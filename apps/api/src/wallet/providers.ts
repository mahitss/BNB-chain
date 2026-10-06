/**
 * Wallet providers (Phase 7).
 *
 * AgenticWalletProvider abstracts the Binance Agentic Wallet so the rest of
 * OLYR never depends on wallet implementation details. The documented
 * integration surface is the `binance-agentic-wallet` Skill driving the `baw`
 * CLI (install: `npx skills add binance/binance-skills-hub/skills/binance-web3/
 * binance-agentic-wallet`), authenticated by QR sign-in from the Binance App
 * (MPC keyless — the agent never holds keys, and App-configured rules constrain
 * it at API level).
 *
 * DOCUMENTED LIMITATION: the exact `baw` CLI subcommand syntax lives in the
 * skill's SKILL.md (binance-skills-hub), which could not be retrieved from
 * this environment. The adapter therefore implements reliable preflight
 * detection and fails honestly with NOT_CONFIGURED until the CLI is present,
 * signed in, and the command surface is confirmed. Nothing is simulated.
 *
 * WalletSkillsProvider exposes only the documented skills OLYR allowlists.
 * Write-capable skills stay gated behind the execution policy.
 */
import { execFile } from "node:child_process";
import type { TokenBalance } from "@olyr/binance";

export interface WalletIdentity {
  provider: string;
  /** NOT_CONFIGURED: no address. CONFIGURED: address set, read not yet
   * verified. CONNECTED: a real read-only query succeeded. ERROR: address
   * configured but invalid or the upstream read failed. SIGNED_OUT: legacy
   * CLI state (CLI present, session unknown). */
  status: "CONNECTED" | "NOT_CONFIGURED" | "SIGNED_OUT" | "CONFIGURED" | "ERROR";
  address: string | null;
  network: string | null;
  /** CLI/skill versions from preflight, when detectable. */
  versions: { cli: string | null; skill: string | null };
  capabilities: string[];
  /** Human-readable state detail. Never carries secrets. */
  detail: string | null;
}

export interface WalletPosition {
  tokenContractAddress: string;
  symbol: string | null;
  balance: string | null;
  tokenPrice: string | null;
  /** Approximate USD value = balance × price; null when price unavailable. */
  valueUsd: string | null;
}

export interface AgenticWalletProvider {
  /** Preflight: is the documented CLI installed and authenticated? */
  preflight(): Promise<{
    installed: boolean;
    cliVersion: string | null;
    authenticated: boolean | null;
  }>;
  getWalletIdentity(): Promise<WalletIdentity>;
  getWalletAddress(): Promise<string | null>;
  getBalances(): Promise<TokenBalance[]>;
  /** Tokenized-stock positions, filtered from balances. */
  getPositions(tokenizedContracts: string[]): Promise<WalletPosition[]>;
  prepareExecution(): Promise<{ prepared: boolean; reason: string }>;
  requestExecution(): Promise<{ requested: boolean; reason: string }>;
  getExecutionStatus(): Promise<{ status: "UNAVAILABLE"; reason: string }>;
}

export class BawCliWalletProvider implements AgenticWalletProvider {
  private readonly cliName: string;
  private readonly timeoutMs: number;
  private cachedPreflight: { installed: boolean; cliVersion: string | null } | null = null;

