/**
 * Agent proxy + ALERT-shape regression tests (no network, no database).
 *
 * 1. The API proxy (HttpAgentClient) must call `${baseUrl}/agent/parse` —
 *    whatever canonical URL is configured — with no hardcoded host/port.
 * 2. ALERT strategies must carry NO maxUsd key; the registry accepts the
 *    shape through all four validation layers and still rejects an
 *    explicit maxUsd:null (validator contract unchanged).
 * 3. Trade strategies keep their maxUsd behavior.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { HttpAgentClient } from "../src/strategies/agent-client.js";
import {
  validateStrategyDefinition,
  type StrategyLimitsConfig,
} from "../src/strategies/validator.js";

const LIMITS: StrategyLimitsConfig = {
  maxStrategyTradeUsd: 25,
  maxStrategyDailyUsd: 100,
  maxSpreadThresholdPercent: 10,
  allowedActions: [],
  allowedAssets: [],
};

const ALERT_STRATEGY = {
  name: "NVDA close premium alert",
  asset: { ticker: "NVDA" },
  conditions: [
    { field: "market_state", operator: "equals", value: "CLOSED" },
    { field: "spread_percent", operator: "greater_than_or_equal", value: 0.5 },
  ],
  action: { type: "ALERT" },
};

describe("HttpAgentClient proxy target", () => {
  it("posts to the configured base URL with the parse path, no hardcoded host", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ status: "PARSED" }), { status: 200 });
    }) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const client = new HttpAgentClient("http://localhost:8000");
      await client.parse("watch NVDA");
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.url, "http://localhost:8000/agent/parse");
    assert.deepEqual(JSON.parse(seen[0]!.body), { text: "watch NVDA" });
    assert.ok(!seen[0]!.url.includes("8005"), "proxy must not target the stale 8005 port");
  });
});

describe("ALERT strategy shape (maxUsd absent)", () => {
  it("passes schema, semantic, capability, and safety validation without maxUsd", () => {
    assert.ok(!("maxUsd" in (ALERT_STRATEGY.action as Record<string, unknown>)));
    const { definition, errors } = validateStrategyDefinition(ALERT_STRATEGY, LIMITS);
    assert.deepEqual(errors, []);
    assert.ok(definition);
    assert.equal(definition!.action.type, "ALERT");
    assert.equal(definition!.action.maxUsd, undefined);
  });

  it("still rejects an explicit maxUsd:null (validator contract unchanged)", () => {
    const withNull = {
      ...ALERT_STRATEGY,
      action: { type: "ALERT", maxUsd: null },
    };
    const { definition, errors } = validateStrategyDefinition(withNull, LIMITS);
    assert.equal(definition, null);
    assert.ok(
      errors.some((e) => e.message.includes("action.maxUsd must be a finite number")),
      `expected finite-number rejection, got: ${JSON.stringify(errors)}`,
    );
  });

  it("trade strategies retain their maxUsd behavior", () => {
    const trade = {
      ...ALERT_STRATEGY,
      action: { type: "PROPOSE_BUY", maxUsd: 20 },
    };
    const { definition, errors } = validateStrategyDefinition(trade, LIMITS);
    assert.deepEqual(errors, []);
    assert.equal(definition!.action.maxUsd, 20);
  });
});
