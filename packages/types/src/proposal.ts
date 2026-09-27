/**
 * Trade-proposal domain types (Phase 5). The Rust risk engine consumes the
 * `RiskInput` shape; Fastify builds proposals from validated strategies +
 * market intelligence and persists decisions for audit.
 */

export type TradeAction = "BUY" | "SELL" | "REDUCE_POSITION" | "REBALANCE";

export type RiskDecisionOutcome = "APPROVED" | "REJECTED" | "REQUIRES_REVIEW";

export type ProposalStatus =
  | "PENDING_RISK"
  | "REJECTED"
  | "REQUIRES_REVIEW"
  | "APPROVED"
  | "EXPIRED"
  | "SIMULATION_PENDING"
  | "SIMULATION_PASSED"
  | "SIMULATION_FAILED"
  | "READY_FOR_EXECUTION";
// NOTE: EXECUTED does not exist — trading arrives in a later phase.

/** Input to the Rust risk engine. Unavailable values are null, never invented. */
export interface RiskInput {
  asset: string;
  action: TradeAction;
  requestedAmountUsd: number;
  estimatedPrice: number | null;
  referencePrice: number | null;
  spreadPercent: number | null;
  estimatedSlippagePercent: number | null;
  marketState: string | null;
  referenceFreshness: string | null;
  liquidityStatus: "SUFFICIENT" | "INSUFFICIENT" | "UNKNOWN" | null;
  currentPositionUsd: number | null;
  dailyTradedUsd: number | null;
  dailyVolumeUsd: number | null;
  referenceAgeSeconds: number | null;
}

export interface RiskRuleResult {
  rule: string;
  outcome: "PASSED" | "FAILED" | "REVIEW";
  reason?: string | null;
  warning?: string | null;
}

export interface RiskDecision {
  decision: RiskDecisionOutcome;
  rulesEvaluated: string[];
  rulesPassed: string[];
  rulesFailed: RiskRuleResult[];
  warnings: string[];
  requiresReview: string[];
  timestamp: string;
}

/** Audit-trail event types for the proposal pipeline. */
export const PROPOSAL_EVENT_TYPES = [
  "STRATEGY_EVALUATED",
  "OPPORTUNITY_MATCHED",
  "PROPOSAL_CREATED",
  "RISK_EVALUATION_STARTED",
  "RISK_EVALUATION_COMPLETED",
] as const;

export interface TradeProposal {
  id: string;
  strategyId: string | null;
  strategyName: string;
  asset: string;
  action: TradeAction;
  requestedAmountUsd: number;
  estimatedPrice: number | null;
  referencePrice: number | null;
  spreadPercent: number | null;
  marketState: string | null;
  liquidityStatus: string | null;
  status: ProposalStatus;
  expiresAt: string;
  createdAt: string;
  /** Latest risk decision, when one exists. */
  riskDecision: RiskDecision | null;
  /** Set once a real broadcast succeeded (Phase 6); never fabricated. */
  txHash: string | null;
}

/** Human-readable risk explanation generated from structured rule results. */
export function explainRiskDecision(decision: RiskDecision): string {
  if (decision.decision === "APPROVED") {
    return (
      `Trade approved: ${decision.rulesPassed.length} deterministic checks passed ` +
      `(${decision.rulesPassed.join(", ")}), and no configured limit was exceeded.`
    );
  }
  if (decision.decision === "REJECTED") {
    const reasons = decision.rulesFailed
      .map((rule) => `${rule.rule}: ${rule.reason ?? "failed"}`)
      .join(" ");
    return `Trade rejected. ${reasons}`;
  }
  return (
    `Trade requires manual review: ${decision.requiresReview.join(", ")}. ` +
    `Warnings: ${decision.warnings.join(" ") || "none"}.`
  );
}
