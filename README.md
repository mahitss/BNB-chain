# OLYR

**Autonomous intelligence and controlled execution for tokenized equities on
BNB Smart Chain** — for traders who want around-the-clock market
intelligence without ever giving an AI unrestricted control of their funds.

## What is OLYR?

OLYR watches tokenized stocks on BNB Smart Chain, detects and explains
divergence between their on-chain price and their reference price, turns
plain-English strategy requests into strictly validated proposals, and —
only when every safety gate passes and a human authorizes — executes through
the Binance Web3 stack with on-chain verification.

## The Problem

Tokenized equities trade 24/7 on-chain, but:

- their reference prices come from traditional markets that close;
- divergence between on-chain and reference price is hard to measure and
  explain reliably;
- "AI trading" products hand an LLM a wallet and hope — there is no
  deterministic layer between what an AI says and what executes on-chain;
- traders have no way to express a strategy in plain language and still get
  hard, auditable risk enforcement.

## The Solution

OLYR separates responsibilities by trust. The AI interprets intent;
deterministic systems control execution:

1. **Detect** — real Binance Web3 RWA data normalized into domain types,
   evaluated by a deterministic opportunity engine (spread, freshness,
   liquidity, official market status).
2. **Interpret** — the LLM converts plain-English requests into a strict
   schema. Four validation layers (schema → semantic → capability → safety)
   plus platform hard limits reject anything oversized, unsupported, or
   injected.
3. **Authorize risk** — a Rust engine with 10 hard rules returns
   APPROVED / REJECTED / REQUIRES_REVIEW with per-rule explanations.
4. **Prepare** — a real quote, transaction construction, and mandatory
   simulation through the Binance Transaction API.
5. **Gate** — expiry, allowlists, scope binding, cooldowns, idempotency,
   kill switch, chain guard.
6. **Execute** — a Go service signs (the only signer) and broadcasts;
   on-chain verification is a separate, mandatory step.

## How It Works

```
User Intent
↓
Strategy Agent (Python · LLM intent only)
↓
Market Intelligence (deterministic)
↓
Opportunity Engine
↓
Risk Engine (Rust · 10 rules · APPROVED/REJECTED/REQUIRES_REVIEW)
↓
Trade Proposal
↓
Quote (Binance Trading API)
↓
Transaction (unsigned)
↓
Simulation (Transaction API)
↓
Authorization (human · MANUAL policy)
↓
Wallet (Go service · sole signer)
↓
BSC (settlement)
↓
Verification (on-chain)
↓
Audit Trail + Portfolio (PostgreSQL)
```

## Why the Architecture Is Safe

| Layer            | What it can do                     | What it can never do                              |
| ---------------- | ---------------------------------- | ------------------------------------------------- |
| LLM (Python)     | Emit one validated strategy JSON   | Hold keys, call tools, reach the network, execute |
| Fastify API      | Validate, persist, orchestrate     | Sign, hold executor keys, broadcast directly      |
| Rust risk engine | Approve/reject deterministically   | Touch the network, the LLM, or mutable state      |
| Go execution     | Sign after re-verifying every gate | Accept arbitrary transactions, skip gates         |
| Browser          | Render real state                  | Reach Binance, Rust, or any credential            |

- Platform limits ($25/trade, $100/day, 1% slippage, allowlists) are
  configuration the AI cannot change, enforced twice (agent + API).
- The kill switch blocks new executions system-wide.
- Every proposal persists its exact risk inputs and per-rule results —
  immutable audit history.

## Features

- Live tokenized-stock market terminal (search, spread, official market
  status, freshness, liquidity)
- Deterministic opportunity engine with explainable signals
- Natural-language + structured strategy builders with clarification flow
- Rust risk decisions with per-rule explanations
- Quote → simulation → authorization → execution lifecycle with immutable
  audit trail
- Kill switch, chain guard, proposal expiry, idempotent executions
- Bounded agent loop with cooldowns and deduplication
- Agentic Wallet adapter (fails closed until provisioned)

## Tech Stack

Next.js 16 · TypeScript · Tailwind CSS 4 · TanStack Query · Fastify 5 ·
Prisma 6 + PostgreSQL 16 · Redis (optional) · Python 3.12 + FastAPI +
Pydantic · Rust (axum) · Go + go-ethereum · Docker · GitHub Actions.
Details: [docs/tech-stack.md](docs/tech-stack.md).

## Integrations

- **Binance Web3 API** — RWA Data (6 endpoints), Market, Trading (RFQ + SWAP),
  Transaction (simulate/broadcast), Wallet balances — all documented, all
  HMAC-signed
- **Agentic Wallet / Wallet Skills** — provider adapter with preflight
  (fails closed until provisioned)
- **LLM providers** — OpenAI-compatible; provider-abstracted

## Security

Full model: [docs/security.md](docs/security.md) and
[docs/submission/security-story.md](docs/submission/security-story.md).
Checklist: [docs/security-checklist.md](docs/security-checklist.md)
(24 PASS / 2 NEEDS_REVIEW / 0 FAIL).

## Demo

Canonical path and narration: [docs/submission/demo-script.md](docs/submission/demo-script.md)
and [docs/demo-runbook.md](docs/demo-runbook.md). The product shows honest
setup states wherever credentials are absent — fake data never appears.

## Local Development

```bash
pnpm install
pnpm build
docker compose up -d postgres
cd apps/api && npx prisma migrate deploy
pnpm dev   # web :3000 · api :4000
```

## Environment Variables

Names only — never values. See [.env.example](.env.example):
`BINANCE_API_KEY/SECRET`, `OLYR_LLM_PROVIDER/MODEL/API_KEY`,
`DATABASE_URL`, `OLYR_RISK_URL`, `OLYR_AGENT_URL`,
`OLYR_EXECUTION_URL`, `OLYR_INTERNAL_TOKEN`, `OLYR_EXECUTOR_PRIVATE_KEY/
ADDRESS` (Go service only), `OLYR_KILL_SWITCH`, `EXPECTED_CHAIN_ID`,
`EXPECTED_NETWORK`, `OLYR_EXECUTION_POLICY`, `OLYR_MAX_*` limits.

## Testing

```bash
pnpm verify   # format → lint → typecheck → tests → build → security audit
```

213 automated tests across TypeScript (174), Python (45), Rust (19), and Go
— all green. Live-credential paths are the only untested surface (documented).

## Mainnet Safety

BSC mainnet execution requires: chain-guard match, kill switch off, MANUAL
authorization, a funded dedicated wallet, and the manual procedure in
[docs/mainnet/micro-trade-runbook.md](docs/mainnet/micro-trade-runbook.md).
Proposals expire, authorizations are scope-bound, executions are idempotent,
and broadcast ≠ confirmed. **No transaction has ever been broadcast from
OLYR.**

## Limitations

Honest list: [docs/submission/limitations.md](docs/submission/limitations.md).

## Developer Experience

Factual integration log (Binance APIs, wallet, debugging):
[docs/submission/developer-experience-report.md](docs/submission/developer-experience-report.md)
and [docs/dev-report/README.md](docs/dev-report/README.md).

## License

Copyright © 2026 OLYR contributors. All rights reserved unless otherwise
noted. Hackathon submission.
