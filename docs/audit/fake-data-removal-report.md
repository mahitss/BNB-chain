# Fake-Data Removal Report

Audit run: 2026-09-30, post-Phase 10.4. Full-repo search for fake, mock,
fixture, placeholder, hardcoded, and fabricated financial data.

## Findings and actions

| Source                                                   | What it was                                      | Where it appeared         | Why fake                                         | Action                                                                                                        | Final state                         |
| -------------------------------------------------------- | ------------------------------------------------ | ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Duplicate "NVDA weekend premium watcher" strategies (×2) | Test records written to dev DB during boot-smoke | `Strategy` table          | Test artifacts, not user strategies              | Deleted via `clean-dev-db.mjs --apply`; orphaned proposals purged                                             | 1 canonical strategy remains        |
| Stale null-strategy AgentEvents                          | Test events from purged proposals                | `AgentEvent` table        | Orphaned test events                             | Deleted                                                                                                       | Timeline shows only real events     |
| Demo/placeholder `.env` in earlier verification cycle    | Placeholder Binance keys                         | Local `.env` (gitignored) | Keys are placeholders, rejected 40101 by gateway | Retained locally as the credential-provisioning template; clearly documented as placeholders; never committed | User replaces values with real keys |
| Legacy `/rwa` page (Phase 2)                             | Pre-terminal market view                         | `apps/web/app/rwa`        | Superseded by `/markets` (Phase 8)               | Removed in Phase 8                                                                                            | Removed                             |
| Phase 1 static landing page                              | Static service list                              | `apps/web/app/page.tsx`   | Superseded by Phase 8 overview dashboard         | Replaced                                                                                                      | Replaced                            |

## Retained (verified legitimate)

| Item                                   | Where                                  | Why kept                                                  |
| -------------------------------------- | -------------------------------------- | --------------------------------------------------------- |
| `*_fixture.json` files (binance tests) | `packages/binance/test/fixtures/`      | Labeled FIXTURE, tests only, never imported by production |
| `FakeLLMProvider`                      | `services/agent/app/providers/fake.py` | Tests only; production default is provider-less           |
| `apps/api/test/*` minimalPrisma stubs  | Test files                             | Test-only in-memory store                                 |
| "Historical data unavailable" copy     | `/markets/[ticker]`, `/executions`     | Truthful statement, not fake data                         |
| Honest empty/setup states              | All pages                              | Intentional design (spec 16/17)                           |

## Verified absent

- No `Math.random` in any financial path (only retry jitter in transport and Rust invariant tests)
- No mock/sample/demo fallback in any catch block (errors surface as errors)
- No hardcoded prices, balances, hashes, or PnL in production code
- No fake transaction hashes in any UI
- No fabricated PnL or performance anywhere
- No seed scripts inserting fake financial data at startup
