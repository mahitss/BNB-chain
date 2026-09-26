/**
 * Freshness evaluation tests — configurable thresholds, boundary-inclusive,
 * UNKNOWN for missing/invalid timestamps.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { evaluateFreshness } from "../../src/intelligence/freshness.js";

const THRESHOLDS = { freshSeconds: 60, agingSeconds: 900, staleSeconds: 3600 };
const NOW = new Date("2026-09-29T15:00:00Z");

describe("evaluateFreshness", () => {
  it("FRESH at and below the fresh boundary", () => {
    const at60 = evaluateFreshness(new Date(NOW.getTime() - 60_000).toISOString(), NOW, THRESHOLDS);
    assert.equal(at60.category, "FRESH");
    assert.equal(at60.ageSeconds, 60);
    const at0 = evaluateFreshness(NOW.toISOString(), NOW, THRESHOLDS);
    assert.equal(at0.category, "FRESH");
  });

  it("AGING just above the fresh boundary and at the aging boundary", () => {
    const at61 = evaluateFreshness(new Date(NOW.getTime() - 61_000).toISOString(), NOW, THRESHOLDS);
    assert.equal(at61.category, "AGING");
    const at900 = evaluateFreshness(
      new Date(NOW.getTime() - 900_000).toISOString(),
      NOW,
      THRESHOLDS,
    );
    assert.equal(at900.category, "AGING");
  });

  it("STALE just above the aging boundary and at the staleness limit", () => {
    const at901 = evaluateFreshness(
      new Date(NOW.getTime() - 901_000).toISOString(),
      NOW,
      THRESHOLDS,
    );
    assert.equal(at901.category, "STALE");
    const at3600 = evaluateFreshness(
      new Date(NOW.getTime() - 3_600_000).toISOString(),
      NOW,
      THRESHOLDS,
    );
    assert.equal(at3600.category, "STALE");
    assert.equal(at3600.beyondStalenessLimit, false);
  });

  it("flags beyondStalenessLimit past the staleness limit", () => {
    const at3601 = evaluateFreshness(
      new Date(NOW.getTime() - 3_601_000).toISOString(),
      NOW,
      THRESHOLDS,
    );
    assert.equal(at3601.category, "STALE");
    assert.equal(at3601.beyondStalenessLimit, true);
    assert.equal(at3601.warningCode, "beyond-staleness-limit");
  });

  it("returns UNKNOWN for missing or invalid timestamps — never invented", () => {
    for (const missing of [null, undefined, ""]) {
      const evaluation = evaluateFreshness(missing as string | null | undefined, NOW, THRESHOLDS);
      assert.equal(evaluation.category, "UNKNOWN");
      assert.equal(evaluation.ageSeconds, null);
      assert.equal(evaluation.warningCode, "timestamp-missing");
    }
    const invalid = evaluateFreshness("not-a-timestamp", NOW, THRESHOLDS);
    assert.equal(invalid.category, "UNKNOWN");
  });

  it("clamps future timestamps to age zero", () => {
    const future = evaluateFreshness(
      new Date(NOW.getTime() + 60_000).toISOString(),
      NOW,
      THRESHOLDS,
    );
    assert.equal(future.ageSeconds, 0);
    assert.equal(future.category, "FRESH");
  });
});
