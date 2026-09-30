# OLYR Test Report — v1.0.0

Run: 2026-09-30 · Command: `pnpm verify` (format → lint → typecheck → tests →
build → security audit) plus language-specific suites. Exit code: 0.

## Results

| Suite                    | Command                             | Tests      | Result |
| ------------------------ | ----------------------------------- | ---------- | ------ |
| Frontend logic           | `pnpm --filter @olyr/web test`      | 13         | PASS   |
| Shared config            | `pnpm --filter @olyr/config test`   | 9          | PASS   |
| Shared types             | `pnpm --filter @olyr/types test`    | 6          | PASS   |
| API (Fastify + pipeline) | `pnpm --filter @olyr/api test`      | 106        | PASS   |
| Python agent             | `pytest services/agent/tests -q`    | 45         | PASS   |
| Rust risk engine         | `cargo test --test risk_rules`      | 19         | PASS   |
| Go execution             | `go test ./...`                     | 2 packages | PASS   |
| TypeScript typecheck     | `pnpm typecheck`                    | —          | PASS   |
| ESLint                   | `pnpm lint`                         | —          | PASS   |
| Prettier                 | `pnpm format:check`                 | —          | PASS   |
| Production build         | `pnpm build` (web + api + packages) | —          | PASS   |
| Prisma migrations        | `prisma migrate status`             | 6 applied  | PASS   |
| Security audit           | `node scripts/security-audit.mjs`   | 0 findings | PASS   |

Total automated tests: **213** (174 TypeScript, 45 Python, 19 Rust, plus Go
packages). All green at v1.0.0.

## Coverage highlights

- Adversarial prompt-injection matrix (hostile prompts never produce
  executable strategies)
- Risk rule boundaries (exactly-at / just-above limits) + invariants
  (over-limit/invalid never APPROVED; deterministic evaluation)
- Authorization scope binding (stale-quote authorization blocked)
- Execution state machine (illegal transitions rejected; terminal states
  terminal)
- Hermetic pipeline tests (developer .env cannot leak network calls into
  tests)

## Known gaps (not tested)

- Live Binance gateway calls with valid credentials (credentials not
  provisioned in the build environment — see docs/mainnet/micro-trade-blocker.md)
- Live mainnet broadcast (forbidden without explicit human authorization;
  runbook prepared)
- Agentic Wallet CLI operations (baw CLI not provisioned)
- Browser DOM interaction (logic tested; visual QA performed manually)
