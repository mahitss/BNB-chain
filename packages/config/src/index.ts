/**
 * Environment-driven configuration helpers shared by OLYR TypeScript services.
 *
 * All configuration comes from environment variables. Missing required values
 * throw at startup instead of failing silently later. Secrets never get
 * defaults — only explicitly optional values do.
 */

export type Environment = "development" | "test" | "production";

const ENVIRONMENTS = ["development", "test", "production"] as const;

/** Thrown when a required environment variable is missing or invalid. */
export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

function readEnv(key: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  return raw.trim();
}

/** Read a required string, or a fallback when the variable is unset. */
export function envString(key: string, fallback?: string): string {
  const raw = readEnv(key);
  if (raw !== undefined) {
    return raw;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new EnvError(`Missing required environment variable: ${key}`);
}

/** Read an optional string; returns undefined when unset. */
export function envOptionalString(key: string): string | undefined {
  return readEnv(key);
}

/** Read an integer, or a fallback when the variable is unset. */
export function envInt(key: string, fallback?: number): number {
  const raw = readEnv(key);
  if (raw === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new EnvError(`Missing required environment variable: ${key}`);
  }
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new EnvError(`Environment variable ${key} must be an integer, got: ${raw}`);
  }
  return value;
}

/** Read a value restricted to an allow-list, or a fallback when unset. */
export function envEnum<T extends string>(key: string, allowed: readonly T[], fallback?: T): T {
  const raw = readEnv(key);
  if (raw === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new EnvError(`Missing required environment variable: ${key}`);
  }
  const match = allowed.find((candidate) => candidate === raw);
  if (match === undefined) {
    throw new EnvError(
      `Environment variable ${key} must be one of [${allowed.join(", ")}], got: ${raw}`,
    );
  }
  return match;
}

/** Platform environment (OLYR_ENV); defaults to development. */
export function loadEnvironment(): Environment {
  return envEnum("OLYR_ENV", ENVIRONMENTS, "development");
}

export {
  isBinanceConfigured,
  loadBinanceConfig,
  type BinanceCacheTtls,
  type BinanceConfig,
} from "./binance.js";

export { loadIntelligenceConfig, type IntelligenceConfig } from "./intelligence.js";
