/**
 * Binance Web3 RWA client.
 *
 * Implements ONLY endpoints documented at:
 *   https://web3.binance.com/en/dev-docs/products/market-api/introduction  (RWA Data)
 *   https://web3.binance.com/en/dev-docs/authentication.md                 (signing)
 * Read-only market data. No trading, swaps, or wallet operations.
 */
import type {
  AssetProfile,
  RwaPlatform,
  RwaPriceQuote,
  RwaSearchResult,
  TokenizedAssetListing,
  TokenLiquidityPool,
  UnderlyingMarketSnapshot,
} from "@olyr/types";
import {
  BinanceError,
  BinanceInvalidRequestError,
  BinanceMalformedResponseError,
  errorFromEnvelopeCode,
} from "./errors.js";
import {
  DEFAULT_RETRY_CONFIG,
  fetchWithTimeout,
  httpStatusToError,
  withRetry,
  type RetryConfig,
  type Sleep,
  realSleep,
} from "./http.js";
import { silentLogger, type Logger } from "./logger.js";
import {
  normalizePlatform,
  normalizePriceQuote,
  normalizeSearchResult,
  normalizeLiquidityPools,
  normalizeTokenListing,
  normalizeUnderlyingMarket,
  normalizeUnderlyingProfile,
} from "./normalize.js";
import type {
  BinanceEnvelope,
  RawRwaPlatform,
  RawRwaPrice,
  RawRwaSearchResult,
  RawRwaToken,
  RawTokenLiquidityPool,
  RawRwaUnderlyingMarket,
  RawRwaUnderlyingProfile,
} from "./raw.js";
import { BINANCE_BUILD_PREFIX, binanceTimestamp, buildRawQuery, signRequest } from "./signer.js";

export interface BinanceRwaClientConfig {
  apiKey: string;
  apiSecret: string;
  /** Documented base URL incl. the /build prefix. */
  baseUrl: string;
  timeoutMs: number;
  retry: RetryConfig;
}

export const DEFAULT_BASE_URL = "https://web3.binance.com/build";
export const DEFAULT_TIMEOUT_MS = 10_000;
/** Documented limit for /rwa/price batch queries. */
export const MAX_BATCH_CONTRACTS = 100;

/**
 * Domain-oriented surface over Binance's RWA Data API. Consumers depend on
 * this interface, never on raw Binance HTTP responses.
 */
export interface BinanceRwaClient {
  /** GET /rwa/platforms — issuance platforms (ondo, bstock, ...). */
  listPlatforms(platformId?: string): Promise<RwaPlatform[]>;
  /** GET /rwa/tokens — tokenized assets with embedded prices + market status. */
  listTokens(filters?: {
    chainId?: string;
    platformId?: string;
    /** Sector tab: 1=Serenity Call ... 13=Buffett Portfolio (documented enum). */
    tabId?: number;
  }): Promise<TokenizedAssetListing[]>;
  /** GET /rwa/price — batch on-chain + reference prices (max 100 contracts). */
  getTokenPrices(chainId: string, tokenContractAddresses: string[]): Promise<RwaPriceQuote[]>;
  /** GET /rwa/search — search by ticker, company name, or contract address. */
  searchTokens(keyword: string, platformId?: string): Promise<RwaSearchResult[]>;
  /** GET /rwa/underlying-profile — company info for a token. */
  getUnderlyingProfile(chainId: string, tokenContractAddress: string): Promise<AssetProfile>;
  /**
   * GET /dex/market/token/top-liquidity — documented on-chain liquidity pools
   * for a token (General Data section of the Market API).
   */
  getTokenLiquidity(chainId: string, tokenContractAddress: string): Promise<TokenLiquidityPool[]>;
  /** GET /rwa/underlying-market — market data + status for a token. */
  getUnderlyingMarketData(
    chainId: string,
    tokenContractAddress: string,
  ): Promise<UnderlyingMarketSnapshot>;
}

export class HttpBinanceRwaClient implements BinanceRwaClient {
  private readonly config: BinanceRwaClientConfig;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: Sleep;

