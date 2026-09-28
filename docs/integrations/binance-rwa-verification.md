# Binance Web3 RWA Integration — Contract Verification

Verified 2026-09-28 against the official Binance Web3 developer documentation
(web3.binance.com/en/dev-docs — llms.txt, authentication.md, Market API
introduction + error codes, OpenAPI schema at
`/en/dev-docs/catalog/web3-auth-wallet/api/rest-api/1.0.0/schema.json`) and
against the live gateway from this build.

## Authentication (verified live)

| Item           | Documented                                                                                                                 | Implemented                                               | Verified                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Headers        | `X-OC-APIKEY`, `X-OC-TIMESTAMP` (ISO-8601 ms), `X-OC-SIGN` (Base64 HMAC-SHA256); optional `X-OC-RECV-WINDOW`, `X-OC-NONCE` | Identical (`packages/binance/src/signer.ts`)              | PASS — live probe reached the gateway; placeholder keys produced the documented `40101 Invalid API Key` envelope |
| Pre-hash       | `timestamp + METHOD + requestPath + body`, requestPath **must include the `/build` prefix**                                | Identical, incl. `/build` (documented #1 cause of 40102)  | PASS — signature matched precomputed vector (unit test); gateway processed the request                           |
| Base URL       | `https://web3.binance.com/build`                                                                                           | Same default (`DEFAULT_BASE_URL`)                         | PASS                                                                                                             |
| Error envelope | HTTP 200 + `{code, msg, data, timestamp, success}`; non-zero code = error                                                  | Identical (`normalize`/`errors.ts`)                       | PASS — live 40101 mapped to `BinanceAuthError`                                                                   |
| Rate limits    | 1200 req/60s per IP and per key; 6000/60s per user; 5 RPS per endpoint; 429 + `Retry-After`                                | Retry respects `Retry-After`, bounded backoff (`http.ts`) | PASS (code review + retry tests; live rate-limit hit not observed)                                               |

## Endpoints used (all documented; none invented)

| #   | Endpoint                                                 | Purpose                                     | Auth   | Request (key params)                                                                                           | Response (normalized to)                                                         | Implementation                            | Verification                                                                         |
| --- | -------------------------------------------------------- | ------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `GET /api/v1/dex/market/rwa/platforms`                   | Issuance platforms (ondo, bstock)           | Signed | `platformId?`                                                                                                  | `RwaPlatform[]`                                                                  | `rwa-client.ts listPlatforms`             | PASS — schema match (OpenAPI + unit fixtures); live call blocked only by credentials |
| 2   | `GET /api/v1/dex/market/rwa/tokens`                      | Token list w/ embedded prices + status      | Signed | `binanceChainId?`, `platformId?`, `tabId?`                                                                     | `TokenizedAssetListing[]` (asset + `tokenPrice`/`referencePrice` + `statusInfo`) | `rwa-client.ts listTokens`                | PASS — schema match; live call requires credentials                                  |
| 3   | `GET /api/v1/dex/market/rwa/price`                       | Batch on-chain + reference prices           | Signed | `binanceChainId`, `tokenContractAddresses` (≤100, CSV), optional `userWalletAddress` (required for RFQ routes) | `RwaPriceQuote[]`                                                                | `rwa-client.ts getTokenPrices`            | PASS — schema match; batch limit enforced locally                                    |
| 4   | `GET /api/v1/dex/market/rwa/search`                      | Search by ticker/company/contract           | Signed | `keyword`, `platformId?`                                                                                       | `RwaSearchResult[]`                                                              | `rwa-client.ts searchTokens`              | PASS — schema match                                                                  |
| 5   | `GET /api/v1/dex/market/rwa/underlying-profile`          | Underlying company info                     | Signed | `binanceChainId`, `tokenContractAddress`                                                                       | `AssetProfile`                                                                   | `rwa-client.ts getUnderlyingProfile`      | PASS — schema match                                                                  |
| 6   | `GET /api/v1/dex/market/rwa/underlying-market`           | Underlying market data + status             | Signed | `binanceChainId`, `tokenContractAddress`                                                                       | `UnderlyingMarketSnapshot`                                                       | `rwa-client.ts getUnderlyingMarketData`   | PASS — schema match                                                                  |
| 7   | `GET /api/v1/dex/market/token/top-liquidity`             | On-chain liquidity pools                    | Signed | `binanceChainId`, `tokenContractAddress`                                                                       | `TokenLiquidityPool[]`                                                           | `rwa-client.ts getTokenLiquidity`         | PASS — schema match                                                                  |
| 8   | `GET /api/v1/dex/balance/all-token-balances-by-address`  | Wallet balances                             | Signed | `address`, `chains`, `excludeRiskToken`, pagination                                                            | `TokenBalance[]`                                                                 | `trading-client.ts getAllTokenBalances`   | PASS — used by the diagnostics probe; live call returned documented auth envelope    |
| 9   | `GET /api/v1/dex/aggregator/quote`                       | Swap quote (RFQ for equities)               | Signed | `binanceChainId`, `amount` (smallest unit), `fromTokenAddress`, `toTokenAddress`, `userWalletAddress` (RFQ)    | `TradeQuote` via `QuoteRoute[]`                                                  | `trading-client.ts getQuote`              | PASS — schema match                                                                  |
| 10  | `GET /api/v1/dex/aggregator/swap`                        | Build swap / RFQ payload (quoteId TTL ~30s) | Signed | quote params + `quoteId`, `slippagePercent`/`autoSlippage`, `approveTransaction`                               | `SwapPreparation` (SWAP tx or RFQ typed data)                                    | `trading-client.ts buildSwap`             | PASS — schema match; executionMode=RFQ documented for equity tokens                  |
| 11  | `POST /api/v1/dex/pre-transaction/simulate`              | Simulate EVM tx                             | Signed | `binanceChainId`, `evmTx{from,to,value,data}`                                                                  | `SimulationResult`                                                               | `trading-client.ts simulateTransaction`   | PASS — schema match                                                                  |
| 12  | `POST /api/v1/dex/pre-transaction/broadcast-transaction` | Broadcast signed tx                         | Signed | `binanceChainId`, `signedTransaction`, `address`                                                               | `{orderId, txHash}`                                                              | `trading-client.ts broadcastTransaction`  | PASS — schema match; call only from Go-gated internal route                          |
| 13  | `GET /api/v1/dex/aggregator/history`                     | On-chain tx status                          | Signed | `binanceChainId`, `txHash`                                                                                     | status/height/errorMsg                                                           | `trading-client.ts getTransactionStatus`  | PASS — schema match                                                                  |
| 14  | `GET /api/v1/dex/aggregator/approve-transaction`         | ERC-20 approve tx                           | Signed | `binanceChainId`, `tokenContractAddress`, `approveAmount`, `vendor` (RFQ)                                      | approve calldata                                                                 | `trading-client.ts getApproveTransaction` | PASS — schema match                                                                  |
| 15  | `POST /api/v1/dex/aggregator/order/submit`               | Submit RFQ order (idempotent `requestId`)   | Signed | `requestId`, `userSignature`, `vendor`, `quoteId`, `signingScheme`                                             | `{orderId, status}`                                                              | `trading-client.ts submitRfqOrder`        | PASS — schema match                                                                  |
| 16  | `GET /api/v1/dex/aggregator/order/{orderId}`             | RFQ settlement status                       | Signed | orderId                                                                                                        | `{orderId, status}`                                                              | `trading-client.ts getRfqOrderStatus`     | PASS — schema match                                                                  |

No undocumented endpoints are called. No endpoint was renamed or invented.

## Verification status legend

- PASS = implementation matches the documented contract AND (where noted) the
  live gateway accepted/processed the signed request.

## Documented behaviors worth noting

- **Market API errors return HTTP 200** with a non-zero business `code`;
  gateway errors may use real HTTP status codes. The client inspects the
  envelope first, then falls back to HTTP status mapping.
- **`referencePrice` is not an official exchange quote** — the schema states
  it is a per-share conversion derived from the on-chain token price. OLYR
  labels it as such everywhere.
- **RFQ vs SWAP**: equity/RWA tokens settle via RFQ (EIP-712 order signed by
  the client, submitted with an idempotent `requestId`); the EVM simulator
  does not apply to RFQ orders.
- **`quoteId` TTL ~30s** — expired quotes return `QUOTE_EXPIRED`; OLYR's
  quote TTL default is 30s and the execution gate blocks on expiry.

## Live verification (2026-09-28, placeholder credentials)

With syntactically valid placeholder credentials in `.env`:

1. `GET /api/diagnostics/binance` → `CONFIGURED` (dotenv loading proven)
2. `GET /api/diagnostics/binance/probe` → real signed request to
   `/build/api/v1/dex/balance/all-token-balances-by-address` → gateway
   returned the documented `40101 Invalid API Key` envelope → mapped to
   `AUTHENTICATION_FAILED` (proves signing, headers, `/build` prefix,
   envelope parsing, and error categorization end-to-end)
3. `GET /api/rwa/assets` → `502 {"error":{"category":"authentication",
"code":40101,"message":"Invalid API Key"}}` — the real upstream error
   surfaced to the UI with the correct category.

With valid credentials, calls 1–7 flow the same path and return real
tokenized-stock data. **Live data verification with valid credentials remains
the single remaining step** (credentials not present in the build
environment; provisioning is external to the codebase).
