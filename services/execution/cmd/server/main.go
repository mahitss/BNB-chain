// Command server runs the OLYR execution service.
//
// Phase 1 exposes a single health endpoint. Bounded spot-trade execution on
// BNB Smart Chain — always simulated before broadcast — arrives in a later
// phase and will live exclusively behind this service.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

const (
	serviceName    = "execution"
	serviceVersion = "0.1.0"
	defaultPort    = 8001
)

// healthResponse mirrors the shared HealthCheck contract from @olyr/types.
type healthResponse struct {
	Service   string `json:"service"`
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Version   string `json:"version"`
}

func envPort(key string, fallback int) int {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return fallback
	}
	port, err := strconv.Atoi(raw)
	if err != nil || port < 1 || port > 65535 {
		slog.Warn("invalid port in environment, using fallback",
			"key", key, "value", raw, "fallback", fallback)
		return fallback
	}
	return port
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	response := healthResponse{
		Service:   serviceName,
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Version:   serviceVersion,
	}
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("failed to encode health response", "error", err)
	}
}

func run() error {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)

	server := &http.Server{
		Addr:              ":" + strconv.Itoa(envPort("EXECUTION_PORT", defaultPort)),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("starting execution service", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}

func main() {
	if err := run(); err != nil {
		slog.Error("execution service failed", "error", err)
		os.Exit(1)
	}
}