  constructor(options: {
    config: BinanceRwaClientConfig;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    sleep?: Sleep;
  }) {
    this.config = options.config;
    this.logger = options.logger ?? silentLogger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? realSleep;
  }

  async listPlatforms(platformId?: string): Promise<RwaPlatform[]> {
    const { data } = await this.request<RawRwaPlatform[]>(
      "listPlatforms",
      "/api/v1/dex/market/rwa/platforms",
      { platformId },
    );
    return data.map(normalizePlatform);
  }

  async listTokens(filters?: {
    chainId?: string;
    platformId?: string;
    tabId?: number;
  }): Promise<TokenizedAssetListing[]> {
    const { data, timestamp } = await this.request<RawRwaToken[]>(
      "listTokens",
      "/api/v1/dex/market/rwa/tokens",
      {
        binanceChainId: filters?.chainId,
        platformId: filters?.platformId,
        tabId: filters?.tabId === undefined ? undefined : String(filters.tabId),
      },
    );
    const listings: TokenizedAssetListing[] = [];
    for (const raw of data) {
      try {
        listings.push(normalizeTokenListing(raw, timestamp));
      } catch (error) {
        // One malformed row (e.g. undocumented assetType null observed live)
        // must not fail the whole listing: skip it with a warn log carrying
        // only public on-chain identifiers, never credentials.
        if (error instanceof BinanceMalformedResponseError) {
          this.logger.warn("binance.skip_malformed_token", {
            tokenContractAddress:
              typeof raw.tokenContractAddress === "string" ? raw.tokenContractAddress : null,
            underlyingTicker:
              typeof raw.underlyingTicker === "string" ? raw.underlyingTicker : null,
            reason: error.message.slice(0, 120),
          });
          continue;
        }
        throw error;
      }
    }
    return listings;
  }

  async getTokenPrices(
    chainId: string,
    tokenContractAddresses: string[],
  ): Promise<RwaPriceQuote[]> {
    if (tokenContractAddresses.length === 0) {
      throw new BinanceInvalidRequestError("tokenContractAddresses must not be empty");
    }
    if (tokenContractAddresses.length > MAX_BATCH_CONTRACTS) {
      throw new BinanceInvalidRequestError(
        `tokenContractAddresses exceeds the documented batch limit of ${MAX_BATCH_CONTRACTS}`,
      );
    }
    const { data } = await this.request<RawRwaPrice[]>(
      "getTokenPrices",
      "/api/v1/dex/market/rwa/price",
      {
        binanceChainId: chainId,
        tokenContractAddresses: tokenContractAddresses.join(","),
      },
    );
    return data.map(normalizePriceQuote);
  }

  async searchTokens(keyword: string, platformId?: string): Promise<RwaSearchResult[]> {
    if (!keyword.trim()) {
      throw new BinanceInvalidRequestError("keyword must not be empty");
    }
    const { data } = await this.request<RawRwaSearchResult[]>(
      "searchTokens",
      "/api/v1/dex/market/rwa/search",
      {
        keyword: keyword.trim(),
        platformId,
      },
    );
    return data.map(normalizeSearchResult);
  }

  async getUnderlyingProfile(chainId: string, tokenContractAddress: string): Promise<AssetProfile> {
    const { data } = await this.request<RawRwaUnderlyingProfile>(
      "getUnderlyingProfile",
      "/api/v1/dex/market/rwa/underlying-profile",
      { binanceChainId: chainId, tokenContractAddress },
    );
    return normalizeUnderlyingProfile(data);
  }

  async getTokenLiquidity(
    chainId: string,
    tokenContractAddress: string,
  ): Promise<TokenLiquidityPool[]> {
    const { data } = await this.request<RawTokenLiquidityPool[]>(
      "getTokenLiquidity",
      "/api/v1/dex/market/token/top-liquidity",
      { binanceChainId: chainId, tokenContractAddress },
    );
    return normalizeLiquidityPools(data);
  }

