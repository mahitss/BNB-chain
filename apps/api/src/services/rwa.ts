/**
 * RWA service: all business logic for tokenized-equity data.
 *
 * Route handlers stay thin; this service composes the Binance RWA client
 * with caching and the deterministic spread calculation from @olyr/types.
 * No LLM involvement anywhere in this path.
 */
import type { BinanceRwaClient, Logger } from "@olyr/binance";
import {
  calculateSpread,
  type RwaAssetWithMarket,
  type RwaMarketSnapshot,
  type RwaPlatform,
  type RwaPriceQuote,
  type RwaSearchResult,
  type TokenizedAsset,
  type UnderlyingMarketSnapshot,
} from "@olyr/types";
import type { TtlCache } from "../cache.js";

export interface RwaServiceOptions {
  client: BinanceRwaClient;
  cache: TtlCache;
  /** Default binanceChainId (BSC "56" for OLYR). */
  chainId: string;
  metadataTtlSeconds: number;
  priceTtlSeconds: number;
  logger: Logger;
}

const CACHE_PREFIX = "olyr:rwa:v1";

export class RwaService {
  private readonly client: BinanceRwaClient;
  private readonly cache: TtlCache;
  private readonly chainId: string;
  private readonly metadataTtl: number;
  private readonly priceTtl: number;
  private readonly logger: Logger;

  constructor(options: RwaServiceOptions) {
    this.client = options.client;
    this.cache = options.cache;
    this.chainId = options.chainId;
    this.metadataTtl = options.metadataTtlSeconds;
    this.priceTtl = options.priceTtlSeconds;
    this.logger = options.logger;
  }

  /** Cached asset list including embedded prices, spread, and market status. */
  async listAssets(
    filters: { chainId?: string; platformId?: string } = {},
  ): Promise<RwaAssetWithMarket[]> {
    const chainId = filters.chainId ?? this.chainId;
    const cacheKey = `${CACHE_PREFIX}:assets:${chainId}:${filters.platformId ?? "all"}`;
    const cached = await this.cache.get<RwaAssetWithMarket[]>(cacheKey);
    if (cached) {
      return cached;
    }
    const listings = await this.client.listTokens({ chainId, platformId: filters.platformId });
    const assets = listings.map((listing) => ({
      asset: listing.asset,
      quote: quoteFromListing(listing.asset, listing),
      spread: calculateSpread(listing.tokenPrice?.value, listing.referencePrice?.value),
      marketStatus: listing.statusInfo,
    }));
    await this.cache.set(cacheKey, assets, this.metadataTtl);
    return assets;
  }

  async listPlatforms(): Promise<RwaPlatform[]> {
    const cacheKey = `${CACHE_PREFIX}:platforms`;
    const cached = await this.cache.get<RwaPlatform[]>(cacheKey);
    if (cached) {
      return cached;
    }
    const platforms = await this.client.listPlatforms();
    await this.cache.set(cacheKey, platforms, this.metadataTtl);
    return platforms;
  }

  /** Search by ticker or company name; returns matches with tokenized assets. */
  async searchAssets(keyword: string): Promise<RwaSearchResult[]> {
    const cacheKey = `${CACHE_PREFIX}:search:${keyword.toLowerCase()}`;
    const cached = await this.cache.get<RwaSearchResult[]>(cacheKey);
    if (cached) {
      return cached;
    }
    const results = await this.client.searchTokens(keyword);
    await this.cache.set(cacheKey, results, this.metadataTtl);
    return results;
  }

  /**
   * Resolve a ticker to a concrete token contract. Explicit chainId/address
   * parameters win; otherwise the first tokenized asset matching the ticker
   * on the default chain is used. Returns null when nothing matches.
   */
  async resolveAsset(
    ticker: string,
    hints: { chainId?: string; address?: string } = {},
  ): Promise<{ chainId: string; tokenContractAddress: string } | null> {
    if (hints.address) {
      return { chainId: hints.chainId ?? this.chainId, tokenContractAddress: hints.address };
    }
    const matches = await this.searchAssets(ticker);
    const result = matches.find(
      (r) => r.ticker.toLowerCase() === ticker.toLowerCase() && r.assets.length > 0,
    );
    const targetChain = hints.chainId ?? this.chainId;
    const asset = result?.assets.find((a) => a.chainId === targetChain) ?? result?.assets[0];
    if (!asset) {
      return null;
    }
    return { chainId: asset.chainId, tokenContractAddress: asset.tokenContractAddress };
  }

