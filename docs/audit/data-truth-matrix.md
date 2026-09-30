# Data Truth Matrix — v1.0.0

Every value displayed in the OLYR terminal, its source, and its status.
Rule: no field ships without a defensible origin.

| Screen           | Field                      | Source                           | Real/Derived               | Freshness        | Fallback                       | Action                          |
| ---------------- | -------------------------- | -------------------------------- | -------------------------- | ---------------- | ------------------------------ | ------------------------------- |
| Overview         | US equities state          | NYSE calendar engine             | DERIVED                    | Live per request | n/a (calendar always computes) | KEEP                            |
| Overview         | On-chain market            | Scan outcome store               | DERIVED                    | Per scan         | ACTIVE/UNKNOWN/WAITING         | KEEP                            |
| Overview         | Agent state                | `/api/agent/state`               | DERIVED                    | Live             | STANDBY/DISABLED               | KEEP                            |
| Overview         | Opportunities              | Scanner store (real evaluations) | DERIVED                    | Per scan         | Empty + reason                 | KEEP                            |
| Overview         | Executions count           | `/api/executions`                | DATABASE                   | 30s poll         | 0 shown honestly               | KEEP                            |
| Markets          | Prices/spread/status       | Binance RWA API                  | REAL                       | Cached ~30s      | Categorized error shown        | KEEP                            |
| Markets/[ticker] | Snapshot fields            | Binance via API                  | REAL                       | 30s poll         | Unavailable per field          | KEEP                            |
| Markets/[ticker] | Price history chart        | — (none)                         | —                          | —                | "Historical data unavailable"  | KEEP (no fake chart)            |
| Opportunities    | Signal + reasons           | Opportunity engine               | DERIVED                    | Per scan         | Empty + reason                 | KEEP                            |
| Strategies       | Saved strategies           | User-created                     | USER-GENERATED             | On write         | Empty state                    | KEEP                            |
| Strategies       | Example text               | Static hint                      | HARDCODED (UI hint)        | Static           | n/a                            | KEEP (input guidance, not data) |
| Agent            | Loop state + last scan     | StrategyLoopWorker               | DERIVED                    | 30s poll         | lastRun error surfaced         | KEEP                            |
| Agent            | Activity timeline          | AgentEvent table                 | DATABASE                   | 20s poll         | Empty state                    | KEEP                            |
| Portfolio        | Balances/positions         | Wallet API                       | EXTERNAL API (provisioned) | On fetch         | Honest 503 setup state         | KEEP                            |
| Proposals        | Lifecycle fields           | Prisma                           | DATABASE                   | 15s poll         | Empty state                    | KEEP                            |
| Executions       | State timeline             | Broadcast + on-chain verify      | REAL (when it happens)     | 15s poll         | Empty state                    | KEEP                            |
| Executions       | BscScan link               | txHash from broadcast            | REAL                       | n/a              | Hidden when no hash            | KEEP                            |
| Wallet           | Status/limits/capabilities | `/api/wallet`                    | DERIVED                    | 60s poll         | NOT_CONFIGURED shown           | KEEP                            |
| Settings         | Policy/limits (read-only)  | Server config                    | HARDCODED (server env)     | Live             | n/a                            | KEEP                            |
| Status bar       | Service health             | `/api/system/status` real checks | DERIVED                    | 30s poll         | Degraded shown                 | KEEP                            |

## Removed/fixed during audit

| Screen           | Issue                                                    | Fix                                                 |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `/agent`         | Scan failures invisible (loop ACTIVE while scans error)  | lastRun error banner added (Phase 11 QA)            |
| Overview         | "UNKNOWN" shown when the actual state was NOT_CONFIGURED | Explicit NOT_CONFIGURED/WAITING states (Phase 10.1) |
| `/opportunities` | "No signals" implied the scanner ran when it never had   | "Market data unavailable" distinction (Phase 10.1)  |

## Explicitly not shown (by design)

Fake balances · sample positions · placeholder transaction hashes ·
demo PnL · "coming soon" cards · demo strategies preloaded to populate
screens.
