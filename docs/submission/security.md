# OLYR Security Architecture

## 1. The AI cannot sign transactions

The LLM produces one JSON document per parse request. It has no tools, no
network access beyond its own provider endpoint, no keys, and no ability to
act after emitting text. Execution is a separate Go service; there is no code
path from any LLM output to a broadcast.

## 2. The AI cannot access private keys

The executor private key exists only in the Go execution service environment.
The Python agent and Fastify API never receive it. Wallet signing material
never enters any database, log, or API response.

## 3. Strategies are validated

Every strategy passes four deterministic layers (schema → semantic →
capability → safety) in the Python agent, then the same checks are
re-enforced in Fastify before persistence. Unknown fields, operators,
actions, and assets are rejected — never silently reinterpreted.

## 4. Risk decisions are deterministic

The Rust engine evaluates 10 rules with no LLM involvement. The same input
and configuration always produce the same decision. Invariant tests prove
over-limit, invalid-price, and disallowed-asset proposals are never approved.

## 5. Transaction simulation is required

SWAP-mode executions cannot broadcast unless simulation status is PASSED.
A FAILED simulation blocks with "the transaction would revert". RFQ orders
are vendor-validated at submission; the EVM simulator does not apply.

## 6. Execution is authorization-gated

MANUAL policy requires an explicit user decision per proposal. BOUNDED_AGENT
auto-executes only when every gate passes and the amount is at or below
`OLYR_REQUIRE_HUMAN_APPROVAL_ABOVE_USD`. DISABLED blocks everything. The
single ExecutionGate evaluates all 12 conditions; partial passes are BLOCKED
with reasons.

## 7. Assets and contracts are allowlisted

Asset and action allowlists are platform configuration enforced in both the
agent and Fastify. Swap targets originate only from Binance quote responses
bound to the proposal's asset; no API accepts an arbitrary destination
address or calldata.

## 8. Limits are enforced

Trade size, daily exposure, slippage, spread threshold, position limits, and
cooldowns are platform configuration enforced by the agent validators AND
re-enforced by Fastify. The LLM cannot raise, bypass, or disable any of them.

## 9. Transactions are verified

BROADCAST and CONFIRMED are distinct states. Confirmation requires on-chain
verification through `/aggregator/history`; expired approvals read as EXPIRED
and are never executable.

## 10. Events are audited

Every pipeline stage persists an AgentEvent with timestamps and structured
detail. Risk evaluations store the exact inputs and per-rule results.
Historical records are append-only — re-evaluation creates new records.

## Additional boundaries

- **Kill switch** (`OLYR_KILL_SWITCH`): blocks all new executions at the API
  and Go service; broadcast transactions continue to confirmation only.
- **Chain guard** (`EXPECTED_CHAIN_ID`/`EXPECTED_NETWORK`): fail-closed on
  network mismatch — no silent network switching.
- **Internal API**: token-guarded; reachable only by the Go execution service.
- **Secrets**: server-side only; scanner (`scripts/security-audit.mjs`) runs
  in CI; no secret appears in logs (redaction helpers, JSON state logging).
