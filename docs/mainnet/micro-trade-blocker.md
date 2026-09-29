# Mainnet Micro-Trade — Blocker Report

Date: 2026-09-29 · Status: **BROADCAST NOT PERFORMED — BLOCKED**

Per the Phase 10.4 stop condition, execution is stopped before broadcast and
nothing was improvised, lowered, bypassed, or substituted. This document
records the exact blockers with evidence.

## Blocker 1 — Binance credentials rejected (AUTHENTICATION_FAILED)

- **Affected component**: Binance Web3 gateway authentication (all Market /
  Trading / Transaction calls)
- **Evidence**: `GET /api/diagnostics/binance/probe` → one real signed request
  to `/build/api/v1/dex/balance/all-token-balances-by-address` → gateway
  returned HTTP 401 with the documented envelope
  `{"code": 40101, "msg": "Invalid API Key"}` → categorized
  `AUTHENTICATION_FAILED`. A raw differential request built directly from the
  documented spec (bypassing OLYR's client) reproduced the identical error,
  proving OLYR's signing/transport is byte-correct and the rejection is on
  the credential side.
- **Root cause**: the configured key (length 40) is not enabled for the
  Binance Web3 API, was created outside the Developer Portal flow, or has
  been disabled.
- **Required human action**: enable Web3 API access for the key in the
  Binance Developer Portal (or provision a new key/secret pair), update
  `.env`, restart the API, and re-run `GET /api/diagnostics/binance/probe`
  until it returns `OK`.

## Blocker 2 — No funded dedicated executor wallet

- **Affected component**: Go execution service (sole signer)
- **Evidence**: `OLYR_EXECUTOR_PRIVATE_KEY` / `OLYR_EXECUTOR_ADDRESS` unset;
  `GET :8001/readiness` → 503 (fail-closed by design). No signing is possible
  and no funds exist to trade.
- **Required human action**: provision a dedicated wallet (never a personal
  wallet), fund with ≤ $10 USDT + ~0.05 BNB gas, set the two env vars
  server-side, restart the execution service, and confirm
  `/readiness` reports `signing: configured`.

## Blocker 3 — No live market data (downstream of Blocker 1)

- **Affected component**: Market/RWA pipeline
- **Evidence**: `/api/rwa/assets` →
  `{"error":{"category":"authentication","code":40101,...}}`; the Rust risk
  engine honestly REJECTS proposals ("estimatedPrice is required") rather
  than fabricating prices — verified live on the restarted stack.
- **Required human action**: resolves automatically once Blocker 1 is fixed.

## Downstream impact

Quote, unsigned-transaction construction, simulation, authorization, and
broadcast are all implemented and gated, but **unreachable until Blockers 1–2
are resolved**. The pre-flight audit
(docs/mainnet/micro-trade-preflight.md) records the full check matrix.

## Safe next step

Once Blockers 1–2 are resolved by the operator, follow
docs/mainnet-micro-trade-runbook.md exactly: re-run this preflight, require
every check PASS, then execute the single micro-trade with explicit human
authorization — never via the agent loop.
