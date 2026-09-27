# Screenshots

Capture from a running instance (`pnpm build && cd apps/web && npx next start`)
after completing the demo setup in `docs/demo-runbook.md`.

Do NOT fabricate screenshots. Where credentials are absent, capture the
honest setup/empty state — those states are part of the product story.

## Required captures

| #   | Page                                              | What to show                                       | Suggested filename          |
| --- | ------------------------------------------------- | -------------------------------------------------- | --------------------------- |
| 1   | `/` Overview                                      | Market status tiles, status bar, opportunities     | `01-overview.png`           |
| 2   | `/markets`                                        | Asset table with real prices/spread/status         | `02-markets.png`            |
| 3   | `/markets/[ticker]`                               | Asset detail: prices, spread, freshness, liquidity | `03-asset-detail.png`       |
| 4   | `/opportunities`                                  | Grouped signals (WATCH/OPPORTUNITY/BLOCKED)        | `04-opportunities.png`      |
| 5   | `/opportunities/[id]`                             | Why detected / what prevents execution             | `05-opportunity-detail.png` |
| 6   | `/strategies`                                     | Natural-language parse → structured preview        | `06-strategy-nl.png`        |
| 6b  | `/strategies`                                     | ADVANCED structured mode                           | `06b-strategy-advanced.png` |
| 7   | Proposals + Rust risk decision (rules ✓/✗)        | `07-risk-decision.png`                             |
| 8   | Simulation PASSED panel / blocked state           | `08-simulation.png`                                |
| 9   | `/wallet` — capabilities, limits, skill allowlist | `09-wallet-security.png`                           |
| 10  | `/executions` + detail timeline                   | `10-execution-timeline.png`                        |
| 11  | `/portfolio`                                      | Setup state or real balances                       | `11-portfolio.png`          |
| 12  | `/agent`                                          | Loop status, observations, activity timeline       | `12-agent.png`              |
| 13  | `/settings`                                       | Read-only policy/limits                            | `13-settings.png`           |

## Rules

- Capture from the running product only; no mockups or edited images.
- Include the status bar in at least one capture (service health story).
- If a page shows an honest empty/setup state, capture it as-is and label it.
- Store captures in this directory; keep filenames as listed.
