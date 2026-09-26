/**
 * RWA / tokenized-equity domain types.
 *
 * Field semantics mirror the official Binance Web3 Market API (RWA Data):
 * https://web3.binance.com/en/dev-docs/products/market-api/introduction
 * (OpenAPI reference: /en/dev-docs/catalog/web3-wallet/api/rest-api/1.0.0/schema.json)
 *
 * Prices are decimal strings (USD) end to end so no floating point precision
 * is lost across TS/Python/Go/Rust service boundaries.
 */

/** Issuance platform ids confirmed by the API docs. New ids may appear. */
export type KnownRwaPlatformId = "ondo" | "bstock";

/** Underlying asset type as returned by the API. 1=Stock, 2=Pre-IPO, 3=ETF. */
export type RwaAssetType = 1 | 2 | 3;

export const RWA_ASSET_TYPE_LABELS: Record<RwaAssetType, string> = {
  1: "Stock",
  2: "Pre-IPO",
  3: "ETF",
};

/**
 * Official underlying-market phase reported by Binance.
 * Never inferred locally from wall-clock time.
 */
export type RwaMarketPhase =
  "premarket" | "regular" | "postmarket" | "overnight" | "closed" | "pause";

/** `statusInfo` object returned by /rwa/tokens and /rwa/underlying-market. */
export interface RwaMarketStatusInfo {
  openState: boolean;
  marketStatus: RwaMarketPhase;
  /** Present when openState=false; e.g. MARKET_CLOSED, ASSET_PAUSED. */
  reasonCode: string | null;
  reasonMsg: string | null;
  /** Unix ms, expected next market open/close. */
  nextOpenTime: number | null;
  nextCloseTime: number | null;
}

/** One tokenized asset as returned by `GET /api/v1/dex/market/rwa/tokens`. */
export interface TokenizedAsset {
  chainId: string;
  tokenContractAddress: string;
  platformId: string;
  assetType: RwaAssetType;
  tokenName: string;
  tokenSymbol: string;
  tokenLogoUrl: string | null;
  decimals: string | null;
  underlyingTicker: string;
  underlyingName: string;
  /** "1.003701" means 1 token ≈ 1.003701 underlying shares. */
  tokenToShareRatio: string | null;
  tags: string[];
  volume24H: string | null;
  marketCap: string | null;
  peRatioTTM: string | null;
}

/** A single price observation, in USD, as a decimal string. */
export interface PriceValue {
  value: string;
  /** ISO-8601 instant the price was reported by the source. */
  asOf: string;
}

export interface OnChainPrice extends PriceValue {
  chainId: string;
  tokenContractAddress: string;
  platformId: string;
}

export interface ReferencePrice extends PriceValue {
  /**
   * Factual source note from the Binance docs: the reference price is a
   * per-share conversion derived from the on-chain token price, NOT an
   * official quote from the traditional stock market.
   */
  basis: "derived-per-share-conversion";
}

/** Quote for one token: on-chain price + underlying reference price. */
export interface RwaPriceQuote {
  chainId: string;
  tokenContractAddress: string;
  platformId: string;
  onChainPrice: OnChainPrice | null;
  referencePrice: ReferencePrice | null;
}

/** Result of the deterministic spread calculation. */
export type SpreadInvalidReason =
  "missing-onchain-price" | "missing-reference-price" | "zero-reference-price" | "invalid-number";

export interface Spread {
  /** Percent, rounded to 4 decimals, as a decimal string. Null when not computable. */
  percent: string | null;
  /** Basis points (percent × 100), rounded to 2 decimals. Null when not computable. */
  bps: string | null;
  invalidReason: SpreadInvalidReason | null;
}

/**
 * Deterministic spread: ((onChain - reference) / reference) * 100.
 * No LLM involvement. Returns an invalidReason instead of throwing for
 * zero reference price, missing values, or non-numeric input.
 */