  constructor(options: { cliName?: string; timeoutMs?: number } = {}) {
    this.cliName = options.cliName ?? "baw";
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Runs the documented preflight check (skill + CLI version detection). */
  async preflight(): Promise<{
    installed: boolean;
    cliVersion: string | null;
    authenticated: boolean | null;
  }> {
    const version = await this.runCli(["--version"]).catch(() => null);
    const installed = version !== null && !version.toLowerCase().includes("not found");
    this.cachedPreflight = { installed, cliVersion: installed ? version.trim() : null };
    // Authentication state requires a signed-in session via the Binance App;
    // it cannot be determined from this machine without the CLI present.
    return { ...this.cachedPreflight, authenticated: installed ? null : false };
  }

  async getWalletIdentity(): Promise<WalletIdentity> {
    const preflight = await this.preflight();
    return {
      provider: "binance-agentic-wallet",
      status: preflight.installed ? "SIGNED_OUT" : "NOT_CONFIGURED",
      address: null,
      network: null,
      versions: { cli: preflight.cliVersion, skill: null },
      capabilities: walletSkillAllowlist(),
      detail: preflight.installed
        ? "CLI detected; session state unknown without sign-in."
        : "Agentic Wallet CLI not detected and no wallet address is configured.",
    };
  }

  async getWalletAddress(): Promise<string | null> {
    throw this.notConfigured("getWalletAddress");
  }

  async getBalances(): Promise<TokenBalance[]> {
    throw this.notConfigured("getBalances");
  }

  async getPositions(_tokenizedContracts: string[]): Promise<WalletPosition[]> {
    throw this.notConfigured("getPositions");
  }

  async prepareExecution(): Promise<{ prepared: boolean; reason: string }> {
    throw this.notConfigured("prepareExecution");
  }

  async requestExecution(): Promise<{ requested: boolean; reason: string }> {
    throw this.notConfigured("requestExecution");
  }

  async getExecutionStatus(): Promise<{ status: "UNAVAILABLE"; reason: string }> {
    throw this.notConfigured("getExecutionStatus");
  }

  private notConfigured(operation: string): Error {
    return new WalletNotConfiguredError(
      `Agentic Wallet operation ${operation} is unavailable: the baw CLI is not installed or ` +
        `its command surface is unconfirmed. Install with \`npx skills add ` +
        `binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet\`, sign in via the ` +
        `Binance App, and confirm the documented CLI commands before enabling wallet execution.`,
    );
  }

  private runCli(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(this.cliName, args, { timeout: this.timeoutMs }, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
      child.on("error", reject);
    });
  }
}

export class WalletNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletNotConfiguredError";
  }
}

/** Upstream wallet read failed after configuration was accepted. Distinct
 * from not-configured: the address exists, but Binance rejected the query
 * or the network failed. Never carries credentials. */
export class WalletReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletReadError";
  }
}

const BSC_CHAIN_ID = "56";
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function isValidBscAddress(value: string | null | undefined): boolean {
  return typeof value === "string" && ADDRESS_PATTERN.test(value.trim());
}

function approxValueUsd(balance: string | null, price: string | null): string | null {
  if (balance === null || price === null) return null;
  const b = Number(balance);
  const p = Number(price);
  if (!Number.isFinite(b) || !Number.isFinite(p) || b < 0 || p < 0) return null;
  const value = b * p;
  return Number.isFinite(value) ? String(value) : null;
}

/**
 * Address-backed read-only wallet provider.
 *
 * Uses the configured on-chain identity (OLYR_EXECUTOR_ADDRESS in this
 * deployment) with the existing Binance Web3 balance API
 * (`query-address-info` skill surface). Read-only by construction: it holds
 * no keys, never signs, and refuses every execution operation. Verification
 * state is honest: CONFIGURED until a real read succeeds (CONNECTED) or
 * fails/is invalid (ERROR).
 */
export class ConfiguredAddressWalletProvider implements AgenticWalletProvider {
  private readonly address: string;
  private readonly chainId: string;
  private readonly network: string;
  private readonly readBalances: (
    chainId: string,
    address: string,
  ) => Promise<TokenBalance[]>;
  private readonly verificationTtlMs: number;
  private lastVerifiedAt: number | null = null;
  private lastError: string | null = null;

  constructor(options: {
    address: string;
    chainId?: string;
    network?: string;
    readBalances: (chainId: string, address: string) => Promise<TokenBalance[]>;
    verificationTtlSeconds?: number;
  }) {
    this.address = options.address.trim();
    this.chainId = (options.chainId ?? BSC_CHAIN_ID).trim();
    this.network = options.network ?? "BNB Smart Chain";
    this.readBalances = options.readBalances;
    this.verificationTtlMs = (options.verificationTtlSeconds ?? 300) * 1000;
  }

  async preflight(): Promise<{
    installed: boolean;
    cliVersion: string | null;
    authenticated: boolean | null;
  }> {
    // No CLI involved: the "installation" is a configured, well-formed address.
    const configured = isValidBscAddress(this.address) && this.chainId === BSC_CHAIN_ID;
    return { installed: configured, cliVersion: null, authenticated: null };
  }

  async getWalletIdentity(): Promise<WalletIdentity> {
    const base = {
      provider: "binance-agentic-wallet",
      address: isValidBscAddress(this.address) ? this.address : null,
      network: this.network,
      versions: { cli: null, skill: null },
      capabilities: walletSkillAllowlist(),
    };
    if (!isValidBscAddress(this.address)) {
      return {
        ...base,
        status: "ERROR",
        detail:
          "A wallet address is configured but it is not a valid BSC address (expected 0x + 40 hex characters).",
      };
    }
    if (this.chainId !== BSC_CHAIN_ID) {
      return {
        ...base,
        status: "ERROR",
        detail: `Wallet chain ${this.chainId} is not the OLYR BSC target (${BSC_CHAIN_ID}).`,
      };
    }
    if (this.lastError !== null) {
      return { ...base, status: "ERROR", detail: this.lastError };
    }
    if (
      this.lastVerifiedAt !== null &&
      Date.now() - this.lastVerifiedAt < this.verificationTtlMs
    ) {
      return { ...base, status: "CONNECTED", detail: "Read-only wallet query succeeded." };
    }
    return {
      ...base,
      status: "CONFIGURED",
      detail: "Address configured; read-only verification has not completed yet.",
    };
  }

