# OLYR Demo Runbook (3–4 minutes)

A guided demonstration path using **real system states only**. Every screen
shown comes from the running services; where the environment has no live
credentials, the demo shows the honest setup state and explains why — that
honesty is itself a feature.

## Setup (before the demo)

1. `docker compose up -d postgres` + `cd apps/api && npx prisma migrate deploy`
2. `pnpm build` (all TS) — start: API (:4000), agent (:8000), risk engine (:8002)
3. `cd apps/web && npx next start` (:3000)
4. Optional (if credentials exist): set Binance + LLM env vars and restart the
   API/agent so live data and parsing work.

## Demo path

1. **Overview (`/`)** — point out the market status tiles (US equities from the
   NYSE calendar, on-chain observability from the last real scan) and the
   global status bar (every service state is a live health check).
2. **Markets (`/markets`)** — real tokenized-stock data from the Binance Web3
   Market API: reference vs on-chain prices, spread, official market status.
   Use search to find one asset.
3. **Asset detail (click a ticker)** — spread, freshness, liquidity with pool
   counts, official market state. Note the "Historical data unavailable"
   honesty on charts.
4. **Opportunities (`/opportunities`)** — deterministic divergence signals
   grouped by status; open one and show "Why this was detected" and "What
   prevents execution" — every line is a structured rule result.
5. **Strategies (`/strategies`)** — type a natural-language request ("Watch
   NVDA when the US market is closed and alert me when divergence exceeds
   1.5%") → ANALYZE → show the structured preview. If no LLM key is
   configured, show the explicit setup message and switch to ADVANCED mode to
   build a strategy from structured fields.
6. **Proposals (`/proposals`)** — create a proposal from the saved strategy
   (`POST /api/proposals`), run risk evaluation live against the Rust engine.
   Without Binance data the risk engine rejects with "estimatedPrice is
   required" — pause on this: _the system refuses to trade on missing data
   rather than inventing it._
7. **Agent (`/agent`)** — loop status, observations, persisted activity
   timeline.
8. **Wallet (`/wallet`)** — capability checklist (execution FALSE by default),
   official skill allowlist, limits.
9. **Security story** — close on the architecture: LLM = intent only;
   deterministic Rust risk authority; Go = only signer; kill switch; chain
   guard; idempotent, expiring, simulation-gated execution. Point at
   `docs/security-checklist.md`.

## With full credentials (optional, if configured)

- Live data flows end-to-end: assets show real prices → opportunities show
  real divergences → proposals pass risk → quote → simulation PASSED → the
  APPROVE & EXECUTE button appears → execution timeline → CONFIRMED only after
  on-chain verification.
- For a real micro-trade, follow `docs/mainnet-micro-trade-runbook.md` — that
  is a separate, explicitly authorized manual procedure, never part of this demo.

## Honesty rules (non-negotiable)

- No fabricated prices, signals, transaction hashes, or "confirmed" states.
- Empty data shows "no data" with the reason; broken services show DEGRADED in
  the status bar.
- Fixtures exist only in test suites, labeled `_fixture: true` — never in the UI.
