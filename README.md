# OLYR

Autonomous tokenized-equity intelligence and execution on **BNB Smart Chain**.

OLYR monitors tokenized stocks (bStocks / Ondo / xStocks class assets),
compares their on-chain prices against reference market prices, understands
traditional market-hours state, detects actionable spreads, validates risk
deterministically, and executes bounded spot trades through Binance Web3
infrastructure — simulating every transaction before broadcast.

> **Status: Phase 1 — repository foundation.**
> All services boot and expose `GET /health`. There is no market data, no
> trading, no AI reasoning, no wallet activity, and no Binance connectivity
> yet. Architecture and phasing: [docs/architecture](docs/architecture/README.md).

## Repository layout

```
olyr/
├── apps/
│   ├── web/            Next.js dashboard (TypeScript, Tailwind CSS)
│   └── api/            Fastify API gateway (TypeScript)
├── services/
│   ├── agent/          LLM market intelligence (Python, FastAPI)
│   ├── execution/      Bounded on-chain execution (Go)
│   └── risk-engine/    Deterministic risk validation (Rust, axum)
├── packages/
│   ├── types/          @olyr/types — shared cross-service contracts
│   ├── config/         @olyr/config — env-driven configuration
│   └── binance/        @olyr/binance — Binance Web3 seam (interfaces only)
├── contracts/          Solidity (empty until the phase that needs it)
├── docs/
│   ├── architecture/   Service boundaries, data flow, security model
│   └── dev-report/     Factual API/tooling log (part of the submission)
├── scripts/            check-all.sh — runs every verification
└── docker-compose.yml  Local development stack
```

## Prerequisites

| Tool                    | Version     | Needed for         |
| ----------------------- | ----------- | ------------------ |
| Node.js + pnpm          | ≥ 24 / 11.x | web, api, packages |
| Python                  | ≥ 3.12      | agent              |
| Go                      | ≥ 1.23      | execution          |
| Rust (rustup)           | stable      | risk-engine        |
| Docker + Docker Compose | any recent  | full local stack   |

## Quick start (TypeScript services)

```bash
pnpm install     # workspace install (also creates the lockfile)
pnpm build       # builds packages, then api and web (topological order)
pnpm dev         # web on :3000 and api on :4000, in parallel with watch mode
```

> `pnpm build` must run once before `pnpm dev` — the apps consume the
> workspace packages from their compiled `dist/` output.

## Running individual services

Each service is independently bootable. All read their configuration from
environment variables (defaults shown; see `.env.example` for the full list).

| Service     | Command                                                                                                                                                                          | Address               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| web         | `pnpm --filter @olyr/web dev` (after `pnpm build`)                                                                                                                               | http://localhost:3000 |
| api         | `pnpm --filter @olyr/api dev` (after `pnpm build`)                                                                                                                               | http://localhost:4000 |
| agent       | `cd services/agent && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python -m app.main` _(Windows; on Linux/macOS use `.venv/bin/...`)_ | http://localhost:8000 |
| execution   | `cd services/execution && go run ./cmd/server`                                                                                                                                   | http://localhost:8001 |
| risk-engine | `cd services/risk-engine && cargo run`                                                                                                                                           | http://localhost:8002 |

Health endpoints (same JSON shape everywhere):

```bash
curl http://localhost:4000/health   # {"service":"api","status":"ok",...}
curl http://localhost:8000/health
curl http://localhost:8001/health
curl http://localhost:8002/health
```

## Full local stack via Docker

```bash
docker compose up --build
```

Starts web (:3000), api (:4000), agent (:8000), execution (:8001),
risk-engine (:8002), plus PostgreSQL (:5432) and Redis (:6379) reserved for
the persistence phase. Copy `.env.example` to `.env` first if you want to
override defaults.

## Environment variables

Copy the template and edit as needed — **never commit `.env` or real keys**:

```bash
cp .env.example .env
```

| Variable                                    | Default            | Used by                  |
| ------------------------------------------- | ------------------ | ------------------------ |
| `OLYR_ENV`                                  | `development`      | all services             |
| `PORT`                                      | `3000`             | web (Next.js convention) |
| `API_PORT`                                  | `4000`             | api                      |
| `AGENT_PORT`                                | `8000`             | agent                    |
| `EXECUTION_PORT`                            | `8001`             | execution                |
| `RISK_ENGINE_PORT`                          | `8002`             | risk-engine              |
| `DATABASE_URL` / `POSTGRES_*` / `REDIS_URL` | see `.env.example` | future persistence phase |
| `BINANCE_API_KEY` / `BINANCE_API_SECRET`    | empty              | future Binance phase     |
| `OLYR_LLM_PROVIDER` / `OLYR_LLM_API_KEY`    | empty              | future agent phase       |
| `OLYR_EXECUTOR_PRIVATE_KEY` / `BSC_RPC_URL` | empty / public RPC | future execution phase   |

## Verification

Root scripts (TypeScript workspace):

```bash
pnpm check        # format:check + lint + build + typecheck
pnpm lint         # ESLint (flat config, typescript-eslint)
pnpm format       # Prettier write (check with: pnpm format:check)
```

Everything, all languages (requires each toolchain on PATH; run from Git Bash
on Windows):

```bash
scripts/check-all.sh
```

Per-language checks:

```bash
# Python agent
cd services/agent && ruff check . && ruff format --check .

# Go execution
cd services/execution && gofmt -l . && go vet ./... && go build ./...

# Rust risk-engine
cd services/risk-engine && cargo fmt --check && cargo clippy -- -D warnings && cargo build
```

CI runs the same checks on every push/PR (`.github/workflows/ci.yml`).

## Security notes

- Configuration comes exclusively from environment variables; secrets are
  never hardcoded, defaulted, or committed (`.env` is gitignored).
- The AI layer will never hold keys or execute transactions; only the
  execution service signs, and only risk-approved, simulated-first intents.
- See [docs/architecture](docs/architecture/README.md) for the full security
  model and the agent → risk → execution flow.
