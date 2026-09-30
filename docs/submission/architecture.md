# OLYR Final Architecture (v1.0.0)

```mermaid
flowchart TB
    U[User] --> T[OLYR Terminal · Next.js :3000]
    T -->|HTTP/JSON · only public surface| API[Fastify API :4000]

    API --> REG[Strategy Registry · Prisma/Postgres]
    API --> RWA[Binance RWA Data · @olyr/binance HMAC-signed]
    API --> MI[Market Intelligence · calendar/freshness/spread]
    API --> OPP[Opportunity Engine · deterministic]
    API --> AGENT[Strategy Agent · Python :8005]
    API --> PORT[Portfolio]

    AGENT -->|intent JSON only| LLM[LLM Provider · abstracted]
    AGENT -->|read-only tools| API

    OPP --> PROP[Trade Proposals]
    PROP --> RISK[Rust Risk Engine :8002 · 10 rules · no LLM · no I/O]
    RISK -->|APPROVED| QUOTE[Quote · Trading API · TTL 30s]
    QUOTE --> TX[Unsigned Transaction · /aggregator/swap]
    TX --> SIM[Simulation · /pre-transaction/simulate]
    SIM -->|PASSED| AUTH[Authorization Gate · MANUAL/BOUNDED/DISABLED]
    AUTH -->|valid| EXEC[Go Execution Service :8001 · sole signer]
    EXEC -->|signed artifact via token-guarded internal API| BCAST[Broadcast / RFQ Submit]
    BCAST --> BSC[BNB Smart Chain · chain 56]
    BSC --> VERIFY[On-chain Verification · /aggregator/history]
    VERIFY --> AUD[(Audit Trail + Portfolio · PostgreSQL)]
```

## Trust boundaries (marked)

| Boundary                | Enforcement                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI boundary**         | The agent emits one validated JSON document. No tools, no keys, no network beyond the LLM provider. Validators reject anything oversized, unsupported, or injected.                 |
| **Risk boundary**       | Only the Rust engine approves execution — 10 deterministic rules, no LLM, no I/O, no state.                                                                                         |
| **Wallet boundary**     | Only the Go service holds the executor key; it re-verifies the full chain-of-custody bundle (proposal/quote/simulation/authorization) before signing, and re-checks chain identity. |
| **Blockchain boundary** | Broadcast requires every prior gate; broadcast ≠ confirmed — on-chain verification is a separate, mandatory step.                                                                   |

## Service inventory (verified)

| Service     | Port | Stack              | Responsibility                                                                     |
| ----------- | ---- | ------------------ | ---------------------------------------------------------------------------------- |
| Terminal    | 3000 | Next.js 16         | Real-state UI, honest empty/error states                                           |
| API         | 4000 | Fastify 5 + Prisma | All routes, validation, persistence, orchestration                                 |
| Agent       | 8005 | Python/FastAPI     | Intent interpretation, 4-layer validation, read-only tools                         |
| Risk engine | 8002 | Rust/axum          | Deterministic execution authority                                                  |
| Execution   | 8001 | Go + go-ethereum   | Sole signer, state machine, idempotency                                            |
| PostgreSQL  | 5432 | Prisma 6           | Registry, proposals, quotes, simulations, authorizations, executions, audit events |
