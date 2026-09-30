# OLYR Demo Script (Final — 3–4 minutes)

Timed narration matching the canonical flow. Every screen shows real backend
state; where credentials are absent, the honest setup state is the talking
point.

## 0:00–0:20 — THE PROBLEM

**Screen: Overview (`/`)**

> "Tokenized stocks trade on-chain around the clock — but the moment the
> traditional market closes, most tooling goes blind. And every 'AI trading'
> demo out there hands the model a wallet and hopes for the best."

## 0:20–0:45 — OLYR OVERVIEW

**Screen: Overview tiles + status bar**

> "OLYR watches tokenized equities on BNB Smart Chain. This status bar is
> live — every service, real health checks. The US-equities state comes from
> our NYSE calendar engine. And this agent is bounded: it can watch and
> propose, but it can never move funds by itself."

## 0:45–1:15 — LIVE TOKENIZED MARKET

**Screen: `/markets`**

> "Here's the live tokenized market from the Binance Web3 Market API —
> reference price, on-chain price, official market status per asset. Search
> works." _(search for an asset)_ "Each number comes straight from the API —
> when something is unavailable, OLYR says unavailable."

## 1:15–1:40 — DIVERGENCE / OPPORTUNITY

**Screen: `/opportunities` → detail**

> "OLYR computes the spread deterministically — big-number arithmetic, no
> floats in the money path. Each signal is grouped: WATCH, OPPORTUNITY,
> BLOCKED. Open one: 'Why this was detected' and 'What prevents execution'
> are the actual rule outputs — not marketing."

## 1:40–2:10 — NATURAL LANGUAGE STRATEGY

**Screen: `/strategies`**

> "You describe what you want: 'Watch NVDA when the US market is closed and
> alert me when the divergence exceeds 1.5%.' The LLM structures that intent
> into a strict schema — then stops. Four validation layers check it, and
> the platform's own limits override anything the model says."

## 2:10–2:35 — AGENT EVALUATION

**Screen: `/agent`**

> "The bounded agent loop evaluates active strategies on an interval. Every
> event in this timeline is persisted from real backend state — strategy
> matched, proposal created, risk decision. No chain-of-thought, no
> fabricated activity."

## 2:35–3:00 — RISK ENGINE

**Screen: `/proposals` → detail (risk section)**

> "Every proposal goes to a Rust risk engine with ten hard rules: trade
> size, daily exposure, slippage, allowlists, freshness, liquidity, position
> limits. It's deterministic — same inputs, same decision — and it explains
> itself rule by rule. The AI can't override it."

## 3:00–3:20 — QUOTE + SIMULATION

**Screen: proposal detail (quote/simulation)**

> "Approved proposals get a real Binance quote, then the transaction is
> constructed and simulated on the actual API before anything can proceed.
> A simulation failure stops the trade here."

## 3:20–3:40 — AUTHORIZATION / WALLET

**Screen: `/wallet`**

> "Execution requires explicit human authorization. MANUAL mode means every
> single trade is approved by a person. The wallet page shows the
> capability checklist — and the AI's execution capability is false by
> default. The kill switch blocks everything system-wide."

## 3:40–4:00 — EXECUTION / VERIFICATION / CLOSING

**Screen: `/executions`**

> "When everything passes, the Go service signs, broadcasts, and verifies
> on-chain — broadcast and confirmed are different states, and OLYR shows
> both honestly. Every stage is audited. That's OLYR: autonomous
> intelligence, controlled execution — the AI proposes, deterministic rules
> decide."

## Recording notes

- With valid Binance credentials, markets/opportunities show live data and
  the full flow runs to AWAITING AUTHORIZATION.
- Without credentials, show the setup states deliberately: "the product
  refuses to fake data" is a stronger demo point than a fake table.
