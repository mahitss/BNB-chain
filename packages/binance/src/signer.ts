/**
 * Request signing for the Binance Web3 API, exactly as documented:
 * https://web3.binance.com/en/dev-docs/authentication.md
 *
 * preHash  = timestamp + METHOD + requestPath + body
 * signature = Base64( HMAC-SHA256(preHash, secretKey) )   (UTF-8)
 *
 * `requestPath` MUST include the `/build` base-path prefix and the raw
 * URL-encoded query string exactly as sent on the wire. Omitting `/build`
 * is the documented #1 cause of error 40102 (Invalid signature).
 */
import { createHmac } from "node:crypto";

export interface SignatureInput {
  /** ISO 8601 UTC with milliseconds, e.g. "2026-05-11T10:08:57.715Z". */
  timestamp: string;
  /** HTTP method, UPPERCASE. */
  method: string;
  /** Full wire path incl. /build prefix and raw-encoded query. */
  requestPath: string;
  /** Raw body string; empty for GET/HEAD. */
  body: string;
}

export const BINANCE_BUILD_PREFIX = "/build";

export function buildPreHash(input: SignatureInput): string {
  return input.timestamp + input.method.toUpperCase() + input.requestPath + input.body;
}

export function signRequest(input: SignatureInput, secretKey: string): string {
  return createHmac("sha256", secretKey).update(buildPreHash(input), "utf8").digest("base64");
}

/**
 * ISO 8601 UTC timestamp with millisecond precision, e.g.
 * "2026-05-11T10:08:57.715Z" — the exact format the gateway requires.
 */
export function binanceTimestamp(now: Date = new Date()): string {
  return now.toISOString();
}

/**
 * Build the raw query string used BOTH in the URL and in the signature so the
 * signed requestPath is byte-identical to what is sent. Spaces become %20
 * (never +), matching the documented examples.
 */
export function buildRawQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
