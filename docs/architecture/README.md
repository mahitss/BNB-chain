# OLYR Architecture

OLYR is an autonomous tokenized-equity intelligence and execution platform on
BNB Smart Chain. It monitors tokenized stocks (bStocks / Ondo / xStocks class
assets), compares on-chain prices against reference market prices, understands
traditional market-hours state, detects actionable spreads, validates risk
deterministically, and executes bounded spot trades through Binance Web3
infrastructure — always simulating before broadcasting.

**Phase status:** this document describes the target architecture. Phase 2
delivers the Binance Web3 RWA data integration (read-only market data): the
api serves real tokenized-stock data to the web dashboard through
`@olyr/binance`. There is still no trading, AI, wallet, or contract activity.
Sections below mark what exists today versus what is planned.

## Phase 2 data flow — Binance RWA integration (implemented)

```
Binance Web3 Market API  (web3.binance.com/build, HMAC-signed requests)
    ↓
RWA Client   HttpBinanceRwaClient (@olyr/binance) — signing, timeout, retry,
    ↓         typed errors, structured logging; BinanceRwaClient interface
Normalizer   raw payloads → normalized shapes (@olyr/binance/normalize)
    ↓
Domain types @olyr/types — TokenizedAsset, RwaPriceQuote, RwaMarketStatusInfo,
    ↓         Spread (deterministic calculateSpread), RwaMarketSnapshot
Fastify API  apps/api — RwaService (caching, snapshot assembly) +
    ↓         GET /api/rwa/* routes, GET /ready
Next.js      apps/web — /rwa dashboard page (TanStack Query),
             calls ONLY the Fastify API
```

### Security boundary for Binance credentials

- `BINANCE_API_KEY` / `BINANCE_API_SECRET` are read **only** inside the api
  service process (via `@olyr/config`). They are never sent to the browser:
  the web app imports no Binance code, and `@olyr/binance` is never part of
  the Next.js client bundle — the browser talks exclusively to OLYR's API.
- The Next.js app reaches Binance data only through
  `fetch(NEXT_PUBLIC_OLYR_API_URL)/api/rwa/*`, which returns normalized
  domain types. Raw Binance responses never cross the api boundary
  (normalization happens inside `@olyr/binance`).
- Secrets are never logged: the client logs operation, path, HTTP status,
  latency, and error category only; header values are redacted by
  `redactCredentials`. Credentials are never hardcoded or defaulted — without
  them the API starts in dev mode and RWA endpoints return a structured 503
  with setup instructions (no fake data anywhere).

## Service responsibilities

| Service                | Language / stack    | Responsibility                                                                              | Phase 1 state              |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------- | -------------------------- |
| `apps/web`             | TypeScript, Next.js | Operator dashboard: spreads, market-hours state, risk decisions, execution log              | Boots; static landing page |
| `apps/api`             | TypeScript, Fastify | Public gateway and orchestrator; persists observations and decisions; serves web            | Boots; `GET /health`       |
| `services/agent`       | Python, FastAPI     | LLM-driven analysis with structured tool calling; provider abstracted behind an interface   | Boots; `GET /health`       |
| `services/execution`   | Go                  | Sole component that signs and broadcasts transactions; enforces simulation-before-broadcast | Boots; `GET /health`       |
| `services/risk-engine` | Rust, axum          | Deterministic, LLM-independent validation of every proposed action                          | Boots; `GET /health`       |
| `packages/types`       | TypeScript          | Shared cross-service contracts (HealthCheck, RWA domain types, spread calc)                 | Exists                     |
| `packages/config`      | TypeScript          | Environment-driven configuration helpers + Binance config validation                        | Exists                     |
| `packages/binance`     | TypeScript          | Binance Web3 RWA client (read-only market data): `BinanceRwaClient`                         | Implemented (read-only)    |
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

## Market Intelligence (Phase 3, deterministic)

Phase 3 turns the Phase 2 data feed into a deterministic market-intelligence
layer — no LLM participates in any numeric or risk decision:

