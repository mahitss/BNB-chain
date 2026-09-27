// Package execution tests: state machine, gates, and offline signing.
// The test private key is a THROWAWAY fixture — never a real key.
package execution

import (
	"encoding/hex"
	"math/big"
	"strings"
	"testing"
	"time"
)

func validBundle() *Bundle {
	b := &Bundle{}
	b.Execution.ID = "exec_1"
	b.Execution.State = string(StateRiskApproved)
	b.Proposal.ID = "prop_1"
	b.Proposal.Status = "APPROVED"
	b.Proposal.Asset = "NVDA"
	b.Proposal.ExpiresAt = time.Now().Add(time.Hour).Format(time.RFC3339)
	b.Quote = &struct {
		ID    string `json:"id"`
		Quote struct {
			ExpiresAt string `json:"expiresAt"`
		} `json:"quote"`
	}{ID: "quote_1"}
	b.Quote.Quote.ExpiresAt = time.Now().Add(30 * time.Second).Format(time.RFC3339)
	b.Simulation = &struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}{ID: "sim_1", Status: "PASSED"}
	b.SwapPreparation = &SwapPreparation{Mode: "SWAP"}
	b.Authorization = &struct {
		ID       string `json:"id"`
		Decision string `json:"decision"`
	}{ID: "auth_1", Decision: "APPROVED"}
	b.ChainID = "56"
	b.ExecutorAddress = "0x0000000000000000000000000000000000000001"
	return b
}

func TestVerifyGatesHappyPath(t *testing.T) {
	if err := VerifyGates(validBundle(), time.Now()); err != nil {
		t.Fatalf("expected gates to pass, got: %v", err)
	}
}

func TestVerifyGatesRejections(t *testing.T) {
	cases := []struct {
		name   string
		modify func(*Bundle)
		reason string
	}{
		{"wrong execution state", func(b *Bundle) { b.Execution.State = string(StateCreated) }, "RISK_APPROVED"},
		{"risk not approved", func(b *Bundle) { b.Proposal.Status = "REJECTED" }, "APPROVED"},
		{"missing quote", func(b *Bundle) { b.Quote = nil }, "quote is missing"},
		{"missing simulation", func(b *Bundle) { b.Simulation = nil }, "simulation has not been performed"},
		{"missing authorization", func(b *Bundle) { b.Authorization = nil }, "no APPROVED authorization"},
		{"authorization rejected", func(b *Bundle) { b.Authorization.Decision = "REJECTED" }, "no APPROVED authorization"},
		{"missing swap payload", func(b *Bundle) { b.SwapPreparation = nil }, "swap preparation payload is missing"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bundle := validBundle()
			tc.modify(bundle)
			err := VerifyGates(bundle, time.Now())
			if err == nil {
				t.Fatalf("expected gate failure")
			}
			if !strings.Contains(err.Error(), tc.reason) {
				t.Fatalf("expected reason to contain %q, got %q", tc.reason, err.Error())
			}
		})
	}
}

func TestVerifyGatesExpiry(t *testing.T) {
	bundle := validBundle()
	bundle.Proposal.ExpiresAt = time.Now().Add(-time.Minute).Format(time.RFC3339)
	if err := VerifyGates(bundle, time.Now()); err == nil || !strings.Contains(err.Error(), "proposal has expired") {
		t.Fatalf("expired proposal must be blocked, got: %v", err)
	}

	bundle = validBundle()
	bundle.Quote.Quote.ExpiresAt = time.Now().Add(-time.Second).Format(time.RFC3339)
	if err := VerifyGates(bundle, time.Now()); err == nil || !strings.Contains(err.Error(), "quote is expired") {
		t.Fatalf("expired quote must be blocked, got: %v", err)
	}
}

func TestVerifyGatesSimulationStatus(t *testing.T) {
	bundle := validBundle()
	bundle.Simulation.Status = "FAILED"
	if err := VerifyGates(bundle, time.Now()); err == nil || !strings.Contains(err.Error(), "must be PASSED") {
		t.Fatalf("FAILED simulation must block SWAP mode, got: %v", err)
	}

	// RFQ mode: UNKNOWN simulation status is expected (vendor-validated).
	bundle = validBundle()
	bundle.Simulation.Status = "UNKNOWN"
	bundle.SwapPreparation.Mode = "RFQ"
	bundle.SwapPreparation.RFQ = &struct {
		Vendor          string `json:"vendor"`
		SigningScheme   string `json:"signingScheme"`
		TypedDataToSign string `json:"typedDataToSign"`
	}{Vendor: "PcsXRfq"}
	if err := VerifyGates(bundle, time.Now()); err != nil {
		t.Fatalf("RFQ with UNKNOWN simulation must pass gates, got: %v", err)
	}
}

