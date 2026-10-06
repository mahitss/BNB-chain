/**
 * Trade-proposal builder + service.
 *
 * Deterministic: builds a RiskInput from the validated strategy (Phase 4),
 * the latest scanner snapshot/opportunity (Phase 3), and explicitly
 * represented portfolio state (unavailable in this phase → null, never
 * invented). Platform limits flow from the same environment the Rust engine
 * reads — the LLM can never influence any of it.
 *
 * Portfolio state: real wallet positions flow in through the optional
 * position resolver when a wallet is configured; otherwise
 * currentPositionUsd is null and the Rust engine's UNKNOWN branches handle
 * it (fail-closed). Daily traded volume starts at 0 — OLYR has never
 * executed a trade.
 */
import type {
  MarketSnapshot,
  RiskDecision,
  RiskInput,
  StrategyDefinition,
  TradeAction,
  TradeProposal,
} from "@olyr/types";
import type { RiskEngineClient } from "./risk-client.js";

export interface ProposalStoreLike {
  createProposal(data: {
    strategyId: string | null;
    asset: string;
    action: string;
    requestedAmountUsd: number;
    estimatedPrice: number | null;
    referencePrice: number | null;
    spreadPercent: number | null;
    estimatedSlippagePercent: number | null;
    marketState: string | null;
    referenceFreshness: string | null;
    liquidityStatus: string | null;
    currentPositionUsd: number | null;
    dailyTradedUsd: number | null;
    dailyVolumeUsd: number | null;
    referenceAgeSeconds: number | null;
    status: string;
    expiresAt: Date;
  }): Promise<{ id: string; createdAt: Date }>;
  listProposals(): Promise<Array<Record<string, unknown>>>;
  getProposal(id: string): Promise<Record<string, unknown> | null>;
  updateProposalStatus(id: string, status: string): Promise<void>;
  createEvaluation(data: {
    proposalId: string;
    decision: string;
    input: RiskInput;
    decisionJson: RiskDecision;
  }): Promise<{ id: string }>;
  getEvaluations(proposalId: string): Promise<Array<Record<string, unknown>>>;
}

const ACTION_BY_STRATEGY_ACTION: Record<string, TradeAction> = {
  PROPOSE_BUY: "BUY",
  PROPOSE_SELL: "SELL",
  PROPOSE_REDUCE_POSITION: "REDUCE_POSITION",
  PROPOSE_REBALANCE: "REBALANCE",
};

function liquidityToRisk(liquidityStatus: string | null): RiskInput["liquidityStatus"] {
  switch (liquidityStatus) {
    case "AVAILABLE":
      return "SUFFICIENT";
    case "NONE":
      return "INSUFFICIENT";
    default:
      return "UNKNOWN";
  }
}

export class ProposalService {
  private readonly store: ProposalStoreLike;
  private readonly riskClient: RiskEngineClient;
  private readonly ttlSeconds: number;
  /** Real wallet position lookup (USD) by underlying ticker. Absent or
   * failing → null (unknown), which keeps POSITION_LIMIT fail-closed. */
  private readonly positionUsdForTicker?: (ticker: string) => Promise<number | null>;

  constructor(
    store: ProposalStoreLike,
    riskClient: RiskEngineClient,
    ttlSeconds: number,
    options: { positionUsdForTicker?: (ticker: string) => Promise<number | null> } = {},
  ) {
    this.store = store;
    this.riskClient = riskClient;
    this.ttlSeconds = ttlSeconds;
    this.positionUsdForTicker = options.positionUsdForTicker;
  }

