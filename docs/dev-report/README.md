# OLYR Developer Report

Factual, dated log of hands-on experience with the APIs, tools, and markets
OLYR is built on. This report is part of the hackathon submission, so entries
must stay structured and truthful — record what actually happened, including
failures and gaps.

## How to use this file

- Add a new `## YYYY-MM-DD` section at the top of the log for each working
  session that produces observations.
- Fill in only the subsections you actually observed something for; delete the
  rest for that entry.
- Never invent data. "Not tested yet" is a valid and useful entry.
- Numbers (latency, spreads, sizes) must come from real measurements; note how
  they were measured.

## Entry template

```markdown
## YYYY-MM-DD

### API onboarding

<!-- Sign-up flow, key provisioning, sandbox access, time to first call. -->

### Documentation issues

<!-- Wrong/missing docs, outdated examples, ambiguities. Link the page. -->

### API errors

<!-- Exact error codes/messages hit, what triggered them, how resolved. -->

### Latency

<!-- Measured response times: endpoint, region/setup, p50/p95 if available. -->

### Edge cases

<!-- Surprising behaviors: rounding, rate limits, market-hours boundaries,
     empty order books, symbol quirks. -->

### Tokenized-stock observations

<!-- Real on-chain vs reference price behavior for bStocks / Ondo / xStocks:
     spread sizes, liquidity, hours effects. Include tx hashes / symbols. -->

### AI stack feedback

<!-- LLM provider behavior, structured tool-calling reliability, latency,
     cost, failure modes. -->

### Requested capabilities

<!-- Things the APIs/platform should support but don't. Be specific. -->
```

## Phase 2 template — Binance Web3 RWA data integration

To be filled in during the live-integration session, using only real
measurements:

```markdown
## YYYY-MM-DD — Binance Web3 RWA data integration

### Documentation page used

<!-- Exact URLs consulted and which sections were authoritative. -->

### Time to first successful API call

<!-- From having credentials to the first HTTP 200 with code=0. -->

### Authentication experience

<!-- How the X-OC-APIKEY / X-OC-TIMESTAMP / X-OC-SIGN signing behaved in
     practice; any signature or timestamp drift issues encountered. -->

### Endpoint discovery

<!-- How the RWA endpoints were located (docs pages, OpenAPI schema,
     llms.txt), and anything the index made hard to find. -->

### Confusing documentation

<!-- Ambiguities or gaps hit while integrating. -->

### Request/response behavior

<!-- Actual response sizes, batch behavior, pagination, null handling. -->

### Latency

<!-- Measured p50/p95 per RWA endpoint, with measurement method. -->

### Errors

<!-- Real error codes encountered, triggers, resolutions. -->

### Rate limits

<!-- Observed X-OC-RateLimit-* header values, any 429s, Retry-After. -->

### Missing SDK functionality

<!-- Gaps in the official SDKs/connectors vs the REST API. -->
```

## Phase 3 template — market-hours intelligence + opportunity engine

To be filled during live verification; do not fabricate observations.

```markdown
## YYYY-MM-DD — Market intelligence live verification

### Market Data

- **Endpoint used**: [TO BE RECORDED DURING LIVE TEST]
- **Response latency**: [TO BE RECORDED DURING LIVE TEST]
- **Price freshness**: [TO BE RECORDED DURING LIVE TEST]
- **Missing fields**: [TO BE RECORDED DURING LIVE TEST]
- **Market-hours behavior**: [TO BE RECORDED DURING LIVE TEST]
- **Observed liquidity behavior**: [TO BE RECORDED DURING LIVE TEST]
- **Documentation clarity**: [TO BE RECORDED DURING LIVE TEST]

### Deterministic-engine observations

<!-- Threshold behavior, freshness buckets, scanner interval, anything that
     differs from the documented assumptions. Only real observations. -->
```

## Phase 4 template — AI stack / agentic strategy engine

To be filled during live verification; do not fabricate observations.