```
Binance RWA Data + Binance Market Data (top-liquidity)
      ↓
Market Intelligence modules (apps/api/src/intelligence/*)
  · us-equity-calendar.ts — the ONLY wall-clock logic: documented NYSE rules
    (09:30–16:00 America/New_York, Mon–Fri, published holiday list 2025–2027)
  · market-state.ts — Binance statusInfo is the PRIMARY source (OPEN /
    PRE_MARKET / AFTER_HOURS / CLOSED); the calendar only refines
    closed → WEEKEND vs HOLIDAY and fills gaps (UNKNOWN)
  · freshness.ts — FRESH / AGING / STALE / UNKNOWN from configurable
    thresholds; missing timestamps are UNKNOWN, never invented
  · spread (in @olyr/types) — scaled-BigInt decimal arithmetic, exact
    absolute spread, percent rounded half-away-from-zero; NaN/∞ impossible
  · opportunity.ts — deterministic decision table (NO_SIGNAL / WATCH /
    OPPORTUNITY / BLOCKED / DATA_UNAVAILABLE) with per-signal reasons,
    warnings, and a documented confidence rule
      ↓
OpportunityScanner (bounded interval, local + Redis-NX overlap lock,
graceful shutdown, capped universe size) → InMemoryScanStore
(Prisma persistence arrives with the database phase)
      ↓
API /api/market/*, /api/opportunities/* → OLYR Terminal (/markets)
```

Read-only: this layer produces information only — no signing, no swaps, no
broadcasts, no wallet access.

## Binance integration point (Phase 2, read-only)

All Binance Web3 access is funneled through `packages/binance`
(`@olyr/binance`). Consumers depend on the `BinanceRwaClient` interface and
receive normalized `@olyr/types` domain objects — never raw Binance HTTP
responses. The implemented RWA methods (all documented, read-only):

| Method                    | Binance endpoint (GET)                      | Notes                             |
| ------------------------- | ------------------------------------------- | --------------------------------- |
| `listPlatforms`           | `/api/v1/dex/market/rwa/platforms`          | issuance platforms (ondo, bstock) |
| `listTokens`              | `/api/v1/dex/market/rwa/tokens`             | assets + embedded prices + status |
| `getTokenPrices`          | `/api/v1/dex/market/rwa/price`              | batch ≤100 contract addresses     |
| `searchTokens`            | `/api/v1/dex/market/rwa/search`             | keyword / contract address        |
| `getUnderlyingProfile`    | `/api/v1/dex/market/rwa/underlying-profile` | company info                      |
| `getUnderlyingMarketData` | `/api/v1/dex/market/rwa/underlying-market`  | underlying stats + status         |

Authentication follows the official docs: `X-OC-APIKEY`, `X-OC-TIMESTAMP`
(ISO 8601 ms), `X-OC-SIGN` = Base64(HMAC-SHA256 over
`timestamp + METHOD + requestPath + body`), with the signed `requestPath`
including the `/build` prefix. Requests carry a bounded timeout and retry
only transient failures (429 / 5xx / network) with capped exponential
backoff. Market API errors arrive as HTTP 200 with a non-zero business
`code`; these map to typed errors (auth / invalid-request / rate-limit /
region / unsupported-chain / server / malformed).

API routes serving this data (all cache-backed with configurable TTLs):

| Route                                              | Purpose                                     |
| -------------------------------------------------- | ------------------------------------------- |
| `GET /api/rwa/assets`                              | tokenized assets + prices + spread + status |
| `GET /api/rwa/assets/:ticker`                      | search matches for a ticker                 |
| `GET /api/rwa/assets/:ticker/market`               | full snapshot incl. official market status  |
| `GET /api/rwa/assets/:ticker/price`                | on-chain + reference quote + spread         |
| `GET /api/rwa/platforms`                           | issuance platforms                          |
| `GET /ready` (`?probe=1` for a live Binance check) | readiness; `/health` stays independent      |

## Data stores (future)

- **PostgreSQL (Prisma)** — observations, spreads, decisions, intents,
  execution records and their transaction hashes.
- **Redis** — hot caches (recent quotes, market-hours state) and coordination
  locks.

Both appear in `docker-compose.yml` today so the local stack matches the
target topology, but nothing connects to them yet.
