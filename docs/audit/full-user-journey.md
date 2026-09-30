# Full User Journey Audit — v1.0.0

Executed 2026-09-30 in the browser (fresh session) against the running local
stack: API :4000 (placeholder Binance credentials in .env), risk engine
:8002, execution :8001, agent :8005, terminal :3000, PostgreSQL up.

Journey: Landing → Overview → Markets → Asset Detail → Opportunities →
Strategy → Agent → Proposal → Simulation → Wallet → Executions → Portfolio →
Settings. Verified: rendering, states, secrets, overflow, console, dead
links/buttons.

## Page-by-page results

| Page                | Renders | Data source                                                                       | States shown                                                                                                                       | Issues                                   |
| ------------------- | ------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `/` Overview        | ✓       | `/api/market/state`, `/api/opportunities`, `/api/agent/status`, `/api/executions` | US equities OPEN (calendar), on-chain NOT_CONFIGURED + reason, honest portfolio setup state, "Market data unavailable" empty state | None                                     |
| `/markets`          | ✓       | `/api/rwa/assets`                                                                 | Real categorized upstream error (40101 Invalid API Key) with RETRY                                                                 | None — error is honest (placeholder key) |
| `/markets/[ticker]` | ✓       | `/api/market/:ticker/snapshot`                                                    | 404/502 handled; "Historical data unavailable"                                                                                     | None                                     |
| `/opportunities`    | ✓       | `/api/opportunities`                                                              | NOT_CONFIGURED → "Market data unavailable" empty state (not fake "no signals")                                                     | None                                     |
| `/strategies`       | ✓       | `/api/strategies`                                                                 | Builder renders; ADVANCED mode works without LLM                                                                                   | None                                     |
| `/agent`            | ✓       | `/api/agent/status`, `/api/agent/state`                                           | Loop state, timeline, failure banner when scan errors                                                                              | None                                     |
| `/portfolio`        | ✓       | `/api/wallet/balances`                                                            | Wallet-setup empty state (honest 503)                                                                                              | None                                     |
| `/proposals`        | ✓       | `/api/proposals`                                                                  | Empty state; execution buttons disabled with explanation                                                                           | None                                     |
| `/executions`       | ✓       | `/api/executions`                                                                 | "No executions yet" + explanation                                                                                                  | None                                     |
| `/wallet`           | ✓       | `/api/wallet`                                                                     | NOT_CONFIGURED status, limits, capability checklist                                                                                | None                                     |
| `/settings`         | ✓       | `/api/wallet` + `/api/system/status`                                              | Read-only config; no fake editable controls                                                                                        | None                                     |

## Checks

- **Console errors**: none on any page (silent network failures surface as
  honest UI error states, not console spam).
- **Hydration errors**: none observed across all 10 routes.
- **Secret leaks**: scanned localStorage, sessionStorage, cookies, and
  rendered HTML on every page — no Binance secrets, no private keys.
- **Horizontal overflow**: none (desktop 1280px).
- **Dead links/buttons**: navigation (10 items) all resolve; buttons either
  work or are explicitly disabled/labeled ("EXECUTION NOT ENABLED").
- **Direct URL access**: all routes render standalone — none depend on
  navigating from the homepage first.
- **Stale-data presentation**: "scan never" / "updated just now" labels are
  driven by real backend timestamps.

## Journey verdict

A first-time user can understand the product, see exactly which services are
unconfigured and why, and never encounters a fabricated number, hash, or
success state.
