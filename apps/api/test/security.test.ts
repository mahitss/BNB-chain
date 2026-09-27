/**
 * Phase 9 security tests: kill switch, chain guard, SSRF/URL exposure,
 * rate limiting, security headers, payload limits, replay/expiry gates.
 */
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import {
  ChainGuardError,
  KillSwitchError,
  assertExecutionPermitted,
  chainGuardOk,
  loadSecurityConfig,
} from "../src/security/hardening.js";

const ENV_KEYS = [
  "OLYR_KILL_SWITCH",
  "EXPECTED_CHAIN_ID",
  "EXPECTED_NETWORK",
  "BINANCE_CHAIN_ID",
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "OLYR_SCAN_ENABLED",
  "REDIS_URL",
  "DATABASE_URL",
  "OLYR_INTERNAL_TOKEN",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("kill switch", () => {
  it("disabled by default — executions permitted (config-wise)", () => {
    const config = loadSecurityConfig();
    assert.equal(config.killSwitch, false);
    assert.doesNotThrow(() => assertExecutionPermitted(config));
  });

  it("OLYR_KILL_SWITCH=enabled blocks execution with typed error", () => {
    process.env["OLYR_KILL_SWITCH"] = "enabled";
    const config = loadSecurityConfig();
    assert.equal(config.killSwitch, true);
    assert.throws(() => assertExecutionPermitted(config), KillSwitchError);
  });

  it("POST /api/executions returns 503 kill-switch-enabled when active", async () => {
    process.env["OLYR_KILL_SWITCH"] = "enabled";
    process.env["BINANCE_API_KEY"] = "k";
    process.env["BINANCE_API_SECRET"] = "s";
    process.env["OLYR_SCAN_ENABLED"] = "false";
    process.env["DATABASE_URL"] = "postgresql://placeholder";
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp({
      prisma: fakePrismaDelegate(),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/executions",
        payload: { proposalId: "x" },
      });
      assert.equal(response.statusCode, 503);
      assert.match(response.body, /kill-switch-enabled/);
    } finally {
      await app.close();
    }
  });
});

describe("chain guard", () => {
  it("passes when configured chain matches expected", () => {
    process.env["BINANCE_CHAIN_ID"] = "56";
    process.env["EXPECTED_CHAIN_ID"] = "56";
    const config = loadSecurityConfig();
    assert.equal(chainGuardOk(config), true);
    assert.doesNotThrow(() => assertExecutionPermitted(config));
  });

  it("blocks on chain mismatch (never silently switches networks)", () => {
    process.env["BINANCE_CHAIN_ID"] = "1";
    process.env["EXPECTED_CHAIN_ID"] = "56";
    const config = loadSecurityConfig();
    assert.equal(chainGuardOk(config), false);
    assert.throws(() => assertExecutionPermitted(config), ChainGuardError);
  });

  it("POST /api/executions returns 403 chain-guard on mismatch", async () => {
    process.env["BINANCE_CHAIN_ID"] = "1";
    process.env["EXPECTED_CHAIN_ID"] = "56";
    process.env["BINANCE_API_KEY"] = "k";
    process.env["BINANCE_API_SECRET"] = "s";
    process.env["OLYR_SCAN_ENABLED"] = "false";
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp({ prisma: fakePrismaDelegate() });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/executions",
        payload: { proposalId: "x" },
      });
      assert.equal(response.statusCode, 403);
      assert.match(response.body, /chain-guard/);
    } finally {
      await app.close();
    }
  });
});

describe("API hardening", () => {
  it("sets security headers (helmet)", async () => {
    process.env["OLYR_SCAN_ENABLED"] = "false";
    const app = await buildApp({ prisma: fakePrismaDelegate() });
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      assert.equal(response.statusCode, 200);
      assert.ok(response.headers["x-content-type-options"], "nosniff header missing");
    } finally {
      await app.close();
    }
  });

  it("rejects oversized payloads with 413", async () => {
    process.env["OLYR_SCAN_ENABLED"] = "false";
    const app = await buildApp({ prisma: fakePrismaDelegate() });
    try {
      const big = "x".repeat(300 * 1024);
      const response = await app.inject({
        method: "POST",
        url: "/api/strategies/parse",
        payload: { text: big },
      });
      assert.equal(response.statusCode, 413);
    } finally {
      await app.close();
    }
  });

  it("rate-limits repeated requests with 429", async () => {
    process.env["OLYR_SCAN_ENABLED"] = "false";
    const app = await buildApp({ prisma: fakePrismaDelegate() });
    try {
      let saw429 = false;
      for (let i = 0; i < 150; i++) {
        const response = await app.inject({ method: "GET", url: "/health" });
        if (response.statusCode === 429) {
          saw429 = true;
          break;
        }
      }
      assert.ok(saw429, "expected a 429 within 150 rapid requests");
    } finally {
      await app.close();
    }
  });
});

