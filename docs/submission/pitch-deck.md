# Pitch Deck Content (8 slides)

## SLIDE 1 — OLYR

**Autonomous Intelligence for Tokenized Equities**

BNB Smart Chain · Detect → Validate → Simulate → Authorize → Execute → Verify

## SLIDE 2 — THE PROBLEM

Tokenized stocks trade 24/7 on-chain — but the intelligence and safety tooling
still thinks in market hours.

- On-chain prices drift from reference prices with no structured way to
  measure or explain the gap.
- "AI trading" products hand an LLM a wallet and hope. There is no
  deterministic layer between what an AI says and what executes on-chain.
- Traders have no way to express a strategy in plain language and still get
  hard, auditable risk enforcement.

## SLIDE 3 — THE SOLUTION

OLYR: an autonomous intelligence and controlled execution platform.

- Real Binance Web3 tokenized-stock data, 24/7.
- Plain-English strategies validated into a strict schema.
- A Rust risk engine — not an LLM — decides what may execute.
- Every trade simulated, authorized, and verified. Broadcast ≠ confirmed.

## SLIDE 4 — HOW IT WORKS

Intent → Intelligence → Risk → Simulation → Authorization → Settlement

The LLM interprets intent (one validated JSON document, nothing more).
Deterministic validators enforce the schema. A Rust engine with 10 hard rules
approves or rejects. The Go service signs — the only component that ever
touches a key. BSC settles. Every stage is audited.

## SLIDE 5 — PRODUCT

- Overview: market status, agent state, live divergence signals
- Markets: tokenized stocks with reference/on-chain spread and market status
- Opportunities: WATCH / OPPORTUNITY / BLOCKED — each fully explained
- Strategies: natural language + advanced structured builder
- Proposals: risk decision, quote, simulation, authorization lifecycle
- Executions: state timeline, on-chain verification
- Wallet: capabilities, limits, kill switch

## SLIDE 6 — TECHNICAL ARCHITECTURE

Five services, five trust boundaries:

- Next.js terminal → Fastify API (the only public surface)
- Python agent: LLM intent interpretation, 4-layer validation
- Rust risk engine: 10 deterministic rules, no LLM, no I/O
- Go execution: sole signer (EIP-1559 + EIP-712), kill switch, idempotent
- PostgreSQL: immutable audit trail

Security boundaries: the browser never touches Binance or Rust; the AI never
touches keys; the risk engine never touches the network.

## SLIDE 7 — WHY IT MATTERS

- Tokenized equities are the RWA wedge into DeFi — but they need market-hours
  intelligence and institutional-grade controls to be taken seriously.
- OLYR's answer is architectural, not aspirational: the AI is structurally
  incapable of moving funds, and every execution is explainable after the
  fact from the audit trail.
- The same architecture extends to any RWA vertical that needs an AI layer
  with hard safety boundaries.

## SLIDE 8 — DEMO / FUTURE

- Demo: live tokenized-stock data, divergence detection, natural-language
  strategy, deterministic risk decision — running end-to-end today.
- Honest status: mainnet execution is implemented and gated; live micro-trade
  awaits production credentials (manual runbook prepared).
- Next: live data verification with production keys, historical divergence
  charts from accumulated scans, portfolio analytics.

## Honesty rules

No traction/user/revenue/PnL claims — none exist. No financial-outcome
promises. The differentiator is the safety architecture, and it is real.
