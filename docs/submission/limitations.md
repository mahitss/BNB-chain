# OLYR Limitations (v1.0.0 — Submission Freeze)

Factual as of the freeze date. Each limitation is real; none is hidden.

## Live verification

- **No live Binance data verified.** The configured credentials are rejected
  by the gateway (40101) — the key needs Web3 API enablement via the
  Developer Portal. Every downstream stage is contract-tested with fixtures
  and blocked honestly in the running product.
- **No mainnet transaction broadcast.** The full path is implemented and
  gated; execution requires a funded dedicated wallet and explicit human
  authorization per docs/mainnet-micro-trade-runbook.md (not performed).

## Market data

- Reference price is Binance's derived per-share conversion, not an official
  exchange quote — labeled as such everywhere.
- One update timestamp per token record (prices derive from it); no
  independent reference-price timestamp exists in the API.
- No WebSocket for RWA prices — controlled polling (15–60s).
- Historical charts are unavailable until real scan history accumulates;
  OLYR never fabricates chart points.

## Opportunity engine

- Scan results are held in memory per process; a restart clears the latest
  snapshot cache (execution-path records are fully persisted in Postgres).
- Thresholds (50/150 bp defaults) are starting points pending live-data
  calibration.
- Agent-loop deduplication is process-local; multi-instance deployments
  should enable the Redis lease.

## Strategies / agent

- Strategy DSL supports 6 fields, 6 operators, 6 actions — deliberately
  small; unsupported requests are rejected, not translated.
- LLM parsing requires a provider key; without one the builder falls back to
  the ADVANCED structured form (no fabrication).
- Clarification quality depends on the configured model (untested with a
  live model — FakeLLMProvider only).

## Wallet / execution

- Agentic Wallet integration fails closed until the `baw` CLI is installed,
  signed in, and its command surface confirmed (SKILL.md was unreachable
  from the build environment).
- Portfolio/balances return honest 503 states until provisioning; PnL is not
  computed (no cost-basis tracking).
- Simulation ids are timestamp-derived (the Transaction API returns no
  simulation reference).
- RFQ signing assumes EIP-712 with v=27/28; other vendor schemes untested.

## Risk / limits

- Risk-engine limits (trade/daily/slippage) are env-configured but their
  management UI is read-only (no policy API yet).
- The NYSE holiday list covers 2025–2027 and must be rolled forward.
- Daily-exposure tracking is per-request until execution history exists.

## Deployment

- No hosted environment — local run verified; production procedure
  documented (docs/deployment.md). `NEXT_PUBLIC_OLYR_API_URL` must be set at
  build time for the frontend.
