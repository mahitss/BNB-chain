/**
 * Capability registry + authoritative execution gate (Phase 7).
 *
 * AgentCapabilities is computed deterministically from configuration, wallet
 * availability, and the execution policy. `canExecuteTrades` defaults to
 * FALSE and can only become true when EVERY precondition holds. The LLM has
 * no path that mutates this registry.
 *
 * ExecutionGate.evaluate() verifies the full 12-point checklist before any
 * execution and returns BLOCKED with deterministic reasons otherwise.
 */
import type { ExecutionPolicyMode, SimulationResult, TradeQuote, TradeProposal } from "@olyr/types";
import type { StrategyLimits } from "../strategies/limits.js";
import type { WalletIdentity } from "./providers.js";

export interface AgentCapabilities {
  canReadMarketData: boolean;
  canReadWallet: boolean;
  canReadPortfolio: boolean;
  canRequestQuotes: boolean;
  canSimulateTransactions: boolean;
  canExecuteTrades: boolean;
  walletConfigured: boolean;
  policyMode: ExecutionPolicyMode;
}

export function computeCapabilities(options: {
  walletIdentity: WalletIdentity | null;
  policyMode: ExecutionPolicyMode;
  binanceConfigured: boolean;
}): AgentCapabilities {
  const status = options.walletIdentity?.status ?? null;
  const walletConfigured =
    status === "CONNECTED" ||
    status === "CONFIGURED" ||
    status === "SIGNED_OUT" ||
    (options.walletIdentity?.versions.cli !== null &&
      options.walletIdentity?.versions.cli !== undefined);
  // Execution additionally requires a signing-capable identity (CLI-backed
  // session). A read-only configured address NEVER enables execution.
  const executionCapable =
    status === "SIGNED_OUT" ||
    (options.walletIdentity?.versions.cli !== null &&
      options.walletIdentity?.versions.cli !== undefined);
  const policyAllows = options.policyMode !== "DISABLED";
  return {
    canReadMarketData: options.binanceConfigured,
    canReadWallet: walletConfigured,
    canReadPortfolio: walletConfigured,
    canRequestQuotes: options.binanceConfigured && policyAllows,
    canSimulateTransactions: options.binanceConfigured && policyAllows,
    canExecuteTrades: executionCapable && policyAllows,
    walletConfigured,
    policyMode: options.policyMode,
  };
}

export interface StrategyRecordLike {
  status: string;
  definition: { asset: { ticker: string }; action: { type: string; maxUsd?: number } };
}

export interface GateContext {
  proposal: TradeProposal;
  strategy: StrategyRecordLike | null;
  quote: { id: string; quote: TradeQuote } | null;
  simulation: { id: string; simulation: SimulationResult } | null;
  authorization: { id: string; decision: string } | null;
  policy: {
    mode: ExecutionPolicyMode;
    maxTradeUsd: number;
    maxDailyUsd: number;
    maxSlippagePercent: number;
    allowedAssets: string[];
    allowedActions: string[];
    requireHumanApprovalAboveUsd: number;
  };
  limits: StrategyLimits;
  /** Sum of already-executed/proposed trade volume today, USD. */
  dailyUsedUsd: number;
  /** True when this execution attempt comes from the bounded agent loop. */
  fromAgent: boolean;
  /** ISO instant of the strategy's last execution, if any. */
  lastExecutionAt: string | null;
  cooldownSeconds: number;
  /** Dedup window key: an identical active execution within the window blocks. */
  duplicateExecutionExists: boolean;
  now?: Date;
}

export interface GateCheck {
  check: string;
  passed: boolean;
  reason: string;
}

export interface GateResult {
  decision: "APPROVED" | "BLOCKED" | "REQUIRES_APPROVAL";
  checks: GateCheck[];
  reasons: string[];
}

/**
 * The single authoritative execution gate. MANUAL user executions and
 * bounded-agent executions both pass through here; the agent path has two
 * extra constraints (strategy must be ACTIVE; amount above the human
 * threshold requires explicit user authorization).
 */
