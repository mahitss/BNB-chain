# Data Lineage

Every important value in OLYR traced to its origin. No value is displayed in
the terminal without a path in this table.

| Value                              | Origin                                       | Transform                                                            | Notes                                                         |
| ---------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `onChainPrice`                     | Binance RWA API (`tokenPrice`)               | None — string preserved                                              | USD decimal string                                            |
| `referencePrice`                   | Binance RWA API (`referencePrice`)           | None — string preserved                                              | Derived per-share conversion per Binance docs; labeled in UI  |
| `spreadPercent` / `spreadAbsolute` | onChainPrice − referencePrice                | Deterministic BigInt-scaled calculation (`calculatePriceDivergence`) | Percent rounded half-away-from-zero, 4 dp                     |
| `divergence direction`             | sign of (onChain − reference)                | Sign comparison                                                      | PREMIUM / DISCOUNT / NONE                                     |
| `marketState` (asset)              | Binance `statusInfo.marketStatus`            | Phase mapping + calendar refinement of CLOSED→WEEKEND/HOLIDAY        | Source labeled `binance` or `derived-calendar`                |
| `marketState` (US banner)          | OLYR NYSE calendar                           | Deterministic rules (09:30–16:00 ET, holidays)                       | IANA `America/New_York`                                       |
| `referenceFreshness`               | now − price timestamp vs config thresholds   | Bucket FRESH/AGING/STALE                                             | Missing timestamp → UNKNOWN                                   |
| `liquidityStatus`                  | Binance `top-liquidity` pools                | Sum of documented pool USD (BigInt)                                  | UNKNOWN when unreachable — never assumed                      |
| `riskDecision`                     | Rust `/evaluate` over stored inputs          | 10 rules, deterministic aggregation                                  | Inputs persisted verbatim                                     |
| `quote.expectedOutput`             | Binance `/aggregator/swap` (`toTokenAmount`) | None — string preserved                                              | Smallest unit                                                 |
| `simulation.status`                | Binance `/pre-transaction/simulate`          | API status mapping (SUCCESS→PASSED)                                  | RFQ = vendor-validated (UNKNOWN recorded)                     |
| `balance`                          | Wallet API (`all-token-balances-by-address`) | None                                                                 | Requires wallet provisioning                                  |
| `execution.state`                  | Go service state machine                     | Transition-table validation                                          | Illegal transitions rejected                                  |
| `txHash`                           | Broadcast response (`txHash`)                | None                                                                 | Rendered only when real; BscScan link only for 32-byte hashes |
| `agentState`                       | Backend loop + config                        | Single source `/api/agent/state`                                     | Overview/Agent/status bar derive from it                      |
| Audit events                       | Actual backend actions                       | Persisted append-only                                                | Never generated to fill the timeline                          |

## Anti-fabrication guarantees

1. Missing upstream value → `null`/UNAVAILABLE end-to-end (no defaults).
2. Failed upstream call → typed error surfaced (no catch-to-sample).
3. Random values exist only in retry jitter (transport) and Rust invariant
   tests — never in financial data.
4. Test fixtures are `*_fixture.json` / `FakeLLMProvider` — test dirs only.
