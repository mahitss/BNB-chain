// Command server runs the OLYR execution service (Go).
//
// Phase 6: the ONLY component that signs transactions. It receives a
// structured OLYR execution request (executionId), fetches the full
// chain-of-custody bundle from the Fastify API, verifies every gate, and
// only then signs (EIP-1559 swap tx or EIP-712 RFQ order) and hands the
// signed artifact back to Fastify for broadcast/submit. Idempotent: a
// repeated request for the same proposal returns the existing execution.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/ethereum/go-ethereum/ethclient"

	execution "olyr/execution/internal/execution"
)

const (
	serviceName    = "execution"
	serviceVersion = "0.2.0"
	defaultPort    = 8001
)

type server struct {
	upstreamURL     string
	internalToken   string
	privateKey      string // hex; may be empty → signing unavailable (fail closed)
	rpcURL          string
	httpClient      *http.Client
	logger          *slog.Logger
	expectedChainID string // fail-closed chain guard (Phase 9)
	killSwitch      bool   // OLYR_KILL_SWITCH=enabled → no new execution starts

	mu         sync.Mutex
	byProposal map[string]string // proposalId → executionId (idempotency)
}

func matchesKillSwitch(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "enabled", "true", "1", "stop":
		return true
	}
	return false
}

type executeRequest struct {
	ExecutionID string `json:"executionId"`
}

type upstreamError struct {
	Status int
	Body   string
}

func (e *upstreamError) Error() string {
	return fmt.Sprintf("upstream HTTP %d: %s", e.Status, e.Body)
}

func (s *server) fetchBundle(ctx context.Context, executionID string) (*execution.Bundle, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.upstreamURL+"/api/internal/execution-bundle/"+executionID, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-olyr-internal-token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bundle fetch failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, &upstreamError{Status: resp.StatusCode, Body: string(body)}
	}
	var bundle execution.Bundle
	if err := json.Unmarshal(body, &bundle); err != nil {
		return nil, fmt.Errorf("bundle decode failed: %w", err)
	}
	return &bundle, nil
}

func (s *server) postInternal(ctx context.Context, path string, payload any) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.upstreamURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-olyr-internal-token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, &upstreamError{Status: resp.StatusCode, Body: string(body)}
	}
	return body, nil
}

func (s *server) getInternal(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.upstreamURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-olyr-internal-token", s.internalToken)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, &upstreamError{Status: resp.StatusCode, Body: string(body)}
	}
	return body, nil
}

func (s *server) setState(ctx context.Context, executionID string, to execution.ExecutionState, failureReason string) {
	_, err := s.postInternal(ctx, "/api/internal/execution-state", map[string]string{
		"executionId":   executionID,
		"state":         string(to),
		"failureReason": failureReason,
	})
	if err != nil {
		s.logger.Error("state update failed", "executionId", executionID, "state", to, "error", err.Error())
	}
}

// fetchNonce reads the executor's pending nonce from the configured RPC
// endpoint (standard Ethereum JSON-RPC against the public BSC endpoint).
func (s *server) fetchNonce(ctx context.Context, address string) (uint64, error) {
	client, err := ethclient.DialContext(ctx, s.rpcURL)
	if err != nil {
		return 0, fmt.Errorf("rpc dial failed: %w", err)
	}
	defer client.Close()
	return client.PendingNonceAt(ctx, common.HexToAddress(address))
}

type executionResult struct {
	ExecutionID string `json:"executionId"`
	State       string `json:"state"`
	TxHash      string `json:"txHash"`
	OrderID     string `json:"orderId"`
	Failure     string `json:"failureReason,omitempty"`
}

