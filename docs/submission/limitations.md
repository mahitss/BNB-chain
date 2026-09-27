# OLYR Limitations

Factual as of v1.0.0 (2026-09-27). Nothing here is hidden; these are the
honest boundaries of the current build.

## Live verification

- **Mainnet execution not verified.** No transaction has ever been broadcast
  from this codebase. The full path (quote → simulation → authorization →
  broadcast → confirmation) is implemented and unit/integration tested with
  fixtures, but requires Binance credentials, a funded dedicated wallet, and
  explicit human authorization to exercise for real.
- Agentic Wallet flows require a Binance App account + QR sign-in; the `baw`
  CLI command surface (SKILL.md) was unreachable from the build environment,
  so the adapter implements preflight and fails closed.

## Data

- Scan history is in-memory (per process); restart clears the latest scan
  snapshot cache. Execution-path records (proposals, evaluations, quotes,
  simulations, authorizations, executions, events) are fully persisted.
- Historical price/divergence charts show "unavailable" until enough real
  scan history accumulates — charts are never fabricated.
- Portfolio returns honest 503s until the Agentic Wallet is provisioned;
  PnL is not computed (no cost-basis tracking).

## Architecture

- Agent-loop deduplication is process-local (single-instance design); a
  multi-instance deployment should enable the Redis lease and share state.
- No WebSocket/SSE — controlled polling (15–60s per page).
- Metrics counters are logged, not exported to a metrics endpoint.
- Settings page is read-only; policy management endpoints do not exist yet.
- Simulation ids are timestamp-derived; the Transaction API returns no
  simulation reference to persist.
- RFQ signing assumes EIP-712 with v=27/28; other vendor schemes untested.

## Intelligence

- Market state comes from Binance's official statusInfo when available; the
  NYSE calendar fallback covers 2025–2027 and must be rolled forward yearly.
- Default thresholds (50/150 bp watch/opportunity) are starting points —
  real-market calibration is pending live data.
- The reference price reported by Binance is a per-share conversion derived
  from the on-chain token price, not an official stock-market quote — OLYR
  labels it as such everywhere.
