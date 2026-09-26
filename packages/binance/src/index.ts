/**
 * Binance integration surface for OLYR.
 *
 * Phase 1 intentionally contains interfaces only — no implementation, no
 * network calls, no credentials. The real Binance Web3 client (market data
 * first, order routing later) will be implemented against these interfaces in
 * a later phase, so consumers never depend on Binance specifics directly.
 */

/** Options for constructing a Binance client. */
export interface BinanceClientOptions {
  /** REST base URL. Public market-data endpoints need no credentials. */
  baseUrl: string;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
  /** API key. Optional for public endpoints; required for account actions later. */
  apiKey?: string;
  /** API secret. Never logged, never committed. */
  apiSecret?: string;
}

/** A spot price observation for a symbol. */
export interface SymbolPrice {
  symbol: string;
  /** Decimal string, e.g. "0.3142" — avoids float precision loss. */
  price: string;
  /** ISO-8601 timestamp of the observation. */
  timestamp: string;
}

/**
 * Read-only market data surface consumed by OLYR services.
 *
 * TODO(phase-2): implement against Binance Web3 endpoints (spot prices,
 * klines, exchange info) behind this interface.
 */
export interface BinanceMarketDataSource {
  getSymbolPrice(symbol: string): Promise<SymbolPrice>;
}

/**
 * Raised when a Binance client is requested before the integration phase has
 * wired a real implementation.
 */
export class BinanceNotConfiguredError extends Error {
  constructor(message = "Binance integration is not implemented yet (planned for a later phase)") {
    super(message);
    this.name = "BinanceNotConfiguredError";
  }
}
