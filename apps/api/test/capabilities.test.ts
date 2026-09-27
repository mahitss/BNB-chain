/**
 * Phase 7 tests: capability registry, execution gate (12 checks incl.
 * cooldown/dedup/human-approval threshold), wallet skill allowlist, and
 * security boundaries (no execute capability by default; the LLM cannot
 * mutate the registry).
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  computeCapabilities,
  evaluateExecutionGate,
  type GateContext,
} from "../src/wallet/capabilities.js";
import { DOCUMENTED_WALLET_SKILLS } from "../src/wallet/providers.js";

const POLICY = {
  mode: "BOUNDED_AGENT" as const,
  maxTradeUsd: 25,
  maxDailyUsd: 100,
  maxSlippagePercent: 0.5,
  allowedAssets: ["NVDA", "AAPL"],
  allowedActions: ["BUY", "SELL", "REDUCE_POSITION"],
  requireHumanApprovalAboveUsd: 10,
};

const LIMITS = {
  maxStrategyTradeUsd: 25,
  maxStrategyDailyUsd: 100,
  maxSpreadThresholdPercent: 10,
  allowedAssets: ["NVDA", "AAPL"],
  allowedActions: ["BUY", "SELL", "REDUCE_POSITION"],
};

const NOW = new Date("2026-09-29T15:00:00Z");

function gateContext(overrides: Partial<GateContext> = {}): GateContext {
  return {
    proposal: {
      id: "prop_1",
      strategyId: "strat_1",
      strategyName: "NVDA watcher",
      asset: "NVDA",
      action: "SELL",
      requestedAmountUsd: 8,
      estimatedPrice: 142,
      referencePrice: 140,
      spreadPercent: "1.5",
      marketState: "CLOSED",
      liquidityStatus: "SUFFICIENT",
      status: "APPROVED",
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      createdAt: NOW.toISOString(),
      riskDecision: null,
      txHash: null,
    },
    strategy: {
      status: "ACTIVE",
      definition: {
        asset: { ticker: "NVDA" },
        action: { type: "PROPOSE_SELL", maxUsd: 8 },
        conditions: [],
        name: "NVDA watcher",
      },
    },
    quote: {
      id: "q1",
      quote: {
        id: "q1",
        chainId: "56",
        fromTokenAddress: "0xa",
        toTokenAddress: "0xb",
        amountIn: "1",
        estimatedAmountOut: "0.9",
        routes: [],
        expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
        source: "test",
        createdAt: NOW.toISOString(),
      },
    },
    simulation: {
      id: "s1",
      simulation: {
        id: "s1",
        proposalId: "prop_1",
        status: "PASSED",
        apiStatus: "SUCCESS",
        failReason: null,
        gasEstimate: null,
        balanceChanges: [],
        allowanceChanges: [],
        warnings: [],
        timestamp: NOW.toISOString(),
        source: "test",
      },
    },
    authorization: { id: "a1", decision: "APPROVED" },
    policy: POLICY,
    limits: LIMITS,
    dailyUsedUsd: 0,
    fromAgent: true,
    lastExecutionAt: null,
    cooldownSeconds: 900,
    duplicateExecutionExists: false,
    now: NOW,
    ...overrides,
  };
}

describe("capability registry", () => {
  it("defaults canExecuteTrades to false without a wallet", () => {
    const capabilities = computeCapabilities({
      walletIdentity: null,
      policyMode: "BOUNDED_AGENT",
      binanceConfigured: true,
    });
    assert.equal(capabilities.canExecuteTrades, false);
    assert.equal(capabilities.canReadMarketData, true);
    assert.equal(capabilities.walletConfigured, false);
  });

  it("DISABLED policy removes quote/simulate/execute capabilities", () => {
    const capabilities = computeCapabilities({
      walletIdentity: null,
      policyMode: "DISABLED",
      binanceConfigured: true,
    });
    assert.equal(capabilities.canRequestQuotes, false);
    assert.equal(capabilities.canSimulateTransactions, false);
    assert.equal(capabilities.canExecuteTrades, false);
  });

  it("wallet identity with CLI present keeps execution capability possible", () => {
    const capabilities = computeCapabilities({
      walletIdentity: {
        provider: "binance-agentic-wallet",
        status: "SIGNED_OUT",
        address: null,
        network: null,
        versions: { cli: "1.0.0", skill: null },
        capabilities: [],
      },
      policyMode: "BOUNDED_AGENT",
      binanceConfigured: true,
    });
    assert.equal(capabilities.canExecuteTrades, true);
    assert.equal(capabilities.walletConfigured, true);
  });
});

describe("wallet skill allowlist", () => {
  it("only allowlists documented OLYR-relevant skills", () => {
    const allowed = DOCUMENTED_WALLET_SKILLS.filter((s) => s.allowlisted).map((s) => s.skill);
    assert.deepEqual(allowed, [
      "binance-tokenized-securities-info",
      "query-token-info",
      "query-address-info",
      "binance-agentic-wallet",
    ]);
    // Write-capable copy-trader must never be allowlisted for the agent.
    const copyTrader = DOCUMENTED_WALLET_SKILLS.find(
      (s) => s.skill === "binance-onchain-copy-trader",
    );
    assert.equal(copyTrader?.allowlisted, false);
  });
});

describe("execution gate", () => {
  it("APPROVED when all 12 checks pass (bounded agent, within threshold)", () => {
    const result = evaluateExecutionGate(gateContext());
    assert.equal(result.decision, "APPROVED");
    assert.equal(result.checks.length, 14); // 12 documented gates + cooldown + duplicate + threshold
    assert.equal(result.reasons.length, 0);
  });

  it("blocks when strategy is not ACTIVE on the agent path", () => {
    const ctx = gateContext();
    ctx.strategy!.status = "DRAFT";
    const result = evaluateExecutionGate(ctx);
    assert.equal(result.decision, "BLOCKED");
    assert.ok(result.reasons.some((r) => r.includes("agent execution requires ACTIVE")));
  });

  it("blocks disallowed asset", () => {
    const ctx = gateContext();
    ctx.strategy!.definition.asset.ticker = "GME";
    const result = evaluateExecutionGate(ctx);
    assert.equal(result.decision, "BLOCKED");
    assert.ok(result.reasons.some((r) => r.includes("not in the configured allowed assets")));
  });

  it("blocks disallowed action", () => {
    const ctx = gateContext();
    ctx.proposal.action = "REBALANCE";
    const result = evaluateExecutionGate(ctx);
    assert.equal(result.decision, "BLOCKED");
  });

  it("blocks expired proposal", () => {
    const ctx = gateContext();
    ctx.proposal.expiresAt = new Date(NOW.getTime() - 1000).toISOString();
    assert.equal(evaluateExecutionGate(ctx).decision, "BLOCKED");
  });

  it("blocks expired or missing quote", () => {
    const ctx = gateContext();
    ctx.quote!.quote.expiresAt = new Date(NOW.getTime() - 1000).toISOString();
    assert.equal(evaluateExecutionGate(ctx).decision, "BLOCKED");
    assert.equal(evaluateExecutionGate(gateContext({ quote: null })).decision, "BLOCKED");
  });

  it("blocks FAILED simulation", () => {
    const ctx = gateContext();
    ctx.simulation!.simulation.status = "FAILED";
    const result = evaluateExecutionGate(ctx);
    assert.equal(result.decision, "BLOCKED");
    assert.ok(result.reasons.some((r) => r.includes("would revert")));
  });

  it("blocks missing authorization", () => {
    const ctx = gateContext();
    ctx.authorization = null;
    assert.equal(evaluateExecutionGate(ctx).decision, "BLOCKED");
  });

  it("blocks when daily limit would be exceeded", () => {
    const ctx = gateContext();
    ctx.dailyUsedUsd = 95; // 95 + 8 > 100
    assert.equal(evaluateExecutionGate(ctx).decision, "BLOCKED");
    ctx.dailyUsedUsd = 92; // 92 + 8 = 100 = limit → pass
    assert.equal(evaluateExecutionGate(ctx).decision, "APPROVED");
  });

  it("REQUIRES_APPROVAL above the human-approval threshold (agent path)", () => {
    const ctx = gateContext();
    ctx.proposal.requestedAmountUsd = 12; // > $10 threshold
    ctx.strategy!.definition.action.maxUsd = 12;
    const result = evaluateExecutionGate(ctx);
    assert.equal(result.decision, "REQUIRES_APPROVAL");
    assert.ok(result.reasons.some((r) => r.includes("explicit user approval required")));
  });

  it("MANUAL path does not require an ACTIVE strategy", () => {
    const ctx = gateContext();
    ctx.fromAgent = false;
    ctx.strategy!.status = "DRAFT";
    assert.equal(evaluateExecutionGate(ctx).decision, "APPROVED");
  });

  it("BLOCKED on duplicate execution or active cooldown", () => {
    assert.equal(
      evaluateExecutionGate(gateContext({ duplicateExecutionExists: true })).decision,
      "BLOCKED",
    );
    const ctx = gateContext({
      lastExecutionAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    assert.equal(evaluateExecutionGate(ctx).decision, "BLOCKED");
    // After the cooldown window the gate no longer blocks on cooldown.
    const ctx2 = gateContext({
      lastExecutionAt: new Date(NOW.getTime() - 1000_000).toISOString(),
    });
    assert.equal(evaluateExecutionGate(ctx2).decision, "APPROVED");
  });
});
