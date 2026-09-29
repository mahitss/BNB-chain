# Trading + Execution Pipeline Verification

Phase 10.3 — verification that OLYR can move from real market data through
proposal, risk, quote, unsigned transaction, simulation, and authorization —
**without broadcasting** — for every stage, with evidence.

Trace target:

```
Market → Opportunity → Strategy → Proposal → Risk → Quote → Unsigned tx
→ Simulation → Authorization → (STOP — broadcast is manually controlled)
```

## Stage evidence

| #   | Stage         | Status                 | Identifier                            | Source                          | Evidence                                                                                                                           |
| --- | ------------- | ---------------------- | ------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Market data   | BLOCKED_BY_CREDENTIALS | —                                     | Binance Web3 Market API         | Live probe reached the gateway; credentials rejected (`40101 Invalid API Key`) — see docs/integrations/binance-rwa-verification.md |
| 2   | Opportunity   | BLOCKED_BY_CREDENTIALS | —                                     | Opportunity Engine              | `/api/opportunities` returns `configurationStatus: NOT_CONFIGURED`; engine untested against live data, unit tests green            |
| 3   | Strategy      | PASS                   | canonical NVDA watcher (dev DB)       | Strategy Registry (Prisma)      | 4-layer validation; adversarial suite green                                                                                        |
| 4   | Proposal      | PASS                   | proposal linked to canonical strategy | TradeProposal (Prisma)          | Created; risk REJECTED on missing price — honest behavior without live data                                                        |
| 5   | Risk          | PASS (code)            | —                                     | Rust `/evaluate`                | 10 rules; REJECTED with exact reason "estimatedPrice is required" — correct fail-closed                                            |
| 6   | Quote         | BLOCKED_BY_CREDENTIALS | —                                     | Trading API `/aggregator/quote` | Requires valid credentials; documented contract implemented + unit tested                                                          |
| 7   | Unsigned tx   | PASS (code)            | —                                     | `/aggregator/swap` response     | Stored as `SwapPreparation` bound to the quote; never signed by Node                                                               |
| 8   | Simulation    | PASS (code)            | —                                     | `/pre-transaction/simulate`     | SWAP-mode gate requires PASSED; RFQ vendor-validated                                                                               |
| 9   | Authorization | PASS (code)            | authorization id                      | ExecutionAuthorization          | Bound to proposal + quote; REJECTED decisions block; stale-quote authorizations invalidated                                        |
| 10  | Broadcast     | NOT PERFORMED          | —                                     | —                               | Behind the Go execution service; manual only                                                                                       |

## Stages proven with the real gateway (live)

- **Signed-request round trip**: real HMAC-SHA256 request to
  `/build/api/v1/dex/balance/all-token-balances-by-address` → gateway
  processed it → documented `40101 Invalid API Key` envelope → categorized
  `AUTHENTICATION_FAILED`. Proves: signing algorithm, headers, `/build`
  prefix, timestamp format, envelope parsing, and error categorization.

## Stages blocked solely by credentials

Stages 1, 2, 6 (live data portion): the exact same code paths are
unit/integration tested with fixtures. Provisioning credentials and
re-running the probe is the only remaining step for live market data.

## Security boundaries verified in this trace

- Node/TypeScript never signs; the Go service is the sole signer.
- The browser never touches Binance; only the token-guarded internal API is
  reachable by the Go service.
- Authorization is bound to the proposal AND the quote (Phase 10.3 binding
  checks); stale authorizations cannot execute.
- Simulation must belong to the current quote; a new quote invalidates it.
- The kill switch and chain guard block new executions regardless of state.