func (s *server) handleExecute(w http.ResponseWriter, r *http.Request) {
	var request executeRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.ExecutionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "executionId is required"})
		return
	}
	if s.killSwitch {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "OLYR kill switch is ENABLED — no new execution may start",
		})
		return
	}
	if s.privateKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "Executor private key is not configured (OLYR_EXECUTOR_PRIVATE_KEY); signing is unavailable and nothing will be broadcast",
		})
		return
	}

	// Idempotency: one execution per proposal.
	bundle, err := s.fetchBundle(r.Context(), request.ExecutionID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	s.mu.Lock()
	if existing, ok := s.byProposal[bundle.Proposal.ID]; ok {
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]string{"executionId": existing, "state": "ALREADY_SUBMITTED"})
		return
	}
	s.mu.Unlock()

	// Gate verification — any failure blocks with the exact reason.
	if err := execution.VerifyGates(bundle, time.Now()); err != nil {
		var gate *execution.GateError
		if errors.As(err, &gate) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": gate.Reason})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.mu.Lock()
	s.byProposal[bundle.Proposal.ID] = request.ExecutionID
	s.mu.Unlock()

	prep := bundle.SwapPreparation
	go s.runExecution(request.ExecutionID, bundle, prep)
	writeJSON(w, http.StatusAccepted, executionResult{
		ExecutionID: request.ExecutionID,
		State:       "BROADCAST_REQUESTED",
	})
}

func (s *server) runExecution(executionID string, bundle *execution.Bundle, prep *execution.SwapPreparation) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	switch prep.Mode {
	case "SWAP":
		s.runSwap(ctx, executionID, bundle, prep)
	case "RFQ":
		s.runRfq(ctx, executionID, bundle, prep)
	default:
		s.setState(ctx, executionID, execution.StateFailed, "unknown execution mode")
	}
}

func (s *server) runSwap(ctx context.Context, executionID string, bundle *execution.Bundle, prep *execution.SwapPreparation) {
	// Chain guard: the bundle's chain must match the EXPECTED_CHAIN_ID config
	// exactly — never silently switch networks.
	if bundle.ChainID != s.expectedChainID {
		s.setState(ctx, executionID, execution.StateFailed,
			fmt.Sprintf("chain guard: bundle chain %s does not match expected %s", bundle.ChainID, s.expectedChainID))
		return
	}
	chainID := new(big.Int)
	if _, ok := chainID.SetString(bundle.ChainID, 10); !ok {
		s.setState(ctx, executionID, execution.StateFailed, "invalid chainId")
		return
	}
	nonce, err := s.fetchNonce(ctx, bundle.ExecutorAddress)
	if err != nil {
		s.setState(ctx, executionID, execution.StateFailed, "nonce fetch failed: "+err.Error())
		return
	}
	signed, _, err := execution.SignSwapTransaction(s.privateKey, chainID, prep.Tx, nonce)
	if err != nil {
		s.setState(ctx, executionID, execution.StateFailed, err.Error())
		return
	}
	body, err := s.postInternal(ctx, "/api/internal/broadcast", map[string]string{
		"executionId":       executionID,
		"signedTransaction": signed,
	})
	if err != nil {
		s.setState(ctx, executionID, execution.StateFailed, "broadcast failed: "+err.Error())
		return
	}
	var broadcast struct {
		TxHash string `json:"txHash"`
	}
	_ = json.Unmarshal(body, &broadcast)
	s.trackTransaction(ctx, executionID, broadcast.TxHash)
}

func (s *server) runRfq(ctx context.Context, executionID string, bundle *execution.Bundle, prep *execution.SwapPreparation) {
	signature, err := execution.SignTypedData(s.privateKey, prep.RFQ.TypedDataToSign)
	if err != nil {
		s.setState(ctx, executionID, execution.StateFailed, err.Error())
		return
	}
	quoteID := ""
	if bundle.Quote != nil {
		quoteID = bundle.Quote.ID
	}
	body, err := s.postInternal(ctx, "/api/internal/rfq/submit", map[string]string{
		"executionId":   executionID,
		"userSignature": signature,
		"vendor":        prep.RFQ.Vendor,
		"quoteId":       quoteID,
		"signingScheme": prep.RFQ.SigningScheme,
	})
	if err != nil {
		s.setState(ctx, executionID, execution.StateFailed, "rfq submit failed: "+err.Error())
		return
	}
	var submitted struct {
		OrderID string `json:"orderId"`
	}
	_ = json.Unmarshal(body, &submitted)
	// Poll the RFQ order until a terminal state.
	for i := 0; i < 60; i++ {
		time.Sleep(5 * time.Second)
		orderBody, err := s.getInternal(ctx, "/api/internal/rfq/order/"+submitted.OrderID)
		if err != nil {
			continue
		}
		var order struct {
			Status string `json:"status"`
		}
		if err := json.Unmarshal(orderBody, &order); err != nil {
			continue
		}
		switch order.Status {
		case "FILLED":
			s.setState(ctx, executionID, execution.StateConfirmed, "")
			return
		case "FAILED", "EXPIRED", "CANCELLED":
			s.setState(ctx, executionID, execution.StateFailed, "rfq order "+order.Status)
			return
		}
	}
	s.setState(ctx, executionID, execution.StateFailed, "rfq order did not settle within the polling window")
}

