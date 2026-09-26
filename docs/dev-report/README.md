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

## Log

_No entries yet — Phase 1 (repository foundation) intentionally performed no
external API calls._
