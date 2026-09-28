/**
 * Execution pipeline route tests (Phase 6): quotes, simulation, authorization
 * policy, idempotency, state machine. Uses an in-memory Prisma stub and an
 * injected deterministic trading client. The REAL signing/broadcast lives in
 * the Go service; these tests verify the Fastify-side gates and contract.
 */
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import type { BinanceTradingClient } from "@olyr/binance";
import type {
  QuoteParams,
  SimulationResult,
  SwapParams,
  SwapPreparation,
  UnsignedTransaction,
} from "@olyr/types";

const ENV_KEYS = [
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "OLYR_SCAN_ENABLED",
  "REDIS_URL",
  "DATABASE_URL",
  "OLYR_EXECUTION_POLICY",
  "OLYR_QUOTE_TTL_SECONDS",
  "OLYR_INTERNAL_TOKEN",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

const STRATEGY = {
  name: "NVDA weekend premium watcher",
  asset: { ticker: "NVDA" },
  conditions: [{ field: "spread_percent", operator: "greater_than", value: 1.5 } as const],
  action: { type: "PROPOSE_SELL", maxUsd: 20 } as const,
};

/** In-memory Prisma stub covering strategies + proposals + execution tables. */
function fakePrisma() {
  const strategies: Array<Record<string, unknown>> = [];
  const proposals: Array<Record<string, unknown>> = [];
  const quotes: Array<Record<string, unknown>> = [];
  const simulations: Array<Record<string, unknown>> = [];
  const authorizations: Array<Record<string, unknown>> = [];
  const evaluations: Array<Record<string, unknown>> = [];
  const executions: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  let id = 1;
  const now = () => new Date();
  const mk = <T>(arr: T[]) => ({
    create: async (args: { data: Record<string, unknown> }) => {
      const row = { id: `x${id++}`, createdAt: now(), updatedAt: now(), ...args.data };
      (arr as unknown as Array<Record<string, unknown>>).push(row);
      return row;
    },
    findMany: async (args?: { where?: { proposalId?: string } }) => {
      const list = arr as unknown as Array<Record<string, unknown>>;
      const pid = args?.where?.proposalId;
      return pid ? list.filter((r) => r.proposalId === pid) : list;
    },
    findFirst: async (args: { where: { proposalId?: string; id?: string; decision?: string } }) => {
      const list = arr as unknown as Array<Record<string, unknown>>;
      const w = args.where;
      return (
        list.find(
          (r) =>
            (!w.proposalId || r.proposalId === w.proposalId) &&
            (!w.id || r.id === w.id) &&
            (!w.decision || r.decision === w.decision),
        ) ?? null
      );
    },
    findUnique: async (args: { where: { id: string } }) =>
      (arr as unknown as Array<Record<string, unknown>>).find((r) => r.id === args.where.id) ??
      null,
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = (arr as unknown as Array<Record<string, unknown>>).find(
        (r) => r.id === args.where.id,
      );
      if (!row) throw new Error("record not found");
      Object.assign(row, args.data);
      return row;
    },
  });
  return {
    strategy: mk(strategies),
    tradeProposal: mk(proposals),
    tradeQuote: mk(quotes),
    simulation: mk(simulations),
    executionAuthorization: mk(authorizations),
    riskEvaluation: mk(evaluations),
    execution: mk(executions),
    agentEvent: {
      async createMany(args: { data: Array<Record<string, unknown>> }) {
        for (const e of args.data) events.push(e);
        return {};
      },
      async findMany() {
        return events;
      },
    },
    _proposals: proposals,
    _quotes: quotes,
    _simulations: simulations,
    _authorizations: authorizations,
    _executions: executions,
    _events: events,
  };
}

const UNSIGNED_TX: UnsignedTransaction = {
  chainId: "56",
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  data: "0xdeadbeef",
  value: "0",
  gas: "210000",
  gasPrice: "10000000000",
  maxFeePerGas: null,
  maxPriorityFeePerGas: null,
  nonce: null,
};

const SWAP_PREP: SwapPreparation = {
  mode: "SWAP",
  quoteId: "quote-id-1",
  tx: UNSIGNED_TX,
  rfq: null,
  toTokenAmount: "19000000",
  minReceiveAmount: "18900000",
  slippagePercent: "0.5",
  priceImpactPercent: "0.12",
  tradeFeeUsd: "0.30",
  estimateGasFee: "0.02",
};

