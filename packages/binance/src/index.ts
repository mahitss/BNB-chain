/**
 * Binance integration surface for OLYR.
 *
 * Phase 2: read-only RWA (tokenized-equity) market data client, implemented
 * strictly against the official documentation:
 *   https://web3.binance.com/en/dev-docs/products/market-api/introduction
 *   https://web3.binance.com/en/dev-docs/authentication.md
 *
 * The rest of OLYR depends on the BinanceRwaClient interface and @olyr/types
 * domain types — never on raw Binance HTTP responses. Trading, swaps, wallet,
 * and broadcast endpoints are intentionally NOT implemented. The Phase 1
 * speculative `BinanceMarketDataSource` seam was replaced by the documented
 * `BinanceRwaClient`.
 */

export {
  HttpBinanceRwaClient,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_BATCH_CONTRACTS,
} from "./rwa-client.js";
export type { BinanceRwaClient, BinanceRwaClientConfig } from "./rwa-client.js";

export {
  BinanceError,
  BinanceAuthError,
  BinanceInvalidRequestError,
  BinanceMalformedResponseError,
  BinanceMarketDataUnavailableError,
  BinanceNetworkError,
  BinanceNotConfiguredError,
  BinanceRateLimitError,
  BinanceRegionBlockedError,
  BinanceServerError,
  BinanceTimeoutError,
  BinanceUnsupportedChainError,
  errorFromEnvelopeCode,
  isRetryableError,
} from "./errors.js";
export type { BinanceErrorCategory } from "./errors.js";

export {
  BINANCE_BUILD_PREFIX,
  binanceTimestamp,
  buildPreHash,
  buildRawQuery,
  signRequest,
} from "./signer.js";
export type { SignatureInput } from "./signer.js";

export { silentLogger, redactCredentials } from "./logger.js";
export type { Logger } from "./logger.js";
export { DEFAULT_RETRY_CONFIG } from "./http.js";
export type { RetryConfig, Sleep } from "./http.js";
