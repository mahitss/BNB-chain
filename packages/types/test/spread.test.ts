/**
 * Spread calculation tests — deterministic pricing logic.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { calculateSpread } from "../src/rwa.js";

describe("calculateSpread", () => {
  it("computes percent and bps for a positive spread", () => {
    const spread = calculateSpread("101.00", "100.00");
    assert.equal(spread.percent, "1.0000");
    assert.equal(spread.bps, "100.00");
    assert.equal(spread.invalidReason, null);
  });

  it("computes a negative spread with sign", () => {
    const spread = calculateSpread("99.00", "100.00");
    assert.equal(spread.percent, "-1.0000");
    assert.equal(spread.bps, "-100.00");
  });

  it("rounds to 4 decimal places for percent", () => {
    const spread = calculateSpread("100.0005", "100.00");
    assert.equal(spread.percent, "0.0005");
  });

  it("returns zero for identical prices", () => {
    const spread = calculateSpread("61.746364", "61.746364");
    assert.equal(spread.percent, "0.0000");
    assert.equal(spread.bps, "0.00");
  });

  it("rejects a zero reference price without throwing", () => {
    const spread = calculateSpread("10.00", "0");
    assert.equal(spread.percent, null);
    assert.equal(spread.invalidReason, "zero-reference-price");
  });

  it("rejects missing on-chain price", () => {
    assert.equal(calculateSpread(null, "10").invalidReason, "missing-onchain-price");
    assert.equal(calculateSpread(undefined, "10").invalidReason, "missing-onchain-price");
    assert.equal(calculateSpread("", "10").invalidReason, "missing-onchain-price");
  });

  it("rejects missing reference price", () => {
    assert.equal(calculateSpread("10", null).invalidReason, "missing-reference-price");
    assert.equal(calculateSpread("10", "").invalidReason, "missing-reference-price");
  });

  it("rejects non-numeric values", () => {
    assert.equal(calculateSpread("abc", "10").invalidReason, "invalid-number");
    assert.equal(calculateSpread("10", "not-a-number").invalidReason, "invalid-number");
    assert.equal(calculateSpread("NaN", "10").invalidReason, "invalid-number");
  });

  it("is deterministic for repeated calls", () => {
    const a = calculateSpread("123.456789", "120.00");
    const b = calculateSpread("123.456789", "120.00");
    assert.deepEqual(a, b);
  });
});