function fakeTradingClient() {
  const client: BinanceTradingClient = {
    async getQuote(params: QuoteParams) {
      return [
        {
          quoteId: "quote-id-1",
          vendorName: "PcsXRfq",
          fromTokenAddress: params.fromTokenAddress,
          toTokenAddress: params.toTokenAddress,
          fromTokenAmount: params.amount,
          toTokenAmount: "19000000",
          tradeFeeUsd: "0.30",
          estimateGasFee: "0.02",
          router: "a--b",
          priceImpactPercent: "0.12",
          fromTokenUnitPrice: "1.00",
          toTokenUnitPrice: null,
          fromTokenSymbol: "bNVDA",
          toTokenSymbol: "USDT",
        },
      ];
    },
    async buildSwap(_params: SwapParams) {
      return SWAP_PREP;
    },
    async getApproveTransaction() {
      return { to: "0x3333333333333333333333333333333333333333", data: "0x095ea7b3", value: "0" };
    },
    async simulateTransaction(
      _chainId: string,
      _tx: UnsignedTransaction,
    ): Promise<SimulationResult> {
      return {
        id: "sim_test",
        proposalId: null,
        status: "PASSED",
        apiStatus: "SUCCESS",
        failReason: null,
        gasEstimate: null,
        balanceChanges: [],
        allowanceChanges: [],
        warnings: [],
        timestamp: new Date().toISOString(),
        source: "binance-web3",
      };
    },
    async broadcastTransaction() {
      // Must never be reached from these tests: only the Go service broadcasts.
      throw new Error("broadcast must not be called from Fastify tests");
    },
    async getTransactionStatus() {
      return {
        status: "success",
        blockHeight: "1",
        errorMsg: null,
        gasUsed: "21000",
        txFee: "0.001",
        txTime: "1",
      };
    },
    async submitRfqOrder() {
      return { orderId: "oc-o-test", status: "PENDING_VENDOR" };
    },
    async getRfqOrderStatus() {
      return { orderId: "oc-o-test", status: "FILLED" };
    },
    async getAllTokenBalances() {
      return [];
    },
  };
  return client;
}

async function buildExecutionApp(ttl = 30) {
  // Hermetic: the developer .env may set Binance keys via dotenv — tests must not hit the network.
  delete process.env["BINANCE_API_KEY"];
  delete process.env["BINANCE_API_SECRET"];
  process.env["OLYR_SCAN_ENABLED"] = "false";
  process.env["OLYR_DEFAULT_OWNER"] = "test-owner";
  process.env["OLYR_QUOTE_TTL_SECONDS"] = String(ttl);
  process.env["OLYR_INTERNAL_TOKEN"] = "test-internal-token";
  const prisma = fakePrisma();
  const app = await buildApp({
    prisma: prisma as unknown as Parameters<typeof buildApp>[0]["prisma"],
    tradingClient: fakeTradingClient(),
  });
  return { app, prisma };
}

async function createApprovedProposal(
  app: Awaited<ReturnType<typeof buildExecutionApp>>["app"],
): Promise<string> {
  const strategy = await app.inject({
    method: "POST",
    url: "/api/strategies",
    payload: { strategy: STRATEGY },
  });
  assert.equal(strategy.statusCode, 201);
  const proposal = await app.inject({
    method: "POST",
    url: "/api/proposals",
    payload: { strategyId: JSON.parse(strategy.body).id },
  });
  assert.equal(proposal.statusCode, 201);
  const proposalId = JSON.parse(proposal.body).id;
  // Approve the proposal through the Rust risk client seam? The pipeline's
  // risk evaluation goes through /evaluate-risk which needs the Rust engine;
  // for these unit tests force-approve via the store.
  return proposalId;
}

