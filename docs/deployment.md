# OLYR Deployment

Manual deployment guide. OLYR does not auto-deploy; no credentials or
infrastructure are committed.

## Deployment order (dependencies flow downward)

1. **PostgreSQL** — provision, apply migrations:
   `cd apps/api && npx prisma migrate deploy`
2. **Redis** (optional — cache/locks; without it the API falls back to
   in-memory cache and local-only locks)
3. **Rust risk engine** — `cargo build --release` → run with risk limits env;
   verify `GET /readiness` reports `rules_loaded: 10`
4. **Python agent** — install `requirements.txt`, set LLM provider vars
   (parsing disabled if unset — safe fallback); verify `GET /readiness`
5. **Go execution service** — build with `CGO_ENABLED=0 go build`; set
   `OLYR_UPSTREAM_URL`, `OLYR_INTERNAL_TOKEN`, `EXPECTED_CHAIN_ID=56`,
   `EXPECTED_NETWORK=mainnet`, `OLYR_EXECUTOR_*`; verify `GET /readiness`
   (ready=true requires the executor key)
6. **Fastify API** — set `DATABASE_URL`, `OLYR_RISK_URL`, `OLYR_AGENT_URL`,
   `OLYR_EXECUTION_URL`, `OLYR_INTERNAL_TOKEN` (same secret as Go),
   Binance credentials, limits; verify `/ready` and `/api/system/status`
7. **Next.js frontend** — build with `NEXT_PUBLIC_OLYR_API_URL` pointing at
   the API's public HTTPS origin; serve behind HTTPS

## Startup guards (fail-fast)

- API: refuses executions when `DATABASE_URL` missing (503) — starts otherwise
- Go service: kill switch + chain guard checked per request; private key
  absence fails closed per request (503)
- Chain mismatch (`BINANCE_CHAIN_ID` vs `EXPECTED_CHAIN_ID`) blocks execution
  with 403 chain-guard

## Environment variables

See `.env.example` for the complete annotated list. Server-side only (never
exposed to the browser): `BINANCE_API_KEY/SECRET`, `OLYR_LLM_API_KEY`,
`OLYR_EXECUTOR_PRIVATE_KEY`, `DATABASE_URL`, `REDIS_URL`, `OLYR_INTERNAL_TOKEN`.
Browser-visible: `NEXT_PUBLIC_OLYR_API_URL` only.

## Health / readiness

| Service     | Health (alive) | Readiness (can function)                  |
| ----------- | -------------- | ----------------------------------------- |
| API         | `/health`      | `/ready` (+`?probe=1` live Binance check) |
| Agent       | `/health`      | `/readiness` (LLM provider configured)    |
| Risk engine | `/health`      | `/readiness` (rules loaded)               |
| Execution   | `/health`      | `/readiness` (executor key configured)    |

`/api/system/status` aggregates all of the above for the terminal status bar.

## HTTPS & headers

Terminate TLS at the reverse proxy. The API sets helmet security headers;
CORS reflects allowed origins (configure your proxy to forward `Origin`).
`NEXT_PUBLIC_*` is the only class of variable exposed to the browser.

## CI/CD

GitHub Actions runs lint/typecheck/tests/build per language plus a security
audit job on every push/PR. Deployment is not automated; live trades are
forbidden in CI by design (no credentials are ever present).
