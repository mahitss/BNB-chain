# Final Architecture

## Mermaid diagram

```mermaid
flowchart TB
    U[User] --> T[OLYR Terminal · Next.js]
    T -->|HTTP/JSON| API[Fastify API :4000]

    API --> REG[Strategy Registry · Prisma/Postgres]
    API --> AGENT[Strategy Agent · Python/FastAPI]
    API --> MKT[Market/RWA Data · @olyr/binance]
    API --> OPP[Opportunity Engine · deterministic]
    API --> PORT[Portfolio]
    API --> PROP[Trade Proposals]
    API --> LOOP[Bounded Agent Loop]

    AGENT -->|intent only| LLM[LLM Provider · abstracted]
    AGENT -->|read-only tools| API

    PROP --> RISK[Rust Risk Engine · 10 rules]
    RISK -->|APPROVED / REJECTED / REQUIRES_REVIEW| PROP
    PROP --> QUOTE[Trading API Quote]
    QUOTE --> SIM[Transaction Simulation]
    SIM --> AUTH[Authorization · MANUAL/BOUNDED/DISABLED]
    AUTH --> EXEC[Go Execution Service · sole signer]

    EXEC -->|signed artifact| BCAST[Transaction Broadcast / RFQ Submit]
    BCAST --> BSC[BNB Smart Chain]
    BSC --> VERIFY[Transaction Verification]
    VERIFY --> DB[(PostgreSQL · Audit Trail)]

    DB --> T

    subgraph security [Security boundaries]
        S1[LLM: no keys, no tools, no network beyond provider]
        S2[Browser: talks to API only]
        S3[Go: only signer, keys never leave process]
        S4[Rust: deterministic, no LLM, no I/O]
    end
```

## Trust boundaries

1. **Browser → API**: the only public surface. Credentials never cross it.
2. **API → Rust**: proposals are evaluated; the Rust engine is deterministic,
   stateless, and LLM-free.
3. **API → Go**: signed internal-token contract; Go verifies the full
   chain-of-custody bundle before signing.
4. **Agent → LLM**: raw text in, raw JSON out; everything after is
   deterministic validation.
5. **Everything → BSC**: settlement happens only through the gated pipeline.

## Component responsibilities (verified)

| Component   | Responsibility                        | Never does                                      |
| ----------- | ------------------------------------- | ----------------------------------------------- |
| Terminal    | render real state                     | fabricate data, reach backend services directly |
| Fastify API | orchestrate, validate, persist        | sign transactions                               |
| Agent       | interpret intent                      | execute, hold keys, mutate policy               |
| Risk engine | approve/reject deterministically      | touch network, LLM, or state                    |
| Go service  | verify gates, sign, broadcast, verify | accept arbitrary transactions                   |
| PostgreSQL  | persist state + audit                 | hold secrets                                    |

## Phase history

P1 foundation · P2 Binance RWA data · P3 market intelligence · P4 strategy
agent · P5 risk engine + proposals · P6 quotes/simulation/controlled
execution · P7 Agentic Wallet + bounded loop · P8 terminal UI · P9
hardening + mainnet readiness · P10 final release.
