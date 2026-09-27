# BSC Mainnet Micro-Trade Runbook

A manual, human-controlled procedure for the first controlled live execution.
**Nothing in this runbook is automated. Every step requires explicit human action.**

## Prerequisites (all mandatory)

- [ ] Dedicated wallet created specifically for this test (not a personal wallet)
- [ ] Wallet funded with tiny amounts only: e.g. 20 USDT + 0.05 BNB for gas
- [ ] `OLYR_EXECUTION_POLICY=MANUAL` (never BOUNDED_AGENT for the first run)
- [ ] `OLYR_MAX_TRADE_USD=10`, `OLYR_MAX_DAILY_TRADE_USD=10`
- [ ] `EXPECTED_CHAIN_ID=56`, `EXPECTED_NETWORK=mainnet` — startup guard must pass
- [ ] `OLYR_KILL_SWITCH` unset (kill switch must be OFF to proceed; if anything
      unexpected happens, set `OLYR_KILL_SWITCH=enabled` and restart the API —
      no new execution can start)
- [ ] Asset allowlist contains exactly one tokenized asset (e.g. `OLYR_ALLOWED_ASSETS=NVDA`)
- [ ] One ACTIVE strategy targeting that asset with maxUsd ≤ 10
- [ ] Risk engine running with the same limits; `GET /readiness` reports ready
- [ ] Binance credentials configured; a real quote was fetched successfully

## Procedure

1. **Verify asset.** `GET /api/rwa/assets/:ticker` — confirm the underlying
   ticker, platform, and token contract address against the issuer's published
   contract address.
2. **Verify market state.** `GET /api/market/:ticker/state` — confirm Binance
   reports the asset tradable (`openState: true`).
3. **Create the proposal.** `POST /api/proposals {strategyId}` — record the
   proposal id, requested amount, estimated price.
4. **Risk evaluation.** `POST /api/proposals/:id/evaluate-risk` — the decision
   MUST be APPROVED with every rule passing. A REJECTED or REQUIRES_REVIEW
   decision stops the test here.
5. **Quote.** `POST /api/quotes` with the token contract addresses and amount —
   verify the returned route, vendor, price impact, and that `expiresAt` is
   ~30s in the future.
6. **Simulation.** `POST /api/proposals/:id/simulate` — status MUST be PASSED
   with no failures. RFQ-mode orders are vendor-validated at submission.
7. **Authorization.** `POST /api/proposals/:id/authorize {decision: "APPROVE"}`
   — performed by the human operator only after steps 1–6 were reviewed.
8. **Execution.** `POST /api/executions {proposalId}` — the Go service
   re-verifies all gates, signs, and broadcasts via the Transaction API.
   Record the returned execution id, state, and `txHash`.
9. **Confirmation.** Poll `GET /api/executions/:id` until state is CONFIRMED.
   BROADCAST does not mean confirmed.
10. **Explorer verification.** Open `https://bscscan.com/tx/<txHash>` and
    confirm: status success, correct chain (BSC mainnet, 56), correct
    destination (DEX router), correct token and amount.
11. **Portfolio state.** Refresh balances — the tokenized asset position should
    reflect the trade. Compare against the balance-change list from the
    simulation.
12. **Audit trail.** `GET /api/strategies/:strategyId/events` — every event
    (STRATEGY_EVALUATED → PROPOSAL_CREATED → RISK… → BROADCASTED → CONFIRMED)
    must be present with timestamps.
13. **Record results** in `docs/dev-report/README.md` under the Phase 6/9
    templates: quote, simulation, authorization, tx hash, confirmation,
    resulting portfolio.

## Abort criteria (stop immediately)

- Any gate returns BLOCKED
- Quote expiry passes before broadcast
- Simulation FAILED or status UNKNOWN on a SWAP route
- Chain guard or kill switch trips
- Transaction not confirmed within 10 minutes → check BscScan manually; do not
  retry the broadcast (idempotency protects, but manual verification is
  mandatory)