  async getUnderlyingMarketData(
    chainId: string,
    tokenContractAddress: string,
  ): Promise<UnderlyingMarketSnapshot> {
    const { data } = await this.request<RawRwaUnderlyingMarket>(
      "getUnderlyingMarketData",
      "/api/v1/dex/market/rwa/underlying-market",
      { binanceChainId: chainId, tokenContractAddress },
    );
    return normalizeUnderlyingMarket(data);
  }

  /**
   * Signed request against the documented gateway. The envelope (HTTP 200 +
   * business `code`) decides success per the Market API error-code docs.
   */
  protected async request<T>(
    operation: string,
    apiPath: string,
    params: Record<string, string | undefined>,
    options: { method?: "GET" | "POST"; body?: string } = {},
  ): Promise<{ data: T; timestamp: number }> {
    const queryEntries = Object.entries(params).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "",
    );
    const rawQuery = buildRawQuery(Object.fromEntries(queryEntries));
    const method = options.method ?? "GET";
    const body = options.body ?? "";
    // Signed requestPath includes the /build prefix exactly as sent on the wire.
    const requestPath = `${BINANCE_BUILD_PREFIX}${apiPath}${rawQuery ? `?${rawQuery}` : ""}`;
    const url = `${this.config.baseUrl}${apiPath}${rawQuery ? `?${rawQuery}` : ""}`;
    const timestamp = binanceTimestamp();
    const signature = signRequest({ timestamp, method, requestPath, body }, this.config.apiSecret);

    const startedAt = Date.now();
    const logMeta = { operation, path: requestPath };

    // One attempt = fetch + envelope parse + typed-error mapping. Retrying
    // this whole unit is required because the Market API reports transient
    // failures (42900/50001) inside HTTP 200 envelopes.
    const attempt = async (): Promise<{ data: T; timestamp: number }> => {
      const result = await fetchWithTimeout(
        {
          method,
          url,
          headers: {
            "X-OC-APIKEY": this.config.apiKey,
            "X-OC-TIMESTAMP": timestamp,
            "X-OC-SIGN": signature,
          },
          body,
          timeoutMs: this.config.timeoutMs,
        },
        this.fetchImpl,
      );

      let envelope: BinanceEnvelope<T>;
      try {
        envelope = JSON.parse(result.text) as BinanceEnvelope<T>;
      } catch {
        // Non-JSON body: map gateway-level HTTP failures, else malformed.
        if (result.status !== 200) {
          throw httpStatusToError(result.status);
        }
        throw new BinanceMalformedResponseError("Binance returned a non-JSON body with HTTP 200", {
          bodyPreview: result.text.slice(0, 200),
        });
      }
      if (typeof envelope.code !== "number" || envelope.data === undefined) {
        throw new BinanceMalformedResponseError(
          "Binance response envelope is missing code/data fields",
          { bodyPreview: result.text.slice(0, 200) },
        );
      }
      if (envelope.code !== 0) {
        // Market API returns HTTP 200 with a non-zero business code on errors.
        throw errorFromEnvelopeCode(envelope.code, envelope.msg ?? "");
      }
      return { data: envelope.data, timestamp: envelope.timestamp };
    };

    try {
      const outcome = await withRetry(
        attempt,
        this.config.retry ?? DEFAULT_RETRY_CONFIG,
        this.sleep,
        this.logger,
        operation,
      );
      this.logger.info("binance.request", {
        ...logMeta,
        status: 200,
        latencyMs: Date.now() - startedAt,
      });
      return outcome;
    } catch (error) {
      // One structured error log per failed operation (final attempt only —
      // intermediate retries are logged by withRetry).
      this.logger.error("binance.request_failed", {
        ...logMeta,
        latencyMs: Date.now() - startedAt,
        errorCategory:
          error instanceof BinanceError
            ? error.category
            : error instanceof Error
              ? error.name
              : "unknown",
        code: error instanceof BinanceError ? error.code : undefined,
      });
      throw error;
    }
  }
}