// ---- Minimal in-memory prisma stub for route wiring ----------------------

function fakePrismaDelegate() {
  return {
    strategy: {
      create: async () => ({}),
      findMany: async () => [],
      findUnique: async () => null,
      update: async () => ({}),
    },
    agentEvent: { createMany: async () => ({}), findMany: async () => [] },
    tradeProposal: {
      create: async () => ({ id: "p", createdAt: new Date() }),
      findMany: async () => [],
      findUnique: async () => null,
      update: async () => ({}),
    },
    riskEvaluation: { create: async () => ({ id: "e" }), findMany: async () => [] },
    tradeQuote: { create: async () => ({ id: "q" }), findFirst: async () => null },
    simulation: { create: async () => ({ id: "s" }), findFirst: async () => null },
    executionAuthorization: { create: async () => ({ id: "a" }), findFirst: async () => null },
    execution: {
      create: async () => ({ id: "x", createdAt: new Date(), updatedAt: new Date() }),
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => ({ id: "x" }),
    },
    $queryRaw: async () => [],
  };
}

describe("state machine replay/expiry invariants", () => {
  it("terminal states cannot transition", async () => {
    const { isValidExecutionTransition } = await import("@olyr/types");
    for (const terminal of ["CONFIRMED", "FAILED", "EXPIRED", "CANCELLED"]) {
      for (const next of ["BROADCAST", "CONFIRMED", "AUTHORIZED"]) {
        assert.equal(isValidExecutionTransition(terminal, next), false);
      }
    }
  });
  it("authorization cannot be replayed through the chain", async () => {
    const { isValidExecutionTransition } = await import("@olyr/types");
    assert.equal(isValidExecutionTransition("AUTHORIZED", "BROADCAST_REQUESTED"), true);
    assert.equal(isValidExecutionTransition("BROADCAST", "BROADCAST_REQUESTED"), false);
    assert.equal(isValidExecutionTransition("CONFIRMING", "AUTHORIZED"), false);
  });
  it("cancelled/expired cannot reach broadcast", async () => {
    const { isValidExecutionTransition } = await import("@olyr/types");
    assert.equal(isValidExecutionTransition("CANCELLED", "AUTHORIZED"), false);
    assert.equal(isValidExecutionTransition("EXPIRED", "BROADCAST_REQUESTED"), false);
  });
});

describe("API hardening details", () => {
  it("helmet security headers present", async () => {
    process.env["OLYR_SCAN_ENABLED"] = "false";
    const app = await buildApp({ prisma: minimalPrisma() });
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      assert.ok(response.headers["x-content-type-options"]);
    } finally {
      await app.close();
    }
  });
  it("oversized payload rejected", async () => {
    process.env["OLYR_SCAN_ENABLED"] = "false";
    const app = await buildApp({ prisma: minimalPrisma() });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/strategies/parse",
        payload: { text: "x".repeat(300 * 1024) },
      });
      assert.equal(response.statusCode, 413);
    } finally {
      await app.close();
    }
  });
  it("internal broadcast rejects bad token", async () => {
    process.env["OLYR_INTERNAL_TOKEN"] = "secret-token";
    process.env["OLYR_SCAN_ENABLED"] = "false";
    const app = await buildApp({ prisma: minimalPrisma() });
    try {
      const missing = await app.inject({
        method: "POST",
        url: "/api/internal/broadcast",
        payload: {},
      });
      assert.equal(missing.statusCode, 401);
      const bad = await app.inject({
        method: "POST",
        url: "/api/internal/broadcast",
        payload: {},
        headers: { "x-olyr-internal-token": "wrong" },
      });
      assert.equal(bad.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

function minimalPrisma() {
  return {
    strategy: {
      create: async () => ({}),
      findMany: async () => [],
      findUnique: async () => null,
      update: async () => ({}),
    },
    agentEvent: { createMany: async () => ({}), findMany: async () => [] },
    tradeProposal: {
      create: async () => ({ id: "p", createdAt: new Date() }),
      findMany: async () => [],
      findUnique: async () => null,
      update: async () => ({ id: "p" }),
    },
    riskEvaluation: { create: async () => ({ id: "e" }), findMany: async () => [] },
    tradeQuote: { create: async () => ({ id: "q" }), findFirst: async () => null },
    simulation: { create: async () => ({ id: "s" }), findFirst: async () => null },
    executionAuthorization: { create: async () => ({ id: "a" }), findFirst: async () => null },
    execution: {
      create: async () => ({ id: "x", createdAt: new Date(), updatedAt: new Date() }),
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => ({ id: "x" }),
    },
  };
}
