# OLYR — Hackathon Submission

**Autonomous intelligence and controlled execution for tokenized equities on
BNB Smart Chain.**

Start here: [judge-guide.md](judge-guide.md) — understand OLYR in 2 minutes.

## Submission contents

| Document                                                         | Purpose                                           |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| [judge-guide.md](judge-guide.md)                                 | 2-minute judge walkthrough                        |
| [product-positioning.md](product-positioning.md)                 | One-liner, positioning language, what OLYR is not |
| [demo-script.md](demo-script.md)                                 | Timed 3–4 minute demo narration                   |
| [demo-recording-checklist.md](demo-recording-checklist.md)       | Pre-recording checks                              |
| [pitch-deck.md](pitch-deck.md)                                   | 8-slide structure                                 |
| [one-pager.md](one-pager.md)                                     | Concise project summary                           |
| [architecture.md](architecture.md)                               | Final architecture (Mermaid) + trust boundaries   |
| [security-story.md](security-story.md)                           | "Why can't the AI drain the wallet?"              |
| [technical-novelty.md](technical-novelty.md)                     | Engineering decisions, mapped to code             |
| [developer-experience-report.md](developer-experience-report.md) | Factual Binance/stack integration log             |
| [test-report.md](test-report.md)                                 | Verification results at freeze                    |
| [limitations.md](limitations.md)                                 | Honest limitations                                |
| [release-readiness.md](release-readiness.md)                     | READY / NEEDS REVIEW / BLOCKED matrix             |
| [release-notes.md](release-notes.md)                             | v1.0.0 capabilities                               |
| [screenshots.md](screenshots.md)                                 | Screenshot set + rules                            |

## Canonical demo path

Overview → Markets → Asset → Opportunity → Strategy → Agent → Proposal →
Risk → Quote → Simulation → Authorization → (Broadcast is manual only) →
Portfolio.

Everything in this package describes the actual implementation. Where a
capability requires external provisioning (Binance credentials, funded
wallet, LLM key), the documents say so explicitly.