  async getWalletAddress(): Promise<string | null> {
    if (!isValidBscAddress(this.address)) {
      throw new WalletNotConfiguredError("No valid wallet address is configured.");
    }
    return this.address;
  }

  async getBalances(): Promise<TokenBalance[]> {
    const address = await this.getWalletAddress();
    try {
      const balances = await this.readBalances(this.chainId, address!);
      this.lastVerifiedAt = Date.now();
      this.lastError = null;
      return balances;
    } catch (error) {
      this.lastError =
        error instanceof Error
          ? `Wallet read failed: ${error.message.slice(0, 160)}`
          : "Wallet read failed with an unknown error.";
      throw new WalletReadError(this.lastError);
    }
  }

  async getPositions(tokenizedContracts: string[]): Promise<WalletPosition[]> {
    const wanted = new Set(tokenizedContracts.map((c) => c.toLowerCase()));
    const balances = await this.getBalances();
    return balances
      .filter((b) => wanted.has(b.tokenContractAddress.toLowerCase()))
      .map((b) => ({
        tokenContractAddress: b.tokenContractAddress,
        symbol: b.symbol,
        balance: b.balance,
        tokenPrice: b.tokenPrice,
        valueUsd: approxValueUsd(b.balance, b.tokenPrice),
      }));
  }

  async prepareExecution(): Promise<{ prepared: boolean; reason: string }> {
    throw new WalletNotConfiguredError(
      "Read-only address provider cannot prepare execution: signing requires the provisioned execution service.",
    );
  }

  async requestExecution(): Promise<{ requested: boolean; reason: string }> {
    throw new WalletNotConfiguredError(
      "Read-only address provider cannot request execution: signing requires the provisioned execution service.",
    );
  }

  async getExecutionStatus(): Promise<{ status: "UNAVAILABLE"; reason: string }> {
    throw new WalletNotConfiguredError(
      "Execution status is unavailable from a read-only address provider.",
    );
  }
}

/**
 * Documented skills (wallet-skills/supported-skills), restricted to the OLYR
 * allowlist. The LLM can never add skills or capabilities to this list.
 */
export const DOCUMENTED_WALLET_SKILLS: readonly {
  skill: string;
  type: "Read" | "Read + Write";
  olyrPermission: string;
  allowlisted: boolean;
}[] = [
  {
    skill: "binance-tokenized-securities-info",
    type: "Read",
    olyrPermission: "READ_MARKET_DATA",
    allowlisted: true,
  },
  {
    skill: "query-token-info",
    type: "Read",
    olyrPermission: "READ_MARKET_DATA",
    allowlisted: true,
  },
  { skill: "query-address-info", type: "Read", olyrPermission: "READ_WALLET", allowlisted: true },
  {
    skill: "binance-agentic-wallet",
    type: "Read + Write",
    olyrPermission: "GET_QUOTE / SIMULATE_TRANSACTION / REQUEST_TRADE_EXECUTION",
    allowlisted: true,
  },
  // Documented but deliberately NOT allowlisted for the OLYR agent:
  {
    skill: "binance-onchain-copy-trader",
    type: "Read + Write",
    olyrPermission: "—",
    allowlisted: false,
  },
  { skill: "meme-rush", type: "Read", olyrPermission: "—", allowlisted: false },
  { skill: "crypto-market-rank", type: "Read", olyrPermission: "—", allowlisted: false },
  { skill: "trading-signal", type: "Read", olyrPermission: "—", allowlisted: false },
  { skill: "binance-leaderboard", type: "Read", olyrPermission: "—", allowlisted: false },
  { skill: "binance-wallet-tracker", type: "Read", olyrPermission: "—", allowlisted: false },
  { skill: "query-token-audit", type: "Read", olyrPermission: "—", allowlisted: false },
];

export function walletSkillAllowlist(): string[] {
  return DOCUMENTED_WALLET_SKILLS.filter((s) => s.allowlisted).map((s) => s.skill);
}