```markdown
## YYYY-MM-DD — Live LLM verification

### AI stack used

<!-- Provider endpoint, integration style (structured output / JSON mode). -->

### Model/provider

<!-- OLYR_LLM_PROVIDER / OLYR_LLM_MODEL values used and why. -->

### Structured output behavior

<!-- Did the model emit valid JSON envelopes? Field-level compliance? -->

### Prompting issues

<!-- Ambiguities in the strategy schema the model struggled with. -->

### Tool-calling issues

<!-- Read-only market tools: latencies, failures, input validation hits. -->

### Latency

<!-- Measured parse latency p50/p95 (model + full validation pipeline). -->

### Malformed responses

<!-- Real malformed-LLM-response occurrences and how the pipeline handled them. -->

### Prompt injection observations

<!-- Injection attempts tried against the live model and validator outcomes. -->

### Missing SDK/API capabilities

<!-- Gaps relevant to the agent (streaming, tool use, JSON modes). -->
```

## Phase 5 template — Rust risk engine + proposal pipeline

To be filled during live verification; do not fabricate observations.

```markdown
## YYYY-MM-DD — Risk engine live verification

### Risk Engine

- **Rule design**: [TO BE RECORDED] — how the rule set behaved against real market data.
- **API boundary**: [TO BE RECORDED] — Fastify→Rust contract behavior under load.
- **Validation behavior**: [TO BE RECORDED] — malformed-request handling in practice.
- **Error handling**: [TO BE RECORDED] — timeout/unavailability behavior of the engine.
- **Latency**: [TO BE RECORDED] — p50/p95 of /evaluate (measured, not estimated).
- **Integration issues**: [TO BE RECORDED] — anything discovered wiring API↔Rust↔DB.
- **Binance portfolio-data issues**: [TO BE RECORDED] — portfolio integration pending.
- **Edge cases discovered**: [TO BE RECORDED]
```

## Phase 6 template — Trading API, simulation, controlled execution

To be filled during live verification; do not fabricate observations.

```markdown
## YYYY-MM-DD — Live trading/simulation verification

### Trading API

- **Quote experience**: [TO BE RECORDED] — RFQ vs SWAP route behavior, vendor spread.
- **Routing behavior**: [TO BE RECORDED]
- **Slippage**: [TO BE RECORDED] — auto vs manual slippage behavior.
- **Latency**: [TO BE RECORDED] — quote + swap-construction p50/p95.
- **Errors**: [TO BE RECORDED] — QUOTE_EXPIRED and friends, real triggers.

### Transaction API

- **Simulation experience**: [TO BE RECORDED] — evmTx payload behavior.
- **Simulation errors**: [TO BE RECORDED]
- **Response structure**: [TO BE RECORDED] — balanceChanges/allowanceChanges in practice.
- **Broadcasting behavior**: [TO BE RECORDED] — orderId/txHash semantics.

### Execution

- **Approval flow**: [TO BE RECORDED] — approve-transaction flow for RWA tokens.
- **Wallet behavior**: [TO BE RECORDED] — nonce, balance verification.
- **Transaction confirmation**: [TO BE RECORDED] — aggregator/history latency.
- **Edge cases**: [TO BE RECORDED]
```

## Phase 7 template — Agentic Wallet, Wallet Skills, Agent Studio, b402

To be filled during live verification; do not fabricate observations.

```markdown
## YYYY-MM-DD — Agentic Wallet live verification

### Agentic Wallet

- **Installation experience**: [TO BE RECORDED] — npx skills add, baw CLI setup.
- **SDK behavior**: [TO BE RECORDED] — baw CLI command surface (SKILL.md).
- **Identity**: [TO BE RECORDED] — QR sign-in, pairing, session behavior.
- **Wallet provisioning**: [TO BE RECORDED] — Agentic Wallet creation in the App.
- **Execution flow**: [TO BE RECORDED] — quote → confirm → submit via NL.
- **Errors**: [TO BE RECORDED]
- **Latency**: [TO BE RECORDED]
- **Documentation issues**: [TO BE RECORDED]

### Wallet Skills

- **Installation**: [TO BE RECORDED]
- **Available skills**: [TO BE RECORDED] — which of the 12 documented skills were usable.
- **Missing skills**: [TO BE RECORDED]
- **Tool behavior**: [TO BE RECORDED]
- **Integration issues**: [TO BE RECORDED]

### Agent Studio

- **Setup experience**: [TO BE RECORDED]
- **Runtime behavior**: [TO BE RECORDED]
- **MCP integration if tested**: [TO BE RECORDED]
- **Missing capabilities**: [TO BE RECORDED]

### b402

- **Documentation review**: done — x402 V2 on BSC, verify/settle flow, gas-sponsored
  settlement, EIP-3009/Permit2 authorizations. OLYR keeps payments DISABLED and off
  the trading path; PaymentProvider seam exists in services/agent.
- **Possible use case**: agent pays external services for market intelligence or
  specialized inference. Never for risk/execution.
- **Whether tested**: NOT TESTED — disabled by design in this phase.
```

