/**
 * Market-intelligence domain types (Phase 3).
 *
 * Everything here is deterministic: no LLM involvement in state, freshness,
 * spread, or opportunity evaluation. Timestamps are ISO-8601 UTC strings.
 */

/** Overall market state for the underlying US equity market. */
export type MarketState =
  "OPEN" | "CLOSED" | "PRE_MARKET" | "AFTER_HOURS" | "WEEKEND" | "HOLIDAY" | "UNKNOWN";

/** Freshness of a price observation relative to configurable thresholds. */
export type ReferenceFreshness = "FRESH" | "AGING" | "STALE" | "UNKNOWN";

/** On-chain execution liquidity, from documented Binance data only. */
export type LiquidityStatus = "AVAILABLE" | "NONE" | "UNKNOWN";

export interface LiquidityInfo {
  status: LiquidityStatus;
  /** Sum of documented top liquidity pools for the token, USD, decimal string. */
  totalLiquidityUsd: string | null;
  poolCount: number | null;
  checkedAt: string | null;
  warnings: string[];
}

/** How old a price observation is, relative to `now`. */
export interface FreshnessEvaluation {
  category: ReferenceFreshness;
  /** Age in seconds; null when no timestamp is available. */
  ageSeconds: number | null;
  /** True when age exceeds the staleness limit (data unusable for signals). */
  beyondStalenessLimit: boolean;
  /** Warning code when the age is unknown or beyond limits. */
  warningCode: "timestamp-missing" | "beyond-staleness-limit" | null;
}

/** Direction of a price divergence, relative to the reference price. */
export type DivergenceDirection = "PREMIUM" | "DISCOUNT" | "NONE";

/** Full deterministic divergence result. No NaN/Infinity can occur. */
export interface PriceDivergence {
  /** Percent rounded to 4 decimals; null when not computable. */
  spreadPercent: string | null;
  /** Absolute difference (on-chain − reference), exact decimal; null when not computable. */
  spreadAbsolute: string | null;
  /** Basis points rounded to 2 decimals; null when not computable. */
  spreadBps: string | null;
  direction: DivergenceDirection;
  invalidReason: string | null;
}

export type OpportunityStatus =
  "NO_SIGNAL" | "WATCH" | "OPPORTUNITY" | "BLOCKED" | "DATA_UNAVAILABLE";

export type OpportunityDirection = "PREMIUM" | "DISCOUNT" | "NONE";

export interface OpportunityReason {
  code: string;
  message: string;
}

export interface OpportunityWarning {
  code: string;
  message: string;
}

/**
 * Deterministic quality level. Documented rule (see opportunity engine):
 * count of satisfied quality gates (reference fresh, on-chain fresh,
 * liquidity validated, underlying market open) → HIGH ≥ 3, MEDIUM = 2,
 * LOW < 2. Null when the status makes confidence meaningless.
 */
export type OpportunityConfidence = "HIGH" | "MEDIUM" | "LOW" | null;

/** Explainable, structured opportunity result produced by the engine. */
export interface MarketOpportunity {
  ticker: string;
  tokenSymbol: string;
  tokenContractAddress: string | null;
  chainId: string;
  status: OpportunityStatus;
  direction: OpportunityDirection;
  spreadPercent: string | null;
  spreadAbsolute: string | null;
  onChainPrice: string | null;
  referencePrice: string | null;
  marketState: MarketState;
  referenceFreshness: ReferenceFreshness;
  confidence: OpportunityConfidence;
  reasons: OpportunityReason[];
  warnings: OpportunityWarning[];
  /** ISO-8601 instant the evaluation ran. */
  timestamp: string;
  source: string;
}

/** Full snapshot for one tokenized asset at one point in time. */
export interface MarketSnapshot {
  ticker: string;
  tokenSymbol: string;
  tokenName: string;
  platformId: string;
  chainId: string;
  tokenContractAddress: string;
  onChainPrice: string | null;
  onChainTimestamp: string | null;
  onChainAgeSeconds: number | null;
  referencePrice: string | null;
  referenceTimestamp: string | null;
  referenceAgeSeconds: number | null;
  referenceFreshness: ReferenceFreshness;
  onChainFreshness: ReferenceFreshness;
  divergence: PriceDivergence;
  marketState: MarketState;
  marketStateSource: "binance" | "derived-calendar";
  liquidity: LiquidityInfo;
  volume24H: string | null;
  warnings: OpportunityWarning[];
  source: string;
  timestamp: string;
}

/** Global market-state banner data. */
export interface GlobalMarketState {
  usEquities: MarketState;
  usEquitiesSource: string;
  /** Whether the tokenized on-chain market is currently observable. */
  onChainMarket: "ACTIVE" | "UNKNOWN";
  onChainMarketDetail: string;
  timestamp: string;
}
