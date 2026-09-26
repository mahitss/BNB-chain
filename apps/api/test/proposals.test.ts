/**
 * Trade-proposal pipeline tests (Phase 5). Uses in-memory Prisma stub + an
 * injected deterministic risk client. The REAL Rust engine is exercised in
 * the boot-smoke verification step (Fastify → Rust).
 */
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import type { RiskDecision, RiskInput } from "@olyr/types";

const ENV_KEYS = [
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "OLYR_SCAN_ENABLED",
  "REDIS_URL",
  "DATABASE_URL",
  "OLYR_PROPOSAL_TTL_SECONDS",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

const VALID_STRATEGY = {
  name: "NVDA weekend premium watcher",
  asset: { ticker: "NVDA" },
  conditions: [
    { field: "market_state", operator: "equals", value: "CLOSED" },
    { field: "spread_percent", operator: "greater_than", value: 1.5 },
  ],
  action: { type: "PROPOSE_REDUCE_POSITION", maxUsd: 20 },
};

function fakePrisma() {
  const strategies: Array<Record<string, unknown>> = [];
  const proposals: Array<Record<string, unknown>> = [];
  const evaluations: Array<Record<string, unknown>> = [];
  const eventsStore: Array<Record<string, unknown>> = [];
  let id = 1;
  const now = () => new Date();
  return {
    strategy: {
      async create(args: { data: Record<string, unknown> }) {
        const row = {
          id: `strat_${id++}`,
          status: "DRAFT",
          createdAt: now(),
          updatedAt: now(),
          ...args.data,
        };
        strategies.push(row);
        return row;
      },
      async findMany() {
        return strategies;
      },
      async findUnique(args: { where: { id: string } }) {
        return strategies.find((s) => s.id === args.where.id) ?? null;
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        const row = strategies.find((s) => s.id === args.where.id);
        if (!row) throw new Error("record not found");
        Object.assign(row, args.data);
        return row;
      },
    },
    agentEvent: {
      async createMany(args: { data: Array<Record<string, unknown>> }) {
        for (const e of args.data) eventsStore.push(e);
        return {};
      },
      async findMany() {
        return eventsStore;
      },
    },
    tradeProposal: {
      async create(args: { data: Record<string, unknown> }) {
        const row = { id: `prop_${id++}`, createdAt: now(), ...args.data };
        proposals.push(row);
        return row;
      },
      async findMany() {
        return proposals;
      },
      async findUnique(args: { where: { id: string } }) {
        return proposals.find((p) => p.id === args.where.id) ?? null;
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        const row = proposals.find((p) => p.id === args.where.id);
        if (!row) throw new Error("record not found");
        Object.assign(row, args.data);
        return row;
      },
    },
    riskEvaluation: {
      async create(args: {
        data: Record<string, unknown> & { ruleResults: { create: unknown[] } };
      }) {
        const row = {
          id: `eval_${id++}`,
          createdAt: now(),
          proposalId: args.data.proposalId,
          decision: args.data.decision,
          input: args.data.input,
        };
        evaluations.push(row);
        return row;
      },
      async findMany(args: { where: { proposalId: string } }) {
        return evaluations.filter((e) => e.proposalId === args.where.proposalId);
      },
    },
    _proposals: proposals,
    _evaluations: evaluations,
    _events: eventsStore,
  };
}

function fakeRiskClient(decision: Partial<RiskDecision>): {
  client: import("../src/proposals/risk-client.js").RiskEngineClient;
  inputs: RiskInput[];
} {
  const inputs: RiskInput[] = [];
  return {
    inputs,
    client: {
      async evaluate(input: RiskInput) {
        inputs.push(input);
        return {
          decision: decision.decision ?? "APPROVED",
          rulesEvaluated: decision.rulesEvaluated ?? ["MAX_TRADE_SIZE"],
          rulesPassed: decision.rulesPassed ?? ["MAX_TRADE_SIZE"],
          rulesFailed: decision.rulesFailed ?? [],
          warnings: decision.warnings ?? [],
          requiresReview: decision.requiresReview ?? [],
          timestamp: decision.timestamp ?? new Date().toISOString(),
        };
      },
    },
  };
}

const APPROVED: Partial<RiskDecision> = {
  decision: "APPROVED",
  rulesEvaluated: ["MAX_TRADE_SIZE", "PRICE_SANITY"],
  rulesPassed: ["MAX_TRADE_SIZE", "PRICE_SANITY"],
};

async function buildProposalApp(riskDecision: Partial<RiskDecision>, ttl?: number) {
  process.env["OLYR_SCAN_ENABLED"] = "false";
  process.env["OLYR_DEFAULT_OWNER"] = "test-owner";
  if (ttl !== undefined) {
    process.env["OLYR_PROPOSAL_TTL_SECONDS"] = String(ttl);
  }
  const prisma = fakePrisma();
  const risk = fakeRiskClient(riskDecision);
  const app = await buildApp({
    agentClient: {
      parse: async () => ({
        status: "PARSED",
        strategy: VALID_STRATEGY,
        errors: [],
        events: [],
      }),
    },
    prisma: prisma as unknown as Parameters<typeof buildApp>[0]["prisma"],
    riskClient: risk.client,
  });
  return { app, prisma, risk };
}

async function saveStrategy(
  app: Awaited<ReturnType<typeof buildProposalApp>>["app"],
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/strategies",
    payload: { strategy: VALID_STRATEGY },
  });
  assert.equal(response.statusCode, 201);
  return JSON.parse(response.body).id;
}