  /** Wallet position in USD, or null when unknown. Never throws: any failure
   * means unknown, and unknown must reach the risk engine as null — never 0. */
  private async resolvePositionUsd(ticker: string): Promise<number | null> {
    if (!this.positionUsdForTicker) return null;
    try {
      const value = await this.positionUsdForTicker(ticker);
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  /** Build a proposal from the validated strategy + latest market data. */
  buildInput(
    strategy: StrategyDefinition,
    snapshot: MarketSnapshot | null,
    currentPositionUsd: number | null = null,
  ): RiskInput {
    const action = ACTION_BY_STRATEGY_ACTION[strategy.action.type];
    if (!action) {
      throw new Error(`Strategy action ${strategy.action.type} does not produce a trade proposal`);
    }
    return {
      asset: strategy.asset.ticker,
      action,
      requestedAmountUsd: strategy.action.maxUsd ?? 0,
      estimatedPrice:
        snapshot?.onChainPrice !== undefined && snapshot.onChainPrice !== null
          ? Number(snapshot.onChainPrice)
          : null,
      referencePrice:
        snapshot?.referencePrice !== undefined && snapshot.referencePrice !== null
          ? Number(snapshot.referencePrice)
          : null,
      spreadPercent:
        snapshot?.divergence.spreadPercent !== null && snapshot
          ? Number(snapshot.divergence.spreadPercent)
          : null,
      estimatedSlippagePercent: null, // unavailable until the execution phase
      marketState: snapshot?.marketState ?? null,
      referenceFreshness: snapshot?.referenceFreshness ?? null,
      liquidityStatus: liquidityToRisk(snapshot?.liquidity.status ?? null),
      currentPositionUsd, // real wallet position when resolvable, else null (fail-closed)
      dailyTradedUsd: 0, // OLYR has never executed a trade
      dailyVolumeUsd:
        snapshot?.volume24H !== undefined &&
        snapshot.volume24H !== null &&
        snapshot.volume24H.trim() !== ""
          ? Number(snapshot.volume24H)
          : null,
      referenceAgeSeconds: snapshot?.referenceAgeSeconds ?? null,
    };
  }

  /** Create a PENDING_RISK proposal from strategy + latest opportunity data. */
  async create(
    strategy: StrategyDefinition,
    strategyId: string | null,
    snapshot: MarketSnapshot | null,
  ): Promise<TradeProposal> {
    const input = this.buildInput(
      strategy,
      snapshot,
      await this.resolvePositionUsd(strategy.asset.ticker),
    );
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const row = await this.store.createProposal({
      strategyId,
      asset: input.asset,
      action: input.action,
      requestedAmountUsd: input.requestedAmountUsd,
      estimatedPrice: input.estimatedPrice,
      referencePrice: input.referencePrice,
      spreadPercent: input.spreadPercent,
      estimatedSlippagePercent: input.estimatedSlippagePercent,
      marketState: input.marketState,
      referenceFreshness: input.referenceFreshness,
      liquidityStatus: input.liquidityStatus,
      currentPositionUsd: input.currentPositionUsd,
      dailyTradedUsd: input.dailyTradedUsd,
      dailyVolumeUsd: input.dailyVolumeUsd,
      referenceAgeSeconds: input.referenceAgeSeconds,
      status: "PENDING_RISK",
      expiresAt,
    });
    return {
      id: row.id,
      strategyId,
      strategyName: strategy.name,
      asset: input.asset,
      action: input.action,
      requestedAmountUsd: input.requestedAmountUsd,
      estimatedPrice: input.estimatedPrice,
      referencePrice: input.referencePrice,
      spreadPercent: input.spreadPercent,
      marketState: input.marketState,
      liquidityStatus: input.liquidityStatus,
      status: "PENDING_RISK",
      expiresAt: expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      riskDecision: null,
      txHash: null,
    };
  }

  /** Sends the stored inputs to the Rust engine and persists the decision. */
  async evaluateRisk(proposal: TradeProposal, input: RiskInput): Promise<RiskDecision> {
    const decision = await this.riskClient.evaluate(input);
    const now = Date.now();
    const expiresAt = Date.parse(proposal.expiresAt);
    const status =
      decision.decision === "APPROVED" && expiresAt < now ? "EXPIRED" : decision.decision;
    await this.store.updateProposalStatus(proposal.id, status);
    await this.store.createEvaluation({
      proposalId: proposal.id,
      decision: decision.decision,
      input,
      decisionJson: decision,
    });
    return decision;
  }

  async list(): Promise<TradeProposal[]> {
    const rows = await this.store.listProposals();
    return rows.map((row) => this.toProposal(row));
  }

  async get(
    id: string,
  ): Promise<{ proposal: TradeProposal; input: RiskInput; evaluations: RiskDecision[] } | null> {
    const row = await this.store.getProposal(id);
    if (!row) {
      return null;
    }
    const evaluations = (await this.store.getEvaluations(id)) as unknown as RiskDecision[];
    return {
      proposal: this.toProposal(row, evaluations),
      input: this.inputFromRow(row),
      evaluations,
    };
  }

  /** Status update used by the bounded agent loop after risk evaluation. */
  async updateStatus(id: string, status: string): Promise<void> {
    await this.store.updateProposalStatus(id, status);
  }

  /** Evaluate a stored proposal: reuses the EXACT stored inputs (audit-safe). */
  async evaluateStored(id: string): Promise<{ proposal: TradeProposal; decision: RiskDecision }> {
    const row = await this.store.getProposal(id);
    if (!row) {
      throw new Error("NOT_FOUND");
    }
    const input = this.inputFromRow(row);
    const decision = await this.riskClient.evaluate(input);
    const status = this.statusFor(decision, row);
    await this.store.updateProposalStatus(id, status);
    await this.store.createEvaluation({
      proposalId: id,
      decision: decision.decision,
      input,
      decisionJson: decision,
    });
    const updated = await this.store.getProposal(id);
    return { proposal: this.toProposal(updated ?? row, [decision]), decision };
  }

  /** Fresh market data → NEW RiskEvaluation; history is never mutated. */
  async reevaluate(
    id: string,
    marketService: { getSnapshot(ticker: string): Promise<unknown> } | null,
  ): Promise<{ proposal: TradeProposal; decision: RiskDecision }> {
    const row = await this.store.getProposal(id);
    if (!row) {
      throw new Error("NOT_FOUND");
    }
    const snapshot = marketService
      ? ((await marketService.getSnapshot(row.asset as string)) as MarketSnapshot | null)
      : null;
    const freshInput: RiskInput = {
      ...this.inputFromRow(row),
      estimatedPrice:
        snapshot?.onChainPrice !== undefined && snapshot.onChainPrice !== null
          ? Number(snapshot.onChainPrice)
          : null,
      referencePrice:
        snapshot?.referencePrice !== undefined && snapshot.referencePrice !== null
          ? Number(snapshot.referencePrice)
          : null,
      spreadPercent:
        snapshot?.divergence.spreadPercent !== null && snapshot
          ? Number(snapshot.divergence.spreadPercent)
          : null,
      marketState: snapshot?.marketState ?? null,
      referenceFreshness: snapshot?.referenceFreshness ?? null,
      liquidityStatus: liquidityToRisk(snapshot?.liquidity.status ?? null),
      referenceAgeSeconds: snapshot?.referenceAgeSeconds ?? null,
    };
    const decision = await this.riskClient.evaluate(freshInput);
    const status = this.statusFor(decision, row);
    await this.store.updateProposalStatus(id, status);
    await this.store.createEvaluation({
      proposalId: id,
      decision: decision.decision,
      input: freshInput,
      decisionJson: decision,
    });
    const updated = await this.store.getProposal(id);
    return { proposal: this.toProposal(updated ?? row, [decision]), decision };
  }

  private inputFromRow(row: Record<string, unknown>): RiskInput {
    return {
      asset: row.asset as string,
      action: row.action as TradeAction,
      requestedAmountUsd: row.requestedAmountUsd as number,
      estimatedPrice: (row.estimatedPrice as number | null) ?? null,
      referencePrice: (row.referencePrice as number | null) ?? null,
      spreadPercent: (row.spreadPercent as number | null) ?? null,
      estimatedSlippagePercent: (row.estimatedSlippagePercent as number | null) ?? null,
      marketState: (row.marketState as string | null) ?? null,
      referenceFreshness: (row.referenceFreshness as string | null) ?? null,
      liquidityStatus: (row.liquidityStatus as RiskInput["liquidityStatus"]) ?? null,
      currentPositionUsd: (row.currentPositionUsd as number | null) ?? null,
      dailyTradedUsd: (row.dailyTradedUsd as number | null) ?? null,
      dailyVolumeUsd: (row.dailyVolumeUsd as number | null) ?? null,
      referenceAgeSeconds: (row.referenceAgeSeconds as number | null) ?? null,
    };
  }

  private statusFor(decision: RiskDecision, row: Record<string, unknown>): string {
    if (decision.decision === "APPROVED") {
      const expiresAt = Date.parse(row.expiresAt as string);
      return expiresAt < Date.now() ? "EXPIRED" : "APPROVED";
    }
    return decision.decision;
  }

  private toProposal(
    row: Record<string, unknown>,
    evaluations: RiskDecision[] = [],
  ): TradeProposal {
    const latest = evaluations.length > 0 ? evaluations[evaluations.length - 1]! : null;
    const status = this.computeStatus(row);
    return {
      id: row.id as string,
      strategyId: (row.strategyId as string | null) ?? null,
      strategyName: (row.strategyName as string) ?? "",
      asset: row.asset as string,
      action: row.action as TradeAction,
      requestedAmountUsd: row.requestedAmountUsd as number,
      estimatedPrice: (row.estimatedPrice as number | null) ?? null,
      referencePrice: (row.referencePrice as number | null) ?? null,
      spreadPercent: (row.spreadPercent as number | null) ?? null,
      marketState: (row.marketState as string | null) ?? null,
      liquidityStatus: (row.liquidityStatus as string | null) ?? null,
      status: status as TradeProposal["status"],
      expiresAt: (row.expiresAt as Date).toISOString(),
      createdAt: (row.createdAt as Date).toISOString(),
      riskDecision: latest,
      txHash: (row.txHash as string | null) ?? null,
    };
  }

  /** Expiration is computed on read: a stale approval never stays executable. */
  private computeStatus(row: Record<string, unknown>): string {
    const status = row.status as string;
    if (["PENDING_RISK", "APPROVED", "REQUIRES_REVIEW"].includes(status)) {
      const expiresAt = Date.parse(row.expiresAt as string);
      if (expiresAt < Date.now()) {
        return "EXPIRED";
      }
    }
    return status;
  }
}
