/**
 * Wallet read-path tests: provider state ladder (NOT_CONFIGURED /
 * CONFIGURED / CONNECTED / ERROR), read-only balance reads, capabilities
 * gating (read-only addresses NEVER enable execution), endpoint integration
 * through buildApp with an injected trading client (no network), and
 * POSITION_LIMIT position wiring (unknown stays null, never zero).
 */
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import {
  BawCliWalletProvider,
  ConfiguredAddressWalletProvider,
  WalletNotConfiguredError,
  WalletReadError,
  isValidBscAddress,
} from "../src/wallet/providers.js";
import { computeCapabilities } from "../src/wallet/capabilities.js";
import { ProposalService } from "../src/proposals/service.js";

const ADDR = "0x0000000000000000000000000000000000000001";

const ENV_KEYS = [
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "OLYR_EXECUTOR_ADDRESS",
  "OLYR_SCAN_ENABLED",
  "REDIS_URL",
  "DATABASE_URL",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

function balancesReader(
  balances: Array<Record<string, unknown>>,
  failWith?: Error,
): (chainId: string, address: string) => Promise<never[] | Array<never>> {
  return (async () => {
    if (failWith) throw failWith;
    return balances;
  }) as unknown as (chainId: string, address: string) => Promise<Array<never>>;
}

describe("address validation", () => {
  it("accepts 0x + 40 hex, rejects everything else", () => {
    assert.equal(isValidBscAddress(ADDR), true);
    assert.equal(isValidBscAddress("0x123"), false);
    assert.equal(isValidBscAddress("not-an-address"), false);
    assert.equal(isValidBscAddress(null), false);
    assert.equal(isValidBscAddress(undefined), false);
    assert.equal(isValidBscAddress(" 0x123 "), false);
  });
});

describe("BawCliWalletProvider without CLI", () => {
  it("reports NOT_CONFIGURED when the CLI is absent", async () => {
    const provider = new BawCliWalletProvider({ cliName: "baw-definitely-missing-cli" });
    const identity = await provider.getWalletIdentity();
    assert.equal(identity.status, "NOT_CONFIGURED");
    assert.equal(identity.address, null);
    assert.ok(identity.detail);
  });
});

describe("ConfiguredAddressWalletProvider state ladder", () => {
  const BALANCES = [
    {
      chainId: "56",
      tokenContractAddress: "0xabc0000000000000000000000000000000000001",
      address: ADDR,
      symbol: "NVDAon",
      balance: "10",
      rawBalance: "10",
      tokenPrice: "100",
    },
  ];

  it("returns ERROR for an invalid configured address", async () => {
    const provider = new ConfiguredAddressWalletProvider({
      address: "nope",
      readBalances: balancesReader([]),
    });
    const identity = await provider.getWalletIdentity();
    assert.equal(identity.status, "ERROR");
    assert.equal(identity.address, null);
    assert.ok(identity.detail);
  });

  it("returns CONFIGURED before any read, CONNECTED after a real read", async () => {
    const provider = new ConfiguredAddressWalletProvider({
      address: ADDR,
      readBalances: balancesReader(BALANCES),
    });
    assert.equal((await provider.getWalletIdentity()).status, "CONFIGURED");
    const balances = await provider.getBalances();
    assert.equal(balances.length, 1);
    const identity = await provider.getWalletIdentity();
    assert.equal(identity.status, "CONNECTED");
    assert.equal(identity.address, ADDR);
    assert.equal(identity.network, "BNB Smart Chain");
  });

  it("returns ERROR and throws WalletReadError when the upstream read fails", async () => {
    const provider = new ConfiguredAddressWalletProvider({
      address: ADDR,
      readBalances: balancesReader([], new Error("boom 40101")),
    });
    await assert.rejects(provider.getBalances(), (e: unknown) => e instanceof WalletReadError);
    const identity = await provider.getWalletIdentity();
    assert.equal(identity.status, "ERROR");
    assert.ok(identity.detail?.includes("boom"));
  });

  it("filters positions by contract and nulls uncomputable values", async () => {
    const provider = new ConfiguredAddressWalletProvider({
      address: ADDR,
      readBalances: balancesReader([
        ...BALANCES,
        {
          chainId: "56",
          tokenContractAddress: "0xother",
          address: ADDR,
          symbol: "X",
          balance: "not-a-number",
          rawBalance: null,
          tokenPrice: null,
        },
      ]),
    });
    const positions = await provider.getPositions([
      "0xABC0000000000000000000000000000000000001",
      "0xother",
    ]);
    assert.equal(positions.length, 2);
    assert.equal(positions[0]!.valueUsd, "1000");
    assert.equal(positions[1]!.valueUsd, null);
  });

  it("refuses every execution operation (read-only)", async () => {
    const provider = new ConfiguredAddressWalletProvider({
      address: ADDR,
      readBalances: balancesReader([]),
    });
    await assert.rejects(provider.prepareExecution(), WalletNotConfiguredError);
    await assert.rejects(provider.requestExecution(), WalletNotConfiguredError);
  });
});

describe("capabilities gating for address identities", () => {
  const base = {
    provider: "binance-agentic-wallet",
    network: "BNB Smart Chain",
    versions: { cli: null, skill: null },
    capabilities: [],
  };

  it("CONFIGURED enables reads but never execution", () => {
    const caps = computeCapabilities({
      walletIdentity: { ...base, status: "CONFIGURED", address: ADDR, detail: null },
      policyMode: "MANUAL",
      binanceConfigured: true,
    });
    assert.equal(caps.canReadWallet, true);
    assert.equal(caps.canReadPortfolio, true);
    assert.equal(caps.canExecuteTrades, false);
  });

  it("CONNECTED address enables reads but never execution", () => {
    const caps = computeCapabilities({
      walletIdentity: { ...base, status: "CONNECTED", address: ADDR, detail: null },
      policyMode: "MANUAL",
      binanceConfigured: true,
    });
    assert.equal(caps.canReadWallet, true);
    assert.equal(caps.canExecuteTrades, false);
  });

  it("ERROR disables reads (fail closed)", () => {
    const caps = computeCapabilities({
      walletIdentity: { ...base, status: "ERROR", address: null, detail: "bad" },
      policyMode: "MANUAL",
      binanceConfigured: true,
    });
    assert.equal(caps.canReadWallet, false);
    assert.equal(caps.canExecuteTrades, false);
  });
});

describe("wallet endpoints through buildApp (injected trading client, no network)", () => {
  const TRADING_BALANCES = [
    {
      chainId: "56",
      tokenContractAddress: "0xabc0000000000000000000000000000000000001",
      address: ADDR,
      symbol: "NVDAon",
      balance: "10",
      rawBalance: "10",
      tokenPrice: "100",
    },
  ];

  async function buildWalletApp() {
    process.env["BINANCE_API_KEY"] = "k";
    process.env["BINANCE_API_SECRET"] = "s";
    process.env["OLYR_EXECUTOR_ADDRESS"] = ADDR;
    process.env["OLYR_SCAN_ENABLED"] = "false";
    return buildApp({
      tradingClient: {
        getAllTokenBalances: async () => TRADING_BALANCES,
      } as never,
    });
  }

  it("reports CONFIGURED, then CONNECTED after a real read, with no secrets", async () => {
    const app = await buildWalletApp();
    try {
      const first = await app.inject({ method: "GET", url: "/api/wallet" });
      assert.equal(first.statusCode, 200);
      const before = JSON.parse(first.body) as {
        wallet: Record<string, unknown>;
        capabilities: Record<string, unknown>;
      };
      assert.equal(before.wallet["status"], "CONFIGURED");
      assert.equal(before.capabilities["canReadWallet"], true);
      assert.equal(before.capabilities["canExecuteTrades"], false);
      const serialized = JSON.stringify(before);
      assert.ok(!/privatekey|secret|mnemonic/i.test(serialized));

      const balances = await app.inject({ method: "GET", url: "/api/wallet/balances" });
      assert.equal(balances.statusCode, 200);
      assert.equal(JSON.parse(balances.body).balances.length, 1);

      const second = await app.inject({ method: "GET", url: "/api/wallet" });
      assert.equal(JSON.parse(second.body).wallet["status"], "CONNECTED");
    } finally {
      await app.close();
    }
  });

  it("serves real portfolio positions with computed values", async () => {
    const app = await buildWalletApp();
    try {
      await app.inject({ method: "GET", url: "/api/wallet/balances" });
      const res = await app.inject({ method: "GET", url: "/api/portfolio" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body) as {
        positions: Array<{ symbol: string | null; valueUsd: string | null }>;
        source: string;
      };
      assert.equal(body.positions.length, 1);
      assert.equal(body.positions[0]!.valueUsd, "1000");
      assert.equal(body.source, "binance-web3");
    } finally {
      await app.close();
    }
  });

  it("reports upstream failure as 502, never fabricated zeros", async () => {
    process.env["BINANCE_API_KEY"] = "k";
    process.env["BINANCE_API_SECRET"] = "s";
    process.env["OLYR_EXECUTOR_ADDRESS"] = ADDR;
    process.env["OLYR_SCAN_ENABLED"] = "false";
    const app = await buildApp({
      tradingClient: {
        getAllTokenBalances: async () => {
          throw new Error("upstream 40101");
        },
      } as never,
    });
    try {
      const res = await app.inject({ method: "GET", url: "/api/wallet/balances" });
      assert.equal(res.statusCode, 502);
      assert.equal(JSON.parse(res.body).error.category, "wallet-read-failed");
      const portfolio = await app.inject({ method: "GET", url: "/api/portfolio" });
      assert.equal(portfolio.statusCode, 502);
    } finally {
      await app.close();
    }
  });
});

describe("POSITION_LIMIT position wiring", () => {
  const store = {
    rows: new Map<string, Record<string, unknown>>(),
    createProposal: async function (data: Record<string, unknown>) {
      const row = { id: "prop_1", createdAt: new Date(), ...data };
      (this as { rows: Map<string, Record<string, unknown>> }).rows.set(row.id as string, row);
      return row;
    },
    listProposals: async () => [],
    getProposal: async function (id: string) {
      return (
        (this as { rows: Map<string, Record<string, unknown>> }).rows.get(id) ?? null
      );
    },
    updateProposalStatus: async () => {},
    createEvaluation: async () => ({ id: "eval_1" }),
    getEvaluations: async () => [],
  };
  const riskClient = {
    evaluate: async (input: unknown) => ({
      decision: "APPROVED",
      rulesEvaluated: [],
      rulesPassed: [],
      rulesFailed: [],
      warnings: [],
      requiresReview: [],
      timestamp: new Date().toISOString(),
      seenInput: input,
    }),
  };
  const strategy = {
    name: "PBR watcher",
    asset: { ticker: "PBR" },
    conditions: [],
    action: { type: "PROPOSE_SELL", maxUsd: 20 },
  } as never;

  it("flows a known position into the risk input", async () => {
    const svc = new ProposalService(store as never, riskClient as never, 300, {
      positionUsdForTicker: async () => 50,
    });
    const proposal = await svc.create(strategy, "strat_1", null);
    assert.equal(proposal.requestedAmountUsd, 20);
    const stored = (await svc.get(proposal.id))!;
    assert.equal(stored.input.currentPositionUsd, 50);
  });

  it("keeps unknown (resolver failure) as null, never zero", async () => {
    const svc = new ProposalService(store as never, riskClient as never, 300, {
      positionUsdForTicker: async () => {
        throw new Error("wallet down");
      },
    });
    const proposal = await svc.create(strategy, "strat_1", null);
    const stored = (await svc.get(proposal.id))!;
    assert.equal(stored.input.currentPositionUsd, null);
  });

  it("defaults to null without a resolver (existing behavior preserved)", async () => {
    const svc = new ProposalService(store as never, riskClient as never, 300);
    const proposal = await svc.create(strategy, "strat_1", null);
    const stored = (await svc.get(proposal.id))!;
    assert.equal(stored.input.currentPositionUsd, null);
  });
});
