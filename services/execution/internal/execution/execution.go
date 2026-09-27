// Package execution implements OLYR's deterministic execution state machine,
// authorization verification, and transaction signing.
//
// SECURITY BOUNDARIES (Phase 6):
//   - This service is the ONLY component that holds the executor private key.
//   - It accepts only structured OLYR execution requests and verifies the
//     full server-side chain of custody (proposal → quote → simulation →
//     authorization) before signing anything.
//   - It never calls the LLM, never touches Binance credentials, and never
//     broadcasts anything that has not passed every gate.
package execution

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/signer/core/apitypes"
)

// ExecutionState mirrors @olyr/types ExecutionState.
type ExecutionState string

const (
	StateCreated             ExecutionState = "CREATED"
	StateRiskApproved        ExecutionState = "RISK_APPROVED"
	StateQuoteRequested      ExecutionState = "QUOTE_REQUESTED"
	StateQuoteReceived       ExecutionState = "QUOTE_RECEIVED"
	StateSimulationRequested ExecutionState = "SIMULATION_REQUESTED"
	StateSimulationPassed    ExecutionState = "SIMULATION_PASSED"
	StateAwaitingAuth        ExecutionState = "AWAITING_AUTHORIZATION"
	StateAuthorized          ExecutionState = "AUTHORIZED"
	StateBroadcastRequested  ExecutionState = "BROADCAST_REQUESTED"
	StateBroadcast           ExecutionState = "BROADCAST"
	StateConfirming          ExecutionState = "CONFIRMING"
	StateConfirmed           ExecutionState = "CONFIRMED"
	StateFailed              ExecutionState = "FAILED"
	StateExpired             ExecutionState = "EXPIRED"
	StateCancelled           ExecutionState = "CANCELLED"
)

// transitions is the documented state machine; anything not listed is invalid.
var transitions = map[ExecutionState][]ExecutionState{
	StateCreated:             {StateRiskApproved},
	StateRiskApproved:        {StateQuoteRequested, StateExpired, StateCancelled},
	StateQuoteRequested:      {StateQuoteReceived, StateFailed},
	StateQuoteReceived:       {StateSimulationRequested, StateFailed, StateExpired, StateCancelled},
	StateSimulationRequested: {StateSimulationPassed, StateFailed},
	StateSimulationPassed:    {StateAwaitingAuth, StateExpired, StateCancelled},
	StateAwaitingAuth:        {StateAuthorized, StateCancelled, StateExpired},
	StateAuthorized:          {StateBroadcastRequested, StateExpired, StateCancelled},
	StateBroadcastRequested:  {StateBroadcast, StateFailed},
	StateBroadcast:           {StateConfirming, StateFailed},
	StateConfirming:          {StateConfirmed, StateFailed},
	StateConfirmed:           {},
	StateFailed:              {},
	StateExpired:             {},
	StateCancelled:           {},
}

// CanTransition reports whether from → to is a valid transition.
func CanTransition(from, to ExecutionState) bool {
	for _, next := range transitions[from] {
		if next == to {
			return true
		}
	}
	return false
}

// GateError carries the exact blocking reason — never a generic failure.
type GateError struct{ Reason string }

func (e *GateError) Error() string { return e.Reason }

// UnsignedSwapTx mirrors the documented unsigned `tx` object from /swap.
type UnsignedSwapTx struct {
	From                 string `json:"from"`
	To                   string `json:"to"`
	Data                 string `json:"data"`
	Value                string `json:"value"`
	Gas                  string `json:"gas"`
	GasPrice             string `json:"gasPrice"`
	MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas"`
}

// SwapPreparation mirrors the normalized /swap response stored by the API.
type SwapPreparation struct {
	Mode string          `json:"mode"`
	Tx   *UnsignedSwapTx `json:"tx"`
	RFQ  *struct {
		Vendor          string `json:"vendor"`
		SigningScheme   string `json:"signingScheme"`
		TypedDataToSign string `json:"typedDataToSign"`
	} `json:"rfq"`
}

