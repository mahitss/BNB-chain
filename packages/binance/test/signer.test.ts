/**
 * Signing tests — the signature scheme is the documented one:
 * preHash = timestamp + METHOD + requestPath(incl. /build) + body
 * signature = Base64(HMAC-SHA256(preHash, secret))
 *
 * The expected signature below is a precomputed regression vector.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  BINANCE_BUILD_PREFIX,
  binanceTimestamp,
  buildPreHash,
  buildRawQuery,
  signRequest,
} from "../src/signer.js";

const VECTOR = {
  timestamp: "2026-05-11T10:08:57.715Z",
  method: "GET",
  requestPath: "/build/api/v1/dex/market/rwa/price?binanceChainId=56&tokenContractAddresses=0xabc",
  body: "",
  secret: "test-secret",
  expectedSignature: "b96jqkWOfHoy+8UbNVGmczC/U3cwU8oCi/T9ubhGYeA=",
};

describe("signRequest", () => {
  it("matches the precomputed HMAC-SHA256/Base64 vector", () => {
    const signature = signRequest(VECTOR, VECTOR.secret);
    assert.equal(signature, VECTOR.expectedSignature);
  });

  it("builds the preHash by concatenation without separators", () => {
    const preHash = buildPreHash(VECTOR);
    assert.equal(
      preHash,
      "2026-05-11T10:08:57.715ZGET/build/api/v1/dex/market/rwa/price?binanceChainId=56&tokenContractAddresses=0xabc",
    );
  });

  it("includes the /build prefix in the signed path", () => {
    assert.equal(BINANCE_BUILD_PREFIX, "/build");
    assert.ok(VECTOR.requestPath.startsWith(BINANCE_BUILD_PREFIX));
  });

  it("signs POST bodies as part of the preHash", () => {
    const postVector = { ...VECTOR, method: "POST", body: '{"k":1}' };
    const signature = signRequest(postVector, VECTOR.secret);
    // Different body → different signature than the GET vector.
    assert.notEqual(signature, VECTOR.expectedSignature);
  });
});

describe("buildRawQuery", () => {
  it("encodes spaces as %20 (never +)", () => {
    assert.equal(buildRawQuery({ symbol: "ETH USDT" }), "symbol=ETH%20USDT");
  });

  it("preserves parameter insertion order", () => {
    assert.equal(buildRawQuery({ b: "2", a: "1" }), "b=2&a=1");
  });

  it("encodes reserved characters in contract addresses", () => {
    assert.equal(
      buildRawQuery({ tokenContractAddresses: "0xabc,0xdef" }),
      "tokenContractAddresses=0xabc%2C0xdef",
    );
  });
});

describe("binanceTimestamp", () => {
  it("produces ISO 8601 with milliseconds and Z suffix", () => {
    const ts = binanceTimestamp(new Date("2026-05-11T10:08:57.715Z"));
    assert.equal(ts, "2026-05-11T10:08:57.715Z");
    assert.match(binanceTimestamp(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
