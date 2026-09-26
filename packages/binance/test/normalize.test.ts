/**
 * Normalizer tests against recorded/sanitized fixtures.
 * Fixtures are clearly labeled (_fixture: true) and are NOT live data.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  normalizePriceQuote,
  normalizeTokenListing,
  normalizeUnderlyingMarket,
} from "../src/normalize.js";
import type { BinanceEnvelope, RawRwaPrice, RawRwaToken } from "../src/raw.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

function loadFixture(name: string): unknown {
  const raw = JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, "utf8")) as Record<string, unknown>;
  assert.equal(raw["_fixture"], true, `${name} must be labeled as a fixture`);
  return raw;
}

describe("normalizeTokenListing (rwa/tokens fixture)", () => {
  const envelope = loadFixture("rwa-tokens.fixture.json") as unknown as BinanceEnvelope<
    RawRwaToken[]
  >;

  it("normalizes a fully populated token", () => {
    const listing = normalizeTokenListing(envelope.data[0]!, envelope.timestamp);
    assert.equal(listing.asset.chainId, "56");
    assert.equal(listing.asset.tokenSymbol, "SPYON");
    assert.equal(listing.asset.underlyingTicker, "SPY");
    assert.equal(listing.asset.assetType, 1);
    assert.deepEqual(listing.asset.tags, ["communityRecognized"]);
    assert.equal(listing.tokenPrice?.value, "61.746364");
    assert.equal(listing.referencePrice?.value, "61.746364");
    // asOf comes from the envelope server timestamp, converted to ISO.
    assert.equal(listing.tokenPrice?.asOf, new Date(envelope.timestamp).toISOString());
    assert.equal(listing.statusInfo?.marketStatus, "regular");
    assert.equal(listing.statusInfo?.openState, true);
  });

  it("preserves a closed-market status with reason codes", () => {
    const listing = normalizeTokenListing(envelope.data[1]!, envelope.timestamp);
    assert.equal(listing.statusInfo?.marketStatus, "closed");
    assert.equal(listing.statusInfo?.reasonCode, "MARKET_CLOSED");
    assert.equal(listing.statusInfo?.reasonMsg, "Weekend or Holiday");
  });

  it("maps missing optional fields to null, never fabricated values", () => {
    const listing = normalizeTokenListing(envelope.data[2]!, envelope.timestamp);
    assert.equal(listing.tokenPrice, null);
    assert.equal(listing.referencePrice, null);
    assert.equal(listing.statusInfo, null);
    assert.equal(listing.asset.tokenToShareRatio, null);
    assert.deepEqual(listing.asset.tags, []);
  });
});

describe("normalizePriceQuote (rwa/price fixture)", () => {
  const envelope = loadFixture("rwa-price.fixture.json") as unknown as BinanceEnvelope<
    RawRwaPrice[]
  >;

  it("normalizes prices with the API-reported update time", () => {
    const quote = normalizePriceQuote(envelope.data[0]!);
    assert.equal(quote.onChainPrice?.value, "61.746364");
    assert.equal(quote.onChainPrice?.asOf, new Date(1748601590000).toISOString());
    assert.equal(quote.referencePrice?.basis, "derived-per-share-conversion");
    assert.equal(quote.referencePrice?.value, "61.700000");
  });

  it("returns null prices when the API omits them", () => {
    const quote = normalizePriceQuote(envelope.data[1]!);
    assert.equal(quote.onChainPrice, null);
    assert.equal(quote.referencePrice, null);
  });
});

describe("normalizeUnderlyingMarket", () => {
  it("normalizes market data with defaults for a missing status object", () => {
    const raw = {
      binanceChainId: "56",
      tokenContractAddress: "0xabc",
      platformId: "ondo",
      assetType: 1,
      statusInfo: null,
      marketData: {
        referencePrice: "61.70",
        high52W: "75.00",
        low52W: "55.00",
        volumeShares24H: "1000",
        avgDailyVolume1Y: "2000",
        totalShares: "1000000",
        marketCap: "61700000",
        turnoverRate: "0.5",
        amplitude: "1.2",
        peRatioTTM: null,
        pbRatio: null,
        dividendYield: null,
        latestDividend: null,
      },
    };
    const snapshot = normalizeUnderlyingMarket(raw);
    assert.equal(snapshot.marketData.high52W, "75.00");
    assert.equal(snapshot.statusInfo.marketStatus, "closed");
    assert.equal(snapshot.statusInfo.openState, false);
  });
});
