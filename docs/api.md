# OLYR API Reference

All endpoints verified in source. Base URL: the Fastify API (default
`http://localhost:4000`). Errors return a structured body:
`{"error": {"category", "message", "code?", "errors?"}}`.

## Health & system

| Method | Path                       | Purpose                                                          | Auth |
| ------ | -------------------------- | ---------------------------------------------------------------- | ---- |
| GET    | `/health`                  | Process alive; returns service/version/timestamp                 | none |
| GET    | `/ready`                   | Configuration readiness; `?probe=1` performs a live Binance call | none |
| GET    | `/api/system/status`       | Aggregated health: DB, risk, agent, execution, Binance, wallet   | none |
| GET    | `/api/agent/events?limit=` | Persisted audit events (newest first)                            | none |

## RWA data (requires Binance credentials; 503 otherwise)

| Method | Path                                             | Purpose                                             | Errors                           |
| ------ | ------------------------------------------------ | --------------------------------------------------- | -------------------------------- |
| GET    | `/api/rwa/assets?chainId&platformId`             | Tokenized assets with prices, spread, market status | 503 not-configured; 502 upstream |
| GET    | `/api/rwa/assets/:ticker`                        | Search matches for a ticker                         | 400 invalid ticker; 404          |
| GET    | `/api/rwa/assets/:ticker/market?chainId&address` | Proposal-style market record                        | 404                              |
| GET    | `/api/rwa/assets/:ticker/price?chainId&address`  | On-chain + reference quote + spread                 | 404                              |
| GET    | `/api/rwa/platforms`                             | Issuance platforms (ondo, bstock)                   | 503                              |

## Market intelligence

| Method | Path                           | Purpose                                                                               | Errors          |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------- | --------------- |
| GET    | `/api/market/state`            | Global banner: US equities (calendar) + on-chain observability                        | 503             |
| GET    | `/api/market/:ticker/snapshot` | Full snapshot: prices, ages, freshness, divergence, liquidity, market state, warnings | 400/404/502/503 |
| GET    | `/api/market/:ticker/state`    | Market state + source (binance vs derived-calendar)                                   | 404/503         |

## Opportunities

| Method | Path                         | Purpose                                           | Errors  |
| ------ | ---------------------------- | ------------------------------------------------- | ------- |
| GET    | `/api/opportunities`         | Latest scanner results + lastScanAt               | 503     |
| GET    | `/api/opportunities/id/:id`  | One opportunity by deterministic id               | 404/503 |
| GET    | `/api/opportunities/:ticker` | On-demand evaluation for a ticker (scanner-first) | 404/503 |

## Strategies

| Method | Path                           | Purpose                                                                               | Errors                     |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------- | -------------------------- |
| POST   | `/api/strategies/parse`        | Natural language → PARSED / NEEDS_CLARIFICATION / REJECTED (+ events). Body: `{text}` | 503 (LLM/DB unconfigured)  |
| POST   | `/api/strategies`              | Validate + persist (DRAFT). Body: `{strategy}`                                        | 422 validation-failed; 503 |
| GET    | `/api/strategies`              | List owner strategies                                                                 | 503                        |
| GET    | `/api/strategies/:id`          | Fetch one                                                                             | 404                        |
| PATCH  | `/api/strategies/:id`          | Update name or status                                                                 | 400/404/422                |
| POST   | `/api/strategies/:id/activate` | DRAFT/PAUSED → ACTIVE                                                                 | 404/422                    |
| POST   | `/api/strategies/:id/pause`    | ACTIVE → PAUSED                                                                       | 404/422                    |
| GET    | `/api/strategies/:id/events`   | Persisted events for the strategy                                                     | 503                        |

## Proposals (Phase 5)

