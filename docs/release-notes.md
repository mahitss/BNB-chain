# OLYR Release Notes — v1.0.0

Release date: 2026-09-27. Hackathon submission build.

## Major capabilities

- **Market intelligence** — real Binance Web3 RWA data (6 documented RWA
  endpoints), deterministic spread/freshness/liquidity evaluation, official
  market-status reporting (never time-inferred).
- **Opportunity engine** — configurable thresholds produce OPPORTUNITY / WATCH
  / BLOCKED / DATA_UNAVAILABLE signals with per-signal reasons and warnings.
- **Strategy agent** — natural-language → strict validated schema
  (4-layer validation, clarification flow, adversarial hardening); LLM
  provider-abstracted; FakeLLMProvider tests-only.
- **Risk engine (Rust)** — 10 deterministic rules, APPROVED/REJECTED/
  REQUIRES_REVIEW with per-rule reasons; invariant-tested.
- **Controlled execution** — Binance Trading API quotes (RFQ + SWAP),
  Transaction API simulation, authorization policy (MANUAL default), kill
  switch, chain guard, idempotent expiring executions, on-chain verification.
- **Terminal UI** — 10-page production terminal with real-state-only rendering,
  explainability surfaces, global status bar, responsive layout.
- **Audit** — immutable persisted events and per-rule risk records for every
  pipeline stage.

## Integrations

Binance Web3 API (RWA Data, Market, Trading incl. RFQ, Transaction, Wallet) ·
Agentic Wallet adapter (preflight; fails closed) · LLM providers
(OpenAI-compatible) · PostgreSQL/Prisma · Redis (optional).

## Security architecture

See [security.md](security.md) and [security-checklist.md](security-checklist.md)
(24 PASS / 2 NEEDS_REVIEW / 0 FAIL). Constitutional boundary: the LLM is
intent interpretation only — risk authority is deterministic Rust; the only
signer is the Go service; the browser never touches backend services.

## Known limitations

- Live Binance/LLM/wallet verification requires credentials not present in
  the build environment; **mainnet execution not verified**.
- Portfolio/balances require Agentic Wallet provisioning (honest 503 states).
- Historical charts unavailable until scan history accumulates.
- Scan store in-memory; agent-loop dedup process-local.
- Simulation ids are timestamp-derived (no API reference returned).

## Testing status

168 TypeScript tests, 45 Python tests, 19 Rust tests, Go test packages —
all green. Security scanner: zero findings. Production builds (Next.js,
tsc, cargo --release, CGO_ENABLED=0 Go) all succeed. `pnpm verify` runs the
complete safe pipeline and never broadcasts.
