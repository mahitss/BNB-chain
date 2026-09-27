# Phase 9 Architecture Audit

Verified in-repository on 2026-09-27. Every claim below was checked against
the actual source tree; nothing is assumed.

## Current architecture (verified files)

| Component       | Location                   | Verified behavior                                                                                                                                                                                                                                                                                                                                    |
| --------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web terminal    | `apps/web`                 | Next.js 16; pages: `/` overview, `/markets` + `[ticker]`, `/opportunities` + `[id]`, `/strategies`, `/agent`, `/portfolio`, `/proposals` + `[id]`, `/executions` + `[id]`, `/wallet`, `/settings`. Persistent shell + status bar.                                                                                                                    |
| API             | `apps/api`                 | Fastify 5. Routes: `/health`, `/ready`, `/api/rwa/*`, `/api/market/*`, `/api/opportunities*`, `/api/strategies*`, `/api/proposals*`, `/api/quotes`, `/api/simulations/:id` (501), `/api/executions*`, `/api/wallet*`, `/api/agent/status`, `/api/system/status`, `/api/agent/events`, `/api/portfolio*`, internal `/api/internal/*` (token-guarded). |
| Agent           | `services/agent`           | FastAPI; `/health`, `/readiness`, `/agent/ready`, `/agent/parse`, `/agent/tools/*`. LLM providers: fake (tests) + openai-compatible. Validation pipeline: schema → semantic → capability → safety.                                                                                                                                                   |
| Risk engine     | `services/risk-engine`     | Rust/axum; `/health`, `/readiness`, `/evaluate`. 10 rules in `src/rules.rs`, engine aggregation in `src/engine.rs`.                                                                                                                                                                                                                                  |
| Execution       | `services/execution`       | Go; `/health`, `/readiness`, `POST /execute`, `GET /executions/{id}`. go-ethereum signing (EIP-1559 + EIP-712). Kill switch + chain guard (Phase 9).                                                                                                                                                                                                 |
| Shared packages | `packages/*`               | `@olyr/types`, `@olyr/config`, `@olyr/binance` (RWA + Trading clients).                                                                                                                                                                                                                                                                              |
| Database        | `apps/api/prisma`          | Prisma 6 + PostgreSQL. Models: Strategy, AgentEvent, TradeProposal, RiskEvaluation, RiskRuleResult, TradeQuote, Simulation, ExecutionAuthorization, Execution, AgentWallet, ExecutionPolicy(+Version), AgentCapability. 5 migrations applied.                                                                                                        |
| CI              | `.github/workflows/ci.yml` | TS (format/lint/build/typecheck/test), Python (ruff+pytest), Go (fmt/vet/test), Rust (fmt/clippy/test), security audit job.                                                                                                                                                                                                                          |

## Service dependencies (verified)

- API → PostgreSQL (Prisma, required for registry/proposals/executions), Redis (optional cache/locks), risk engine (HTTP `/evaluate`), agent (HTTP `/agent/parse`), Binance Web3 gateway (HTTP, HMAC-signed), execution service (HTTP hand-off).
- Agent → API (HTTP read-only/controlled tools), LLM provider (OpenAI-compatible endpoint).
- Execution → API (internal token-guarded bundle/broadcast/status), BSC RPC (nonce), go-ethereum (signing).
- Risk engine → nothing. Pure deterministic evaluation.
- Web → API only.

## Execution flow (verified in code)

Strategy (registry, ACTIVE) → proposal (dedup + cooldown) → risk `/evaluate` (APPROVED required) → quote (≤30s TTL) → `/aggregator/swap` → simulation (SWAP: `/pre-transaction/simulate`; RFQ: vendor-validated) → authorization (policy MANUAL/BOUNDED_AGENT/DISABLED) → Go `POST /execute` → gate re-verification → signing → internal broadcast/RFQ submit → `/aggregator/history` tracking → CONFIRMED only after on-chain success.

## Security boundaries (verified)

1. LLM produces text only; validators are authoritative (Phase 4 pipeline + Phase 9 adversarial tests).
2. Browser talks only to Fastify; Rust/Go/Binance are never browser-reachable.
3. Private keys only in Go env; Binance secrets only in Fastify env.
4. Kill switch (`OLYR_KILL_SWITCH`) blocks new executions at API and Go service.
5. Chain guard (`EXPECTED_CHAIN_ID`) fails closed on mismatch.
6. Internal API guarded by `OLYR_INTERNAL_TOKEN`.
7. Simulation required before broadcast (SWAP mode); RFQ vendor-validated.
8. Idempotency: one execution per proposal (DB unique + Go map).