  /** Quote for one tokenized asset: on-chain + reference price + spread. */
  async getAssetQuote(
    chainId: string,
    tokenContractAddress: string,
  ): Promise<RwaPriceQuote & { spread: ReturnType<typeof calculateSpread> }> {
    const cacheKey = `${CACHE_PREFIX}:quote:${chainId}:${tokenContractAddress.toLowerCase()}`;
    const quote =
      (await this.cache.get<RwaPriceQuote>(cacheKey)) ??
      (await this.fetchQuote(chainId, tokenContractAddress));
    await this.cache.set(cacheKey, quote, this.priceTtl);
    return {
      ...quote,
      spread: calculateSpread(quote.onChainPrice?.value, quote.referencePrice?.value),
    };
  }

  /**
   * Full market snapshot for one asset: market status comes from Binance's
   * own statusInfo — never inferred locally from wall-clock time.
   */
  async getAssetMarket(chainId: string, tokenContractAddress: string): Promise<RwaMarketSnapshot> {
    const cacheKey = `${CACHE_PREFIX}:market:${chainId}:${tokenContractAddress.toLowerCase()}`;
    const cached = await this.cache.get<RwaMarketSnapshot>(cacheKey);
    if (cached) {
      return cached;
    }
    const [quote, underlying] = await Promise.all([
      this.getAssetQuote(chainId, tokenContractAddress),
      this.fetchUnderlyingMarket(chainId, tokenContractAddress),
    ]);
    const snapshot: RwaMarketSnapshot = {
      asset: null,
      quote,
      spread: calculateSpread(quote.onChainPrice?.value, quote.referencePrice?.value),
      marketStatus: underlying.statusInfo,
      retrievedAt: new Date().toISOString(),
    };
    await this.cache.set(cacheKey, snapshot, this.priceTtl);
    return snapshot;
  }

  private async fetchQuote(chainId: string, tokenContractAddress: string): Promise<RwaPriceQuote> {
    const quotes = await this.client.getTokenPrices(chainId, [tokenContractAddress]);
    const quote = quotes.find(
      (q) => q.tokenContractAddress.toLowerCase() === tokenContractAddress.toLowerCase(),
    );
    if (!quote) {
      // The API omitted this token from the batch — report an empty quote
      // rather than fabricating prices; the spread layer marks it unavailable.
      this.logger.warn("rwa.quote_missing_from_batch", { chainId, tokenContractAddress });
      return {
        chainId,
        tokenContractAddress,
        platformId: "",
        onChainPrice: null,
        referencePrice: null,
      };
    }
    return quote;
  }

  private async fetchUnderlyingMarket(
    chainId: string,
    tokenContractAddress: string,
  ): Promise<UnderlyingMarketSnapshot> {
    const cacheKey = `${CACHE_PREFIX}:underlying:${chainId}:${tokenContractAddress.toLowerCase()}`;
    const cached = await this.cache.get<UnderlyingMarketSnapshot>(cacheKey);
    if (cached) {
      return cached;
    }
    const snapshot = await this.client.getUnderlyingMarketData(chainId, tokenContractAddress);
    await this.cache.set(cacheKey, snapshot, this.metadataTtl);
    return snapshot;
  }
}

function quoteFromListing(
  asset: TokenizedAsset,
  listing: {
    tokenPrice: { value: string; asOf: string } | null;
    referencePrice: { value: string; asOf: string } | null;
  },
): RwaPriceQuote {
  return {
    chainId: asset.chainId,
    tokenContractAddress: asset.tokenContractAddress,
    platformId: asset.platformId,
    onChainPrice: listing.tokenPrice
      ? {
          value: listing.tokenPrice.value,
          asOf: listing.tokenPrice.asOf,
          chainId: asset.chainId,
          tokenContractAddress: asset.tokenContractAddress,
          platformId: asset.platformId,
        }
      : null,
    referencePrice: listing.referencePrice
      ? {
          value: listing.referencePrice.value,
          asOf: listing.referencePrice.asOf,
          basis: "derived-per-share-conversion",
        }
      : null,
  };
}
