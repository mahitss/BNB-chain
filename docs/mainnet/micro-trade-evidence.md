# Mainnet Micro-Trade Evidence

This document records the evidence for the controlled mainnet micro-trade.
It is **empty by design** — the trade has not been performed. Fill it in only
during/after the authorized run described in
docs/mainnet-micro-trade-runbook.md, using safe public information only.

## Pre-flight

- Date: _(fill during run)_
- Preflight audit result: _(PASS required — see docs/mainnet/micro-trade-preflight.md)_
- Operator: _(initials)_

## Execution

| Field                   | Value                                  |
| ----------------------- | -------------------------------------- |
| Date                    | _(fill)_                               |
| Network                 | BSC MAINNET (chain 56)                 |
| Wallet (public address) | _(fill)_                               |
| Asset                   | _(fill)_                               |
| Action                  | _(fill)_                               |
| Amount                  | _(fill)_                               |
| Risk result             | _(APPROVED + rule list)_               |
| Quote result            | _(route, expected output, expiry)_     |
| Simulation result       | _(PASSED + balance changes)_           |
| Authorization result    | _(APPROVED, actor)_                    |
| Transaction hash        | _(fill — from the broadcast response)_ |
| Confirmation result     | _(block height, status)_               |
| Portfolio verification  | _(before / after balances)_            |
| Explorer reference      | _(BscScan URL)_                        |

## Rules

- Never record private keys, seed phrases, API secrets, or signing material.
- Only public identifiers (addresses, hashes, amounts) belong here.
- If any stage failed, record the exact failure — do not omit or soften it.
