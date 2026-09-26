# OLYR Architecture

OLYR is an autonomous tokenized-equity intelligence and execution platform on
BNB Smart Chain. It monitors tokenized stocks (bStocks / Ondo / xStocks class
assets), compares on-chain prices against reference market prices, understands
traditional market-hours state, detects actionable spreads, validates risk
deterministically, and executes bounded spot trades through Binance Web3
infrastructure — always simulating before broadcasting.

**Phase status:** this document describes the target architecture. Phase 1
delivers the repository foundation only: all services boot and expose
`GET /health`, with no market data, trading, AI, wallet, or contract activity
yet. Sections below mark what exists today versus what is planned.

## Service responsibilities

| Service                | Language / stack    | Responsibility                                                                              | Phase 1 state              |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------- | -------------------------- |
| `apps/web`             | TypeScript, Next.js | Operator dashboard: spreads, market-hours state, risk decisions, execution log              | Boots; static landing page |
| `apps/api`             | TypeScript, Fastify | Public gateway and orchestrator; persists observations and decisions; serves web            | Boots; `GET /health`       |
| `services/agent`       | Python, FastAPI     | LLM-driven analysis with structured tool calling; provider abstracted behind an interface   | Boots; `GET /health`       |
| `services/execution`   | Go                  | Sole component that signs and broadcasts transactions; enforces simulation-before-broadcast | Boots; `GET /health`       |
| `services/risk-engine` | Rust, axum          | Deterministic, LLM-independent validation of every proposed action                          | Boots; `GET /health`       |
| `packages/types`       | TypeScript          | Shared cross-service contracts (`HealthCheck`, price/spread types)                          | Exists                     |
| `packages/config`      | TypeScript          | Environment-driven configuration helpers                                                    | Exists                     |
| `packages/binance`     | TypeScript          | Binance Web3 integration seam — interfaces only until the integration phase                 | Interfaces only            |
| `contracts/`           | Solidity, Foundry   | On-chain components, only when genuinely required                                           | Placeholder                |

## Communication boundaries

- **web → api**: the frontend talks only to the API service over HTTP/JSON.
  It never calls the agent, risk engine, execution service, or Binance
  directly.
- **api → everything else**: internal services (agent, risk-engine,
  execution) are not exposed publicly; the api is the single entry point that
  orchestrates them.
- **agent → risk-engine → execution**: the action pipeline. The agent proposes;
  the risk engine approves, resizes, or rejects deterministically; execution
  only acts on risk-approved intents.
- **agent → @olyr/binance (future)**: read-only market data access via the
  abstracted client. The agent never holds credentials capable of moving
  funds.
- **execution ↔ BNB Smart Chain**: the only component with wallet access.

### Data flow (target)

```
                       ┌──────────────────────┐
                       │   web (Next.js)      │ :3000
                       └──────────┬───────────┘
                                  │ HTTP/JSON
                       ┌──────────▼───────────┐
                       │   api (Fastify)      │ :4000
                       └───┬──────────┬───────┘
                           │          │
                reads/writes│          │ orchestrates
                           │          │
              ┌────────────▼───┐   ┌──▼──────────────────┐
              │ PostgreSQL     │   │ agent (FastAPI)     │ :8000
              │ Redis          │   │ LLM behind iface    │
              └────────────────┘   └──┬───────────────┬──┘
                                      │ reads         │ proposes
                          ┌───────────▼────────┐      │
                          │ @olyr/binance      │      │
                          │ (Binance Web3 API) │      │
                          └────────────────────┘      │
                                                 ┌────▼─────────────────┐
                                                 │ risk-engine (Rust)   │ :8002
                                                 │ deterministic gate   │
                                                 └────┬─────────────────┘
                                                      │ approved intents only
                                                 ┌────▼─────────────────┐
                                                 │ execution (Go)       │ :8001
                                                 │ simulate → broadcast │
                                                 └────┬─────────────────┘
                                                      │
                                                 BNB Smart Chain
```

Phase 1 reality: no arrows are live yet. Each service is an isolated,
bootable process with a health endpoint.

## Agent → risk → execution flow (future)

1. **Observe** — scheduled/triggered collection of on-chain tokenized-stock
   prices (BSC) and reference prices (via `@olyr/binance`), plus traditional
   market-hours state.
2. **Analyze** — the agent evaluates spreads and market context using
   structured tool calling. Its LLM provider is hidden behind an interface so
   no vendor SDK leaks into business logic.
3. **Propose** — the agent emits a structured execution intent (asset, side,
   size bound, validity window). Proposals are data, never commands.
4. **Validate** — the risk engine re-checks every intent deterministically:
   position limits, spread sanity, market-hours rules, circuit breakers. It is
   independent from the LLM and can veto anything.
5. **Execute** — the execution service receives only risk-approved intents,
   simulates the transaction first, and broadcasts only if the simulation
   succeeds within the approved bounds. Results and transaction hashes are
   reported back through the api and persisted.

## Security boundaries

- **The AI never touches keys.** The agent runs read-only tools and can only
  produce proposals. It has no access to wallets, private keys, or signing.
- **Deterministic risk gate.** Every intent must pass the Rust risk engine —
  a non-LLM, testable, deterministic component — before execution.
- **Single signer.** Only the Go execution service holds transaction
  capability, and every real transaction must pass simulation before
  broadcast. Failed or reverted simulations are never retried blindly.
- **No fabricated results.** Nothing in the system reports a blockchain
  interaction as successful unless a real, verifiable transaction occurred.
- **Secrets via environment only.** All configuration comes from environment
  variables (`.env` locally, never committed; see `.env.example`). No keys —
  API, LLM, or wallet — are ever hardcoded or committed.
- **Internal services stay internal.** In deployment, agent / risk-engine /
  execution are not publicly reachable; the api is the only public surface.
- **Containers run non-root.** All service images drop to an unprivileged
  user.

## Future Binance integration point

All Binance Web3 access will be funneled through `packages/binance`
(`@olyr/binance`). Phase 1 ships the seam only: `BinanceMarketDataSource` for
read-only market data and supporting types. When the integration phase
arrives, a concrete client is implemented behind that interface and injected
where needed, so callers stay decoupled from Binance specifics (endpoints,
auth, rate limits) and the integration can be tested against fakes in CI.

## Data stores (future)

- **PostgreSQL (Prisma)** — observations, spreads, decisions, intents,
  execution records and their transaction hashes.
- **Redis** — hot caches (recent quotes, market-hours state) and coordination
  locks.

Both appear in `docker-compose.yml` today so the local stack matches the
target topology, but nothing connects to them yet.
