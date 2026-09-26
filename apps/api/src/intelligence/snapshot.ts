/**
 * Snapshot assembly — combines one RWA listing (asset + embedded prices +
 * official statusInfo) with documented liquidity data into a MarketSnapshot.
 *
 * Timestamp honesty: Binance's /rwa/tokens quote carries ONE update time per
 * record (the envelope/quote timestamp). Because the reference price is
 * documented as derived from the on-chain token price, that single timestamp
 * is applied to both. If it is absent, freshness is UNKNOWN — never invented.
 */
import {
  calculatePriceDivergence,
  type MarketSnapshot,
  type LiquidityInfo,
  type OpportunityWarning,
  type RwaMarketStatusInfo,
  type TokenizedAssetListing,
} from "@olyr/types";
import { evaluateFreshness, type FreshnessThresholds } from "./freshness.js";
import { deriveMarketState } from "./market-state.js";

export type SnapshotThresholds = FreshnessThresholds;

export function buildSnapshot(options: {
  listing: TokenizedAssetListing;
  liquidity: LiquidityInfo;
  thresholds: SnapshotThresholds;
  now: Date;
  source: string;
}): MarketSnapshot {
  const { listing, liquidity, thresholds, now, source } = options;
  const asset = listing.asset;
  const asOf = listing.tokenPrice?.asOf ?? listing.referencePrice?.asOf ?? null;

  const onChainFreshness = evaluateFreshness(asOf, now, thresholds);
  const referenceFreshness = evaluateFreshness(asOf, now, thresholds);
  const divergence = calculatePriceDivergence(
    listing.tokenPrice?.value ?? null,
    listing.referencePrice?.value ?? null,
  );
  const state = deriveMarketState(listing.statusInfo, now);

  const warnings: OpportunityWarning[] = [];
  if (onChainFreshness.warningCode === "timestamp-missing") {
    warnings.push({
      code: "price-timestamp-missing",
      message: "Binance did not provide a price update timestamp; freshness is unknown.",
    });
  }
  if (onChainFreshness.warningCode === "beyond-staleness-limit") {
    warnings.push({
      code: "price-not-updating",
      message: `Price has not updated for ${onChainFreshness.ageSeconds}s (beyond the staleness limit); the reference price may not be updating.`,
    });
  }
  for (const w of state.warnings) {
    warnings.push({
      code: w,
      message:
        "Market state derived from the OLYR US-equity calendar, not from Binance status data.",
    });
  }

  return {
    ticker: asset.underlyingTicker,
    tokenSymbol: asset.tokenSymbol,
    tokenName: asset.tokenName,
    platformId: asset.platformId,
    chainId: asset.chainId,
    tokenContractAddress: asset.tokenContractAddress,
    onChainPrice: listing.tokenPrice?.value ?? null,
    onChainTimestamp: asOf,
    onChainAgeSeconds: onChainFreshness.ageSeconds,
    referencePrice: listing.referencePrice?.value ?? null,
    referenceTimestamp: asOf,
    referenceAgeSeconds: referenceFreshness.ageSeconds,
    referenceFreshness: referenceFreshness.category,
    onChainFreshness: onChainFreshness.category,
    divergence,
    marketState: state.state,
    marketStateSource: state.source,
    liquidity,
    volume24H: asset.volume24H,
    warnings,
    source,
    timestamp: now.toISOString(),
  };
}

/** Re-exported for consumers that hold a raw statusInfo. */
export type { RwaMarketStatusInfo };