| Method | Path                               | Purpose                                                                  | Errors      |
| ------ | ---------------------------------- | ------------------------------------------------------------------------ | ----------- |
| POST   | `/api/proposals`                   | Create PENDING_RISK proposal from a saved strategy. Body: `{strategyId}` | 400/404/503 |
| GET    | `/api/proposals`                   | List                                                                     | 503         |
| GET    | `/api/proposals/:id`               | Proposal + evaluations (history immutable)                               | 404/503     |
| POST   | `/api/proposals/:id/evaluate-risk` | Rust engine on stored inputs; persists RiskEvaluation                    | 404/502/503 |
| POST   | `/api/proposals/:id/re-evaluate`   | Fresh market data → NEW evaluation                                       | 404/502/503 |

## Quotes / simulation / authorization (Phase 6)

| Method | Path                           | Purpose                                                                                                                                        | Errors          |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| POST   | `/api/quotes`                  | Binance quote for an APPROVED proposal. Body: `{proposalId, fromTokenAddress, toTokenAddress, amount}` (amount = smallest-unit integer string) | 400/409/502     |
| POST   | `/api/proposals/:id/simulate`  | Build swap from the stored quote, simulate (SWAP) or mark RFQ                                                                                  | 404/409/502/503 |
| GET    | `/api/simulations/:id`         | Explicitly 501 — simulations surface via proposals                                                                                             | 501             |
| POST   | `/api/proposals/:id/authorize` | Record MANUAL/BOUNDED authorization decision. Body: `{decision: APPROVE\|REJECT}`                                                              | 403/404/409     |

## Executions (Phase 6)

| Method | Path                         | Purpose                                                                  | Errors                         |
| ------ | ---------------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| POST   | `/api/executions`            | Idempotent execution creation after ALL gates pass. Body: `{proposalId}` | 400/403 (policy/gates)/404/503 |
| GET    | `/api/executions`            | List                                                                     | 503                            |
| GET    | `/api/executions/:id`        | One execution + evaluations                                              | 404/503                        |
| POST   | `/api/executions/:id/cancel` | CANCELLED if the state machine allows                                    | 404/409/503                    |

## Wallet / portfolio / agent (Phase 7)

| Method | Path                                       | Purpose                                                 | Errors                 |
| ------ | ------------------------------------------ | ------------------------------------------------------- | ---------------------- |
| GET    | `/api/wallet`                              | Identity, policy, limits, capabilities, skill allowlist | — (works unconfigured) |
| GET    | `/api/wallet/capabilities`                 | Capability registry snapshot                            | —                      |
| GET    | `/api/wallet/balances`                     | Balances via wallet provider                            | 503 not-configured     |
| GET    | `/api/portfolio`, `/api/portfolio/:ticker` | Honest 503 until wallet provisioning                    | 503                    |
| GET    | `/api/agent/status`                        | Loop state, active strategies, last scan, opportunities | 503                    |

## Internal (Go execution service only)

| Method | Path                                          | Purpose                                       | Auth                  |
| ------ | --------------------------------------------- | --------------------------------------------- | --------------------- |
| GET    | `/api/internal/execution-bundle/:executionId` | Full chain-of-custody bundle                  | x-olyr-internal-token |
| POST   | `/api/internal/broadcast`                     | Broadcast a SIGNED transaction                | token                 |
| POST   | `/api/internal/rfq/submit`                    | Submit signed RFQ order                       | token                 |
| GET    | `/api/internal/tx-status/:txHash`             | On-chain status                               | token                 |
| GET    | `/api/internal/rfq/order/:orderId`            | RFQ order status                              | token                 |
| POST   | `/api/internal/execution-state`               | Persist Go-side state transitions (validated) | token                 |

## Other services

- **Agent (:8000):** `GET /health`, `GET /readiness`, `GET /agent/ready`,
  `POST /agent/parse`, `GET|POST /agent/tools/{name}` (read-only +
  controlled: create_trade_proposal, request_simulation, request_execution).
- **Risk engine (:8002):** `GET /health`, `GET /readiness`, `POST /evaluate`.
- **Execution (:8001):** `GET /health`, `GET /readiness`, `POST /execute`,
  `GET /executions/{id}`.
