/**
 * Execution domain types (Phase 6): quotes, unsigned transactions,
 * simulation results, authorization policy, and the execution state machine.
 *
 * Documented Binance execution modes (official docs):
 * - SWAP: /quote → /swap (quoteId TTL ~30s) returns an unsigned `tx` →
 *   simulate (/pre-transaction/simulate) → client signs EIP-1559 →
 *   /pre-transaction/broadcast-transaction → track via /aggregator/history.
 * - RFQ (equity/RWA tokens — Ondo, BStock): /swap returns
 *   executionMode=RFQ + rfq.typedDataToSign (EIP-712) → sign typed data →
 *   POST /order/submit (idempotent requestId) → poll GET /order/{orderId}
 *   until FILLED / FAILED / EXPIRED / CANCELLED.
 * Unavailable values are null — never invented.
 */

export interface QuoteRoute {
  /** Vendor-supplied quote id; consumed by /swap. TTL ~30s. */
  quoteId: string | null;
  vendorName: string | null;
  fromTokenAddress: string;
  toTokenAddress: string;
  /** Smallest-unit integer strings. */
  fromTokenAmount: string | null;
  toTokenAmount: string | null;
  /** Estimated network fee, USD. */
  tradeFeeUsd: string | null;
  estimateGasFee: string | null;
  router: string | null;
  priceImpactPercent: string | null;
  fromTokenUnitPrice: string | null;
  toTokenUnitPrice: string | null;
  fromTokenSymbol: string | null;
  toTokenSymbol: string | null;
}

export interface TradeQuote {
  id: string;
  chainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amountIn: string;
  /** Best-route estimated output (smallest unit); null when unavailable. */
  estimatedAmountOut: string | null;
  routes: QuoteRoute[];
  /** Seconds after which routes must be re-fetched (documented TTL ~30s). */
  expiresAt: string;
  source: string;
  createdAt: string;
}

/** Unsigned EVM transaction payload — NEVER contains a private key. */
export interface UnsignedTransaction {
  chainId: string;
  from: string;
  to: string;
  data: string;
  value: string;
  gas: string | null;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  nonce: string | null;
}

export type SwapExecutionMode = "SWAP" | "RFQ";

/** Normalized /swap response: exactly one of tx (SWAP) or rfq (RFQ). */
export interface SwapPreparation {
  mode: SwapExecutionMode;
  quoteId: string | null;
  /** Present when mode=SWAP: the unsigned transaction to sign. */
  tx: UnsignedTransaction | null;
  /** Present when mode=RFQ: EIP-712 typed data (serialized) to sign. */
  rfq: {
    vendor: string;
    signingScheme: string | null;
    /** Serialized EIP-712 typed data exactly as returned by Binance. */
    typedDataToSign: string;
  } | null;
  toTokenAmount: string | null;
  minReceiveAmount: string | null;
  slippagePercent: string | null;
  priceImpactPercent: string | null;
  tradeFeeUsd: string | null;
  estimateGasFee: string | null;
}

export type SimulationStatus = "PASSED" | "FAILED" | "UNKNOWN";

export interface SimulationResult {
  id: string;
  proposalId: string | null;
  status: SimulationStatus;
  /** Simulated execution status exactly as reported by the API. */
  apiStatus: string | null;
  failReason: string | null;
  gasEstimate: string | null;
  balanceChanges: Array<{
    contractAddress: string;
    tokenType: string | null;
    /** Signed delta, smallest unit. */
    change: string;
    owner: string;
  }>;
  allowanceChanges: Array<{
    tokenAddress: string;
    owner: string;
    spender: string;
    preAmount: string;
    postAmount: string;
  }>;
  warnings: string[];
  timestamp: string;
  source: string;
}

export type ExecutionPolicyMode = "MANUAL" | "BOUNDED_AGENT" | "DISABLED";

export interface ExecutionPolicy {
  mode: ExecutionPolicyMode;
}

export type AuthorizationDecision = "APPROVED" | "REJECTED";

export interface ExecutionAuthorizationRecord {
  id: string;
  proposalId: string;
  quoteId: string | null;
  simulationId: string | null;
  decision: AuthorizationDecision;
  actor: string;
  policyMode: ExecutionPolicyMode;
  createdAt: string;
}

export type ExecutionState =
  | "CREATED"
  | "RISK_APPROVED"
  | "QUOTE_REQUESTED"
  | "QUOTE_RECEIVED"
  | "SIMULATION_REQUESTED"
  | "SIMULATION_PASSED"
  | "AWAITING_AUTHORIZATION"
  | "AUTHORIZED"
  | "BROADCAST_REQUESTED"
  | "BROADCAST"
  | "CONFIRMING"
  | "CONFIRMED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED";

/** Deterministic transitions; anything else is invalid. */
export const EXECUTION_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  CREATED: ["RISK_APPROVED"],
  RISK_APPROVED: ["QUOTE_REQUESTED", "EXPIRED", "CANCELLED"],
  QUOTE_REQUESTED: ["QUOTE_RECEIVED", "FAILED"],
  QUOTE_RECEIVED: ["SIMULATION_REQUESTED", "FAILED", "EXPIRED", "CANCELLED"],
  SIMULATION_REQUESTED: ["SIMULATION_PASSED", "FAILED"],
  SIMULATION_PASSED: ["AWAITING_AUTHORIZATION", "EXPIRED", "CANCELLED"],
  AWAITING_AUTHORIZATION: ["AUTHORIZED", "CANCELLED", "EXPIRED"],
  AUTHORIZED: ["BROADCAST_REQUESTED", "EXPIRED", "CANCELLED"],
  BROADCAST_REQUESTED: ["BROADCAST", "FAILED"],
  BROADCAST: ["CONFIRMING", "FAILED"],
  CONFIRMING: ["CONFIRMED", "FAILED"],
  CONFIRMED: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function isValidExecutionTransition(from: ExecutionState, to: ExecutionState): boolean {
  return (EXECUTION_TRANSITIONS[from] ?? []).includes(to);
}

export interface ExecutionRecord {
  id: string;
  proposalId: string;
  quoteId: string | null;
  simulationId: string | null;
  authorizationId: string | null;
  state: ExecutionState;
  /** Set after broadcast: platform orderId / tx hash — only real values. */
  orderId: string | null;
  txHash: string | null;
  failureReason: string | null;
  idempotencyKey: string;
  /** LIVE | DRY_RUN | FIXTURE — never faked. */
  environment: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Which environment produced an execution result — never faked. */
export type ExecutionEnvironment = "LIVE" | "DRY_RUN" | "FIXTURE";

export const EXECUTION_EVENT_TYPES = [
  "QUOTE_REQUESTED",
  "QUOTE_RECEIVED",
  "SIMULATION_REQUESTED",
  "SIMULATION_PASSED",
  "SIMULATION_FAILED",
  "AUTHORIZATION_REQUESTED",
  "AUTHORIZED",
  "REJECTED",
  "BROADCAST_REQUESTED",
  "BROADCASTED",
  "CONFIRMING",
  "CONFIRMED",
  "EXECUTION_FAILED",
] as const;