export function calculateSpread(
  onChain: string | null | undefined,
  reference: string | null | undefined,
): Spread {
  if (onChain === null || onChain === undefined || onChain === "") {
    return invalid("missing-onchain-price");
  }
  if (reference === null || reference === undefined || reference === "") {
    return invalid("missing-reference-price");
  }
  const on = Number(onChain);
  const ref = Number(reference);
  if (!Number.isFinite(on)) {
    return invalid("invalid-number");
  }
  if (!Number.isFinite(ref)) {
    return invalid("invalid-number");
  }
  if (ref === 0) {
    return invalid("zero-reference-price");
  }
  // Round via integer shift to keep the rounding rule explicit and stable.
  const percent = Math.round(((on - ref) / ref) * 100 * 1e4) / 1e4;
  const bps = Math.round(((on - ref) / ref) * 1e4 * 1e2) / 1e2;
  return {
    percent: percent.toFixed(4),
    bps: bps.toFixed(2),
    invalidReason: null,
  };
}

function invalid(reason: SpreadInvalidReason): Spread {
  return { percent: null, bps: null, invalidReason: reason };
}

/** RWA token issuance platform, from `GET /rwa/platforms`. */
export interface RwaPlatform {
  platformId: string;
  tickerCount: number;
  chainDistribution: Array<{ chainId: string; tokenCount: number }>;
  website: string | null;
  logoUrl: string | null;
}

/** `GET /rwa/search` result: one underlying ticker with its tokenized assets. */
export interface RwaSearchResult {
  ticker: string;
  companyName: string | null;
  assets: Array<{
    platformId: string;
    chainId: string;
    tokenContractAddress: string;
    tokenSymbol: string;
    assetType: RwaAssetType;
  }>;
}

/** Company profile, from `GET /rwa/underlying-profile`. */
export interface AssetProfile {
  chainId: string;
  tokenContractAddress: string;
  platformId: string;
  underlyingTicker: string;
  underlyingFullName: string;
  assetType: RwaAssetType;
  tokenToShareRatio: string | null;
  companyInfo: {
    ceo: string | null;
    website: string | null;
    industry: string | null;
    conceptsEn: string[];
    descriptionEn: string | null;
  } | null;
  /** Keyed by mechanism (dailyAttestationReport, collateralReport, ...). */
  protections: Record<string, { supported: boolean; url: string | null }>;
}

/** Underlying market data, from `GET /rwa/underlying-market`. */
export interface UnderlyingMarketSnapshot {
  chainId: string;
  tokenContractAddress: string;
  platformId: string;
  assetType: RwaAssetType;
  statusInfo: RwaMarketStatusInfo;
  marketData: {
    referencePrice: string | null;
    high52W: string | null;
    low52W: string | null;
    volumeShares24H: string | null;
    avgDailyVolume1Y: string | null;
    totalShares: string | null;
    marketCap: string | null;
    turnoverRate: string | null;
    amplitude: string | null;
    peRatioTTM: string | null;
    pbRatio: string | null;
    dividendYield: string | null;
    latestDividend: string | null;
  };
}

/** Composite for the frontend: asset + prices + spread + market status. */
export interface RwaMarketSnapshot {
  asset: TokenizedAsset | null;
  quote: RwaPriceQuote | null;
  spread: Spread;
  marketStatus: RwaMarketStatusInfo | null;
  /** ISO-8601 instant OLYR assembled this snapshot. */
  retrievedAt: string;
}

/**
 * A tokenized asset enriched with prices, spread, and market status —
 * the shape served by `GET /api/rwa/assets` and rendered by the dashboard.
 */
export interface RwaAssetWithMarket {
  asset: TokenizedAsset;
  quote: RwaPriceQuote;
  spread: Spread;
  marketStatus: RwaMarketStatusInfo | null;
}

/**
 * `GET /rwa/tokens` row: the tokenized asset plus the prices and official
 * market status Binance embeds in that endpoint (no separate price call
 * needed for listings).
 */
export interface TokenizedAssetListing {
  asset: TokenizedAsset;
  tokenPrice: PriceValue | null;
  referencePrice: PriceValue | null;
  statusInfo: RwaMarketStatusInfo | null;
}
