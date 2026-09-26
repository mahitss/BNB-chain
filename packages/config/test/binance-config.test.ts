/**
 * Binance configuration validation tests.
 */
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import { EnvError } from "../src/index.js";
import { isBinanceConfigured, loadBinanceConfig } from "../src/binance.js";

const KEYS = [
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "BINANCE_BASE_URL",
  "BINANCE_TIMEOUT_MS",
] as const;

afterEach(() => {
  for (const key of KEYS) {
    delete process.env[key];
  }
});

describe("loadBinanceConfig", () => {
  it("returns null when credentials are absent (supported dev mode)", () => {
    assert.equal(loadBinanceConfig(), null);
    assert.equal(isBinanceConfigured(), false);
  });

  it("rejects partial configuration (key without secret)", () => {
    process.env["BINANCE_API_KEY"] = "key-only";
    assert.throws(() => loadBinanceConfig(), EnvError);
  });

  it("rejects partial configuration (secret without key)", () => {
    process.env["BINANCE_API_SECRET"] = "secret-only";
    assert.throws(() => loadBinanceConfig(), EnvError);
  });

  it("loads defaults when both credentials are present", () => {
    process.env["BINANCE_API_KEY"] = "k";
    process.env["BINANCE_API_SECRET"] = "s";
    const config = loadBinanceConfig();
    assert.ok(config);
    assert.equal(config.baseUrl, "https://web3.binance.com/build");
    assert.equal(config.timeoutMs, 10000);
    assert.equal(config.chainId, "56");
    assert.equal(config.cacheTtls.priceSeconds, 15);
    assert.equal(config.cacheTtls.metadataSeconds, 300);
    assert.equal(isBinanceConfigured(), true);
  });

  it("honors overrides", () => {
    process.env["BINANCE_API_KEY"] = "k";
    process.env["BINANCE_API_SECRET"] = "s";
    process.env["BINANCE_TIMEOUT_MS"] = "2500";
    process.env["BINANCE_CHAIN_ID"] = "1";
    const config = loadBinanceConfig();
    assert.ok(config);
    assert.equal(config.timeoutMs, 2500);
    assert.equal(config.chainId, "1");
  });

  it("rejects non-numeric timeout values", () => {
    process.env["BINANCE_API_KEY"] = "k";
    process.env["BINANCE_API_SECRET"] = "s";
    process.env["BINANCE_TIMEOUT_MS"] = "soon";
    assert.throws(() => loadBinanceConfig(), EnvError);
  });
});