export function evaluateExecutionGate(ctx: GateContext): GateResult {
  const now = ctx.now ?? new Date();
  const checks: GateCheck[] = [];
  const check = (name: string, passed: boolean, reason: string) =>
    checks.push({ check: name, passed, reason });

  // 1. Strategy active (agent path only; the human may execute a DRAFT once).
  check(
    "STRATEGY_ACTIVE",
    !ctx.fromAgent || ctx.strategy?.status === "ACTIVE",
    ctx.strategy
      ? `Strategy status is ${ctx.strategy.status}; agent execution requires ACTIVE`
      : "Strategy not found",
  );
  // 2/3. Proposal valid + not expired.
  check("PROPOSAL_VALID", Boolean(ctx.proposal), "Proposal missing");
  const proposalExpired = ctx.proposal ? Date.parse(ctx.proposal.expiresAt) < now.getTime() : true;
  check("PROPOSAL_NOT_EXPIRED", !proposalExpired, "Proposal has expired");
  // 4/5. Allowlists (platform policy — never the strategy's own lists).
  const ticker = ctx.strategy?.definition.asset.ticker ?? ctx.proposal.asset;
  const assetAllowed =
    ctx.limits.allowedAssets.length === 0 ||
    ctx.limits.allowedAssets.includes(ticker.toUpperCase());
  check("ASSET_ALLOWED", assetAllowed, `Asset ${ticker} is not in the configured allowed assets`);
  const actionAllowed =
    ctx.limits.allowedActions.length === 0 ||
    ctx.limits.allowedActions.includes(ctx.proposal.action);
  check(
    "ACTION_ALLOWED",
    actionAllowed,
    `Action ${ctx.proposal.action} is not in the configured allowed actions`,
  );
  // 6. Risk decision APPROVED.
  check(
    "RISK_APPROVED",
    ctx.proposal.status === "APPROVED",
    `Risk decision must be APPROVED (current: ${ctx.proposal.status})`,
  );
  // 7. Quote valid + unexpired.
  const quoteExpired = !ctx.quote || Date.parse(ctx.quote.quote.expiresAt) < now.getTime();
  check("QUOTE_VALID", Boolean(ctx.quote) && !quoteExpired, "Quote is missing or expired");
  // 8. Simulation PASSED (SWAP) or vendor-validated RFQ (UNKNOWN recorded).
  const simOk =
    Boolean(ctx.simulation) &&
    (ctx.simulation!.simulation.status === "PASSED" ||
      ctx.simulation!.simulation.status === "UNKNOWN");
  check(
    "SIMULATION_PASSED",
    simOk,
    ctx.simulation?.simulation.status === "FAILED"
      ? "Simulation FAILED — the transaction would revert"
      : "Simulation has not been performed",
  );
  // 9. Authorization valid.
  check(
    "AUTHORIZATION_VALID",
    ctx.authorization?.decision === "APPROVED",
    "No APPROVED authorization for this proposal",
  );
  // 10. Execution policy allows it.
  check("POLICY_ALLOWS", ctx.policy.mode !== "DISABLED", "Execution policy is DISABLED");
  // 11. Daily limits.
  const requested = ctx.proposal.requestedAmountUsd;
  check(
    "DAILY_LIMIT_AVAILABLE",
    ctx.dailyUsedUsd + requested <= ctx.policy.maxDailyUsd,
    `Daily usage ${ctx.dailyUsedUsd} + requested ${requested} exceeds the ${ctx.policy.maxDailyUsd} daily maximum`,
  );
  // 12. Position/cooldown/dedup + human-approval threshold.
  check(
    "NO_DUPLICATE_EXECUTION",
    !ctx.duplicateExecutionExists,
    "An active execution for this signal already exists",
  );
  const cooldownActive =
    ctx.lastExecutionAt !== null &&
    now.getTime() - Date.parse(ctx.lastExecutionAt) < ctx.cooldownSeconds * 1000;
  check(
    "COOLDOWN_RESPECTED",
    !cooldownActive,
    `Strategy is in cooldown (${ctx.cooldownSeconds}s after its last execution)`,
  );
  const requiresApproval = ctx.fromAgent && requested > ctx.policy.requireHumanApprovalAboveUsd;
  // The threshold is NOT a hard block: it routes the proposal to explicit
  // human authorization instead (REQUIRES_APPROVAL).
  check(
    "HUMAN_APPROVAL_THRESHOLD",
    !requiresApproval,
    `Requested $${requested} exceeds the $${ctx.policy.requireHumanApprovalAboveUsd} auto-execution limit; explicit user approval required`,
  );

  const hardReasons = checks
    .filter((c) => !c.passed && c.check !== "HUMAN_APPROVAL_THRESHOLD")
    .map((c) => c.reason);
  if (hardReasons.length > 0) {
    return { decision: "BLOCKED", checks, reasons: hardReasons };
  }
  if (requiresApproval) {
    return {
      decision: "REQUIRES_APPROVAL",
      checks,
      reasons: [
        `Requested $${requested} exceeds the $${ctx.policy.requireHumanApprovalAboveUsd} auto-execution limit; explicit user approval required`,
      ],
    };
  }
  return { decision: "APPROVED", checks, reasons: [] };
}
