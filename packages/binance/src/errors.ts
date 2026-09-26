/**
 * Typed errors for the Binance Web3 API client.
 *
 * Mapping follows the official docs:
 * - Gateway errors (authentication.md): 40001, 40101..40104, 42900, 50000, 50001
 * - Market API compliance/chain errors (market-api/error-codes.md):
 *   40301..40303 (region/proxy), 40411 (chain not supported)
 * - Market API responses use HTTP 200 with a business `code`; errors are
 *   detected from the envelope, not the HTTP status.
 */

export type BinanceErrorCategory =
  | "authentication"
  | "invalid-request"
  | "rate-limit"
  | "api-error"
  | "region-blocked"
  | "unsupported-chain"
  | "network"
  | "timeout"
  | "malformed-response"
  | "not-configured"
  | "market-data-unavailable";

export interface BinanceErrorOptions {
  category: BinanceErrorCategory;
  /** Business error code from the Binance envelope, when present. */
  code?: number;
  /** HTTP status code, when the failure surfaced at HTTP level. */
  httpStatus?: number;
  details?: unknown;
}

export class BinanceError extends Error {
  readonly category: BinanceErrorCategory;
  readonly code?: number;
  readonly httpStatus?: number;
  readonly details?: unknown;

  constructor(message: string, options: BinanceErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.category = options.category;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.details = options.details;
  }
}

export class BinanceAuthError extends BinanceError {
  constructor(message: string, code?: number, httpStatus?: number) {
    super(message, { category: "authentication", code, httpStatus });
  }
}

export class BinanceInvalidRequestError extends BinanceError {
  constructor(message: string, code?: number, details?: unknown) {
    super(message, { category: "invalid-request", code, details });
  }
}

export class BinanceRateLimitError extends BinanceError {
  /** Seconds to wait, from the Retry-After header when present. */
  readonly retryAfterSeconds: number | null;
  constructor(
    message: string,
    retryAfterSeconds: number | null,
    code?: number,
    httpStatus?: number,
  ) {
    super(message, { category: "rate-limit", code, httpStatus });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class BinanceServerError extends BinanceError {
  constructor(message: string, code?: number, httpStatus?: number) {
    super(message, { category: "api-error", code, httpStatus });
  }
}

export class BinanceRegionBlockedError extends BinanceError {
  constructor(message: string, code?: number) {
    super(message, { category: "region-blocked", code });
  }
}

export class BinanceUnsupportedChainError extends BinanceError {
  constructor(message: string, code?: number) {
    super(message, { category: "unsupported-chain", code });
  }
}

export class BinanceNetworkError extends BinanceError {
  constructor(message: string, details?: unknown) {
    super(message, { category: "network", details });
  }
}

export class BinanceTimeoutError extends BinanceError {
  constructor(timeoutMs: number) {
    super(`Binance request timed out after ${timeoutMs}ms`, {
      category: "timeout",
    });
  }
}

export class BinanceMalformedResponseError extends BinanceError {
  constructor(message: string, details?: unknown) {
    super(message, { category: "malformed-response", details });
  }
}

export class BinanceNotConfiguredError extends BinanceError {
  constructor(
    message = "Binance API credentials are not configured (set BINANCE_API_KEY and BINANCE_API_SECRET)",
  ) {
    super(message, { category: "not-configured" });
  }
}

export class BinanceMarketDataUnavailableError extends BinanceError {
  constructor(message: string, details?: unknown) {
    super(message, { category: "market-data-unavailable", details });
  }
}

const ENVELOPE_CODE_MAP: Record<number, (msg: string) => BinanceError> = {
  40001: (msg) => new BinanceInvalidRequestError(msg, 40001),
  40101: (msg) => new BinanceAuthError(msg, 40101),
  40102: (msg) => new BinanceAuthError(msg, 40102),
  40103: (msg) => new BinanceAuthError(msg, 40103),
  40104: (msg) => new BinanceAuthError(msg, 40104),
  40301: (msg) => new BinanceRegionBlockedError(msg, 40301),
  40302: (msg) => new BinanceRegionBlockedError(msg, 40302),
  40303: (msg) => new BinanceRegionBlockedError(msg, 40303),
  40411: (msg) => new BinanceUnsupportedChainError(msg, 40411),
  42900: (msg) => new BinanceRateLimitError(msg, null, 42900),
  50000: (msg) => new BinanceServerError(msg, 50000),
  50001: (msg) => new BinanceServerError(msg, 50001),
};

/** Map a business error code from the response envelope to a typed error. */
export function errorFromEnvelopeCode(code: number, msg: string): BinanceError {
  const factory = ENVELOPE_CODE_MAP[code];
  if (factory) {
    return factory(msg);
  }
  return new BinanceServerError(msg || `Unknown Binance error code ${code}`, code);
}

/** Errors that are transient and safe to retry (bounded, with backoff). */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof BinanceRateLimitError) return true;
  if (error instanceof BinanceServerError) return true;
  if (error instanceof BinanceNetworkError) return true;
  // Timeouts are retried: a hung request may be transient gateway load.
  if (error instanceof BinanceTimeoutError) return true;
  return false;
}
