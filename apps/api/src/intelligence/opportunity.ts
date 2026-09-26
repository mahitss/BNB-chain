/**
 * Opportunity engine — deterministic, explainable, read-only.
 *
 * Decision table (documented; thresholds from configuration):
 *   missing/invalid prices or UNKNOWN market state → DATA_UNAVAILABLE
 *   |spread| < watch threshold                     → NO_SIGNAL
 *   watch ≤ |spread| < opportunity threshold       → WATCH
 *   |spread| ≥ opportunity threshold, then gates:
 *     liquidity NONE / UNKNOWN / below minimum     → BLOCKED
 *     price age beyond staleness limit             → BLOCKED
 *     reference or on-chain freshness STALE        → WATCH (downgrade)
 *     freshness UNKNOWN                            → WATCH (downgrade)
 *     otherwise                                    → OPPORTUNITY
 *
 * Confidence (deterministic, documented): count quality gates satisfied —
 * reference FRESH, on-chain FRESH, liquidity AVAILABLE ≥ minimum, underlying
 * market OPEN → HIGH ≥ 3, MEDIUM = 2, LOW < 2. Null for NO_SIGNAL and
 * DATA_UNAVAILABLE. No LLM produces any number here.
 *
 * Terminology is deliberately neutral: "price divergence detected", never
 * "profitable" or "guaranteed".
 */
import type {
  LiquidityInfo,
  MarketOpportunity,
  MarketSnapshot,
  OpportunityDirection,
  OpportunityReason,
  OpportunityStatus,
  OpportunityWarning,
} from "@olyr/types";

export interface OpportunityEngineConfig {
  spreadWatchPercent: number;
  spreadOpportunityPercent: number;
  minLiquidityUsd: number;
}