func TestCanTransitionRejectsInvalidJumps(t *testing.T) {
	if CanTransition(StateCreated, StateBroadcast) {
		t.Fatal("CREATED → BROADCAST must be invalid")
	}
	if CanTransition(StateCreated, StateConfirmed) {
		t.Fatal("CREATED → CONFIRMED must be invalid")
	}
	if CanTransition(StateConfirmed, StateFailed) {
		t.Fatal("terminal states must not transition")
	}
	valid := [][2]ExecutionState{
		{StateCreated, StateRiskApproved},
		{StateRiskApproved, StateQuoteRequested},
		{StateAuthorized, StateBroadcastRequested},
		{StateBroadcastRequested, StateBroadcast},
		{StateBroadcast, StateConfirming},
		{StateConfirming, StateConfirmed},
	}
	for _, pair := range valid {
		if !CanTransition(pair[0], pair[1]) {
			t.Fatalf("%s → %s must be valid", pair[0], pair[1])
		}
	}
}

// TEST-ONLY throwaway key. Never holds funds; never used in production.
const testPrivateKey = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

func TestSignSwapTransactionRoundTrip(t *testing.T) {
	tx := &UnsignedSwapTx{
		From:     "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // derived from the test key
		To:       "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
		Data:     "0xa9059cbb0000000000000000000000000000000000000000000000000000000000000001",
		Value:    "0",
		Gas:      "200000",
		GasPrice: "10000000000",
	}
	signed, sender, err := SignSwapTransaction(testPrivateKey, big.NewInt(56), tx, 7)
	if err != nil {
		t.Fatalf("signing failed: %v", err)
	}
	if !strings.HasPrefix(signed, "0x") || len(signed) < 100 {
		t.Fatalf("signed tx must be a 0x-prefixed RLP payload, got len %d", len(signed))
	}
	if !strings.EqualFold(sender, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266") {
		t.Fatalf("unexpected signer address: %s", sender)
	}
}

func TestSignSwapTransactionRejectsMismatchedSender(t *testing.T) {
	tx := &UnsignedSwapTx{
		From:     "0x0000000000000000000000000000000000000099",
		To:       "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
		Data:     "0xdeadbeef",
		Value:    "0",
		Gas:      "21000",
		GasPrice: "10000000000",
	}
	_, _, err := SignSwapTransaction(testPrivateKey, big.NewInt(56), tx, 0)
	if err == nil || !strings.Contains(err.Error(), "does not match the executor wallet") {
		t.Fatalf("signing for another wallet must be rejected, got: %v", err)
	}
}

func TestSignSwapTransactionRejectsInvalidPayload(t *testing.T) {
	cases := []struct {
		name   string
		modify func(*UnsignedSwapTx)
	}{
		{"data without 0x", func(tx *UnsignedSwapTx) { tx.Data = "abcdef" }},
		{"invalid hex data", func(tx *UnsignedSwapTx) { tx.Data = "0xzz" }},
		{"negative value", func(tx *UnsignedSwapTx) { tx.Value = "-5" }},
		{"zero gas", func(tx *UnsignedSwapTx) { tx.Gas = "0" }},
		{"invalid to", func(tx *UnsignedSwapTx) { tx.To = "0x1234" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tx := &UnsignedSwapTx{
				From: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
				To:   "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
				Data: "0xdeadbeef",
				Gas:  "21000",
			}
			tc.modify(tx)
			if _, _, err := SignSwapTransaction(testPrivateKey, big.NewInt(56), tx, 0); err == nil {
				t.Fatalf("invalid payload must be rejected")
			}
		})
	}
}

func TestSignTypedData(t *testing.T) {
	typedData := `{
		"types": {
			"EIP712Domain": [
				{"name": "name", "type": "string"},
				{"name": "version", "type": "string"},
				{"name": "chainId", "type": "uint256"}
			],
			"Order": [{"name": "amount", "type": "uint256"}]
		},
		"primaryType": "Order",
		"domain": {"name": "OLYR", "version": "1", "chainId": 56},
		"message": {"amount": 20}
	}`
	signature, err := SignTypedData(testPrivateKey, typedData)
	if err != nil {
		t.Fatalf("EIP-712 signing failed: %v", err)
	}
	// 0x + 65-byte r||s||v = 132 hex chars.
	if len(signature) != 132 || !strings.HasPrefix(signature, "0x") {
		t.Fatalf("unexpected signature shape: %s", signature)
	}
	// v must be 27/28 per eth_signTypedData_v4 convention.
	v := signature[len(signature)-2:]
	if v != "1b" && v != "1c" {
		t.Fatalf("unexpected v byte: %s", v)
	}

	// Hex-wrapped JSON payload must produce the same signature.
	hexWrapped := "0x" + hex.EncodeToString([]byte(typedData))
	signature2, err := SignTypedData(testPrivateKey, hexWrapped)
	if err != nil || signature2 != signature {
		t.Fatalf("hex-wrapped payload must produce the identical signature")
	}

	// Invalid payload must be rejected.
	if _, err := SignTypedData(testPrivateKey, "0xzz"); err == nil {
		t.Fatal("invalid typed data must be rejected")
	}
}