// Bundle is the server-side chain of custody fetched from the OLYR API.
type Bundle struct {
	Execution struct {
		ID      string `json:"id"`
		State   string `json:"state"`
		TxHash  string `json:"txHash"`
		OrderID string `json:"orderId"`
	} `json:"execution"`
	Proposal struct {
		ID        string `json:"id"`
		Status    string `json:"status"`
		Asset     string `json:"asset"`
		ExpiresAt string `json:"expiresAt"`
	} `json:"proposal"`
	Quote *struct {
		ID    string `json:"id"`
		Quote struct {
			ExpiresAt string `json:"expiresAt"`
		} `json:"quote"`
	} `json:"quote"`
	Simulation *struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	} `json:"simulation"`
	SwapPreparation *SwapPreparation `json:"swapPreparation"`
	Authorization   *struct {
		ID       string `json:"id"`
		Decision string `json:"decision"`
	} `json:"authorization"`
	ChainID         string `json:"chainId"`
	ExecutorAddress string `json:"executorAddress"`
}

// VerifyGates enforces every documented precondition. Any failure returns a
// GateError with the exact reason; NO execution proceeds otherwise.
func VerifyGates(bundle *Bundle, now time.Time) error {
	if bundle.Execution.State != string(StateRiskApproved) {
		return &GateError{Reason: fmt.Sprintf(
			"execution state must be RISK_APPROVED (current: %s)", bundle.Execution.State)}
	}
	if bundle.Proposal.Status != "APPROVED" {
		return &GateError{Reason: fmt.Sprintf(
			"risk decision must be APPROVED (current: %s)", bundle.Proposal.Status)}
	}
	if expires, err := time.Parse(time.RFC3339, bundle.Proposal.ExpiresAt); err == nil && expires.Before(now) {
		return &GateError{Reason: "proposal has expired; re-evaluate risk first"}
	}
	if bundle.Quote == nil {
		return &GateError{Reason: "quote is missing"}
	}
	if expires, err := time.Parse(time.RFC3339, bundle.Quote.Quote.ExpiresAt); err == nil && expires.Before(now) {
		return &GateError{Reason: "quote is expired; fetch a fresh quote"}
	}
	if bundle.Authorization == nil || bundle.Authorization.Decision != "APPROVED" {
		return &GateError{Reason: "no APPROVED authorization for this proposal"}
	}
	if bundle.Simulation == nil {
		return &GateError{Reason: "simulation has not been performed"}
	}
	if bundle.SwapPreparation == nil {
		return &GateError{Reason: "swap preparation payload is missing"}
	}
	switch bundle.SwapPreparation.Mode {
	case "SWAP":
		if bundle.Simulation.Status != "PASSED" {
			return &GateError{Reason: fmt.Sprintf(
				"simulation must be PASSED (current: %s)", bundle.Simulation.Status)}
		}
	case "RFQ":
		// RFQ orders are vendor-validated at submission; the EVM simulator
		// does not apply to EIP-712 orders. Simulation status UNKNOWN is
		// the expected recorded state for RFQ mode.
	default:
		return &GateError{Reason: fmt.Sprintf("unknown execution mode %q", bundle.SwapPreparation.Mode)}
	}
	return nil
}

// parseBigInt parses a decimal or 0x-prefixed hex numeric string.
func parseBigInt(value string) (*big.Int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, errors.New("empty numeric value")
	}
	if strings.HasPrefix(value, "0x") || strings.HasPrefix(value, "0X") {
		n, ok := new(big.Int).SetString(value[2:], 16)
		if !ok {
			return nil, fmt.Errorf("invalid numeric value %q", value)
		}
		return n, nil
	}
	neg := false
	if strings.HasPrefix(value, "-") {
		neg, value = true, value[1:]
	}
	n, ok := new(big.Int).SetString(value, 10)
	if !ok {
		return nil, fmt.Errorf("invalid numeric value %q", value)
	}
	if neg {
		n.Neg(n)
	}
	return n, nil
}

