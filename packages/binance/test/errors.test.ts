/**
 * Error mapping tests — envelope business codes → typed errors,
 * and retryability classification.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  BinanceAuthError,
  BinanceInvalidRequestError,
  BinanceRateLimitError,
  BinanceRegionBlockedError,
  BinanceServerError,
  BinanceUnsupportedChainError,
  errorFromEnvelopeCode,
  isRetryableError,
  BinanceNetworkError,
  BinanceTimeoutError,
} from "../src/errors.js";

interface ErrorCase {
  code: number;
  msg: string;
  expectedCategory: string;
  httpStatus: number;
}

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/error-codes.fixture.json", import.meta.url)),
    "utf8",
  ),
) as { _fixture: boolean; cases: ErrorCase[] };

describe("errorFromEnvelopeCode", () => {
  it("fixture is labeled as a fixture", () => {
    assert.equal(FIXTURE._fixture, true);
  });

  for (const testCase of FIXTURE.cases) {
    it(`maps code ${testCase.code} to ${testCase.expectedCategory}`, () => {
      const error = errorFromEnvelopeCode(testCase.code, testCase.msg);
      assert.equal(error.category, testCase.expectedCategory);
      assert.equal(error.code, testCase.code);
      assert.ok(
        error instanceof BinanceServerError === (testCase.expectedCategory === "api-error"),
      );
    });
  }

  it("maps specific classes", () => {
    assert.ok(errorFromEnvelopeCode(40102, "Signature error") instanceof BinanceAuthError);
    assert.ok(errorFromEnvelopeCode(40001, "bad param") instanceof BinanceInvalidRequestError);
    assert.ok(errorFromEnvelopeCode(42900, "rate limit") instanceof BinanceRateLimitError);
    assert.ok(errorFromEnvelopeCode(40301, "region") instanceof BinanceRegionBlockedError);
    assert.ok(errorFromEnvelopeCode(40411, "chain") instanceof BinanceUnsupportedChainError);
  });

  it("falls back to a server error for unknown codes", () => {
    const error = errorFromEnvelopeCode(99999, "mystery");
    assert.equal(error.category, "api-error");
    assert.equal(error.code, 99999);
  });

  it("preserves Retry-After on rate-limit errors", () => {
    const error = new BinanceRateLimitError("rate limit", 7, 42900);
    assert.equal(error.retryAfterSeconds, 7);
    assert.ok(isRetryableError(error));
  });
});

describe("isRetryableError", () => {
  it("retries only transient failures", () => {
    assert.equal(isRetryableError(new BinanceServerError("50001", 50001)), true);
    assert.equal(isRetryableError(new BinanceRateLimitError("42900", null, 42900)), true);
    assert.equal(isRetryableError(new BinanceNetworkError("connection reset")), true);
    assert.equal(isRetryableError(new BinanceTimeoutError(1000)), true);
    assert.equal(isRetryableError(new BinanceAuthError("40102", 40102)), false);
    assert.equal(isRetryableError(new BinanceInvalidRequestError("40001", 40001)), false);
    assert.equal(isRetryableError(new BinanceRegionBlockedError("40301", 40301)), false);
    assert.equal(isRetryableError(new Error("something else")), false);
  });
});
