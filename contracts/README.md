# Contracts

Smart contracts will live here once a later phase first requires them (for
example an on-chain settlement or treasury contract for the execution flow).

Phase 1 intentionally initializes **no** Foundry project: `forge init` will be
run in the phase that actually needs contracts, so the repository carries no
unused scaffolding and no unaudited placeholder code.

Planned when that phase arrives:

- Foundry project layout (`foundry.toml`, `src/`, `test/`, `script/`)
- Solidity only where genuinely required — the platform leans on BNB Smart
  Chain's existing token standards rather than re-implementing them
- viem-based TypeScript bindings published for the `@olyr/*` packages
- Deployment path: BSC testnet first, BSC mainnet for the final product
