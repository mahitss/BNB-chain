# Judge Guide — Understand OLYR in 2 Minutes

No source-code knowledge required. Every screen shows real backend state.

## 1. Open the dashboard

The overview answers "what is happening right now": US equity market status
(from an NYSE calendar engine), on-chain market observability, the agent's
state, and execution counters. The status bar at the bottom shows every
backend service's real health — degraded services are shown, never hidden.

## 2. Open Markets

Real tokenized stocks from the Binance Web3 Market API. Each row shows the
reference price, the on-chain price, the spread between them, and the
official market status reported by Binance.

## 3. Click a ticker

Asset detail: prices, spread, reference freshness, on-chain liquidity (with
pool counts), and market state. Where data is unavailable, OLYR says
"unavailable" — it never invents values.

## 4. Open Opportunities

Deterministic divergence signals grouped by status. Open one: "Why this was
detected" lists the structured rule results; "What prevents execution" lists
the blocking conditions. Terminology is deliberate — divergence is an
observation, never a profit promise.

## 5. Create a natural-language strategy

Type: _"Watch NVDA when the US market is closed and alert me when the
divergence exceeds 1.5%."_ → ANALYZE. The LLM structures intent; four
validation layers enforce the schema. If no LLM key is set, switch to
ADVANCED mode — the structured form works without any AI.

## 6. Open the Agent

The bounded loop's real state (STANDBY / MONITORING), active strategies, and
the activity timeline — every event comes from the persisted audit log. No
chain-of-thought is exposed; only application events.

## 7. Open Proposals → a proposal

The full lifecycle: risk decision with per-rule pass/fail, quote, simulation,
authorization, execution. Note what is missing on purpose: no fabricated
prices, no invented transaction hashes.

## 8. Look for the safety story

- The AI never holds keys and cannot execute anything.
- A 10-rule Rust engine is the only execution authority.
- Simulation is mandatory before broadcast; broadcast ≠ confirmed.
- The kill switch and chain guard block executions regardless of state.
- Every limit ($25/trade, $100/day, 1% slippage) is enforced in code.

## What makes it different

Most "AI trading" demos connect an LLM to a wallet. OLYR does the opposite:
the AI is the least privileged component in the system. The Rust risk engine,
not the model, decides what executes — and it can prove why.

## If something shows a setup state

That is intentional. Without live credentials the product shows exactly what
is missing (e.g. "Binance credentials rejected: 40101 Invalid API Key") and
never substitutes fake data. Honest failure is a feature.
