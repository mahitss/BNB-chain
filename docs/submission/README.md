# OLYR — Submission

**Autonomous intelligence and controlled execution for tokenized equities on
BNB Smart Chain.**

## What OLYR does

OLYR monitors tokenized stocks on BNB Smart Chain, detects and explains
divergences between their on-chain price and their reference price, validates
every proposed action through a deterministic Rust risk engine, and executes
only through an explicitly authorized, simulation-gated pipeline.

## Why it matters

Tokenized equities trade around the clock. OLYR brings structured
intelligence, honest explainability, and hard safety controls to that market —
the AI proposes, deterministic rules decide, humans authorize.

## The safety story (the differentiator)

- The LLM stops at intent: no keys, no tools, no network, no execution.
- A 10-rule Rust risk engine is the only execution authority.
- Simulation is mandatory before broadcast; broadcast ≠ confirmed.
- Kill switch, chain guard, expiry, idempotency, cooldowns, and platform
  limits are enforced in code — the AI cannot change them.
- Every stage persists an immutable audit event.

## Submission contents

| Document                                     | Purpose                                     |
| -------------------------------------------- | ------------------------------------------- |
| [demo-script.md](demo-script.md)             | Timed 3–4 minute demo narration             |
| [screenshots.md](screenshots.md)             | Required screenshot set + rules             |
| [architecture.md](architecture.md)           | Final architecture with security boundaries |
| [security.md](security.md)                   | Security architecture summary               |
| [tech-stack.md](tech-stack.md)               | Actual technologies used                    |
| [limitations.md](limitations.md)             | Known limitations (factual)                 |
| [release-readiness.md](release-readiness.md) | READY / NEEDS REVIEW / BLOCKED matrix       |

## Running it

See the repository README (`Local Development`) and
[docs/demo-runbook.md](../demo-runbook.md). `pnpm verify` runs the complete
safe verification pipeline.