export function evaluateOpportunity(
  snapshot: MarketSnapshot,
  config: OpportunityEngineConfig,
): MarketOpportunity {
  const reasons: OpportunityReason[] = [];
  const warnings: OpportunityWarning[] = snapshot.warnings.map((w) => ({ ...w }));
  const timestamp = snapshot.timestamp;

  const base = {
    ticker: snapshot.ticker,
    tokenSymbol: snapshot.tokenSymbol,
    tokenContractAddress: snapshot.tokenContractAddress,
    chainId: snapshot.chainId,
    onChainPrice: snapshot.onChainPrice,
    referencePrice: snapshot.referencePrice,
    marketState: snapshot.marketState,
    referenceFreshness: snapshot.referenceFreshness,
    timestamp,
    source: snapshot.source,
  };

  const pushStateWarning = () => {
    if (snapshot.marketState !== "OPEN") {
      reasons.push({
        code: "underlying-market-not-open",
        message: `US equity market state is ${snapshot.marketState}.`,
      });
      reasons.push({
        code: "token-observable",
        message: "Tokenized asset remains observable on-chain.",
      });
    }
  };

  // 1. Data availability gate.
  if (snapshot.divergence.invalidReason !== null || snapshot.marketState === "UNKNOWN") {
    if (snapshot.divergence.invalidReason !== null) {
      warnings.push({
        code: "insufficient-price-data",
        message: `Price divergence could not be computed (${snapshot.divergence.invalidReason}).`,
      });
    }
    if (snapshot.marketState === "UNKNOWN") {
      warnings.push({
        code: "market-state-unknown",
        message: "Underlying market state could not be determined.",
      });
    }
    return {
      ...base,
      status: "DATA_UNAVAILABLE",
      direction: "NONE",
      spreadPercent: null,
      spreadAbsolute: null,
      confidence: null,
      reasons,
      warnings,
    };
  }

  const spreadPercent = Number(snapshot.divergence.spreadPercent);
  const absoluteSpread = Math.abs(spreadPercent);

  // 2. Threshold evaluation (boundary-inclusive per documented rules).
  if (absoluteSpread < config.spreadWatchPercent) {
    reasons.push({
      code: "within-thresholds",
      message: `Price divergence ${snapshot.divergence.spreadPercent}% is within the configured watch threshold (${config.spreadWatchPercent}%).`,
    });
    return {
      ...base,
      status: "NO_SIGNAL",
      direction: "NONE",
      spreadPercent: snapshot.divergence.spreadPercent,
      spreadAbsolute: snapshot.divergence.spreadAbsolute,
      confidence: null,
      reasons,
      warnings,
    };
  }

  const direction: OpportunityDirection = snapshot.divergence.direction;
  reasons.push({
    code: direction === "DISCOUNT" ? "price-divergence-discount" : "price-divergence-premium",
    message: `On-chain price is ${snapshot.divergence.spreadPercent}% ${direction === "DISCOUNT" ? "below" : "above"} the reference price (price divergence detected).`,
  });
  pushStateWarning();
  if (snapshot.referenceAgeSeconds !== null) {
    reasons.push({
      code: "reference-price-age",
      message: `Reference price is ${formatAge(snapshot.referenceAgeSeconds)} old.`,
    });
  }

  const liquidityOk =
    snapshot.liquidity.status === "AVAILABLE" &&
    meetsMinimum(snapshot.liquidity, config.minLiquidityUsd);
  const onChainFreshnessOk = snapshot.onChainFreshness !== "STALE";
  const marketOpen = snapshot.marketState === "OPEN";
  const beyondStalenessLimit = snapshot.warnings.some((w) => w.code === "price-not-updating");

  let status: OpportunityStatus;
  if (absoluteSpread >= config.spreadOpportunityPercent) {
    // Opportunity-level spread: apply hard gates.
    if (snapshot.liquidity.status === "NONE") {
      status = "BLOCKED";
      reasons.push({
        code: "liquidity-insufficient",
        message: "No on-chain liquidity pools were reported for this token.",
      });
    } else if (snapshot.liquidity.status === "UNKNOWN") {
      status = "BLOCKED";
      warnings.push({
        code: "liquidity-unknown",
        message: "Execution liquidity has not yet been validated.",
      });
    } else if (!meetsMinimum(snapshot.liquidity, config.minLiquidityUsd)) {
      status = "BLOCKED";
      reasons.push({
        code: "liquidity-insufficient",
        message: `On-chain liquidity (${snapshot.liquidity.totalLiquidityUsd ?? "unknown"} USD) is below the configured minimum (${config.minLiquidityUsd} USD).`,
      });
    } else if (beyondStalenessLimit) {
      status = "BLOCKED";
      warnings.push({
        code: "data-too-stale",
        message:
          "Price data exceeded the staleness limit and cannot support an opportunity signal.",
      });
    } else if (snapshot.referenceFreshness === "STALE" || snapshot.onChainFreshness === "STALE") {
      status = "WATCH";
      warnings.push({
        code: "stale-reference-price",
        message: "Reference price is stale; signal downgraded to WATCH.",
      });
    } else if (
      snapshot.referenceFreshness === "UNKNOWN" ||
      snapshot.onChainFreshness === "UNKNOWN"
    ) {
      status = "WATCH";
      warnings.push({
        code: "freshness-unknown",
        message: "Price freshness is unknown; signal downgraded to WATCH.",
      });
    } else {
      status = "OPPORTUNITY";
    }
  } else {
    status = "WATCH";
  }

  const gatesSatisfied =
    (snapshot.referenceFreshness === "FRESH" ? 1 : 0) +
    (onChainFreshnessOk && snapshot.onChainFreshness === "FRESH" ? 1 : 0) +
    (liquidityOk ? 1 : 0) +
    (marketOpen ? 1 : 0);
  const confidence = gatesSatisfied >= 3 ? "HIGH" : gatesSatisfied === 2 ? "MEDIUM" : "LOW";

  return {
    ...base,
    status,
    direction,
    spreadPercent: snapshot.divergence.spreadPercent,
    spreadAbsolute: snapshot.divergence.spreadAbsolute,
    confidence,
    reasons,
    warnings,
  };
}

function meetsMinimum(liquidity: LiquidityInfo, minimumUsd: number): boolean {
  if (minimumUsd <= 0) {
    return true; // No minimum configured; availability itself is the gate.
  }
  if (liquidity.totalLiquidityUsd === null) {
    return false;
  }
  return Number(liquidity.totalLiquidityUsd) >= minimumUsd;
}

function formatAge(seconds: number): string {
  if (seconds < 90) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
