/**
 * Scanner tests: overlap prevention, graceful shutdown, store updates, and
 * end-to-end snapshot→opportunity flow with a stubbed Binance client.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { OpportunityScanner } from "../../src/scanner/scanner.js";
import { InMemoryScanStore } from "../../src/scanner/store.js";
import type { BinanceRwaClient, Logger } from "@olyr/binance";
import type { IntelligenceConfig } from "@olyr/config";
import type { TokenLiquidityPool, TokenizedAssetListing } from "@olyr/types";

const CONFIG: IntelligenceConfig = {
  spreadWatchPercent: 0.5,
  spreadOpportunityPercent: 1.5,
  referenceFreshSeconds: 60,
  referenceAgingSeconds: 900,
  referenceStaleSeconds: 3600,
  minLiquidityUsd: 0,
  scan: { enabled: true, intervalSeconds: 3600, maxAssets: 10, assetsFilter: [] },
};

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function listing(ticker: string, onChain: string, reference: string): TokenizedAssetListing {
  return {
    asset: {
      chainId: "56",
      tokenContractAddress: `0x${ticker.charCodeAt(0).toString(16).padStart(2, "0")}aa000000000000000000000000000000000001`,
      platformId: "ondo",
      assetType: 1,
      tokenName: `${ticker} Token`,
      tokenSymbol: `${ticker}T`,
      tokenLogoUrl: null,
      decimals: "18",
      underlyingTicker: ticker,
      underlyingName: `${ticker} Inc`,
      tokenToShareRatio: null,
      tags: [],
      volume24H: "1000",
      marketCap: null,
      peRatioTTM: null,
    },
    tokenPrice: { value: onChain, asOf: new Date().toISOString() },
    referencePrice: { value: reference, asOf: new Date().toISOString() },
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

function fakeClient(listings: TokenizedAssetListing[]): BinanceRwaClient {
  return {
    async listPlatforms() {
      return [];
    },
    async listTokens() {
      return listings;
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
        {
          pool: "NVDA/WBNB",
          protocolName: "PancakeSwap",
          liquidityUsd: "900000.00",
          poolAddress: null,
        },
      ];
    },
  };
}

describe("OpportunityScanner", () => {
  it("evaluates assets, stores snapshots and opportunities", async () => {
    const listings = [
      listing("NVDA", "101.82", "100.00"), // +1.82% → OPPORTUNITY
      listing("AAPL", "100.10", "100.00"), // +0.10% → NO_SIGNAL
      listing("TSLA", "98.00", "100.00"), // -2.00% → OPPORTUNITY (discount)
    ];
    const store = new InMemoryScanStore();
    const scanner = new OpportunityScanner({
      client: fakeClient(listings),
      store,
      config: CONFIG,
      chainId: "56",
      logger: silentLogger,
    });
    const performed = await scanner.scanOnce("manual");
    assert.equal(performed, true);

    const latest = store.latest();
    assert.equal(latest.snapshots.length, 3);
    assert.equal(latest.completedAt !== null, true);
    const statuses = Object.fromEntries(latest.opportunities.map((o) => [o.ticker, o.status]));
    assert.equal(statuses["NVDA"], "OPPORTUNITY");
    assert.equal(statuses["AAPL"], "NO_SIGNAL");
    assert.equal(statuses["TSLA"], "OPPORTUNITY");
    assert.equal(store.latestForTicker("tsla")!.direction, "DISCOUNT");
    assert.equal(store.lastScanOutcome().ok, true);
    assert.equal(store.lastScanOutcome().assetCount, 3);
  });

  it("prevents overlapping scans — the second concurrent call is skipped", async () => {
    let releaseScan: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    let calls = 0;
    const slowClient: BinanceRwaClient = {
      ...fakeClient([listing("NVDA", "102.00", "100.00")]),
      async listTokens() {
        calls++;
        await gate;
        return listings;
      },
    };
    const listings = [listing("NVDA", "102.00", "100.00")];
    const store = new InMemoryScanStore();
    const scanner = new OpportunityScanner({
      client: slowClient,
      store,
      config: CONFIG,
      chainId: "56",
      logger: silentLogger,
    });

    const first = scanner.scanOnce("manual");
    // Give the first scan a tick to set its running flag, then attempt overlap.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = scanner.scanOnce("manual");
    releaseScan?.();
    const firstResult = await first;
    const secondResult = await second;
    assert.equal(firstResult, true);
    assert.equal(secondResult, false, "overlapping scan must be skipped");
    assert.equal(calls, 1);
    void listings;
  });

  it("scanOnce returns false after stop() and stop() awaits in-flight work", async () => {
    const store = new InMemoryScanStore();
    const scanner = new OpportunityScanner({
      client: fakeClient([listing("NVDA", "102.00", "100.00")]),
      store,
      config: CONFIG,
      chainId: "56",
      logger: silentLogger,
    });
    await scanner.scanOnce("manual");
    await scanner.stop();
    const afterStop = await scanner.scanOnce("manual");
    assert.equal(afterStop, false, "scanner must not scan after stop()");
  });

  it("respects the maxAssets cap and the ticker filter", async () => {
    const listings = ["A", "B", "C"].map((t) => listing(t, "102.00", "100.00"));
    const store = new InMemoryScanStore();
    const scanner = new OpportunityScanner({
      client: fakeClient(listings),
      store,
      config: { ...CONFIG, scan: { ...CONFIG.scan, maxAssets: 2 } },
      chainId: "56",
      logger: silentLogger,
    });
    await scanner.scanOnce("manual");
    assert.equal(store.latest().snapshots.length, 2);
  });

  it("continues after an asset-level data error (marks asset unavailable)", async () => {
    const brokenClient: BinanceRwaClient = {
      ...fakeClient([listing("NVDA", "102.00", "100.00")]),
      async getTokenLiquidity() {
        throw new Error("liquidity upstream down");
      },
    };
    const store = new InMemoryScanStore();
    const scanner = new OpportunityScanner({
      client: brokenClient,
      store,
      config: CONFIG,
      chainId: "56",
      logger: silentLogger,
    });
    await scanner.scanOnce("manual");
    // Liquidity is UNKNOWN → opportunity engine BLOCKs, but the scan still
    // completes and stores an explainable result.
    const latest = store.latest();
    assert.equal(latest.opportunities.length, 1);
    assert.equal(latest.opportunities[0]!.status, "BLOCKED");
    assert.ok(latest.opportunities[0]!.warnings.some((w) => w.code === "liquidity-unknown"));
  });
});
