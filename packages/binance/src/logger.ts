/**
 * Structured logging contract for the Binance client.
 *
 * SECURITY RULES (enforced by convention in implementations):
 * - Never log API keys, secret keys, or the X-OC-SIGN / X-OC-APIKEY headers.
 * - Never log wallet private keys or authorization headers.
 * Log only: operation name, HTTP status, latency, error category, and
 * non-sensitive request metadata.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function redactCredentials(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    safe[key] =
      key === "x-oc-apikey" || key === "x-oc-sign" || key === "authorization"
        ? "[REDACTED]"
        : value;
  }
  return safe;
}
