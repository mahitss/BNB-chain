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
  status: "CONNECTED" | "NOT_CONFIGURED" | "SIGNED_OUT";
  address: string | null;
  network: string | null;
  /** CLI/skill versions from preflight, when detectable. */
  versions: { cli: string | null; skill: string | null };
  capabilities: string[];
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