func (s *server) trackTransaction(ctx context.Context, executionID, txHash string) {
	s.setState(ctx, executionID, execution.StateConfirming, "")
	for i := 0; i < 60; i++ {
		time.Sleep(5 * time.Second)
		body, err := s.getInternal(ctx, "/api/internal/tx-status/"+txHash)
		if err != nil {
			continue
		}
		var status struct {
			Status   string `json:"status"`
			ErrorMsg string `json:"errorMsg"`
			Height   string `json:"height"`
		}
		if err := json.Unmarshal(body, &status); err != nil {
			continue
		}
		switch status.Status {
		case "success":
			s.setState(ctx, executionID, execution.StateConfirmed, "")
			return
		case "failed":
			s.setState(ctx, executionID, execution.StateFailed, "on-chain failure: "+status.ErrorMsg)
			return
		}
	}
	s.setState(ctx, executionID, execution.StateFailed, "transaction was not confirmed within the tracking window")
}

func (s *server) handleGetExecution(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	defer s.mu.Unlock()
	for proposalID, executionID := range s.byProposal {
		if executionID == id {
			writeJSON(w, http.StatusOK, map[string]string{
				"executionId": executionID,
				"proposalId":  proposalID,
			})
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "execution not found"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func envPort(key string, fallback int) int {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return fallback
	}
	port, err := strconv.Atoi(raw)
	if err != nil || port < 1 || port > 65535 {
		slog.Warn("invalid port in environment, using fallback", "key", key, "fallback", fallback)
		return fallback
	}
	return port
}

func run() error {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	s := &server{
		upstreamURL:     strings.TrimRight(envStr("OLYR_UPSTREAM_URL", "http://localhost:4000"), "/"),
		internalToken:   os.Getenv("OLYR_INTERNAL_TOKEN"),
		privateKey:      os.Getenv("OLYR_EXECUTOR_PRIVATE_KEY"),
		rpcURL:          envStr("OLYR_EXECUTOR_RPC_URL", "https://bsc-dataseed.bnbchain.org"),
		httpClient:      &http.Client{Timeout: 30 * time.Second},
		logger:          slog.Default(),
		byProposal:      map[string]string{},
		expectedChainID: envStr("EXPECTED_CHAIN_ID", envStr("BINANCE_CHAIN_ID", "56")),
		killSwitch:      matchesKillSwitch(os.Getenv("OLYR_KILL_SWITCH")),
	}
	if s.killSwitch {
		slog.Warn("OLYR kill switch is ENABLED — no new execution may start")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /readiness", func(w http.ResponseWriter, _ *http.Request) {
		// Execution is only truly ready when signing is configured.
		ready := s.privateKey != ""
		status := map[string]any{
			"service":  serviceName,
			"version":  serviceVersion,
			"signing":  map[bool]string{true: "configured", false: "not-configured"}[s.privateKey != ""],
			"ready":    ready,
		}
		code := http.StatusOK
		if !ready {
			code = http.StatusServiceUnavailable
		}
		writeJSON(w, code, status)
	})
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"service": serviceName, "status": "ok", "version": serviceVersion,
			"signing": map[bool]string{true: "configured", false: "not-configured"}[s.privateKey != ""],
		})
	})
	mux.HandleFunc("POST /execute", s.handleExecute)
	mux.HandleFunc("GET /executions/{id}", s.handleGetExecution)

	server := &http.Server{
		Addr:              ":" + strconv.Itoa(envPort("EXECUTION_PORT", defaultPort)),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
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

func envStr(key, fallback string) string {
	if raw, ok := os.LookupEnv(key); ok && raw != "" {
		return raw
	}
	return fallback
}

func main() {
	if err := run(); err != nil {
		slog.Error("execution service failed", "error", err)
		os.Exit(1)
	}
}
