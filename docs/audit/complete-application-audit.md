# Complete Application Audit — Data Source Truthfulness

Audited: 2026-09-30 (post-Phase 10.4, pre-freeze). Every data source in the
running application was traced to its origin. Verdicts: REAL / DERIVED /
USER-GENERATED / DATABASE / EXTERNAL API / TEST / DEMO / MOCK / FIXTURE /
HARDCODED / UNKNOWN.

## Data source inventory

| Data                | Source                                | Classification | Production path                     | Verdict                                                     |
| ------------------- | ------------------------------------- | -------------- | ----------------------------------- | ----------------------------------------------------------- |
| On-chain price      | Binance RWA API (`tokenPrice`)        | EXTERNAL API   | Yes — `/api/rwa/*`, `/api/market/*` | REAL (when credentials valid; otherwise honest unavailable) |
| Reference price     | Binance RWA API (`referencePrice`)    | EXTERNAL API   | Same                                | REAL (derived per-share conversion — labeled)               |
| Market status       | Binance `statusInfo`                  | EXTERNAL API   | Yes                                 | REAL (official; never time-inferred)                        |
| US equities state   | OLYR NYSE calendar                    | DERIVED        | Yes — `/api/market/state`           | DERIVED (deterministic; source labeled)                     |
| Spread / divergence | OLYR calculation                      | DERIVED        | Yes                                 | DERIVED (BigInt-scaled; deterministic)                      |
| Freshness           | OLYR vs API timestamps                | DERIVED        | Yes                                 | DERIVED                                                     |
| Liquidity           | Binance `top-liquidity`               | EXTERNAL API   | Yes                                 | REAL (or UNKNOWN — never assumed)                           |
| Divergence signals  | Opportunity Engine                    | DERIVED        | Yes                                 | DERIVED (deterministic; reasons persisted)                  |
| Strategies          | User input via LLM parse + validation | USER-GENERATED | Yes                                 | USER-GENERATED (validated 4 layers)                         |
| Risk decisions      | Rust engine                           | DERIVED        | Yes                                 | DERIVED (deterministic; inputs persisted)                   |
| Executions          | Go service                            | DATABASE       | Yes                                 | REAL (only after full gate chain)                           |
| Agent events        | Backend actions                       | DATABASE       | Yes                                 | REAL (persisted from actual actions)                        |
| Portfolio           | Wallet API                            | EXTERNAL API   | Not yet (honest 503)                | BLOCKED until wallet provisioning                           |
| Test fixtures       | `*_fixture.json`, FakeLLMProvider     | FIXTURE        | **No** — tests only                 | TEST (labeled `_fixture: true`)                             |
| Demo states         | UI setup/empty states                 | UI-only        | Yes (no creds)                      | Honest state, not data                                      |

## UNKNOWN items investigated

None remained. All previously-UNKNOWN values (US equities, on-chain market)
are now explicitly classified: US equities = DERIVED from the calendar;
on-chain = NOT_CONFIGURED / WAITING_FOR_DATA / ACTIVE based on scan state.

## Fake-data search results

Patterns searched: mock, mocks, fixture(s), fake, dummy, sample, demo, seed,
placeholder, hardcoded, testData, exampleData, staticData, fallbackData,
fakeTransaction, fakeHash, mockPrice/Balance/Portfolio/Opportunity/Execution/
Event/Agent, samplePortfolio/Market, demoPortfolio/Execution.

| Location                                            | Match                                                      | Classification                    | Action            |
| --------------------------------------------------- | ---------------------------------------------------------- | --------------------------------- | ----------------- |
| `packages/binance/src/http.ts:136`                  | `Math.random` retry jitter                                 | Transport backoff (non-financial) | KEEP              |
| UI `placeholder=` attributes                        | Input hints (markets search, strategies)                   | UI guidance                       | KEEP              |
| "fake" in comments/UI copy                          | Honesty statements ("never fabricated", "refuses to fake") | Documentation                     | KEEP              |
| Test fixtures (`*_fixture.json`, `FakeLLMProvider`) | Labeled FIXTURE                                            | TEST-only                         | KEEP (test dirs)  |
| `docs/submission/demo-script.md`                    | Narration for honest states                                | DOCUMENT                          | KEEP              |
| `services/execution/tests` signing key              | TEST-only throwaway key                                    | TEST                              | KEEP (documented) |

No fake financial value reaches any production code path.