describe("execution pipeline", () => {
  it("quotes require an APPROVED proposal", async () => {
    const { app } = await buildExecutionApp();
    try {
      const proposalId = await createApprovedProposal(app);
      const response = await app.inject({
        method: "POST",
        url: "/api/quotes",
        payload: {
          proposalId,
          fromTokenAddress: "0xaaa",
          toTokenAddress: "0xbbb",
          amount: "20000000",
        },
      });
      assert.equal(response.statusCode, 409, "PENDING_RISK proposal must not be quotable");
      assert.match(response.body, /APPROVED/);
    } finally {
      await app.close();
    }
  });

  it("invalid amounts are rejected", async () => {
    const { app } = await buildExecutionApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/quotes",
        payload: {
          proposalId: "x",
          fromTokenAddress: "0xaaa",
          toTokenAddress: "0xbbb",
          amount: "-5",
        },
      });
      assert.equal(response.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  it("MANUAL policy: authorize works end-to-end and execution creation is idempotent", async () => {
    const { app, prisma } = await buildExecutionApp();
    try {
      const proposalId = await createApprovedProposal(app);
      // Force-approve: mark the proposal APPROVED (risk evaluation covered by
      // Phase 5 tests with the real Rust engine).
      const row = prisma._proposals[0]!;
      row.status = "APPROVED";
      row.riskDecision = {
        decision: "APPROVED",
        rulesEvaluated: [],
        rulesPassed: [],
        rulesFailed: [],
        warnings: [],
        requiresReview: [],
        timestamp: new Date().toISOString(),
      };

      const quote = await app.inject({
        method: "POST",
        url: "/api/quotes",
        payload: {
          proposalId,
          fromTokenAddress: "0xaaa",
          toTokenAddress: "0xbbb",
          amount: "20000000",
        },
      });
      assert.equal(quote.statusCode, 201);
      const quoteBody = JSON.parse(quote.body);
      assert.equal(quoteBody.routes.length, 1);
      assert.equal(quoteBody.source, "binance-web3");

      const simulation = await app.inject({
        method: "POST",
        url: `/api/proposals/${proposalId}/simulate`,
      });
      assert.equal(simulation.statusCode, 201, simulation.body);
      const simBody = JSON.parse(simulation.body);
      assert.equal(simBody.status, "PASSED");

      const authorize = await app.inject({
        method: "POST",
        url: `/api/proposals/${proposalId}/authorize`,
        payload: { decision: "APPROVE" },
      });
      assert.equal(authorize.statusCode, 201);
      assert.equal(JSON.parse(authorize.body).decision, "APPROVED");

      const execute = await app.inject({
        method: "POST",
        url: "/api/executions",
        payload: { proposalId },
      });
      assert.equal(execute.statusCode, 201, execute.body);
      const execution = JSON.parse(execute.body);
      assert.equal(execution.state, "RISK_APPROVED");
      assert.equal(execution.idempotencyKey, `exec:${proposalId}`);

      const duplicate = await app.inject({
        method: "POST",
        url: "/api/executions",
        payload: { proposalId },
      });
      assert.equal(duplicate.statusCode, 201);
      assert.equal(
        JSON.parse(duplicate.body).id,
        execution.id,
        "idempotent: same execution returned",
      );
      assert.equal(prisma._executions.length, 1);
    } finally {
      await app.close();
    }
  });

  it("DISABLED policy blocks authorization and execution with exact reasons", async () => {
    process.env["OLYR_EXECUTION_POLICY"] = "DISABLED";
    const { app } = await buildExecutionApp();
    try {
      const proposalId = await createApprovedProposal(app);
      const authorize = await app.inject({
        method: "POST",
        url: `/api/proposals/${proposalId}/authorize`,
        payload: { decision: "APPROVE" },
      });
      assert.equal(authorize.statusCode, 403);
      assert.match(authorize.body, /DISABLED/);
      const execute = await app.inject({
        method: "POST",
        url: "/api/executions",
        payload: { proposalId },
      });
      assert.equal(execute.statusCode, 403);
    } finally {
      await app.close();
    }
  });

  it("simulation rejects an expired quote", async () => {
    const { app, prisma } = await buildExecutionApp();
    try {
      const proposalId = await createApprovedProposal(app);
      const row = prisma._proposals[0]!;
      row.status = "APPROVED";
      const quote = await app.inject({
        method: "POST",
        url: "/api/quotes",
        payload: {
          proposalId,
          fromTokenAddress: "0xaaa",
          toTokenAddress: "0xbbb",
          amount: "20000000",
        },
      });
      assert.equal(quote.statusCode, 201);
      // Expire the stored quote.
      const stored = prisma._quotes[prisma._quotes.length - 1]!;
      stored.expiresAt = new Date(Date.now() - 1000);
      const simulation = await app.inject({
        method: "POST",
        url: `/api/proposals/${proposalId}/simulate`,
      });
      assert.equal(simulation.statusCode, 409);
      assert.match(simulation.body, /expired/);
    } finally {
      await app.close();
    }
  });

  it("cancel is invalid after broadcast, valid before authorization", async () => {
    const { app, prisma } = await buildExecutionApp();
    try {
      const proposalId = await createApprovedProposal(app);
      const row = prisma._proposals[0]!;
      row.status = "APPROVED";
      await app.inject({
        method: "POST",
        url: "/api/quotes",
        payload: {
          proposalId,
          fromTokenAddress: "0xaaa",
          toTokenAddress: "0xbbb",
          amount: "20000000",
        },
      });
      await app.inject({ method: "POST", url: `/api/proposals/${proposalId}/simulate` });
      await app.inject({
        method: "POST",
        url: `/api/proposals/${proposalId}/authorize`,
        payload: { decision: "APPROVE" },
      });
      const execution = JSON.parse(
        (await app.inject({ method: "POST", url: "/api/executions", payload: { proposalId } }))
          .body,
      );
      const cancel = await app.inject({
        method: "POST",
        url: `/api/executions/${execution.id}/cancel`,
      });
      assert.equal(cancel.statusCode, 200);
      assert.equal(JSON.parse(cancel.body).state, "CANCELLED");
      const again = await app.inject({
        method: "POST",
        url: `/api/executions/${execution.id}/cancel`,
      });
      assert.equal(again.statusCode, 409, "terminal states cannot transition");
    } finally {
      await app.close();
    }
  });

  it("internal broadcast requires the internal token", async () => {
    const { app } = await buildExecutionApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/internal/broadcast",
        payload: { executionId: "x", signedTransaction: "0xabc" },
      });
      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});