## Phase 8 template — terminal UX + integration observations

To be filled during live verification; do not fabricate observations.

```markdown
## YYYY-MM-DD — Terminal UX integration

### Onboarding friction

<!-- e.g. credential setup steps, first-scan wait time. -->

### Frontend integration issues

<!-- contract mismatches, stale Next types, build quirks. -->

### API latency

<!-- measured p50/p95 for /api/rwa/assets, /api/opportunities, /api/system/status. -->

### Real-time limitations

<!-- polling intervals used; WebSocket/SSE not yet implemented. -->

### Error messages

<!-- upstream error surfaces shown to users; clarity findings. -->

### Wallet UX

<!-- connection states, empty portfolio handling. -->

### Execution UX

<!-- simulate → approve → execute flow findings. -->

### Documentation gaps

<!-- anything the docs should document but don't. -->
```

## Log

## 2026-09-26 — Phase 2 preparation (documentation and client implementation)

### Documentation page used

- `https://web3.binance.com/en/dev-docs/llms.txt` — LLM index of all doc pages.
- `https://web3.binance.com/en/dev-docs/llms-full.txt` — full documentation
  dump (439 KB at time of access); used to locate the Market API RWA section.
- `https://web3.binance.com/en/dev-docs/authentication.md` — authoritative
  authentication specification (headers, signing, rate limits, gateway errors).
- `https://web3.binance.com/en/dev-docs/products/market-api/introduction.md` —
  RWA endpoint summary (six GET endpoints).
- `https://web3.binance.com/en/dev-docs/products/market-api/error-codes.md` —
  Market API business error codes.
- `https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/1.0.0/schema.json`
  — complete OpenAPI 3.0.2 schema (1.64 MB); authoritative for request
  parameters and response-field schemas, including all enums.

### Endpoint discovery

The llms.txt/llms-full.txt dump contains endpoint _summaries_ only (paths,
methods, operation IDs). Exact parameter and response-field schemas live in
the OpenAPI schema behind the docs-site catalog
(`/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data`). Not obvious from
the index — worth knowing for future phases.

### Edge cases (documentation-level, verified from the OpenAPI schema)

- **Market API errors return HTTP 200** with a non-zero business `code` in the
  body (`{code, msg, data, timestamp, success}`). Gateway errors (401xx) may
  come with real HTTP status codes. Client code must inspect the envelope.
- **`referencePrice` is NOT an official stock-market quote** — the schema
  states it is "a per-share converted price derived from the on-chain token
  price". OLYR labels it accordingly everywhere; spread percentages computed
  against it must be interpreted with this in mind.
- Market status is provided officially per token
  (`statusInfo.marketStatus`: premarket | regular | postmarket | overnight |
  closed | pause, with reasonCode/reasonMsg/nextOpenTime/nextCloseTime).
- `GET /rwa/price` batches up to 100 contract addresses per request.
- Sector tabs (`tabId`) are a documented enum: 1=Serenity Call …
  13=Buffett Portfolio.
- The docs site sits behind an AWS WAF challenge: plain HTTP clients (curl)
  receive HTTP 202 with `x-amzn-waf-action: challenge` and no body. A real
  browser passes the challenge; this affected our documentation retrieval
  (signed API gateway requests use the `/build` path and are unaffected).

### Latency

Not measured yet — no live API call has been made (credentials not
provisioned in the build environment). Phase 2 was verified with sanitized
fixtures.

### Errors

No live API errors encountered yet; error mapping is implemented against the
documented codes (40001, 40101–40104, 40301–40303, 40411, 42900, 50000, 50001) and unit-tested with fixtures.

### Requested capabilities

_None yet — will be recorded after live integration._
