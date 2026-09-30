# Technical Novelty — What Actually Distinguishes OLYR

Every claim below maps to code in this repository. Nothing is aspirational.

## 1. Natural-language strategy → constrained strategy DSL

The LLM never outputs free-form actions. It emits one JSON document validated
against a strict Pydantic schema (`extra="forbid"`) mirrored by a TypeScript
validator at the persistence boundary. The DSL supports exactly six condition
fields, six operators, and six action types — anything else is rejected, not
reinterpreted. Unsupported requests return structured clarification questions
instead of guesses.

_Code: services/agent/app/models/strategy.py, app/validators/pipeline.py;
apps/api/src/strategies/validator.ts_

## 2. Deterministic opportunity detection

Divergence, freshness, liquidity, and market state are computed by pure
functions. The spread engine uses scaled-BigInt decimal arithmetic — no
floating point anywhere in financial math, making NaN/Infinity unrepresentable
and identical inputs always produce identical outputs. Every signal carries
its reasons and warnings as structured data.

_Code: packages/types/src/decimal.ts, packages/types/src/rwa.ts,
apps/api/src/intelligence/opportunity.ts_

## 3. A separate Rust risk authority

Risk is not a policy file or a prompt — it is a standalone axum service with
10 independently testable rules. It has no LLM dependency, no network egress,
and no state. Invariant tests prove over-limit, invalid-price, and
disallowed-asset proposals are never approved, and that evaluation is
deterministic across repeated runs.

_Code: services/risk-engine/src/{rules,engine,models}.rs;
tests/risk_rules.rs_

## 4. Controlled execution state machine

Execution is a 15-state machine with an explicit transition table. Illegal
jumps (CREATED → BROADCAST, CONFIRMED → anything) are rejected at the service
layer. The Go service re-verifies the full chain-of-custody bundle — proposal,
quote, simulation, authorization — before signing anything.

_Code: packages/types/src/execution.ts (EXECUTION_TRANSITIONS);
services/execution/internal/execution/execution.go_

## 5. Mandatory transaction simulation

SWAP-mode executions cannot pass the gate without a PASSED simulation from
the documented Transaction API. A FAILED simulation blocks with "the
transaction would revert". RFQ orders (the equity-token path) are
vendor-validated at submission — recorded honestly as UNKNOWN, never as
PASSED.

_Code: apps/api/src/executions/service.ts (SIMULATION_PASSED gate);
packages/binance/src/trading-client.ts_

## 6. Agent/wallet capability boundaries

The agent's tools are read-only proxies with validated inputs; a generic
"execute_transaction" tool does not exist. The Go service is the only signer
and re-verifies the chain of custody independently. The browser talks only to
Fastify. Four processes, four trust levels, zero shared credentials.

_Code: services/agent/app/tools/market_tools.py;
services/execution/internal/execution/execution.go (VerifyGates)_

## 7. Human authorization with scope binding

Authorization is granted per proposal AND per quote. When a newer quote
exists, an older authorization fails the gate
(AUTHORIZATION_QUOTE_BINDING). Simulations are bound the same way
(SIMULATION_QUOTE_BINDING). MANUAL policy requires an explicit human
decision; BOUNDED_AGENT auto-executes only under the threshold with every
gate passing.

_Code: apps/api/src/executions/service.ts (evaluateGates)_

## 8. Immutable audit trail

Every pipeline stage persists a structured event (17 event types) and every
risk evaluation stores its exact inputs and per-rule results. There are no
update or delete code paths for audit records — re-evaluation creates new
records.

_Code: apps/api/prisma/schema.prisma (AgentEvent, RiskEvaluation,
RiskRuleResult); apps/api/src/executions/prisma-store.ts_

## 9. Real tokenized-equity market data

Six documented Binance RWA endpoints integrated with HMAC-SHA256 signed
requests, envelope-aware error mapping (Market API errors arrive as HTTP 200
with a business code), bounded retries that respect Retry-After, and
normalization into domain types. The `referencePrice` is labeled everywhere
as a derived conversion — not an official quote.

_Code: packages/binance/src/{rwa-client,trading-client,signer}.ts_

## 10. BSC settlement with verification

Broadcast and confirmation are distinct states. Confirmation requires
on-chain verification through `/aggregator/history`; the UI renders a BscScan
link only for real 32-byte hashes and never renders a hash that was not
returned by a broadcast.

_Code: apps/web/app/executions/[id]/page.tsx (formatting layer);
services/execution (tracking)_
