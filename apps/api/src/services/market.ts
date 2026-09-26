/**
 * Market-intelligence service: on-demand state/snapshot/opportunity for a
 * single ticker, plus the global market-state banner. Reuses the cached RWA
 * listing data from RwaService and the deterministic intelligence modules.
 */
import type { BinanceRwaClient, Logger } from "@olyr/binance";
import type { IntelligenceConfig } from "@olyr/config";
import type {
  GlobalMarketState,
  MarketOpportunity,
  MarketSnapshot,
  TokenizedAssetListing,
} from "@olyr/types";
import { buildSnapshot } from "../intelligence/snapshot.js";
import { evaluateOpportunity } from "../intelligence/opportunity.js";
import { computeLiquidityInfo } from "../intelligence/liquidity.js";
import { getUsEquityCalendarState } from "../intelligence/us-equity-calendar.js";
import type { RwaService } from "./rwa.js";
import type { ScanStore } from "../scanner/store.js";

export interface MarketIntelligenceServiceOptions {
  rwaService: RwaService;
  client: BinanceRwaClient;
  config: IntelligenceConfig;
  chainId: string;
  store: ScanStore;
  logger: Logger;
}

export class MarketIntelligenceService {
  private readonly rwaService: RwaService;
  private readonly client: BinanceRwaClient;
  private readonly config: IntelligenceConfig;
  private readonly chainId: string;
  private readonly store: ScanStore;
  private readonly logger: Logger;

  constructor(options: MarketIntelligenceServiceOptions) {
    this.rwaService = options.rwaService;
    this.client = options.client;
    this.config = options.config;
    this.chainId = options.chainId;
    this.store = options.store;
    this.logger = options.logger;
  }

  /** Banner: US equities (calendar) + on-chain observability (last scan). */
  getGlobalState(): GlobalMarketState {
    const outcome = this.store.lastScanOutcome();
    return {
      usEquities: getUsEquityCalendarState(new Date()),
      usEquitiesSource: "olyr-us-equity-calendar (NYSE rules, America/New_York)",
      onChainMarket: outcome.ok ? "ACTIVE" : "UNKNOWN",
      onChainMarketDetail: outcome.ok
        ? `Last scan ${outcome.at} evaluated ${outcome.assetCount} assets.`
        : "No successful scan has run yet; on-chain observability is unknown.",
      timestamp: new Date().toISOString(),
    };
  }

  /** Full snapshot for one ticker (on-demand; scanner results are separate). */
  async getSnapshot(ticker: string): Promise<MarketSnapshot | null> {
    const assetWithMarket = await this.findAsset(ticker);
    if (!assetWithMarket) {
      return null;
    }
    const { asset, quote, marketStatus } = assetWithMarket;
    const liquidity = await computeLiquidityInfo(
      this.client,
      asset.chainId,
      asset.tokenContractAddress,
    );
    const listing: TokenizedAssetListing = {
      asset,
      tokenPrice: quote.onChainPrice
        ? { value: quote.onChainPrice.value, asOf: quote.onChainPrice.asOf }
        : null,
      referencePrice: quote.referencePrice
        ? { value: quote.referencePrice.value, asOf: quote.referencePrice.asOf }
        : null,
      statusInfo: marketStatus,
    };
    return buildSnapshot({
      listing,
      liquidity,
      thresholds: {
        freshSeconds: this.config.referenceFreshSeconds,
        agingSeconds: this.config.referenceAgingSeconds,
        staleSeconds: this.config.referenceStaleSeconds,
      },
      now: new Date(),
      source: "binance-web3",
    });
  }

  /** Deterministic opportunity for one ticker, evaluated on demand. */
  async getOpportunity(ticker: string): Promise<MarketOpportunity | null> {
    const snapshot = await this.getSnapshot(ticker);
    if (!snapshot) {
      return null;
    }
    return evaluateOpportunity(snapshot, this.config);
  }

  /** Scanner-backed result for a ticker, or null when no scan has covered it. */
  getScannerOpportunity(ticker: string): MarketOpportunity | null {
    return this.store.latestForTicker(ticker);
  }

  private async findAsset(ticker: string) {
    const target = ticker.toUpperCase();
    const assets = await this.rwaService.listAssets();
    const match = assets.find(
      (a) =>
        a.asset.underlyingTicker.toUpperCase() === target ||
        a.asset.tokenSymbol.toUpperCase() === target,
    );
    if (!match) {
      this.logger.warn("market.ticker_not_found", { ticker });
      return null;
    }
    return match;
  }
}
