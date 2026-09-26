/**
 * Market-intelligence endpoint serialization tests. Uses the buildApp client
 * injection seam with FIXTURE data (clearly marked, not live) so responses
 * are exercised end-to-end without network access.
 */
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import type { BinanceRwaClient } from "@olyr/binance";
import type { TokenLiquidityPool, TokenizedAssetListing } from "@olyr/types";

const BINANCE_KEYS = [
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "OLYR_SCAN_ENABLED",
  "REDIS_URL",
] as const;

afterEach(() => {
  for (const key of BINANCE_KEYS) {
    delete process.env[key];
  }
});

// FIXTURE DATA — structure from the official Binance OpenAPI schema, values
// from documented examples. Not live data; used only for serialization tests.
const FIXTURE_LISTING: TokenizedAssetListing = {
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
    tokenToShareRatio: null,
    tags: [],
    volume24H: "500000",
    marketCap: null,
    peRatioTTM: null,
  },
  tokenPrice: { value: "101.820000", asOf: new Date().toISOString() },
  referencePrice: { value: "100.000000", asOf: new Date().toISOString() },
  statusInfo: {
    openState: false,
    marketStatus: "closed",
    reasonCode: "MARKET_CLOSED",
    reasonMsg: "Weekend or Holiday",
    nextOpenTime: null,
    nextCloseTime: null,
  },
};

function fixtureClient(): BinanceRwaClient {
  return {
    async listPlatforms() {
      return [];
    },
    async listTokens() {
      return [FIXTURE_LISTING];
    },
    async getTokenPrices() {
      return [];
    },
    async searchTokens() {
      return [];
    },
    async getUnderlyingProfile() {
      throw new Error("not used");
    },
    async getUnderlyingMarketData() {
      throw new Error("not used");
    },
    async getTokenLiquidity(): Promise<TokenLiquidityPool[]> {
      return [
        { pool: "NVDA/WBNB", protocolName: null, liquidityUsd: "800000.00", poolAddress: null },
      ];
    },
  };
}

async function buildFixtureApp() {
  process.env["BINANCE_API_KEY"] = "k";
  process.env["BINANCE_API_SECRET"] = "s";
  process.env["OLYR_SCAN_ENABLED"] = "false";
  return buildApp({ binanceClient: fixtureClient() });
}

describe("market intelligence endpoints (fixture data via injected client)", () => {
  it("GET /api/market/state serializes the global banner", async () => {
    const app = await buildFixtureApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/market/state" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      for (const key of [
        "usEquities",
        "usEquitiesSource",
        "onChainMarket",
        "onChainMarketDetail",
        "timestamp",
      ]) {
        assert.ok(key in body, `missing key: ${key}`);
      }
    } finally {
      await app.close();
    }
  });

  it("GET /api/market/:ticker/snapshot returns the full deterministic snapshot", async () => {
    const app = await buildFixtureApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/market/NVDA/snapshot" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.ticker, "NVDA");
      assert.equal(body.onChainPrice, "101.820000");
      assert.equal(body.referencePrice, "100.000000");
      assert.equal(body.marketState, "WEEKEND"); // statusInfo closed + Saturday calendar
      assert.equal(body.liquidity.status, "AVAILABLE");
      assert.ok(body.divergence.spreadPercent.startsWith("1.8"));
      assert.equal(body.source, "binance-web3");
      assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
      assert.ok(Array.isArray(body.warnings));
    } finally {
      await app.close();
    }
  });

  it("GET /api/market/:ticker/state returns state plus source", async () => {
    const app = await buildFixtureApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/market/NVDA/state" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.ticker, "NVDA");
      assert.equal(body.marketState, "WEEKEND");
      assert.equal(body.marketStateSource, "binance");
      assert.ok("timestamp" in body);
      assert.ok("dataSource" in body);
    } finally {
      await app.close();
    }
  });

  it("GET /api/opportunities/:ticker evaluates deterministically and 404s on unknown", async () => {
    const app = await buildFixtureApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/opportunities/NVDA" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.ticker, "NVDA");
      assert.ok(
        ["NO_SIGNAL", "WATCH", "OPPORTUNITY", "BLOCKED", "DATA_UNAVAILABLE"].includes(body.status),
      );
      assert.ok(Array.isArray(body.reasons));
      assert.ok(Array.isArray(body.warnings));
      assert.equal(body.dataSource, "binance-web3");

      const missing = await app.inject({ method: "GET", url: "/api/opportunities/ZZZZ" });
      assert.equal(missing.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it("GET /api/opportunities returns an empty payload before the first scan", async () => {
    const app = await buildFixtureApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/opportunities" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.lastScanAt, null);
      assert.deepEqual(body.opportunities, []);
      assert.equal(body.dataSource, "binance-web3");
    } finally {
      await app.close();
    }
  });
});