// SignSwapTransaction signs the unsigned EVM transaction as a legacy
// (gasPrice) transaction with EIP-155 replay protection, returning the raw
// signed hex and the signer address. The private key never leaves this scope.
func SignSwapTransaction(privateKeyHex string, chainID *big.Int, tx *UnsignedSwapTx, nonce uint64) (string, string, error) {
	key, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return "", "", fmt.Errorf("invalid executor private key: %w", err)
	}
	if !strings.HasPrefix(tx.Data, "0x") {
		return "", "", &GateError{Reason: "transaction data must be 0x-prefixed calldata"}
	}
	data, err := hex.DecodeString(tx.Data[2:])
	if err != nil {
		return "", "", &GateError{Reason: "transaction data is not valid hex"}
	}
	value, err := parseBigInt(tx.Value)
	if err != nil {
		return "", "", &GateError{Reason: "transaction value is invalid: " + err.Error()}
	}
	gas, err := parseBigInt(tx.Gas)
	if err != nil || gas.Sign() <= 0 {
		return "", "", &GateError{Reason: "transaction gas is missing or invalid"}
	}
	gasPrice, err := parseBigInt(tx.GasPrice)
	if err != nil || gasPrice.Sign() <= 0 {
		return "", "", &GateError{Reason: "transaction gasPrice is missing or invalid"}
	}
	if !common.IsHexAddress(tx.To) {
		return "", "", &GateError{Reason: "transaction `to` is not a valid contract address"}
	}
	to := common.HexToAddress(tx.To)
	legacy := &types.LegacyTx{
		Nonce:    nonce,
		GasPrice: gasPrice,
		Gas:      gas.Uint64(),
		To:       &to,
		Value:    value,
		Data:     data,
	}
	signed, err := types.SignTx(types.NewTx(legacy), types.NewEIP155Signer(chainID), key)
	if err != nil {
		return "", "", fmt.Errorf("signing failed: %w", err)
	}
	raw, err := signed.MarshalBinary()
	if err != nil {
		return "", "", fmt.Errorf("rlp encoding failed: %w", err)
	}
	sender := crypto.PubkeyToAddress(key.PublicKey)
	if from := strings.ToLower(tx.From); from != "" && from != strings.ToLower(sender.Hex()) {
		return "", "", &GateError{Reason: "transaction `from` does not match the executor wallet"}
	}
	return "0x" + hex.EncodeToString(raw), sender.Hex(), nil
}

// SignTypedData signs EIP-712 typed data (RFQ orders) with the executor key.
// Binance returns typedDataToSign serialized as JSON or as a 0x-prefixed hex
// string of that JSON; both forms are accepted. v follows the
// eth_signTypedData_v4 convention (27/28).
func SignTypedData(privateKeyHex, typedData string) (string, error) {
	key, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return "", fmt.Errorf("invalid executor private key: %w", err)
	}
	payload := typedData
	if strings.HasPrefix(payload, "0x") {
		decoded, err := hex.DecodeString(payload[2:])
		if err != nil {
			return "", &GateError{Reason: "typedDataToSign hex payload is invalid"}
		}
		payload = string(decoded)
	}
	var typedDataStruct apitypes.TypedData
	if err := json.Unmarshal([]byte(payload), &typedDataStruct); err != nil {
		return "", &GateError{Reason: "typedDataToSign is not valid EIP-712 JSON"}
	}
	domainSeparator, err := typedDataStruct.HashStruct("EIP712Domain", typedDataStruct.Domain.Map())
	if err != nil {
		return "", fmt.Errorf("hashing EIP712Domain failed: %w", err)
	}
	messageHash, err := typedDataStruct.HashStruct(typedDataStruct.PrimaryType, typedDataStruct.Message)
	if err != nil {
		return "", fmt.Errorf("hashing message failed: %w", err)
	}
	digest := crypto.Keccak256(append([]byte("\x19\x01"), append(domainSeparator, messageHash...)...))
	signature, err := crypto.Sign(digest, key)
	if err != nil {
		return "", fmt.Errorf("signing failed: %w", err)
	}
	signature[64] += 27
	return "0x" + hex.EncodeToString(signature), nil
}
