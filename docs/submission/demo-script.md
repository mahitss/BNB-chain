# OLYR Demo Script (3–4 minutes)

A timed narration path matching `docs/demo-runbook.md`. Every screen is real
system state; where credentials are absent, the honest setup state is itself
the talking point.

| Time  | Screen              | Say / do                                                                                                                                                                                                                                                                       |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 00:00 | Terminal (`/`)      | "Tokenized stocks trade on-chain around the clock — but the tools to understand them still think in market hours. This is OLYR." Point at the market status tiles and the live status bar.                                                                                     |
| 00:20 | `/` continued       | "Everything on screen is real backend state: Binance Web3 data on the left, service health along the bottom — the status bar shows degraded services, it never hides them."                                                                                                    |
| 00:45 | `/markets`          | "Live tokenized stocks from the Binance Web3 Market API — reference price, on-chain price, official market status per asset." Search for an asset to show the table reacts.                                                                                                    |
| 01:10 | `/markets/[ticker]` | "The key comparison: on-chain price vs reference price. OLYR computes the spread deterministically and reports reference freshness straight from the API." Note the market state badge — official, not inferred.                                                               |
| 01:35 | `/strategies`       | "You describe what you want in plain English." Type the example, hit ANALYZE, show the structured interpretation. "The LLM only structures intent — every number was already validated." If no LLM key: show the setup banner and build the strategy in ADVANCED mode instead. |
| 02:00 | `/opportunities`    | "The opportunity engine classifies divergence signals: WATCH, OPPORTUNITY, BLOCKED — each with its reasons and warnings." Open one: "Why this was detected" / "What prevents execution" — structured rule results.                                                             |
| 02:20 | Proposals + risk    | Create a proposal from the saved strategy and run risk evaluation. Without Binance credentials the Rust engine rejects on missing price — "it refuses to trade on data it doesn't have." With credentials: APPROVED with every rule listed.                                    |
| 02:40 | Quote + simulation  | "A real Binance quote, then mandatory transaction simulation before anything can broadcast. Simulation FAILED means the trade would revert — it never reaches broadcast."                                                                                                      |
| 03:00 | `/wallet`           | "The authorization boundary. MANUAL mode requires a human for every trade. The AI never holds keys and can never change its own limits — $25 per trade, $100 per day, kill switch."                                                                                            |
| 03:20 | `/executions`       | "Every execution persists its full state timeline. Broadcast is not confirmed — confirmation comes from on-chain verification. Explorer link only for real hashes."                                                                                                            |
| 03:40 | Portfolio + close   | "Portfolio and audit trail update from verified state. OLYR: autonomous intelligence, controlled execution — the AI proposes, deterministic rules decide."                                                                                                                     |

## Honesty notes

- If Binance credentials are absent: markets show the setup state; the risk
  engine's REJECTED-on-missing-price is the safety showcase.
- If the LLM key is absent: the strategy builder shows its setup banner.
- Never narrate a trade as executed/confirmed unless the screen shows it from
  the API.
