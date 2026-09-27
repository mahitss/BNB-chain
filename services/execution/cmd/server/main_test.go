package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func upstreamWithBundle(bundle map[string]any) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/internal/execution-bundle/"):
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(bundle)
		case r.URL.Path == "/api/internal/broadcast":
			// Must never be reached in these tests: no key configured.
			w.WriteHeader(http.StatusTeapot)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func validBundleJSON() map[string]any {
	return map[string]any{
		"execution": map[string]any{"id": "exec_1", "state": "RISK_APPROVED"},
		"proposal": map[string]any{
			"id": "prop_1", "status": "APPROVED", "asset": "NVDA",
			"expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
		},
		"quote":         map[string]any{"id": "q1", "quote": map[string]any{"expiresAt": time.Now().Add(30 * time.Second).Format(time.RFC3339)}},
		"simulation":    map[string]any{"id": "sim_1", "status": "PASSED"},
		"authorization": map[string]any{"id": "auth_1", "decision": "APPROVED"},
		"swapPreparation": map[string]any{
			"mode": "SWAP",
			"tx": map[string]any{
				"from": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
				"to":   "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
				"data": "0xdeadbeef", "value": "0", "gas": "21000", "gasPrice": "10000000000",
			},
		},
		"chainId":         "56",
		"executorAddress": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
	}
}

func newTestServer(t *testing.T, upstream *httptest.Server, privateKey string) *server {
	t.Helper()
	return &server{
		upstreamURL:   upstream.URL,
		internalToken: "test-token",
		privateKey:    privateKey,
		rpcURL:        "http://127.0.0.1:1", // unreachable; signing tests don't dial
		httpClient:    &http.Client{Timeout: 5 * time.Second},
		logger:        testLogger(),
		byProposal:    map[string]string{},
	}
}

func postExecute(t *testing.T, s *server, executionID string) *httptest.ResponseRecorder {
	t.Helper()
	body := strings.NewReader(`{"executionId":"` + executionID + `"}`)
	req, _ := http.NewRequest(http.MethodPost, "/execute", body)
	rec := httptest.NewRecorder()
	s.handleExecute(rec, req)
	return rec
}

func TestExecuteFailsClosedWithoutPrivateKey(t *testing.T) {
	upstream := upstreamWithBundle(validBundleJSON())
	defer upstream.Close()
	s := newTestServer(t, upstream, "")
	resp := postExecute(t, s, "exec_1")
	if resp.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing executor key must fail closed with 503, got %d", resp.Code)
	}
	if !strings.Contains(resp.Body.String(), "not configured") {
		t.Fatalf("must report the missing key, got: %s", resp.Body.String())
	}
}

func TestExecuteRejectsGateFailures(t *testing.T) {
	bundle := validBundleJSON()
	bundle["proposal"] = map[string]any{
		"id": "prop_1", "status": "REJECTED", "asset": "NVDA",
		"expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
	}
	upstream := upstreamWithBundle(bundle)
	defer upstream.Close()
	s := newTestServer(t, upstream, testPrivateKeyFixture)
	resp := postExecute(t, s, "exec_1")
	if resp.Code != http.StatusForbidden {
		t.Fatalf("gate failure must return 403, got %d: %s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "APPROVED") {
		t.Fatalf("must carry the exact blocking reason, got: %s", resp.Body.String())
	}
}

func TestExecuteIdempotency(t *testing.T) {
	upstream := upstreamWithBundle(validBundleJSON())
	defer upstream.Close()
	s := newTestServer(t, upstream, testPrivateKeyFixture)
	s.byProposal["prop_1"] = "exec_existing"
	resp := postExecute(t, s, "exec_1")
	if resp.Code != http.StatusOK {
		t.Fatalf("repeated execution must return 200 with the existing id, got %d", resp.Code)
	}
	if !strings.Contains(resp.Body.String(), "exec_existing") {
		t.Fatalf("must return the existing execution, got: %s", resp.Body.String())
	}
}

func TestExecuteMalformedRequest(t *testing.T) {
	upstream := upstreamWithBundle(validBundleJSON())
	defer upstream.Close()
	s := newTestServer(t, upstream, testPrivateKeyFixture)
	req, _ := http.NewRequest(http.MethodPost, "/execute", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	s.handleExecute(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing executionId must return 400, got %d", rec.Code)
	}
}