## Environment variables (verified against .env.example)

Core: `OLYR_ENV`, `PORT`, `API_PORT`, `AGENT_PORT`, `EXECUTION_PORT`, `RISK_ENGINE_PORT`.
Data: `DATABASE_URL`, `POSTGRES_*`, `REDIS_URL`.
Binance: `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `BINANCE_BASE_URL`, `BINANCE_TIMEOUT_MS`, `BINANCE_MAX_RETRIES`, `BINANCE_BACKOFF_*`, `BINANCE_CHAIN_ID`.
LLM: `OLYR_LLM_PROVIDER`, `OLYR_LLM_MODEL`, `OLYR_LLM_API_KEY`, `OLYR_LLM_BASE_URL`, `OLYR_LLM_TIMEOUT_SECONDS`.
Strategy: `OLYR_MAX_STRATEGY_TRADE_USD`, `OLYR_MAX_STRATEGY_DAILY_USD`, `OLYR_MAX_SPREAD_THRESHOLD`, `OLYR_ALLOWED_ACTIONS`, `OLYR_ALLOWED_ASSETS`, `OLYR_DEFAULT_OWNER`, `OLYR_AGENT_URL`.
Risk/execution: `OLYR_MAX_TRADE_USD`, `OLYR_MAX_DAILY_TRADE_USD`, `OLYR_MAX_POSITION_USD`, `OLYR_MAX_SLIPPAGE_PERCENT`, `OLYR_MAX_REFERENCE_AGE_SECONDS`, `OLYR_REQUIRE_LIQUIDITY_DATA`, `OLYR_PROPOSAL_TTL_SECONDS`, `OLYR_RISK_URL`, `OLYR_EXECUTION_URL`.
Agent loop: `OLYR_STRATEGY_LOOP_SECONDS`, `OLYR_STRATEGY_COOLDOWN_SECONDS`, `OLYR_REQUIRE_HUMAN_APPROVAL_ABOVE_USD`, `OLYR_WALLET_CLI`.
Phase 9: `OLYR_KILL_SWITCH`, `EXPECTED_CHAIN_ID`, `EXPECTED_NETWORK`, `OLYR_INTERNAL_TOKEN`, `OLYR_EXECUTOR_PRIVATE_KEY`, `OLYR_EXECUTOR_ADDRESS`, `OLYR_EXECUTOR_RPC_URL`, `OLYR_UPSTREAM_URL`, `OLYR_QUOTE_TTL_SECONDS`, `OLYR_EXECUTION_POLICY`.

## Database dependencies

PostgreSQL 16 required for registry/proposals/executions. Migrations are
sequential and deterministic. Indexes exist on ownerId/createdAt,
strategyId/createdAt, proposalId/createdAt columns. Execution uniqueness is
enforced by the unique `idempotencyKey`. Audit tables (AgentEvent,
RiskEvaluation, RiskRuleResult) are append-only by convention — no update or
delete code paths exist.

## Deployment dependencies

Docker Compose for local (postgres, redis + 5 services). Node 24, Python 3.12
(venv), Go ≥1.23, Rust stable. No external managed services required. Frontend
needs `NEXT_PUBLIC_OLYR_API_URL` at build time.

## Known technical debt

1. In-memory scan store (Phase 3) — scanner results are not persisted; restart loses the last scan. Prisma-backed proposal/evaluation persistence covers the execution path.
2. Agent-loop deduplication is process-local (Map), not Redis-shared.
3. Portfolio endpoints return honest 503 until the Agentic Wallet is provisioned.
4. `getBalances`/`getPositions` on the baw adapter throw NOT_CONFIGURED — the documented `baw` CLI command surface (SKILL.md) was unreachable during this build.
5. No WebSocket/SSE — controlled polling only.
6. Simulation id (`sim_<timestamp>`) is not a durable Binance-side reference; the Transaction API returns no simulation id.
7. RFQ signature scheme assumes EIP-712 with 27/28 v; other schemes would need testing with live vendors.

## Known blockers

- Live Binance credentials absent → quote/simulation/broadcast unverified against the real gateway.
- Agentic Wallet requires a Binance App account + QR sign-in — not possible in this environment.
- Mainnet micro-trade requires funded dedicated wallet + explicit human authorization (runbook written, not executed).
