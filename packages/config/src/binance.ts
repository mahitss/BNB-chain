/**
 * Binance Web3 API configuration, loaded from environment variables.
 *
 * Credentials come ONLY from the environment; they are never hardcoded,
 * never defaulted, and never logged. A partially configured client (key
 * without secret, or vice versa) is rejected as a misconfiguration.
 *
 * Both credentials are required because every Binance Web3 endpoint is
 * authenticated: requests are signed with HMAC-SHA256 using the secret key
 * (see https://web3.binance.com/en/dev-docs/authentication.md).
 */
import { EnvError, envInt, envString } from "./index.js";

export interface BinanceCacheTtls {
  /** TTL for relatively stable metadata (asset lists, profiles). */
  metadataSeconds: number;
  /** TTL for time-sensitive prices — short by design. */
  priceSeconds: number;
}

export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  /** Documented gateway base URL incl. the /build prefix. */
  baseUrl: string;
  timeoutMs: number;
  retry: {
    maxAttempts: number;
    backoffBaseMs: number;
    backoffMaxMs: number;
  };
  /** Default binanceChainId for RWA queries; BSC ("56") for OLYR. */
  chainId: string;
  cacheTtls: BinanceCacheTtls;
}

/** true iff both credentials are present in the environment. */
export function isBinanceConfigured(): boolean {
  return (
    process.env["BINANCE_API_KEY"] !== undefined &&
    process.env["BINANCE_API_KEY"].trim() !== "" &&
    process.env["BINANCE_API_SECRET"] !== undefined &&
    process.env["BINANCE_API_SECRET"].trim() !== ""
  );
}

/**
 * Loads and validates Binance configuration. Throws EnvError on partial
 * configuration or invalid numeric values. Returns null when credentials
 * are simply absent (supported dev mode — the API starts and reports a
 * clear configuration error on RWA endpoints).
 */
export function loadBinanceConfig(): BinanceConfig | null {
  const hasKey = envOptional("BINANCE_API_KEY");
  const hasSecret = envOptional("BINANCE_API_SECRET");
  if (!hasKey && !hasSecret) {
    return null;
  }
  if (!hasKey || !hasSecret) {
    throw new EnvError(
      "Binance credentials are partially configured: both BINANCE_API_KEY and BINANCE_API_SECRET must be set",
    );
  }
  return {
    apiKey: hasKey,
    apiSecret: hasSecret,
    baseUrl: envOptional("BINANCE_BASE_URL") ?? "https://web3.binance.com/build",
    timeoutMs: envInt("BINANCE_TIMEOUT_MS", 10_000),
    retry: {
      maxAttempts: envInt("BINANCE_MAX_RETRIES", 3),
      backoffBaseMs: envInt("BINANCE_BACKOFF_BASE_MS", 300),
      backoffMaxMs: envInt("BINANCE_BACKOFF_MAX_MS", 5000),
    },
    chainId: envOptional("BINANCE_CHAIN_ID") ?? "56",
    cacheTtls: {
      metadataSeconds: envInt("RWA_CACHE_METADATA_TTL_SECONDS", 300),
      priceSeconds: envInt("RWA_CACHE_PRICE_TTL_SECONDS", 15),
    },
  };
}

function envOptional(key: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  return raw.trim();
}

// Keep the tree-shaken import surface small; envString is re-exported for
// consumers that must fail hard on missing app-level config.
export { envString };
