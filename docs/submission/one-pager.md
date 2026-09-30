# OLYR One-Pager

## Project

**OLYR** — autonomous intelligence and controlled execution for tokenized
equities on BNB Smart Chain.

## Problem

Tokenized stocks trade 24/7 on-chain, but there is no safe way to combine AI
driven intelligence with hard execution controls. Existing "AI trading" tools
either give an LLM unrestricted wallet access (unsafe) or reduce the AI to a
chatbot (useless).

## Solution

OLYR separates responsibilities by trust:

- The **AI** (provider-abstracted LLM) converts plain-English requests into a
  strictly validated strategy schema — and stops there. No keys, no tools,
  no network beyond its own provider.
- A **deterministic opportunity engine** evaluates real Binance Web3
  tokenized-stock data (prices, official market status, liquidity) and emits
  explainable divergence signals.
- A **Rust risk engine** — 10 hard rules, zero LLM involvement — is the only
  execution authority (APPROVED / REJECTED / REQUIRES_REVIEW with reasons).
- A **Go execution service** is the only signer: quote → unsigned
  transaction → mandatory simulation → authorization → broadcast → on-chain
  verification. Broadcast ≠ confirmed.

## Key innovation

**The AI is structurally incapable of moving funds.** The path from LLM
output to a broadcast is broken by design at four independent boundaries:
schema validation, platform hard limits, a Rust risk engine, and a
human/authorization gate. Every proposal is explainable after the fact from
the persisted audit trail.

## Architecture

Next.js terminal → Fastify API → Python agent (intent) → Rust risk engine
(authority) → Go execution (signing) → BSC (settlement) → PostgreSQL (audit).
Full diagram: docs/architecture/final-architecture.md.

## Security

Kill switch · chain guard (fail-closed) · asset/action allowlists ·
$25/trade, $100/day, 1% slippage hard limits · idempotent expiring
executions · immutable audit trail · secret scanner in CI. The LLM cannot
change any of it.

## Technology

Next.js 16, TypeScript, Tailwind, TanStack Query · Fastify 5, Prisma,
PostgreSQL 16 · Python 3.12, FastAPI, Pydantic · Rust (axum) · Go +
go-ethereum · BNB Smart Chain · Docker + GitHub Actions.

## Demo

Live tokenized-stock market data, divergence detection, natural-language
strategy with deterministic validation, risk decisions, and a full audit
trail — running locally today (docs/demo-runbook.md). Mainnet broadcast is
implemented and gated but not performed (docs/mainnet/micro-trade-runbook.md).

## Current status

All 10 engineering phases complete; v1.0.0 tagged. 213+ automated tests
across TypeScript, Python, Rust, and Go — all green. Live data verification
awaits production Binance credentials (the only blocker).

## Limitations

Honest list: docs/submission/limitations.md — including no live mainnet
execution, no historical charts (no accumulated history), read-only policy
management, and in-memory scan state.
