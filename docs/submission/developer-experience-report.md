# OLYR Developer Experience Report — v1.0.0 (Final)

Written from actual implementation experience across 10 phases. No generic
praise; difficulties are documented where they occurred.

## Setup

- The polyglot monorepo (pnpm workspace + Python venv + Go module + Rust
  crate) was straightforward, with two Windows-specific snags: the Rust
  windows-gnu toolchain needed a bundled-lld linker override (incomplete
  MinGW gcc on this machine), and pnpm 11 blocked postinstall scripts
  (esbuild, prisma engines) until allowlisted in pnpm-workspace.yaml.
- Prisma 6 pinned deliberately after npm's registry served an 8.0 RC with a
  different CLI (`validate`/`generate` unregistered). Lesson: pin the major.

## Authentication

- The Binance Web3 HMAC-SHA256 scheme (timestamp + METHOD + /build-prefixed
  path + body, Base64) is cleanly documented and our implementation matched
  it on the first live call — the placeholder-credential probe reached the
  real gateway and received the documented `40101 Invalid API Key`.
- The documented "#1 cause of 40102" (omitting the `/build` prefix from the
  signed path) matches our experience: our test vector asserts the prefix.

## API integration

- **Market API errors return HTTP 200** with a non-zero business code. Our
  first retry wrapper missed this because it only inspected HTTP status —
  caught in testing and fixed by retrying the whole fetch+envelope unit.
- Rate limits are documented per dimension (per-IP/key/user/endpoint) with
  `Retry-After` on 429; our bounded retry honors the header.

## RWA data

- Six RWA endpoints, all GET, all schema-verified against the official
  OpenAPI file. `referencePrice` is documented as a derived per-share
  conversion, not an official quote — we label it as such in the UI.
- Market status is first-class (`statusInfo`: premarket/regular/postmarket/
  overnight/closed/pause with reason codes and next-open/close times) — no
  local inference needed.
- `tokenPriceUpdatedAt` is a single timestamp per record (both prices derive
  from it); a per-price timestamp would improve freshness reporting.

## Trading / Transaction API

- RFQ (equity tokens) vs SWAP are genuinely different flows: RFQ returns
  EIP-712 typed data and settles via an idempotent order-submission; SWAP
  returns an unsigned EVM tx for the Transaction API simulator.
- `quoteId` TTL ~30s forced our quote→simulate→execute stages to bind
  explicitly to a quote id — stale-binding checks added after a quote
  change.
- The simulator accepts `{binanceChainId, evmTx{from,to,value,data}}` and
  returns predicted balance/allowance changes — solid design.

## Wallet

- The Agentic Wallet integrates via the Skills `baw` CLI with QR sign-in
  (MPC keyless). The SKILL.md command surface was unreachable from our
  build environment (raw.githubusercontent.com blocked), so our adapter
  implements preflight and fails closed — deliberately, not as a shortcut.

## Agent integration

- Structured output worked as documented; our adversarial suite scripts a
  "compliant model" that emits oversized or unsupported strategies, and the
  deterministic validators reject all of them. The model is never trusted.
- Clarification flow (NEEDS_CLARIFICATION) proved important: guessing
  financial parameters is the failure mode we designed against.

## Debugging

- The full-docker demo path surfaced two real bugs quickly: retry logic that
  didn't cover HTTP-200 envelope errors, and CORS missing for the browser.
  Both were found by running the actual stack, not by reading code.
- Postgres engine EPERM on Windows when rebuilding while the API runs —
  stop the API before `prisma generate`.

## Documentation

- The Binance Web3 docs are LLM-friendly (llms.txt/llms-full.txt) but the
  per-endpoint schemas live behind the catalog UI, not the index — knowing
  the OpenAPI file location saves hours.
- Error-code documentation is split across product pages (gateway codes in
  authentication.md, business codes per product) — a unified table would help.

## Ergonomics / limitations

- No sandbox/testnet credentials for the Web3 gateway — first live call must
  be on mainnet with a funded wallet. A test mode would lower onboarding risk.
- No WebSocket for RWA prices at this tier; polling with cache is our answer.
- The RFQ flow requires `userWalletAddress` at quote time — fine, but
  undocumented for the uninitiated.

## Improvements we would recommend

1. Ship per-endpoint reference pages in llms-full.txt (params + responses).
2. Provide a non-interactive credential validation endpoint or CLI command.
3. Document the RFQ userWalletAddress requirement prominently in the quote
   endpoint description.
