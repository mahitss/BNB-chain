# Mainnet Micro-Trade — Pre-Flight Audit

Date: 2026-09-29 · Environment: local development stack, BSC mainnet target
(chain 56). Evidence gathered from live processes and configuration — values
of secrets never printed.

## Verdict: BLOCKED — do not proceed to broadcast

Three independent gates fail. Every check below was executed against the
running stack; nothing is assumed.

## Configuration checks

| Check                             | Status | Evidence                                                                                                   |
| --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| Kill switch OFF                   | PASS   | `OLYR_KILL_SWITCH` empty in .env; `/api/agent/state` shows loop enabled, no kill-switch block              |
| Expected chain = 56 (BSC mainnet) | PASS   | `EXPECTED_CHAIN_ID=56`, `EXPECTED_NETWORK=mainnet` in .env; chain guard active in API + Go                 |
| Execution policy MANUAL           | PASS   | `OLYR_EXECUTION_POLICY` unset → default MANUAL                                                             |
| Max trade $25 / daily $100        | PASS   | `OLYR_MAX_TRADE_USD`/`OLYR_MAX_DAILY_TRADE_USD` defaults active; enforced by Rust engine + Fastify         |
| Slippage limit 1%                 | PASS   | `OLYR_MAX_SLIPPAGE_PERCENT` default active                                                                 |
| Asset allowlist                   | PASS   | Empty = default spot set; a single allowlisted asset must be configured before the trade (operator action) |

## Service checks

| Check               | Status           | Evidence                                                                                                                                                                                             |
| ------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                 | PASS             | `/health` 200; request ids + structured errors live                                                                                                                                                  |
| Risk engine         | PASS             | `/readiness` 200, 10 rules loaded; 19 tests green                                                                                                                                                    |
| Agent               | PASS             | `/readiness` 200; parsing disabled without LLM key (safe fallback)                                                                                                                                   |
| Execution service   | PASS             | Running; `/readiness` 503 is CORRECT — signing not configured (no executor key)                                                                                                                      |
| Database            | FAIL → recovered | Postgres was down mid-audit (Docker Desktop auto-shutdown); `docker compose up -d postgres` restored it; `/api/system/status` now `database: ok`. **Docker must be kept running for mainnet.**       |
| Binance credentials | FAIL             | `CONFIGURED` but live probe → real gateway → `40101 Invalid API Key` (`AUTHENTICATION_FAILED`). The key is rejected by Binance itself — not a client error (raw differential request reproduced it). |

## Execution-path checks

| Check                            | Status      | Evidence                                                                                                                                                                   |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid Binance credentials        | **BLOCKED** | 40101 from the live gateway with the configured key. Operator must enable Web3 API access for the key in the Binance Developer Portal or provision a new key.              |
| Funded dedicated executor wallet | **BLOCKED** | `OLYR_EXECUTOR_PRIVATE_KEY`/`OLYR_EXECUTOR_ADDRESS` unset; execution readiness 503 (fail-closed). Operator must provision a dedicated wallet with ~20 USDT + 0.05 BNB gas. |
| Real quote                       | **BLOCKED** | Downstream of credentials.                                                                                                                                                 |
| Real simulation                  | **BLOCKED** | Downstream of credentials.                                                                                                                                                 |
| Fresh proposal (APPROVED)        | BLOCKED     | Risk engine honestly REJECTS without live prices.                                                                                                                          |
| Human authorization              | NOT REACHED | Gate chain incomplete.                                                                                                                                                     |

## Required operator actions (in order)

1. Enable the Binance Web3 API for the account/key (Developer Portal) and
   replace the rejected key in `.env`.
2. Provision a dedicated executor wallet; set `OLYR_EXECUTOR_PRIVATE_KEY` /
   `OLYR_EXECUTOR_ADDRESS` (server-side only).
3. Fund it with tiny amounts (≤ the configured $10 human-approval threshold).
4. Configure `OLYR_ALLOWED_ASSETS` to exactly one tokenized asset.
5. Restart the stack; re-run this preflight — every check must be PASS before
   following `docs/mainnet-micro-trade-runbook.md`.