describe("trade proposal pipeline", () => {
  it("creates a PENDING_RISK proposal from a saved strategy", async () => {
    const { app } = await buildProposalApp(APPROVED);
    try {
      const strategyId = await saveStrategy(app);
      const response = await app.inject({
        method: "POST",
        url: "/api/proposals",
        payload: { strategyId },
      });
      assert.equal(response.statusCode, 201);
      const proposal = JSON.parse(response.body);
      assert.equal(proposal.status, "PENDING_RISK");
      assert.equal(proposal.asset, "NVDA");
      assert.equal(proposal.action, "REDUCE_POSITION");
      assert.equal(proposal.requestedAmountUsd, 20);
      assert.ok(proposal.expiresAt > proposal.createdAt);
    } finally {
      await app.close();
    }
  });

  it("evaluate-risk stores the decision and rule results", async () => {
    const { app, prisma } = await buildProposalApp({
      decision: "APPROVED",
      rulesEvaluated: ["MAX_TRADE_SIZE", "PRICE_SANITY"],
      rulesPassed: ["MAX_TRADE_SIZE", "PRICE_SANITY"],
    });
    try {
      const strategyId = await saveStrategy(app);
      const created = JSON.parse(
        (await app.inject({ method: "POST", url: "/api/proposals", payload: { strategyId } })).body,
      );
      const response = await app.inject({
        method: "POST",
        url: `/api/proposals/${created.id}/evaluate-risk`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.decision.decision, "APPROVED");
      assert.ok(body.decision.rulesPassed.includes("MAX_TRADE_SIZE"));
      assert.equal(prisma._evaluations.length, 1, "evaluation must be persisted");
      const fetched = JSON.parse(
        (await app.inject({ method: "GET", url: `/api/proposals/${created.id}` })).body,
      );
      assert.equal(fetched.status, "APPROVED");
    } finally {
      await app.close();
    }
  });

  it("REJECTED decisions set proposal status with failed-rule reasons", async () => {
    const { app } = await buildProposalApp({
      decision: "REJECTED",
      rulesEvaluated: ["MAX_TRADE_SIZE", "PRICE_SANITY"],
      rulesPassed: ["PRICE_SANITY"],
      rulesFailed: [
        {
          rule: "MAX_TRADE_SIZE",
          outcome: "FAILED",
          reason: "Requested $50.00 exceeds configured $25.00 maximum.",
        },
      ],
    });
    try {
      const strategyId = await saveStrategy(app);
      const created = JSON.parse(
        (await app.inject({ method: "POST", url: "/api/proposals", payload: { strategyId } })).body,
      );
      const response = await app.inject({
        method: "POST",
        url: `/api/proposals/${created.id}/evaluate-risk`,
      });
      const body = JSON.parse(response.body);
      assert.equal(body.proposal.status, "REJECTED");
      assert.ok(body.proposal.riskDecision.rulesFailed[0].reason.includes("exceeds"));
    } finally {
      await app.close();
    }
  });

  it("re-evaluate creates a NEW evaluation without mutating the first", async () => {
    const { app, prisma } = await buildProposalApp(APPROVED);
    try {
      const strategyId = await saveStrategy(app);
      const created = JSON.parse(
        (await app.inject({ method: "POST", url: "/api/proposals", payload: { strategyId } })).body,
      );
      await app.inject({ method: "POST", url: `/api/proposals/${created.id}/evaluate-risk` });
      const before = prisma._evaluations.length;
      const reevaluated = await app.inject({
        method: "POST",
        url: `/api/proposals/${created.id}/re-evaluate`,
      });
      assert.equal(reevaluated.statusCode, 200);
      assert.equal(prisma._evaluations.length, before + 1, "new evaluation record, not mutation");
    } finally {
      await app.close();
    }
  });

  it("an expired proposal never stays APPROVED", async () => {
    const { app } = await buildProposalApp(APPROVED, 0); // TTL 0 → immediately expired
    try {
      const strategyId = await saveStrategy(app);
      const created = JSON.parse(
        (await app.inject({ method: "POST", url: "/api/proposals", payload: { strategyId } })).body,
      );
      await app.inject({ method: "POST", url: `/api/proposals/${created.id}/evaluate-risk` });
      const fetched = JSON.parse(
        (await app.inject({ method: "GET", url: `/api/proposals/${created.id}` })).body,
      );
      assert.equal(fetched.status, "EXPIRED", "approved proposal past TTL must read EXPIRED");
    } finally {
      await app.close();
    }
  });

  it("400 when creating a proposal without a strategyId", async () => {
    const { app } = await buildProposalApp(APPROVED);
    try {
      const response = await app.inject({ method: "POST", url: "/api/proposals", payload: {} });
      assert.equal(response.statusCode, 400);
    } finally {
      await app.close();
    }
  });
});
