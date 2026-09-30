# Product Positioning

## One-liner

**OLYR is an autonomous intelligence and controlled execution platform for
tokenized equities on BNB Smart Chain.**

## Who it is for

Traders and operators who want around-the-clock intelligence on tokenized
stocks — and who refuse to give an AI unrestricted control of their funds.

## What it does

OLYR watches tokenized equities 24/7, detects and explains divergence between
their on-chain price and their reference price, turns plain-English strategy
requests into strictly validated proposals, evaluates every proposal through
a deterministic Rust risk engine, and — only when every safety gate passes
and a human authorizes — executes through Binance Web3 with on-chain
verification.

## Core flow

```
DETECT → ANALYZE → VALIDATE → PROPOSE → SIMULATE → AUTHORIZE → EXECUTE → VERIFY
```

## Core architectural principle

**The AI interprets intent. Deterministic systems control execution.**

Every boundary in the product enforces this:

- The LLM emits one validated JSON strategy — no tools, no keys, no network.
- A Rust engine is the only execution authority — 10 rules, no LLM, no I/O.
- The Go service is the only signer — keys never leave its environment.
- The browser talks only to OLYR's API — never to Binance, never to Rust.
- Humans hold the final authorization; the kill switch overrides everything.

## Positioning language (binding for all submission materials)

Say: "price divergence detected", "deterministic risk decision",
"controlled execution", "authorization gate".

Never say: "guaranteed profit", "risk-free", "guaranteed arbitrage",
"autonomous money printer", "fully autonomous trading".

## What OLYR is not

- Not a yield product, not a signal-selling service, not a bot marketplace.
- Not an autonomous money manager — every execution is authorized and
  bounded by configuration the AI cannot change.
- Not a source of financial advice — divergences are observations.
