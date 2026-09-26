/**
 * Normalizers: raw Binance RWA payloads → OLYR domain types.
 *
 * Every field is defensively validated; anything the API may omit becomes a
 * typed null instead of an undefined leak or a fabricated value.
 */
import {
  type AssetProfile,
  type RwaAssetType,
  type RwaMarketPhase,
  type RwaMarketStatusInfo,
  type RwaPlatform,
  type RwaPriceQuote,
  type RwaSearchResult,
  type TokenizedAsset,
  type TokenizedAssetListing,
  type UnderlyingMarketSnapshot,
} from "@olyr/types";
import { BinanceMalformedResponseError } from "./errors.js";
import type {
  RawRwaMarketStatusInfo,
  RawRwaPlatform,
  RawRwaPrice,
  RawRwaSearchResult,
  RawRwaToken,
  RawRwaUnderlyingMarket,
  RawRwaUnderlyingProfile,
} from "./raw.js";

const MARKET_PHASES: readonly RwaMarketPhase[] = [
  "premarket",
  "regular",
  "postmarket",
  "overnight",
  "closed",
  "pause",
];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asAssetType(value: unknown): RwaAssetType | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

function msToIso(value: unknown): string | null {
  const ms = asNumber(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function nullableStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function normalizeMarketStatus(
  raw: RawRwaMarketStatusInfo | null | undefined,
): RwaMarketStatusInfo | null {
  if (!raw) {
    return null;
  }
  const phase = MARKET_PHASES.find((p) => p === raw.marketStatus);
  if (!phase) {
    // Unknown phase from the API: keep the data but never invent a phase.
    throw new BinanceMalformedResponseError(
      `Unknown marketStatus value: ${String(raw.marketStatus)}`,
    );
  }
  return {
    openState: raw.openState === true,
    marketStatus: phase,
    reasonCode: asString(raw.reasonCode),
    reasonMsg: asString(raw.reasonMsg),
    nextOpenTime: asNumber(raw.nextOpenTime),
    nextCloseTime: asNumber(raw.nextCloseTime),
  };
}

export function normalizeTokenizedAsset(raw: RawRwaToken): TokenizedAsset {
  const assetType = asAssetType(raw.assetType);
  const contract = asString(raw.tokenContractAddress);
  if (assetType === null) {
    throw new BinanceMalformedResponseError(
      `Invalid assetType for token ${String(raw.tokenContractAddress)}`,
    );
  }
  if (!contract) {
    throw new BinanceMalformedResponseError("Missing tokenContractAddress in RWA token");
  }
  return {
    chainId: raw.binanceChainId,
    tokenContractAddress: contract,
    platformId: raw.platformId,
    assetType,
    tokenName: asString(raw.tokenName) ?? "",
    tokenSymbol: asString(raw.tokenSymbol) ?? "",
    tokenLogoUrl: asString(raw.tokenLogoUrl),
    decimals: asString(raw.decimals),
    underlyingTicker: asString(raw.underlyingTicker) ?? "",
    underlyingName: asString(raw.underlyingName) ?? "",
    tokenToShareRatio: asString(raw.tokenToShareRatio),
    tags: nullableStringList(raw.tags),
    volume24H: asString(raw.volume24H),
    marketCap: asString(raw.marketCap),
    peRatioTTM: asString(raw.peRatioTTM),
  };
}

export function normalizeTokenListing(
  raw: RawRwaToken,
  /** Server envelope timestamp (Unix ms) — the prices' asOf instant. */
  envelopeTimestampMs: number,
): TokenizedAssetListing {
  const asOf = msToIso(envelopeTimestampMs) ?? new Date().toISOString();
  const tokenPriceValue = asString(raw.tokenPrice);
  const referencePriceValue = asString(raw.referencePrice);
  return {
    asset: normalizeTokenizedAsset(raw),
    tokenPrice: tokenPriceValue ? { value: tokenPriceValue, asOf } : null,
    referencePrice: referencePriceValue ? { value: referencePriceValue, asOf } : null,
    statusInfo: normalizeMarketStatus(raw.statusInfo),
  };
}

export function normalizePriceQuote(raw: RawRwaPrice): RwaPriceQuote {
  const onChainValue = asString(raw.tokenPrice);
  const referenceValue = asString(raw.referencePrice);
  const asOf = msToIso(raw.tokenPriceUpdatedAt) ?? new Date().toISOString();
  return {
    chainId: raw.binanceChainId,
    tokenContractAddress: raw.tokenContractAddress,
    platformId: raw.platformId,
    onChainPrice: onChainValue
      ? {
          value: onChainValue,
          asOf,
          chainId: raw.binanceChainId,
          tokenContractAddress: raw.tokenContractAddress,
          platformId: raw.platformId,
        }
      : null,
    referencePrice: referenceValue
      ? { value: referenceValue, asOf, basis: "derived-per-share-conversion" }
      : null,
  };
}

export function normalizePlatform(raw: RawRwaPlatform): RwaPlatform {
  return {
    platformId: raw.platformId,
    tickerCount: asNumber(raw.tickerCount) ?? 0,
    chainDistribution: (raw.chainDistribution ?? []).map((entry) => ({
      chainId: entry.binanceChainId,
      tokenCount: asNumber(entry.tokenCount) ?? 0,
    })),
    website: asString(raw.website),
    logoUrl: asString(raw.logoUrl),
  };
}

export function normalizeSearchResult(raw: RawRwaSearchResult): RwaSearchResult {
  return {
    ticker: raw.ticker,
    companyName: asString(raw.companyName),
    assets: (raw.assets ?? []).flatMap((asset) => {
      const assetType = asAssetType(asset.assetType);
      const contract = asString(asset.tokenContractAddress);
      if (assetType === null || !contract) {
        return [];
      }
      return [
        {
          platformId: asset.platformId,
          chainId: asset.binanceChainId,
          tokenContractAddress: contract,
          tokenSymbol: asString(asset.tokenSymbol) ?? "",
          assetType,
        },
      ];
    }),
  };
}

export function normalizeUnderlyingProfile(raw: RawRwaUnderlyingProfile): AssetProfile {
  const assetType = asAssetType(raw.assetType);
  if (assetType === null) {
    throw new BinanceMalformedResponseError("Invalid assetType in underlying profile");
  }
  const protections: Record<string, { supported: boolean; url: string | null }> = {};
  if (raw.protections && typeof raw.protections === "object") {
    for (const [key, value] of Object.entries(raw.protections)) {
      if (value && typeof value === "object" && "supported" in value) {
        protections[key] = {
          supported: value.supported === true,
          url: asString(value.url),
        };
      }
    }
  }
  return {
    chainId: raw.binanceChainId,
    tokenContractAddress: raw.tokenContractAddress,
    platformId: raw.platformId,
    underlyingTicker: asString(raw.underlyingTicker) ?? "",
    underlyingFullName: asString(raw.underlyingFullName) ?? "",
    assetType,
    tokenToShareRatio: asString(raw.tokenToShareRatio),
    companyInfo: raw.companyInfo
      ? {
          ceo: asString(raw.companyInfo.ceo),
          website: asString(raw.companyInfo.website),
          industry: asString(raw.companyInfo.industry),
          conceptsEn: nullableStringList(raw.companyInfo.conceptsEn),
          descriptionEn: asString(raw.companyInfo.descriptionEn),
        }
      : null,
    protections,
  };
}

export function normalizeUnderlyingMarket(raw: RawRwaUnderlyingMarket): UnderlyingMarketSnapshot {
  const assetType = asAssetType(raw.assetType);
  if (assetType === null) {
    throw new BinanceMalformedResponseError("Invalid assetType in underlying market data");
  }
  const market = raw.marketData;
  const pick = (value: unknown): string | null => asString(value);
  return {
    chainId: raw.binanceChainId,
    tokenContractAddress: raw.tokenContractAddress,
    platformId: raw.platformId,
    assetType,
    statusInfo: normalizeMarketStatus(raw.statusInfo) ?? {
      openState: false,
      marketStatus: "closed",
      reasonCode: null,
      reasonMsg: null,
      nextOpenTime: null,
      nextCloseTime: null,
    },
    marketData: {
      referencePrice: market ? pick(market.referencePrice) : null,
      high52W: market ? pick(market.high52W) : null,
      low52W: market ? pick(market.low52W) : null,
      volumeShares24H: market ? pick(market.volumeShares24H) : null,
      avgDailyVolume1Y: market ? pick(market.avgDailyVolume1Y) : null,
      totalShares: market ? pick(market.totalShares) : null,
      marketCap: market ? pick(market.marketCap) : null,
      turnoverRate: market ? pick(market.turnoverRate) : null,
      amplitude: market ? pick(market.amplitude) : null,
      peRatioTTM: market ? pick(market.peRatioTTM) : null,
      pbRatio: market ? pick(market.pbRatio) : null,
      dividendYield: market ? pick(market.dividendYield) : null,
      latestDividend: market ? pick(market.latestDividend) : null,
    },
  };
}
