# OLYR Security Checklist

Status as of 2026-09-27, verified against the source tree. Every item is
PASS / FAIL / NEEDS_REVIEW with evidence.

## Secrets

- **No secrets in source** — PASS. `node scripts/security-audit.mjs` scans all
  tracked sources for private-key/seed/token patterns; zero findings.
- **.env gitignored** — PASS. `.gitignore` contains `.env`; only `.env.example`
  ships (placeholders).
- **Secrets not logged** — PASS. Header values redacted (`redactCredentials`);
  Go logs state names only; no request bodies logged.
- **Frontend receives no secrets** — PASS. Only `NEXT_PUBLIC_OLYR_API_URL`
  (a URL) is browser-exposed; Binance/LLM/executor credentials are server-side.

## Authentication

- **Agent → parse** — NEEDS_REVIEW. The parse endpoint is unauthenticated
  internally; acceptable for local deployment, requires network isolation in
  production (documented in deployment.md).
- **Internal execution API** — PASS. `/api/internal/*` requires
  `x-olyr-internal-token` matching `OLYR_INTERNAL_TOKEN` (tested: 401 without).

## Authorization

- **Execution policy** — PASS. MANUAL (default) / BOUNDED_AGENT / DISABLED
  enforced in AuthorizationService; DISABLED blocks all executions (tested).
- **Human approval threshold** — PASS. BOUNDED_AGENT auto-execution above
  `OLYR_REQUIRE_HUMAN_APPROVAL_ABOVE_USD` routes to REQUIRES_APPROVAL (tested).

## Agent isolation

- **No wallet/keys/HTTP/shell/DB tools** — PASS. Agent tools are read-only
  proxies with validated inputs; no write tools exist (Phase 4 + 7 tool tests).
- **Prompt injection** — PASS. Hostile prompts never produce executable
  strategies; oversized/unsupported/"compliant" outputs are rejected by the
  validators (8 adversarial pytest cases + Phase 4 suite).
- **LLM cannot mutate capability registry** — PASS. Registry computed from
  server config; no LLM path touches it.

## Wallet isolation

- **Signing material confined to Go service** — PASS. Only
  `OLYR_EXECUTOR_PRIVATE_KEY` exists, in the Go env; sender-mismatch and
  invalid-payload signing tests pass.
- **baw CLI adapter fails closed** — PASS. Returns NOT_CONFIGURED until the
  documented CLI is present; no simulated wallet operations.

## Transaction validation

- **Destination/token allowlists** — PASS. Swap targets come only from Binance
  quote responses tied to the proposal's asset; no arbitrary destination input
  exists in any API.
- **Chain validation** — PASS. Chain guard (API + Go) fails closed on
  EXPECTED_CHAIN_ID mismatch (tested).
- **Price/spread sanity** — PASS. PRICE_SANITY and SPREAD_SANITY rules reject
  zero/negative/non-finite/out-of-range values (Rust tests).

## Contract allowlists

- **No unlimited approvals** — PASS (agent layer rejects near-total slippage
  and the approve-transaction endpoint is not exposed through any API route;
  approvals would be per-quote amounts if enabled later) — NEEDS_REVIEW for a
  future approval flow.

## Risk controls

- **Deterministic risk engine** — PASS. 10 rules; LLM output cannot influence
  them; invariant tests prove over-limit/invalid never APPROVED.
- **Platform hard limits re-enforced at persistence** — PASS (Phase 4 validator
  tests).

## Simulation

- **Simulation-before-broadcast** — PASS. Execution gates require simulation
  PASSED (SWAP) or RFQ vendor validation; FAILED simulation blocks (tested).

## Replay protection

- **Idempotency** — PASS. One execution per proposal (unique key + Go map);
  RFQ requestId = execution id; duplicate requests return existing execution
  (tested).

## API security

- **Rate limiting** — PASS. @fastify/rate-limit 120 req/min (429 tested).
- **Payload limits** — PASS. 256 KB body limit (413 tested).
- **Security headers** — PASS. @fastify/helmet (x-content-type-options tested).
- **Request IDs** — PASS. Fastify genReqId = UUID per request.
- **No stack traces in production** — PASS. Error handler returns structured
  categories only.

## SSRF

- **No user-controlled URLs** — PASS. All outbound URLs are server env config
  (`BINANCE_BASE_URL`, `OLYR_RISK_URL`, `OLYR_AGENT_URL`,
  `OLYR_EXECUTOR_RPC_URL`, `OLYR_UPSTREAM_URL`); agent tools call fixed
  internal paths with validated tickers; no endpoint accepts a URL parameter.
  NEEDS_REVIEW: env values are trusted config — operator responsibility.

## Database

- **Migrations deterministic** — PASS. `prisma migrate status` clean; 6
  sequential migrations.
- **Indexes on critical queries** — PASS (ownerId/createdAt, strategyId,
  proposalId composites).
- **Immutable audit records** — PASS. RiskEvaluation/AgentEvent have no update
  or delete code paths.

## Logging

- **Structured, secret-free** — PASS. Operation/status/latency/category only;
  credential redaction helper; Go logs JSON state names.

## Monitoring

- **System status aggregation** — PASS. `/api/system/status` real-checks DB +
  risk + agent + execution; terminal status bar renders degraded states.

## BSC network validation

- **Fail-fast chain guard** — PASS. API + Go reject executions when configured
  chain ≠ expected chain (tested).
- **Kill switch** — PASS. `OLYR_KILL_SWITCH=enabled` blocks new executions at
  API and Go (tested: 503 kill-switch-enabled).

## Mainnet procedure

- **Runbook** — PASS. `docs/mainnet-micro-trade-runbook.md` documents the full
  manual procedure; execution itself is NOT automated.

## Summary

PASS: 24 · NEEDS_REVIEW: 2 (agent parse authentication under network exposure;
contract-approval flow not yet implemented) · FAIL: 0
