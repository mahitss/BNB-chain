/**
 * Strategy registry + endpoint tests.
 *
 * - Route/serialization tests use an in-memory Prisma stub and an injected
 *   fake agent client (no network, no DB).
 * - Persistence tests run only when OLYR_TEST_DATABASE_URL is set (local
 *   docker compose Postgres); they are skipped otherwise.
 */
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { explainStrategy } from "../src/strategies/explainer.js";
import type { AgentClient } from "../src/strategies/agent-client.js";
import type { AgentParseResponse, StrategyDefinition } from "@olyr/types";

const ENV_KEYS = [
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "OLYR_SCAN_ENABLED",
  "REDIS_URL",
  "OLYR_MAX_STRATEGY_TRADE_USD",
  "OLYR_ALLOWED_ASSETS",
  "DATABASE_URL",
  "OLYR_DEFAULT_OWNER",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

// FIXTURE STRATEGY — schema-conformant example, not live data.
const VALID_STRATEGY: StrategyDefinition = {
  name: "NVDA weekend premium watcher",
  asset: { ticker: "NVDA" },
  conditions: [
    { field: "market_state", operator: "equals", value: "CLOSED" },
    { field: "spread_percent", operator: "greater_than", value: 1.5 },
  ],
  action: { type: "PROPOSE_REDUCE_POSITION", maxUsd: 20 },
};

function fakeAgentClient(response: AgentParseResponse): AgentClient {
  return {
    async parse() {
      return response;
    },
  };
}

/** In-memory Prisma stub implementing the registry's surface. */
function fakePrisma() {
  const strategies: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  let idCounter = 1;
  const now = () => new Date();
  return {
    strategy: {
      async create(args: { data: Record<string, unknown> }) {
        const row = {
          id: `strat_${idCounter++}`,
          status: "DRAFT",
          createdAt: now(),
          updatedAt: now(),
          ...args.data,
        };
        strategies.push(row);
        return row;
      },
      async findMany(args: Record<string, unknown>) {
        const where = args.where as { ownerId?: string } | undefined;
        return strategies.filter((s) => !where?.ownerId || s.ownerId === where.ownerId);
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
        for (const event of args.data) {
          events.push({ id: `evt_${events.length + 1}`, createdAt: now(), ...event });
        }
        return {};
      },
      async findMany(args: { where: { strategyId?: string }; orderBy?: unknown }) {
        const strategyId = args.where?.strategyId;
        return events
          .filter((e) => !strategyId || e.strategyId === strategyId)
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      },
    },
    _events: events,
  };
}

async function buildStrategyApp(options: {
  agentResponse?: AgentParseResponse;
  prisma?: ReturnType<typeof fakePrisma>;
}) {
  process.env["OLYR_SCAN_ENABLED"] = "false";
  process.env["OLYR_DEFAULT_OWNER"] = "test-owner";
  return buildApp({
    agentClient: fakeAgentClient(
      options.agentResponse ?? {
        status: "PARSED",
        strategy: VALID_STRATEGY,
        errors: [],
        events: [
          { type: "STRATEGY_REQUESTED" },
          { type: "VALIDATION_PASSED" },
          { type: "STRATEGY_PARSED", detail: { name: VALID_STRATEGY.name } },
        ],
      },
    ),
    prisma: options.prisma ?? fakePrisma(),
  });
}

describe("POST /api/strategies/parse (injected fake agent)", () => {
  it("returns PARSED with strategy and persists run events", async () => {
    const prisma = fakePrisma();
    const app = await buildStrategyApp({ prisma });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/strategies/parse",
        payload: { text: "Watch NVDA and reduce 1.5% premium by $20" },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.status, "PARSED");
      assert.equal(body.strategy.asset.ticker, "NVDA");
      assert.equal(
        body.events.some((e: { type: string }) => e.type === "STRATEGY_PARSED"),
        true,
      );
      assert.ok(prisma._events.length > 0, "agent events must be persisted");
    } finally {
      await app.close();
    }
  });

  it("returns NEEDS_CLARIFICATION with questions", async () => {
    const app = await buildStrategyApp({
      agentResponse: {
        status: "NEEDS_CLARIFICATION",
        questions: ["What maximum amount should the strategy use?"],
        errors: [],
        events: [{ type: "CLARIFICATION_REQUIRED" }],
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/strategies/parse",
        payload: { text: "Buy NVDA when it drops" },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.status, "NEEDS_CLARIFICATION");
      assert.ok(body.questions[0].includes("maximum amount"));
    } finally {
      await app.close();
    }
  });

  it("returns REJECTED with structured errors for over-limit strategies", async () => {
    const app = await buildStrategyApp({
      agentResponse: {
        status: "REJECTED",
        errors: [
          {
            layer: "safety",
            code: "trade-size-exceeds-platform-limit",
            message: "action.maxUsd (10000 USD) exceeds the platform limit (25 USD)",
          },
        ],
        events: [{ type: "VALIDATION_FAILED" }],
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/strategies/parse",
        payload: { text: "Buy $10,000 of NVDA" },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.status, "REJECTED");
      assert.equal(body.errors[0].layer, "safety");
    } finally {
      await app.close();
    }
  });
});

describe("strategy registry endpoints", () => {
  it("creates a strategy, computes explanation deterministically, persists events", async () => {
    const prisma = fakePrisma();
    const app = await buildStrategyApp({ prisma });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/strategies",
        payload: { strategy: VALID_STRATEGY },
      });
      assert.equal(response.statusCode, 201);
      const record = JSON.parse(response.body);
      assert.equal(record.status, "DRAFT");
      assert.match(record.explanation, /reduce the position by up to \$20/);
      assert.match(record.explanation, /only creates proposals/);
      assert.ok(prisma._events.some((e) => e.type === "STRATEGY_SAVED"));
    } finally {
      await app.close();
    }
  });

  it("rejects a trade size above the platform limit with a clear explanation", async () => {
    const app = await buildStrategyApp({});
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/strategies",
        payload: {
          strategy: { ...VALID_STRATEGY, action: { type: "PROPOSE_BUY", maxUsd: 10_000 } },
        },
      });
      assert.equal(response.statusCode, 422);
      const body = JSON.parse(response.body);
      assert.equal(body.error.category, "validation-failed");
      assert.ok(body.error.message.includes("exceeds the platform limit"));
    } finally {
      await app.close();
    }
  });

  it("rejects unknown fields, invalid sizes, and unsupported actions", async () => {
    const app = await buildStrategyApp({});
    try {
      const cases = [
        {
          strategy: { ...VALID_STRATEGY, unknownKey: 1 },
          layer: "schema",
        },
        {
          strategy: { ...VALID_STRATEGY, action: { type: "PROPOSE_SELL", maxUsd: 0 } },
          layer: "semantic",
        },
        {
          strategy: { ...VALID_STRATEGY, action: { type: "EXECUTE_TRADE", maxUsd: 5 } },
          layer: "capability",
        },
        {
          strategy: {
            ...VALID_STRATEGY,
            conditions: [{ field: "spread_percent", operator: "greater_than", value: 50 }],
          },
          layer: "safety",
        },
      ];
      for (const testCase of cases) {
        const response = await app.inject({
          method: "POST",
          url: "/api/strategies",
          payload: testCase,
        });
        assert.equal(response.statusCode, 422);
      }
    } finally {
      await app.close();
    }
  });

  it("activates and pauses with status-transition rules", async () => {
    const app = await buildStrategyApp({});
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/strategies",
        payload: { strategy: VALID_STRATEGY },
      });
      const { id } = JSON.parse(created.body);

      const pauseFromDraft = await app.inject({
        method: "POST",
        url: `/api/strategies/${id}/pause`,
      });
      assert.equal(pauseFromDraft.statusCode, 422, "DRAFT cannot be paused directly");

      const activate = await app.inject({ method: "POST", url: `/api/strategies/${id}/activate` });
      assert.equal(activate.statusCode, 200);
      assert.equal(JSON.parse(activate.body).status, "ACTIVE");

      const pause = await app.inject({ method: "POST", url: `/api/strategies/${id}/pause` });
      assert.equal(pause.statusCode, 200);
      assert.equal(JSON.parse(pause.body).status, "PAUSED");

      const events = await app.inject({ method: "GET", url: `/api/strategies/${id}/events` });
      const types = JSON.parse(events.body).events.map((e: { type: string }) => e.type);
      assert.ok(types.includes("STRATEGY_ACTIVATED"));
      assert.ok(types.includes("STRATEGY_PAUSED"));
    } finally {
      await app.close();
    }
  });

  it("lists and gets strategies, 404 on unknown id", async () => {
    const app = await buildStrategyApp({});
    try {
      await app.inject({
        method: "POST",
        url: "/api/strategies",
        payload: { strategy: VALID_STRATEGY },
      });
      const list = await app.inject({ method: "GET", url: "/api/strategies" });
      assert.equal(JSON.parse(list.body).strategies.length, 1);
      const missing = await app.inject({ method: "GET", url: "/api/strategies/does-not-exist" });
      assert.equal(missing.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

describe("deterministic strategy explainer", () => {
  it("explains the canonical NVDA watcher", () => {
    const explanation = explainStrategy(VALID_STRATEGY);
    assert.ok(explanation.includes("Monitor NVDA when the US market state equals CLOSED"));
    assert.ok(explanation.includes("price spread is more than 1.5%"));
    assert.ok(explanation.includes("reduce the position by up to $20"));
    assert.ok(explanation.includes("only creates proposals"));
  });

  it("is deterministic for identical strategies", () => {
    assert.equal(explainStrategy(VALID_STRATEGY), explainStrategy(VALID_STRATEGY));
  });
});

// Persistence tests against a real PostgreSQL (docker compose) when available.
describe(
  "strategy registry persistence (real database)",
  { skip: !process.env.OLYR_TEST_DATABASE_URL },
  () => {
    it("persists strategies and events via Prisma", async () => {
      process.env["DATABASE_URL"] = process.env.OLYR_TEST_DATABASE_URL;
      process.env["OLYR_SCAN_ENABLED"] = "false";
      const app = await buildStrategyApp({});
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/strategies",
          payload: { strategy: VALID_STRATEGY },
        });
        assert.equal(created.statusCode, 201);
        const record = JSON.parse(created.body);
        const fetched = await app.inject({ method: "GET", url: `/api/strategies/${record.id}` });
        assert.equal(fetched.statusCode, 200);
        assert.equal(JSON.parse(fetched.body).definition.asset.ticker, "NVDA");
        const events = await app.inject({
          method: "GET",
          url: `/api/strategies/${record.id}/events`,
        });
        assert.ok(JSON.parse(events.body).events.length >= 1);
      } finally {
        await app.close();
      }
    });
  },
);
