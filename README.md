# OLYR

**Autonomous intelligence and controlled execution for tokenized equities on BNB Smart Chain.**

[![CI](https://github.com/mahitss/BNB-chain/actions/workflows/ci.yml/badge.svg)](./.github/workflows/ci.yml)

## Overview

OLYR watches tokenized stocks on BNB Smart Chain, detects and explains price
divergences between their on-chain price and their reference price, validates
every proposed action through a deterministic Rust risk engine, and executes
only through an explicitly authorized, simulation-gated pipeline. It is built
for one thesis: **tokenized equities trade around the clock, but most tooling
still thinks in market hours** — OLYR brings structured intelligence and
controlled automation to the hours in between.

## Problem

Tokenized equities (bStocks, Ondo-class assets) trade 24/7 on-chain, but:

- their reference prices come from traditional markets that close;
- divergence between on-chain and reference price is hard to measure reliably;
- existing bots offer unrestricted execution with no structured risk controls;
- AI agents have no safe way to turn intent into bounded on-chain actions.

## Solution

OLYR separates responsibilities by trust:

1. **Detect** — real Binance Web3 RWA data, normalized and evaluated by a
   deterministic opportunity engine (spread, freshness, liquidity, market state).
2. **Interpret** — an LLM converts plain-English strategies into a strict
   schema. It stops at intent: no keys, no tools, no execution.
3. **Validate** — four deterministic validation layers (schema → semantic →
   capability → safety) plus platform hard limits.
4. **Authorize risk** — a Rust engine evaluates 10 independent rules and
   returns APPROVED / REJECTED / REQUIRES_REVIEW with per-rule explanations.
5. **Prepare** — a real quote from the Trading API, transaction construction,
   and mandatory simulation through the Transaction API.
6. **Gate** — a 12-point execution gate (expiry, allowlists, simulation,
   authorization, policy, limits, cooldown, deduplication).
7. **Execute** — a Go service signs (the only signer) and broadcasts;
   broadcast ≠ confirmed: on-chain verification is a separate step.
8. **Audit** — every stage persists structured, queryable events.

## Architecture

```
User
 ↓
OLYR Terminal (Next.js)
 ↓
Fastify API
 ├── Strategy Agent (Python, LLM behind an interface)
 ├── Market/RWA Data (@olyr/binance clients)
 ├── Opportunity Engine (deterministic)
 ├── Portfolio
 ├── Proposals
 └── Execution Orchestrator
       ↓
   Rust Risk Engine ── APPROVED / REJECTED / REQUIRES_REVIEW
       ↓
   Transaction Simulation
       ↓
   Authorization (MANUAL | BOUNDED_AGENT | DISABLED)
       ↓
   Go Execution Service (sole signer)
       ↓
   BNB Smart Chain
       ↓
   Transaction Verification
       ↓
   Portfolio + Audit Trail (PostgreSQL)
```

Detailed diagrams: [docs/architecture/final-architecture.md](docs/architecture/final-architecture.md).

## Core Flow

`Strategy → Risk APPROVED → Quote → Simulation PASSED → Authorization →
Broadcast → On-chain CONFIRMED → Portfolio + Audit` — with expiration,
idempotency, and a kill switch enforced at every hop.

## Key Features

- Real Binance Web3 RWA data (prices, official market status, liquidity pools)
- Deterministic, explainable opportunity signals — no LLM in the numbers
- Natural-language strategies with strict schema validation and clarification
- Rust risk engine with 10 hard rules and platform limits the LLM cannot change
- Quote → simulation → authorization → broadcast → verification pipeline
- Kill switch, chain guard, idempotency, proposal expiry, immutable audit log
- Read-only agent tools; a generic execute tool does not exist

## Tech Stack

Next.js 16 · TypeScript · Tailwind CSS 4 · TanStack Query · Fastify 5 ·
Prisma + PostgreSQL · Redis (optional) · Python 3.12 + FastAPI ·
Rust (axum) · Go + go-ethereum · BNB Smart Chain · Docker.
Full inventory: [docs/tech-stack.md](docs/tech-stack.md).

## Security Model

The constitutional boundary — **the LLM is never the financial authority** —
is enforced structurally. Full model: [docs/security.md](docs/security.md)
and [docs/security-checklist.md](docs/security-checklist.md) (24 PASS / 2
NEEDS_REVIEW / 0 FAIL at release).

## Supported Integrations

- **Binance Web3 API** — RWA Data, Market, Trading (RFQ + SWAP), Transaction,
  Wallet (documented endpoints only)
- **Binance Agentic Wallet / Wallet Skills** — isolated behind a provider
  adapter with preflight detection (adapter fails closed until provisioned)
- **LLM providers** — OpenAI-compatible chat completions; provider-abstracted

## Local Development

```bash
pnpm install
pnpm build
docker compose up -d postgres
cd apps/api && npx prisma migrate deploy
pnpm dev   # web :3000 · api :4000
```

## Environment Variables

Copy `.env.example` → `.env`. Server-side only: `BINANCE_API_KEY/SECRET`,
`OLYR_LLM_API_KEY`, `OLYR_EXECUTOR_PRIVATE_KEY`, `DATABASE_URL`,
`OLYR_INTERNAL_TOKEN`. Browser-visible: `NEXT_PUBLIC_OLYR_API_URL` only.
Demo configuration: `.env.demo.example`.

## Running the Project

Each service is independently bootable (see the service table in the
[deployment guide](docs/deployment.md)). `pnpm verify` runs the complete
safe verification pipeline: format → lint → typecheck → tests → build →
security audit. It never broadcasts a transaction.

## Testing

168 TypeScript tests (types, config, web logic, api), 45 Python tests
(including adversarial prompt-injection), 19 Rust tests (rule matrix +
invariants), Go state-machine/signing tests, integration smoke tests,
`node scripts/security-audit.mjs`.

## Demo

Follow [docs/demo-runbook.md](docs/demo-runbook.md) and
[docs/demo-script.md](docs/demo-script.md). The demo uses only real system
states; where credentials are absent the product shows explicit setup states.

## Mainnet Safety

BSC mainnet execution requires: explicit `EXPECTED_CHAIN_ID`/`EXPECTED_NETWORK`
match, kill switch off, MANUAL authorization, funded dedicated wallet, and the
manual procedure in [docs/mainnet-micro-trade-runbook.md](docs/mainnet-micro-trade-runbook.md).
Automated CI never broadcasts. **Live execution status: not verified** (no
credentials in this build environment).

## Project Structure

See [docs/architecture/phase-9-audit.md](docs/architecture/phase-9-audit.md)
for the verified component inventory.

## Limitations

Documented in [docs/submission/limitations.md](docs/submission/limitations.md)
and [docs/final-audit.md](docs/final-audit.md).

## Developer Experience

Factual integration log (Binance APIs, wallet, debugging):
[docs/dev-report/README.md](docs/dev-report/README.md).

## License

Copyright © 2026 OLYR contributors. All rights reserved unless otherwise
noted. Hackathon submission.
