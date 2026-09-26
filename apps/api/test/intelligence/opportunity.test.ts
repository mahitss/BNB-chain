/**
 * Opportunity engine tests — deterministic decision table, threshold
 * boundaries, liquidity gating, confidence rule, and explainability.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { evaluateOpportunity } from "../../src/intelligence/opportunity.js";
import { buildSnapshot } from "../../src/intelligence/snapshot.js";
import type { LiquidityInfo, TokenizedAssetListing } from "@olyr/types";

const ENGINE_CONFIG = {
  spreadWatchPercent: 0.5, // 50 bp
  spreadOpportunityPercent: 1.5, // 150 bp
  minLiquidityUsd: 0,
};
const THRESHOLDS = { freshSeconds: 60, agingSeconds: 900, staleSeconds: 3600 };
const NOW = new Date("2026-09-29T15:00:00Z");

function listingWith(spread: { onChain: string; reference: string }): TokenizedAssetListing {
  return {
    asset: {
      chainId: "56",
      tokenContractAddress: "0xabc0000000000000000000000000000000000001",
      platformId: "ondo",
      assetType: 1,
      tokenName: "Example Tokenized NVDA",
      tokenSymbol: "NVDO",
      tokenLogoUrl: null,
      decimals: "18",
      underlyingTicker: "NVDA",
      underlyingName: "NVIDIA Corp",
      tokenToShareRatio: "1.0",
      tags: [],
      volume24H: "500000",
      marketCap: null,
      peRatioTTM: null,
    },
    tokenPrice: { value: spread.onChain, asOf: NOW.toISOString() },
    referencePrice: { value: spread.reference, asOf: NOW.toISOString() },
    statusInfo: {
      openState: true,
      marketStatus: "regular",
      reasonCode: null,
      reasonMsg: null,
      nextOpenTime: null,
      nextCloseTime: null,
    },
  };
}

const AVAILABLE_LIQUIDITY: LiquidityInfo = {
  status: "AVAILABLE",
  totalLiquidityUsd: "1000000.00",
  poolCount: 3,
  checkedAt: NOW.toISOString(),
  warnings: [],
};

function snapshotFor(
  spread: { onChain: string; reference: string },
  liquidity = AVAILABLE_LIQUIDITY,
) {
  return buildSnapshot({
    listing: listingWith(spread),
    liquidity,
    thresholds: THRESHOLDS,
    now: NOW,
    source: "binance-web3",
  });
}

describe("opportunity engine", () => {
  it("NO_SIGNAL below the watch threshold, with explanation", () => {
    const result = evaluateOpportunity(
      snapshotFor({ onChain: "100.30", reference: "100.00" }),
      ENGINE_CONFIG,
    );
    assert.equal(result.status, "NO_SIGNAL");
    assert.equal(result.confidence, null);
    assert.ok(result.reasons.some((r) => r.code === "within-thresholds"));
  });

  it("WATCH at exactly the watch threshold (boundary-inclusive)", () => {
    // 0.5% exact
    const result = evaluateOpportunity(
      snapshotFor({ onChain: "100.50", reference: "100.00" }),
      ENGINE_CONFIG,
    );
    assert.equal(result.status, "WATCH");
    assert.equal(result.direction, "PREMIUM");
  });

  it("WATCH between watch and opportunity thresholds, both directions", () => {
    const premium = evaluateOpportunity(
      snapshotFor({ onChain: "101.00", reference: "100.00" }),
      ENGINE_CONFIG,
    );
    assert.equal(premium.status, "WATCH");
    assert.equal(premium.direction, "PREMIUM");
    const discount = evaluateOpportunity(
      snapshotFor({ onChain: "99.00", reference: "100.00" }),
      ENGINE_CONFIG,
    );
    assert.equal(discount.status, "WATCH");
    assert.equal(discount.direction, "DISCOUNT");
    assert.ok(premium.reasons.some((r) => r.code === "price-divergence-premium"));
    assert.ok(discount.reasons.some((r) => r.code === "price-divergence-discount"));
  });

  it("WATCH just below the opportunity threshold", () => {
    const result = evaluateOpportunity(
      snapshotFor({ onChain: "101.49", reference: "100.00" }),
      ENGINE_CONFIG,
    );
    assert.equal(result.status, "WATCH");
  });

  it("OPPORTUNITY at exactly the opportunity threshold with good data", () => {
    const result = evaluateOpportunity(
      snapshotFor({ onChain: "101.50", reference: "100.00" }),
      ENGINE_CONFIG,
    );
    assert.equal(result.status, "OPPORTUNITY");
    assert.equal(result.confidence, "HIGH");
  });

  it("OPPORTUNITY just above the opportunity threshold", () => {
    const result = evaluateOpportunity(
      snapshotFor({ onChain: "101.82", reference: "100.00" }),
      ENGINE_CONFIG,
    );
    assert.equal(result.status, "OPPORTUNITY");
    assert.equal(result.spreadPercent, "1.8200");
  });

  it("BLOCKED when liquidity status is UNKNOWN (never assumed sufficient)", () => {
    const unknownLiquidity: LiquidityInfo = {
      status: "UNKNOWN",
      totalLiquidityUsd: null,
      poolCount: null,
      checkedAt: NOW.toISOString(),
      warnings: ["liquidity-unavailable"],
    };
    const result = evaluateOpportunity(
      snapshotFor({ onChain: "102.00", reference: "100.00" }, unknownLiquidity),
      ENGINE_CONFIG,
    );
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.warnings.some((w) => w.code === "liquidity-unknown"));
    assert.ok(result.warnings.some((w) => w.message.includes("has not yet been validated")));
  });

  it("BLOCKED when liquidity is below the configured minimum", () => {
    const smallLiquidity: LiquidityInfo = { ...AVAILABLE_LIQUIDITY, totalLiquidityUsd: "500.00" };
    const result = evaluateOpportunity(
      snapshotFor({ onChain: "102.00", reference: "100.00" }, smallLiquidity),
      {
        ...ENGINE_CONFIG,
        minLiquidityUsd: 10000,
      },
    );
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.reasons.some((r) => r.code === "liquidity-insufficient"));
  });

  it("WATCH (downgrade) when reference is STALE but within the staleness limit", () => {
    const listing = listingWith({ onChain: "102.00", reference: "100.00" });
    const old = new Date(NOW.getTime() - 1800_000).toISOString(); // 30 min
    listing.tokenPrice = { value: listing.tokenPrice!.value, asOf: old };
    listing.referencePrice = { value: listing.referencePrice!.value, asOf: old };
    const snapshot = buildSnapshot({
      listing,
      liquidity: AVAILABLE_LIQUIDITY,
      thresholds: THRESHOLDS,
      now: NOW,
      source: "binance-web3",
    });
    const result = evaluateOpportunity(snapshot, ENGINE_CONFIG);
    assert.equal(result.status, "WATCH");
    assert.ok(result.warnings.some((w) => w.code === "stale-reference-price"));
  });

  it("BLOCKED when price data is beyond the staleness limit", () => {
    const listing = listingWith({ onChain: "102.00", reference: "100.00" });
    const veryOld = new Date(NOW.getTime() - 7200_000).toISOString(); // 2 hours
    listing.tokenPrice = { value: listing.tokenPrice!.value, asOf: veryOld };
    const snapshot = buildSnapshot({
      listing,
      liquidity: AVAILABLE_LIQUIDITY,
      thresholds: THRESHOLDS,
      now: NOW,
      source: "binance-web3",
    });
    const result = evaluateOpportunity(snapshot, ENGINE_CONFIG);
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.warnings.some((w) => w.code === "data-too-stale"));
  });

  it("DATA_UNAVAILABLE when prices are missing", () => {
    const listing = listingWith({ onChain: "100.00", reference: "100.00" });
    listing.tokenPrice = null;
    listing.referencePrice = null;
    const snapshot = buildSnapshot({
      listing,
      liquidity: AVAILABLE_LIQUIDITY,
      thresholds: THRESHOLDS,
      now: NOW,
      source: "binance-web3",
    });
    const result = evaluateOpportunity(snapshot, ENGINE_CONFIG);
    assert.equal(result.status, "DATA_UNAVAILABLE");
    assert.ok(result.warnings.some((w) => w.code === "insufficient-price-data"));
  });

  it("includes market-state reasons when the underlying market is not open", () => {
    const listing = listingWith({ onChain: "102.00", reference: "100.00" });
    listing.statusInfo = {
      openState: false,
      marketStatus: "closed",
      reasonCode: "MARKET_CLOSED",
      reasonMsg: "Weekend or Holiday",
      nextOpenTime: null,
      nextCloseTime: null,
    };
    const snapshot = buildSnapshot({
      listing,
      liquidity: AVAILABLE_LIQUIDITY,
      thresholds: THRESHOLDS,
      now: new Date("2026-10-03T15:00:00Z"), // Saturday
      source: "binance-web3",
    });
    assert.equal(snapshot.marketState, "WEEKEND");
    const result = evaluateOpportunity(snapshot, ENGINE_CONFIG);
    assert.ok(result.reasons.some((r) => r.message.includes("WEEKEND")));
    assert.ok(result.reasons.some((r) => r.code === "token-observable"));
  });

  it("uses neutral terminology (no profit guarantees)", () => {
    const result = evaluateOpportunity(
      snapshotFor({ onChain: "102.00", reference: "100.00" }),
      ENGINE_CONFIG,
    );
    const text = JSON.stringify(result).toLowerCase();
    assert.ok(!text.includes("guaranteed"));
    assert.ok(!text.includes("profitable"));
    assert.ok(result.reasons.some((r) => r.message.includes("price divergence detected")));
  });

  it("every response carries source and timestamp", () => {
    const result = evaluateOpportunity(
      snapshotFor({ onChain: "102.00", reference: "100.00" }),
      ENGINE_CONFIG,
    );
    assert.equal(result.source, "binance-web3");
    assert.ok(!Number.isNaN(Date.parse(result.timestamp)));
  });
});
