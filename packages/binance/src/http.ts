/**
 * Bounded HTTP layer for the Binance client: request timeout via
 * AbortController plus safe retry with exponential backoff + jitter.
 *
 * Retries ONLY transient failures (429 / 5xx / network errors / timeouts),
 * never authentication, invalid-request, region, or malformed-response
 * errors — see isRetryableError() in errors.ts.
 */
import {
  BinanceAuthError,
  BinanceError,
  BinanceNetworkError,
  BinanceRateLimitError,
  BinanceServerError,
  BinanceTimeoutError,
  isRetryableError,
} from "./errors.js";
import type { Logger } from "./logger.js";

export interface FetchOptions {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  /** Raw body; empty string for GET. */
  body: string;
  timeoutMs: number;
}

export interface RetryConfig {
  /** Total attempts including the first (default 3 → 2 retries). */
  maxAttempts: number;
  /** Base backoff in ms; delay = base * 2^attempt + jitter (default 300). */
  backoffBaseMs: number;
  /** Hard ceiling for a single backoff delay (default 5000). */
  backoffMaxMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffBaseMs: 300,
  backoffMaxMs: 5000,
};

export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
}

/** Injectable sleep so tests don't wait real time. */
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithTimeout(
  options: FetchOptions,
  fetchImpl: typeof fetch,
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.method === "GET" ? undefined : options.body,
      signal: controller.signal,
      redirect: "manual",
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new BinanceTimeoutError(options.timeoutMs);
    }
    throw new BinanceNetworkError(
      `Binance request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new BinanceNetworkError(
      `Failed to read Binance response body: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { status: response.status, headers: response.headers, text };
}

/**
 * Runs `operation` with bounded exponential backoff on retryable failures.
 * The operation must throw typed BinanceErrors — retrying therefore covers
 * both transport failures AND business-level envelope errors (the Market API
 * reports 50001/42900 inside HTTP 200 envelopes). Retries respect
 * Retry-After for rate limits (capped by backoffMaxMs).
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  retry: RetryConfig,
  sleep: Sleep,
  logger: Logger,
  operationName: string,
): Promise<T> {
  let lastError: unknown;
  const attempts = Math.max(1, retry.maxAttempts);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const delayMs = await backoffDelay(lastError, retry, attempt);
      logger.warn("binance.retry", { operation: operationName, attempt, delayMs });
      await sleep(delayMs);
    }
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function backoffDelay(
  lastError: unknown,
  retry: RetryConfig,
  attempt: number,
): Promise<number> {
  const exponential = Math.min(retry.backoffMaxMs, retry.backoffBaseMs * 2 ** (attempt - 1));
  if (lastError instanceof BinanceRateLimitError && lastError.retryAfterSeconds) {
    // Respect the server hint, but keep it bounded to avoid retry storms.
    return Math.min(retry.backoffMaxMs, lastError.retryAfterSeconds * 1000);
  }
  // Full jitter within [0, exponential) spreads concurrent retries.
  return Math.floor(Math.random() * exponential);
}

export function httpStatusToError(status: number): BinanceError {
  if (status === 401) {
    // Gateway auth rejection with a non-JSON body; auth errors are never retried.
    return new BinanceAuthError(`Binance gateway rejected credentials (HTTP 401)`, undefined, 401);
  }
  if (status === 429) {
    return new BinanceRateLimitError("Binance rate limit exceeded (HTTP 429)", null, 42900, status);
  }
  if (status >= 500) {
    return new BinanceServerError(`Binance server error (HTTP ${status})`, undefined, status);
  }
  return new BinanceNetworkError(`Unexpected HTTP ${status} from Binance`);
}
