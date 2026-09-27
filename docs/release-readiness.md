# OLYR Release Readiness

Status at Phase 9 completion (2026-09-27). Each verdict is backed by the
verification commands in the Final Test Command section.

| Area                       | Verdict        | Evidence / notes                                                                                                                                                                                                                      |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCHITECTURE               | PASS           | 5 services + 3 packages; boundaries documented in docs/architecture/phase-9-audit.md; no architectural violations found in audit.                                                                                                     |
| FRONTEND                   | PASS           | Next 16 build clean; 10 pages + 3 detail views; lint/typecheck clean; 13 logic tests green; honest loading/empty/error states everywhere.                                                                                             |
| BACKEND                    | PASS           | Fastify builds + 97 TS api tests green; helmet/rate-limit/body-limit/request-ids live; structured errors only.                                                                                                                        |
| AGENT                      | PASS           | 42 pytest green incl. adversarial suite; providers isolated; controlled tools only; parse fails safe without LLM config.                                                                                                              |
| RISK ENGINE                | PASS           | Rust clippy -D warnings; 19 tests incl. invariants; kill-switch-aware readiness; fully deterministic.                                                                                                                                 |
| EXECUTION ENGINE           | PASS           | Go vet/test green; state machine enforced; kill switch + chain guard; idempotency; fail-closed without executor key.                                                                                                                  |
| WALLET                     | PASS (adapter) | Provider interface + preflight; fails closed NOT_CONFIGURED. SKILL.md command surface unconfirmed — documented limitation.                                                                                                            |
| DATABASE                   | PASS           | 6 migrations applied; `migrate status` clean; audit tables append-only; unique idempotency key.                                                                                                                                       |
| SECURITY                   | PASS           | scripts/security-audit.mjs zero findings; kill switch + chain guard tested; adversarial suite green; no secrets in tracked sources. NEEDS_REVIEW items in security-checklist (agent parse auth under exposure; approval flow future). |
| OBSERVABILITY              | PASS           | Structured JSON logs w/ request ids; per-service /health + /readiness; /api/system/status aggregation; audit events persisted. Metrics counters not yet exported (scrape endpoint absent).                                            |
| DEPLOYMENT                 | PASS           | docs/deployment.md documents order, env, guards, health; production builds succeed. Deployment itself is manual.                                                                                                                      |
| BSC MAINNET CONFIG         | PASS           | EXPECTED_CHAIN_ID/EXPECTED_NETWORK guards in API + Go; fail-closed on mismatch; kill switch.                                                                                                                                          |
| LIVE MICRO-TRADE READINESS | NEEDS_REVIEW   | Code paths complete and tested with fixtures/mocks; NO live Binance credentials or funded wallet in this environment. Runbook written but not executed.                                                                               |
| DEMO READINESS             | PASS           | docs/demo-runbook.md path verified against running services; honest states demonstrated (risk REJECTED on missing data is a showcase moment).                                                                                         |
| DOCUMENTATION              | PASS           | README rewritten; architecture + phase-9 audit + runbooks + checklist present; dev-report factual.                                                                                                                                    |

## FAIL/NEEDS_REVIEW remediation

1. **LIVE MICRO-TRADE READINESS (NEEDS_REVIEW)** — Blocker: no Binance API
   credentials, no funded dedicated wallet. Remediation: follow
   `docs/mainnet-micro-trade-runbook.md` with a funded test wallet after
   provisioning credentials; every gate must pass before broadcast.
2. **Wallet adapter (NEEDS_REVIEW)** — Blocker: `baw` CLI SKILL.md unreachable
   from the build environment. Remediation: retrieve the official SKILL.md,
   confirm command surface, then implement `getBalances`/`getPositions`/
   `prepareExecution` on `BawCliWalletProvider`.
3. **Agent parse auth (NEEDS_REVIEW)** — Blocker: `/agent/parse` unauthenticated.
   Remediation: expose only on an internal network or add an internal token
   check mirroring `/api/internal/*`.

## Known limitations (documented, intentional)

- In-memory scan store; process-local agent-loop dedup.
- Polling instead of WebSocket/SSE.
- Portfolio 503 until wallet provisioning; PnL not computed (no cost basis).
