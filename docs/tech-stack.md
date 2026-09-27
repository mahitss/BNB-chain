# OLYR Tech Stack

Only technologies actually used in the repository (verified in package files
and source).

## Frontend (`apps/web`)

| Technology          | Use                                                      |
| ------------------- | -------------------------------------------------------- |
| Next.js 16          | App Router, server/client components, static generation  |
| TypeScript (strict) | All application code                                     |
| Tailwind CSS 4      | Design system (custom primitives in `components/ui.tsx`) |
| TanStack Query 5    | Data fetching, polling, cache invalidation               |
| node:test + tsx     | Frontend logic tests                                     |

Not used: component libraries (hand-rolled primitives), charting libraries
(history unavailable — charts are not fabricated).

## API (`apps/api`)

| Technology               | Use                                                                    |
| ------------------------ | ---------------------------------------------------------------------- |
| Node.js 24 + Fastify 5   | HTTP API, plugins: @fastify/cors, @fastify/helmet, @fastify/rate-limit |
| Prisma 6 + PostgreSQL 16 | Strategy registry, proposals, executions, audit events                 |
| @olyr/binance            | Binance Web3 RWA/Trading/Transaction/Wallet clients (HMAC-signed)      |
| ioredis (optional)       | Shared cache + distributed lock when `REDIS_URL` is set                |
| node:test + tsx          | 99 tests                                                               |

## Agent (`services/agent`)

| Technology            | Use                                                     |
| --------------------- | ------------------------------------------------------- |
| Python 3.12 + FastAPI | `/agent/parse`, read-only + controlled tools            |
| Pydantic 2            | Strict strategy schema (`extra="forbid"`)               |
| httpx                 | LLM provider calls (OpenAI-compatible) + OLYR API tools |
| FakeLLMProvider       | Deterministic tests-only provider                       |
| pytest + ruff         | 45 tests, lint/format                                   |

## Risk engine (`services/risk-engine`)

| Technology                        | Use                                     |
| --------------------------------- | --------------------------------------- |
| Rust (axum, tokio, serde, chrono) | `/evaluate` with 10 deterministic rules |
| BigInt-scaled decimals (TS side)  | Cross-checked spread arithmetic         |
| cargo test                        | 19 tests incl. invariants               |

## Execution (`services/execution`)

| Technology           | Use                                                 |
| -------------------- | --------------------------------------------------- |
| Go 1.23+, net/http   | `/execute`, state machine, idempotency              |
| go-ethereum v1.16    | EIP-1559/legacy signing, EIP-712 typed-data signing |
| ethclient (JSON-RPC) | Nonce fetch from configured BSC endpoint            |
| go test              | State machine, gates, signing round-trips           |

## Blockchain

- **BNB Smart Chain (mainnet, chain 56)** — settlement target; chain-guarded
- Tokenized equities via Binance Web3 aggregator (RFQ for equity tokens)
- No custom contracts deployed by OLYR in this build

## Database

- PostgreSQL 16 (Prisma migrations, 6 applied)
- Models: Strategy, AgentEvent, TradeProposal, RiskEvaluation, RiskRuleResult,
  TradeQuote, Simulation, ExecutionAuthorization, Execution, AgentWallet,
  ExecutionPolicy(+Version), AgentCapability

## Infrastructure

- Docker Compose (postgres, redis + 5 services with health-aware Dockerfiles)
- GitHub Actions CI (TS/Python/Go/Rust gates + security audit job)
- No cloud deployment committed; manual procedure in docs/deployment.md
