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
