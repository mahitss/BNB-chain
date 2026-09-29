# OLYR Final Mainnet Status (v1.0.0)

Date: 2026-09-29 · Target: BSC mainnet (chain 56) · Verdict source:
docs/mainnet/micro-trade-preflight.md + live verification runs.

| Check                         | Status           | Evidence                                                                                                                                 |
| ----------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| REAL DATA                     | FAIL             | Live gateway reachable (signed request proven) but credentials rejected: 40101 Invalid API Key. Requires valid Binance Web3 credentials. |
| REAL QUOTE                    | FAIL             | Downstream of REAL DATA; the same path is contract-verified and unit-tested with fixtures.                                               |
| REAL TRANSACTION CONSTRUCTION | FAIL             | Downstream of REAL DATA; `/aggregator/swap` implemented per OpenAPI, stored bound to the quote.                                          |
| REAL SIMULATION               | FAIL             | Downstream of REAL DATA; `/pre-transaction/simulate` implemented; SWAP-mode PASSED required by the gate.                                 |
| HUMAN AUTHORIZATION           | PASS (mechanism) | MANUAL policy enforced; authorization bound to proposal + quote; threshold routing tested. The human decision itself awaits a live run.  |
| MAINNET BROADCAST             | FAIL (by design) | Implemented behind the Go service; requires all prior stages. Never invoked — no credentials, no funded wallet.                          |
| BSC CONFIRMATION              | FAIL             | Downstream of broadcast; `/aggregator/history` verification implemented and unit-tested.                                                 |
| PORTFOLIO VERIFICATION        | FAIL             | Balances endpoint implemented; requires Agentic Wallet provisioning + valid credentials.                                                 |
| AUDIT TRAIL                   | PASS             | Full lifecycle events persisted (verified in Postgres during testing); append-only.                                                      |
| SECURITY                      | PASS             | Checklist 24 PASS / 2 NEEDS_REVIEW / 0 FAIL; scanner zero findings; adversarial + replay + binding tests green.                          |
| KILL SWITCH                   | PASS             | Tested: 503 kill-switch-enabled on executions; Go service blocks per request.                                                            |
| CHAIN GUARD                   | PASS             | Tested: 403 chain-guard on EXPECTED_CHAIN_ID mismatch; fail-closed both API and Go.                                                      |

## Why the data/broadcast stages are FAIL

One root cause: **no valid Binance Web3 credentials and no funded executor
wallet exist in this environment.** The system demonstrably reaches the real
gateway (signed request proven) and honestly refuses to proceed — the risk
engine REJECTS proposals on missing data rather than inventing values, and
the execution gates block with exact reasons. Per the Phase 10.4 stop
condition, no limits were lowered and nothing was improvised.

## Path to flip every FAIL to PASS

1. Enable/provision valid Binance Web3 credentials (fixes REAL DATA → QUOTE →
   SIMULATION chain; verified by `/api/diagnostics/binance/probe` → OK).
2. Provision + fund the dedicated executor wallet (fixes signing readiness).
3. Follow docs/mainnet-micro-trade-runbook.md with MANUAL authorization.
4. Record evidence in docs/mainnet/micro-trade-evidence.md.
