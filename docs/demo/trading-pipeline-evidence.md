# Trading Pipeline Evidence — Phase 10.3

Per-stage evidence for the controlled trace:
Market → Opportunity → Strategy → Proposal → Risk → Quote → Unsigned tx →
Simulation → Authorization (**STOP — no broadcast**).

> This file records the state captured during the controlled verification run
> of 2026-09-28/29 in the local development environment. Live market data was
> BLOCKED by missing valid Binance credentials at the time of capture; stages
> that require it are marked accordingly. Secrets are never recorded here.

## Stage 1 — Market data

- **Status**: BLOCKED_BY_CREDENTIALS
- **Source**: Binance Web3 Market API (`/build/api/v1/dex/market/rwa/*`)
- **Evidence**: `GET /api/diagnostics/binance/probe` → real signed request →
  gateway responded `40101 Invalid API Key` → categorized
  `AUTHENTICATION_FAILED`. The signing/transport chain is proven; the data
  payload requires valid credentials.

## Stage 2 — Opportunity

- **Status**: BLOCKED_BY_CREDENTIALS (depends on stage 1)
- **Evidence**: `GET /api/opportunities` →
  `{"configurationStatus": "NOT_CONFIGURED", "opportunities": []}` — the UI
  distinguishes "market data unavailable" from "no signals" (Phase 10.1 fix).

## Stage 3 — Strategy

- **Status**: PASS
- **Identifier**: canonical NVDA watcher strategy (dev database)
- **Evidence**: 4-layer validation (schema → semantic → capability → safety)
  plus the adversarial suite (45+ pytest cases) — hostile prompts and
  injected oversized/unsupported strategies are rejected.

## Stage 4 — Proposal

- **Status**: PASS (created) then REJECTED by design
- **Identifier**: proposal linked to the canonical strategy
- **Evidence**: `POST /api/proposals` → PENDING_RISK; with no live market
  data the snapshot prices are null and the risk engine honestly REJECTS:
  "estimatedPrice is required for this action but was missing." No value is
  invented to force an APPROVED path.

## Stage 5 — Risk

- **Status**: PASS (code) — decision REJECTED in the no-credential capture
- **Evidence**: Rust `/evaluate`; 19 tests incl. invariants (over-limit,
  invalid-price, disallowed-asset never APPROVED); exact per-rule reason
  returned and persisted.

## Stage 6 — Quote

- **Status**: IMPLEMENTED, blocked by credentials for live data
- **Evidence**: `POST /api/quotes` requires an APPROVED proposal; quote
  stored with ~30s TTL; contract verified against the OpenAPI schema.

## Stage 7 — Unsigned transaction

- **Status**: IMPLEMENTED, blocked by credentials for live data
- **Evidence**: `/aggregator/swap` returns the unsigned `tx` (SWAP) or RFQ
  typed data; stored bound to the quote; never signed by Node.

## Stage 8 — Simulation

- **Status**: IMPLEMENTED, blocked by credentials for live data
- **Evidence**: SWAP mode requires PASSED before authorization; RFQ is
  vendor-validated at submission.

## Stage 9 — Authorization

- **Status**: IMPLEMENTED — gate verified with unit tests
- **Evidence**: authorization bound to proposal + quote (Phase 10.3 binding
  checks); stale-quote authorizations blocked; REJECTED decisions block;
  execution idempotency prevents duplicates.

## Stage 10 — Broadcast

- **Status**: NOT PERFORMED
- **Evidence**: broadcast is behind the Go execution service and the manual
  mainnet runbook (docs/mainnet-micro-trade-runbook.md). No transaction has
  ever been broadcast from OLYR.
