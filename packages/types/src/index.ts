/**
 * Shared cross-service types for the OLYR platform.
 *
 * These types define the contracts exchanged between services over HTTP/JSON.
 * Keep them small and stable; service-internal types stay inside their own
 * services.
 */

export type ServiceName = "web" | "api" | "agent" | "execution" | "risk-engine";

export type HealthStatus = "ok" | "degraded";

/** Standard health payload returned by every service's `GET /health`. */
export interface HealthCheck {
  service: ServiceName;
  status: HealthStatus;
  /** ISO-8601 timestamp. */
  timestamp: string;
  version: string;
}

/**
 * A single observed price for an asset. Prices are decimal strings to avoid
 * floating-point precision loss across language boundaries (TS/Python/Go/Rust).
 */
export interface PricePoint {
  symbol: string;
  price: string;
  /** Where the price was observed, e.g. "binance" or "bsc-onchain". */
  source: string;
  /** ISO-8601 timestamp of the observation. */
  timestamp: string;
}

/**
 * Gap between an on-chain tokenized-stock price and its reference market
 * price. The spread is expressed in basis points as a decimal string.
 */
export interface PriceSpread {
  symbol: string;
  onChain: PricePoint;
  reference: PricePoint;
  spreadBps: string;
}

// TODO(phase-2+): risk-decision and execution-intent contracts will be added
// here once the agent → risk-engine → execution flow is implemented.

export * from "./rwa.js";
