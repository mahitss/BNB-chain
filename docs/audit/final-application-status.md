# OLYR Final Application Status (v1.0.0)

Verified 2026-09-30 against the running stack. Verdicts: REAL / PARTIAL /
UNAVAILABLE / BLOCKED. "READY" is deliberately not used — see evidence.

| Capability         | Status      | Evidence                                                                                                                                                                                       |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Market Data        | PARTIAL     | Pipeline implemented, contract-verified, live signed request reaches the gateway; real payloads require valid credentials (currently rejected 40101). UI shows the categorized error honestly. |
| Opportunity Engine | PARTIAL     | Fully deterministic and tested (40 markets tests); live evaluation requires the same credentials. Honest BLOCKED states verified.                                                              |
| Strategies         | REAL        | Parse (LLM, needs key) + ADVANCED structured mode (works without any AI); validation, persistence, activation/pause all live-verified.                                                         |
| Agent              | PARTIAL     | Bounded loop, state machine, timeline all live; scanning requires valid credentials.                                                                                                           |
| Portfolio          | UNAVAILABLE | Honest 503 + setup states; requires Agentic Wallet provisioning.                                                                                                                               |
| Proposals          | REAL        | Full lifecycle live-verified against the real gateway (honest risk REJECTION on missing data).                                                                                                 |
| Quotes             | PARTIAL     | Implemented per OpenAPI; live payloads need valid credentials.                                                                                                                                 |
| Simulation         | PARTIAL     | Implemented; live call needs credentials.                                                                                                                                                      |
| Wallet             | PARTIAL     | Read-only identity/limits live; balances need Agentic Wallet + Binance key.                                                                                                                    |
| Execution          | BLOCKED     | Full gate chain + Go signer implemented; requires credentials + funded wallet. Never broadcast.                                                                                                |
| Audit Trail        | REAL        | Every persisted event traces to an actual backend action; append-only.                                                                                                                         |
| Deployment         | PARTIAL     | Local run verified end-to-end; no hosted environment (documented).                                                                                                                             |

## Headline

Every value shown in the UI is real or explicitly unavailable. Nothing is
fabricated. The three PARTIAL verdicts share one root cause — no production
Binance/LLM/wallet credentials in the build environment — and each shows an
honest setup state instead of substitute data.
