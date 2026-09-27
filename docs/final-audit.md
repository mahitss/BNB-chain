# OLYR Final Release Audit (Phase 10)

Verified against the repository at tag `v1.0.0` on 2026-09-27.

## Removed

- Stale `TODO(phase-2+)` comment in `packages/types/src/index.ts` (the contracts it referenced shipped in Phases 2–6).
- The Phase 1 static landing page and the interim `/rwa` route (superseded by the Phase 8 Overview and `/markets`).
- Temporary inline debug scripts used during earlier phases (all `scripts/tmp-*` codemods were deleted after use).
- Build artifacts (`server.exe`, `tsconfig.tsbuildinfo`) and `.gitignore` entries covering them.

## Retained (verified in use)

- All 5 services, 3 shared packages, 12 web routes, 14 API route groups.
- `docs/dev-report/` templates and log — a hackathon submission artifact.
- `services/risk-engine/.cargo/config.toml` — required Windows-gnu linker fix.
- `scripts/check-all.sh` — referenced by README for non-pnpm users.

## Known limitations (documented, intentional)

1. Portfolio/balances require Agentic Wallet provisioning (`/api/wallet/balances` → 503 otherwise); pages show setup states.
2. Historical charts display "unavailable" — only live snapshots exist; no fabricated history.
3. Simulation ids are timestamp-derived (the Binance Transaction API returns no simulation reference).
4. RFQ signing assumes EIP-712 with v=27/28; other vendor schemes untested.
5. Agent-loop dedup is process-local (single-instance design).
6. Scan store is in-memory — scanner results survive until restart only; execution-path records are fully persisted.
7. Settings page is read-only (no policy-management API exists yet).

## Known technical debt

- Agent-loop deduplication is process-local rather than Redis-shared.
- No WebSocket/SSE; polling at 15–60s intervals.
- Metrics counters are logged, not exported to a scrape endpoint.
- `docs/submission/screenshots.md` lists screenshots to capture — captures depend on a live-credentialed environment.

## Final architecture

Unchanged from Phase 9 (see `docs/architecture/phase-9-audit.md` and
`docs/architecture/final-architecture.md`). The constitutional boundary holds:
LLM = intent · deterministic validation · Rust = risk authority · Go =
execution orchestration · wallet = signing boundary · BSC = settlement ·
database = audit/state.
