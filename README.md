# OLYR

**Autonomous intelligence and controlled execution for tokenized equities on BNB Smart Chain.**

OLYR monitors tokenized stocks (bStocks / Ondo-class assets), detects and explains price
divergences against reference prices, validates every proposed action through a deterministic
Rust risk engine, and — only when every gate passes — prepares bounded execution through the
Binance Web3 stack. Tokenized markets keep operating outside traditional equity hours; OLYR
keeps watching when the bell rings.

> **Status:** hackathon build, Phases 1–8 complete. No transaction has ever been broadcast
> from this codebase; execution requires credentials, a funded wallet, and explicit
> authorization, none of which exist in the repository.

## What OLYR does

1. **Market intelligence** — real Binance Web3 RWA data (prices, market status, liquidity)
   normalized into domain types; deterministic spread and freshness evaluation.
2. **Opportunity engine** — explainable signals (OPPORTUNITY / WATCH / BLOCKED / NO_SIGNAL)
   from configurable thresholds; every signal carries its reasons and warnings.
3. **Strategy agent** — natural-language strategies parsed by an LLM into a strict schema,
   then validated by four deterministic layers. The LLM stops at intent; it never calculates
   risk or touches money.
4. **Risk engine (Rust)** — 10 hard rules (trade size, daily exposure, slippage, asset/action
   allowlists, freshness, liquidity, position limits, price/spread sanity) with per-rule
   explanations. APPROVED / REJECTED / REQUIRES_REVIEW — deterministic, no LLM.
5. **Controlled execution** — quote → transaction construction → simulation → authorization
   policy (MANUAL / BOUNDED_AGENT / DISABLED) → broadcast → on-chain verification. Idempotent,
   expiring, and fail-closed at every step.
6. **Agentic Wallet integration (adapter)** — the Binance Agentic Wallet / Wallet Skills layer
   is isolated behind a provider interface with preflight detection; OLYR never holds wallet
   signing material.

## Architecture

```
Binance Web3 API (RWA · Market · Trading · Transaction · Wallet)
      ↓  @olyr/binance (normalized clients, HMAC-signed)
Market Intelligence (deterministic: state, freshness, spread)  →  Rust Risk Engine
      ↓                                                              ↓
Opportunity Engine ──→ Fastify API ──→ Strategy Registry (Prisma/Postgres)
      ↓                                        ↑
Next.js Terminal (Overview · Markets · Opportunities · Strategies · Agent ·
Portfolio · Proposals · Executions · Wallet · Settings)
```

Full data flow, security boundaries, and phase-by-phase decisions:
[docs/architecture/README.md](docs/architecture/README.md).

## Tech stack

- **Frontend:** Next.js 16, TypeScript, Tailwind CSS 4, TanStack Query
- **API:** Node 24, Fastify, Prisma + PostgreSQL, Redis (optional cache/locks)
- **Agent:** Python 3.12, FastAPI, provider-abstracted LLM (OpenAI-compatible)
- **Execution:** Go (go-ethereum signing; EIP-1559 + EIP-712)
- **Risk engine:** Rust (axum), 10 deterministic rules
- **Blockchain:** BSC mainnet target, viem-compatible contracts deferred until needed

## Local setup

```bash
pnpm install
pnpm build          # all TS packages + apps
docker compose up -d postgres   # or: docker compose up -d for the full stack
cd apps/api && npx prisma migrate deploy
pnpm dev            # web :3000 · api :4000
```

Additional services (each independently bootable):

| Service     | Run                                            | Default |
| ----------- | ---------------------------------------------- | ------- |
| agent       | `cd services/agent && uvicorn app.main:app`    | :8000   |
| risk-engine | `cd services/risk-engine && cargo run`         | :8002   |
| execution   | `cd services/execution && go run ./cmd/server` | :8001   |

## Environment

Copy `.env.example` → `.env` and fill what you need. Highlights:

- `BINANCE_API_KEY` / `BINANCE_API_SECRET` — server-side only; without them OLYR runs in
  dev mode and shows explicit setup states (never fake data).
- `OLYR_LLM_PROVIDER` / `OLYR_LLM_MODEL` / `OLYR_LLM_API_KEY` — strategy parsing.
- `OLYR_MAX_TRADE_USD`, `OLYR_MAX_DAILY_TRADE_USD`, `OLYR_MAX_POSITION_USD`,
  `OLYR_MAX_SLIPPAGE_PERCENT`, `OLYR_REQUIRE_HUMAN_APPROVAL_ABOVE_USD` — hard risk limits.
- `OLYR_EXECUTION_POLICY` — MANUAL (default) / BOUNDED_AGENT / DISABLED.
- `OLYR_EXECUTOR_PRIVATE_KEY` — Go execution service only; never committed, never logged.

Full list with defaults: [.env.example](.env.example).

## Verification

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # TS
cd services/risk-engine && cargo fmt --check && cargo clippy -- -D warnings && cargo test
cd services/agent && ruff check . && ruff format --check . && pytest tests -q
cd services/execution && go vet ./... && go test ./...
```

CI (`.github/workflows/ci.yml`) runs the same gates on every push.

## Security model

- The LLM produces text only — no tools, keys, network, or execution capability.
- Private keys live only in the Go execution service environment; Binance secrets only in the
  Fastify environment; the browser sees neither.
- Every execution passes: risk APPROVED → fresh quote → simulation PASSED → authorization →
  policy gates → broadcast → on-chain verification. Broadcast ≠ confirmed.
- Proposals expire; approvals cannot be reused; executions are idempotent.
- Secrets are never logged or committed (`.env` is gitignored; only `.env.example` ships).

## Deployment

Production build: `pnpm build` produces the Next.js production bundle and compiled services.
Origins are configured via `NEXT_PUBLIC_OLYR_API_URL` (browser) and the service URL variables
(`OLYR_AGENT_URL`, `OLYR_RISK_URL`, `OLYR_EXECUTION_URL`, `OLYR_UPSTREAM_URL`,
`OLYR_INTERNAL_TOKEN` shared secret). Health endpoints: `/health` on every service plus
`/api/system/status` and `/ready` on the API. Deployment is manual — no credentials or
infrastructure are committed.

## Documentation

- [Architecture](docs/architecture/README.md) — boundaries, data flow, security model
- [Developer report](docs/dev-report/README.md) — factual API integration log (submission artifact)
