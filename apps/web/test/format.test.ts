/** Frontend logic tests (node:test): formatters and API error mapping —
 * the pure logic behind the UI. Component behavior is validated by
 * typecheck + production build; DOM tests would require a browser harness. */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  explorerTxUrl,
  formatClock,
  formatPercent,
  formatUsd,
  isQuoteExpired,
  spreadTone,
  timeAgo,
} from "../lib/format";

describe("formatUsd", () => {
  it("formats numbers as USD", () => {
    assert.equal(formatUsd(142.75), "$142.75");
    assert.equal(formatUsd("140.2"), "$140.20");
  });
  it("returns Unavailable for missing/invalid values — never fabricates", () => {
    assert.equal(formatUsd(null), "Unavailable");
    assert.equal(formatUsd(undefined), "Unavailable");
    assert.equal(formatUsd(""), "Unavailable");
    assert.equal(formatUsd(Number.NaN), "Unavailable");
  });
});

describe("formatPercent", () => {
  it("adds + sign for positive values", () => {
    assert.equal(formatPercent(1.82), "+1.82%");
    assert.equal(formatPercent("0.5"), "+0.50%");
  });
  it("keeps negative sign", () => {
    assert.equal(formatPercent(-1.5), "-1.50%");
  });
  it("returns Unavailable for missing values", () => {
    assert.equal(formatPercent(null), "Unavailable");
  });
});

describe("spreadTone", () => {
  it("premium → pass, discount → fail, zero/missing → neutral", () => {
    assert.equal(spreadTone("1.5"), "pass");
    assert.equal(spreadTone("-1.5"), "fail");
    assert.equal(spreadTone("0"), "neutral");
    assert.equal(spreadTone(null), "neutral");
  });
});

describe("timeAgo", () => {
  it("renders relative time", () => {
    const now = Date.now();
    assert.equal(timeAgo(new Date(now - 3000).toISOString(), now), "just now");
    assert.equal(timeAgo(new Date(now - 5000).toISOString(), now), "5s ago");
    assert.equal(timeAgo(new Date(now - 120_000).toISOString(), now), "2m ago");
    assert.equal(timeAgo(new Date(now - 3_600_000).toISOString(), now), "1h ago");
  });
  it("handles null/invalid", () => {
    assert.equal(timeAgo(null), "never");
    assert.equal(timeAgo("garbage"), "unknown");
  });
});

describe("explorerTxUrl", () => {
  it("links only real 32-byte hashes", () => {
    const hash = "0x" + "ab".repeat(32);
    assert.equal(explorerTxUrl(hash), `https://bscscan.com/tx/${hash}`);
    assert.equal(explorerTxUrl("0x1234"), null);
    assert.equal(explorerTxUrl(null), null);
    assert.equal(explorerTxUrl("not-a-hash"), null);
  });
});

describe("isQuoteExpired", () => {
  it("treats missing expiry as expired", () => {
    assert.equal(isQuoteExpired(null), true);
  });
  it("respects the documented ~30s TTL", () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    assert.equal(isQuoteExpired(future), false);
    assert.equal(isQuoteExpired(past), true);
  });
});

describe("formatClock", () => {
  it("formats valid timestamps", () => {
    assert.ok(formatClock("2026-09-29T15:00:00Z").includes(":"));
  });
  it("renders — for invalid input", () => {
    assert.equal(formatClock(null), "—");
    assert.equal(formatClock("bad"), "—");
  });
});
