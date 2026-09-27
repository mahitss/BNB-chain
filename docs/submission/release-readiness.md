# OLYR Release Readiness (v1.0.0)

Verified 2026-09-27 against the repository at tag v1.0.0. Evidence points to
in-repo files, tests, or live verification runs.

| Category           | Status                             | Evidence                                                                                                                                                                                                            |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core Product       | READY                              | All 10 terminal pages + 3 detail views render real backend state; overview/market/opportunity/strategy/proposal/execution/wallet flows verified live (honest states without credentials). `apps/web`, `pnpm build`. |
| Market Data        | READY*                             | 6 documented RWA endpoints integrated, normalized, cached; live Binance verification pending credentials (`/ready?probe=1`). *Data path fully implemented; live call unverified.                                    |
| Opportunity Engine | READY                              | Deterministic signals with reasons/warnings; 40 TS tests + invariant-style coverage; boundary tests at thresholds.                                                                                                  |
| Strategy Agent     | READY                              | 45 pytest incl. adversarial injection matrix; 4-layer validation; clarification flow; fails safe on malformed output.                                                                                               |
| Risk Engine        | READY                              | Rust clippy -D warnings; 19 tests incl. invariants (over-limit never approved); deterministic; no LLM/I-O.                                                                                                          |
| Trading            | READY (code) / NEEDS REVIEW (live) | Quote + swap construction implemented per documented API; live gateway call unverified (no credentials).                                                                                                            |
| Simulation         | READY (code) / NEEDS REVIEW (live) | Mandatory SWAP-mode gate; RFQ vendor-validated; simulation REQUIRED before broadcast (tested).                                                                                                                      |
| Wallet             | NEEDS REVIEW                       | Adapter fails closed NOT_CONFIGURED; baw CLI SKILL.md unreachable from build environment; provisioning requires Binance App + QR sign-in.                                                                           |
| Execution          | READY (code) / NEEDS REVIEW (live) | Go state machine, idempotency, kill switch, chain guard, go-ethereum signing; broadcast path unverified live.                                                                                                       |
| Portfolio          | NEEDS REVIEW                       | Honest 503 states until wallet provisioning; balances endpoint implemented against documented Wallet API.                                                                                                           |
| Security           | READY                              | Security checklist 24 PASS / 2 NEEDS_REVIEW / 0 FAIL; scanner zero findings; adversarial tests green; kill switch + chain guard tested.                                                                             |
| Observability      | READY                              | Structured JSON logs with request ids; /health + /readiness per service; /api/system/status aggregation; audit events persisted. Metrics export not yet present.                                                    |
| Frontend           | READY                              | Next 16 production build clean; responsive shell + status bar; 13 logic tests; hydration-safe client pages.                                                                                                         |
| Backend            | READY                              | Fastify hardening (helmet, rate-limit, body limit); Prisma migrations current; graceful shutdown all services.                                                                                                      |
| Deployment         | READY                              | docs/deployment.md documents order/env/health; Dockerfiles production-shaped; no credentials committed; manual deploy only.                                                                                         |
| Documentation      | READY                              | README final; architecture (Mermaid) + phase-9 audit + API reference + security + tech-stack + runbooks + checklist + release notes.                                                                                |
| Demo               | READY                              | docs/demo-runbook.md + demo-script.md verified against running services; honest-state demo is the fallback story.                                                                                                   |
| Testing            | READY                              | pnpm verify pipeline: format/lint/typecheck/168 TS tests/45 Python/19 Rust/Go + security audit — all green.                                                                                                         |

## Summary

- **READY:** Core Product, Market Data (code), Opportunity Engine, Strategy
  Agent, Risk Engine, Trading (code), Simulation (code), Execution (code),
  Security, Observability, Frontend, Backend, Deployment, Documentation, Demo,
  Testing.
- **NEEDS REVIEW:** Wallet (provisioning), Portfolio (wallet-dependent), Live
  micro-trade (credentials + funded wallet + manual authorization per runbook).
- **BLOCKED:** none.
