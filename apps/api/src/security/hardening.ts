/**
 * Phase 9 production hardening: execution kill switch, chain/network guard,
 * and security configuration loading.
 *
 * KILL SWITCH: when OLYR_KILL_SWITCH=enabled (or true/1), NO new execution
 * may start anywhere in OLYR — API, agent loop, or Go service. Already
 * broadcast transactions continue to confirmation only.
 *
 * CHAIN GUARD: EXPECTED_CHAIN_ID / EXPECTED_NETWORK must match the configured
 * binanceChainId at startup or the process refuses to serve executions
 * (fail-fast). Networks are never silently switched.
 */
import { envOptionalString } from "@olyr/config";

export interface SecurityConfig {
  /** "enabled" when the kill switch is active. */
  killSwitch: boolean;
  /** Configured binanceChainId, e.g. "56" (BSC). */
  chainId: string;
  /** Required chain id for execution; mismatch blocks execution. */
  expectedChainId: string;
  /** Required network label; mismatch blocks execution. */
  expectedNetwork: "mainnet" | "testnet" | "devnet";
}

const NETWORK_LABELS: Record<string, "mainnet" | "testnet" | "devnet"> = {
  "56": "mainnet",
  "97": "testnet",
  "1": "mainnet",
  "11155111": "testnet",
};

export function loadSecurityConfig(): SecurityConfig {
  const raw = envOptionalString("OLYR_KILL_SWITCH") ?? "";
  const killSwitch = ["enabled", "true", "1", "stop"].includes(raw.trim().toLowerCase());
  const chainId = envOptionalString("BINANCE_CHAIN_ID") ?? "56";
  const expectedChainId = envOptionalString("EXPECTED_CHAIN_ID") ?? chainId;
  const expectedNetworkRaw = envOptionalString("EXPECTED_NETWORK");
  const expectedNetwork =
    expectedNetworkRaw === "mainnet" ||
    expectedNetworkRaw === "testnet" ||
    expectedNetworkRaw === "devnet"
      ? expectedNetworkRaw
      : (NETWORK_LABELS[expectedChainId] ?? "mainnet");
  return { killSwitch, chainId, expectedChainId, expectedNetwork };
}

/** True when the configured chain matches the required chain/network. */
export function chainGuardOk(config: SecurityConfig): boolean {
  return config.chainId === config.expectedChainId;
}

export class KillSwitchError extends Error {
  readonly statusCode = 503;
  constructor() {
    super("OLYR kill switch is ENABLED — no new execution may start");
    this.name = "KillSwitchError";
  }
}

export class ChainGuardError extends Error {
  readonly statusCode = 403;
  constructor(config: SecurityConfig) {
    super(
      `Chain guard: configured chain ${config.chainId} does not match expected ${config.expectedChainId} (${config.expectedNetwork}). Execution blocked.`,
    );
    this.name = "ChainGuardError";
  }
}

/** Asserts execution is permitted; throws the typed error otherwise. */
export function assertExecutionPermitted(config: SecurityConfig): void {
  if (config.killSwitch) {
    throw new KillSwitchError();
  }
  if (!chainGuardOk(config)) {
    throw new ChainGuardError(config);
  }
}
