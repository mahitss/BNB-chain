/**
 * API route tests: dev-mode behavior (no Binance credentials), health and
 * readiness endpoints. Uses Fastify inject() — no network, no live Binance.
 */
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { buildApp } from "../src/app.js";

const BINANCE_KEYS = ["BINANCE_API_KEY", "BINANCE_API_SECRET", "REDIS_URL"] as const;

afterEach(() => {
  for (const key of BINANCE_KEYS) {
    delete process.env[key];
  }
});

describe("api app (dev mode, no Binance credentials)", () => {
  it("GET /health succeeds without Binance configuration", async () => {
    delete process.env["BINANCE_API_KEY"];
    delete process.env["BINANCE_API_SECRET"];
    const app = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.service, "api");
      assert.equal(body.status, "ok");
    } finally {
      await app.close();
    }
  });

  it("GET /ready reports 503 with a setup hint when credentials are missing", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      assert.equal(response.statusCode, 503);
      const body = JSON.parse(response.body);
      assert.equal(body.ready, false);
      assert.equal(body.binanceConfigured, false);
      assert.match(body.detail, /BINANCE_API_KEY/);
    } finally {
      await app.close();
    }
  });

  it("RWA endpoints return a clear configuration error, never fake data", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/rwa/assets" });
      assert.equal(response.statusCode, 503);
      const body = JSON.parse(response.body);
      assert.equal(body.error.category, "not-configured");
      assert.match(body.error.message, /BINANCE_API_KEY/);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid tickers with 400", async () => {
    process.env["BINANCE_API_KEY"] = "k";
    process.env["BINANCE_API_SECRET"] = "s";
    const app = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/rwa/assets/%20bad%20ticker!" });
      // %20 decodes to a space, which the ticker pattern rejects.
      assert.equal(response.statusCode, 400);
    } finally {
      await app.close();
    }
  });
});
