/**
 * Raw Binance Web3 API response shapes (envelope + RWA payloads).
 *
 * These mirror the official OpenAPI schema:
 * https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/1.0.0/schema.json
 * They exist only inside @olyr/binance — the rest of OLYR consumes the
 * normalized domain types from @olyr/types.
 */

export interface BinanceEnvelope<T> {
  code: number;
  msg: string;
  data: T;
  /** Server response time, Unix ms. */
  timestamp: number;
  success: boolean;
}

export interface RawRwaPlatform {
  platformId: string;
  tickerCount: number;
  chainDistribution: Array<{ binanceChainId: string; tokenCount: number }>;
  website: string | null;
  logoUrl: string | null;
}

export interface RawRwaMarketStatusInfo {
  openState: boolean;
  marketStatus: string;
  reasonCode: string | null;
  reasonMsg: string | null;
  nextOpenTime: number | null;
  nextCloseTime: number | null;
}

export interface RawRwaToken {
  binanceChainId: string;
  tokenContractAddress: string;
  platformId: string;
  assetType: number;
  tokenName: string;
  tokenSymbol: string;
  tokenLogoUrl: string | null;
  decimals: string | null;
  underlyingTicker: string;
  underlyingName: string;
  underlyingNameZh: string | null;
  tokenToShareRatio: string | null;
  tags: string[] | null;
  statusInfo: RawRwaMarketStatusInfo | null;
  tokenPrice: string | null;
  referencePrice: string | null;
  volume24H: string | null;
  marketCap: string | null;
  peRatioTTM: string | null;
}

export interface RawRwaPrice {
  binanceChainId: string;
  tokenContractAddress: string;
  platformId: string;
  tokenPrice: string | null;
  referencePrice: string | null;
  tokenPriceUpdatedAt: number | null;
}

export interface RawRwaSearchResult {
  ticker: string;
  companyName: string | null;
  assets: Array<{
    platformId: string;
    binanceChainId: string;
    tokenContractAddress: string;
    tokenSymbol: string;
    assetType: number;
  }>;
}

export interface RawRwaUnderlyingProfile {
  binanceChainId: string;
  tokenContractAddress: string;
  platformId: string;
  underlyingTicker: string;
  underlyingFullName: string;
  assetType: number;
  tokenToShareRatio: string | null;
  protections: Record<string, { supported: boolean; url: string | null }> | null;
  companyInfo: {
    ceo: string | null;
    website: string | null;
    industry: string | null;
    conceptsEn: string[] | null;
    conceptsCn: string[] | null;
    descriptionEn: string | null;
    descriptionZh: string | null;
  } | null;
}

export interface RawRwaUnderlyingMarket {
  binanceChainId: string;
  tokenContractAddress: string;
  platformId: string;
  assetType: number;
  statusInfo: RawRwaMarketStatusInfo | null;
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
  } | null;
}

export interface RawTokenLiquidityPool {
  pool: string;
  protocolName: string | null;
  liquidityUsd: string | null;
  poolAddress: string | null;
}
