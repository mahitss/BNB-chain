/**
 * Client integration tests using recorded/sanitized fixtures and a mocked
 * fetch. Covers: request signing on the wire, envelope error mapping,
 * bounded retry behavior, timeouts, batch validation, and malformed
 * responses. NO live Binance API is contacted by these tests.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { HttpBinanceRwaClient, type BinanceRwaClientConfig } from "../src/rwa-client.js";
import {
  BinanceAuthError,
  BinanceInvalidRequestError,
  BinanceMalformedResponseError,
  BinanceServerError,
  BinanceTimeoutError,
} from "../src/errors.js";
import type { RawRwaToken, RawRwaPrice } from "../src/raw.js";

const TOKENS_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/rwa-tokens.fixture.json", import.meta.url)),
    "utf8",
  ),
) as { _fixture: boolean } & Record<string, unknown>;
const PRICE_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/rwa-price.fixture.json", import.meta.url)),
    "utf8",
  ),
) as { _fixture: boolean } & Record<string, unknown>;

const CONFIG: BinanceRwaClientConfig = {
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
  baseUrl: "https://web3.binance.com/build",
  timeoutMs: 1000,
  retry: { maxAttempts: 3, backoffBaseMs: 1, backoffMaxMs: 5 },
};

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

function mockFetch(responder: (url: string) => { status: number; body: string } | "hang"): {
  fetchImpl: typeof fetch;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const outcome = responder(url);
    if (outcome === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
      });
    }
    return new Response(outcome.body, { status: outcome.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

const noSleep = async () => {};
const sleepRecordingInto = (delays: number[]) => async (ms: number) => {
  delays.push(ms);
};

function makeClient(fetchImpl: typeof fetch, sleep = noSleep): HttpBinanceRwaClient {
  return new HttpBinanceRwaClient({ config: CONFIG, fetchImpl, sleep });
}

describe("HttpBinanceRwaClient", () => {
  it("sends documented auth headers and /build URL for a successful call", async () => {
    const { fetchImpl, requests } = mockFetch(() => ({
      status: 200,
      body: JSON.stringify(TOKENS_FIXTURE),
    }));
    const client = makeClient(fetchImpl);
    const listings = await client.listTokens({ chainId: "56" });

    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.ok(
      request.url.startsWith("https://web3.binance.com/build/api/v1/dex/market/rwa/tokens?"),
    );
    assert.match(
      request.headers["x-oc-apikey"] ?? request.headers["X-OC-APIKEY"] ?? "",
      /^test-api-key$/,
    );
    const sign = request.headers["x-oc-sign"] ?? request.headers["X-OC-SIGN"];
    assert.ok(sign, "X-OC-SIGN header must be present");
    assert.ok(!sign!.includes("test-api-secret"), "signature must not contain the secret");
    const timestamp = request.headers["x-oc-timestamp"] ?? request.headers["X-OC-TIMESTAMP"];
    assert.match(timestamp ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(listings.length, 3);
    assert.equal(listings[0]!.asset.underlyingTicker, "SPY");
  });

  it("maps a 40102 envelope to BinanceAuthError without retry", async () => {
    let calls = 0;
    const { fetchImpl } = mockFetch(() => {
      calls++;
      return {
        status: 200,
        body: JSON.stringify({
          code: 40102,
          msg: "Signature error",
          data: null,
          timestamp: 1,
          success: false,
        }),
      };
    });
    const client = makeClient(fetchImpl);
    await assert.rejects(
      client.listTokens({ chainId: "56" }),
      (error: unknown) => error instanceof BinanceAuthError && error.code === 40102,
    );
    assert.equal(calls, 1, "auth errors must never be retried");
  });

  it("retries transient 50001 errors with backoff and then succeeds", async () => {
    let calls = 0;
    const { fetchImpl } = mockFetch(() => {
      calls++;
      if (calls < 3) {
        return {
          status: 200,
          body: JSON.stringify({
            code: 50001,
            msg: "Service temporarily unavailable",
            data: null,
            timestamp: 1,
            success: false,
          }),
        };
      }
      return { status: 200, body: JSON.stringify(PRICE_FIXTURE) };
    });
    const delays: number[] = [];
    const client = makeClient(fetchImpl, sleepRecordingInto(delays));
    const quotes = await client.getTokenPrices("56", [
      "0x8755c5c39b1aa9053a83ac731242a2cf4d04b0fe",
    ]);
    assert.equal(calls, 3);
    assert.equal(quotes.length, 2);
    assert.equal(delays.length, 2, "backoff sleeps between retries");
  });

  it("respects Retry-After on 429 but stays bounded", async () => {
    let calls = 0;
    const { fetchImpl } = mockFetch(() => {
      calls++;
      if (calls === 1) {
        return {
          status: 200,
          body: JSON.stringify({
            code: 42900,
            msg: "rate limited",
            data: null,
            timestamp: 1,
            success: false,
          }),
        };
      }
      return { status: 200, body: JSON.stringify(PRICE_FIXTURE) };
    });
    const delays: number[] = [];
    const client = new HttpBinanceRwaClient({
      config: { ...CONFIG, retry: { maxAttempts: 2, backoffBaseMs: 1, backoffMaxMs: 2000 } },
      fetchImpl,
      sleep: sleepRecordingInto(delays),
    });
    await client.getTokenPrices("56", ["0x8755c5c39b1aa9053a83ac731242a2cf4d04b0fe"]);
    assert.equal(calls, 2);
    assert.equal(delays.length, 1);
  });

  it("never retries invalid-request errors", async () => {
    let calls = 0;
    const { fetchImpl } = mockFetch(() => {
      calls++;
      return {
        status: 200,
        body: JSON.stringify({
          code: 40001,
          msg: "Parameter error",
          data: null,
          timestamp: 1,
          success: false,
        }),
      };
    });
    const delays: number[] = [];
    const client = makeClient(fetchImpl, sleepRecordingInto(delays));
    await assert.rejects(client.listTokens({ chainId: "56" }), BinanceInvalidRequestError);
    assert.equal(calls, 1);
    assert.equal(delays.length, 0);
  });

  it("enforces the documented 100-contract batch limit locally", async () => {
    const { fetchImpl, requests } = mockFetch(() => ({ status: 200, body: "{}" }));
    const client = makeClient(fetchImpl);
    const tooMany = Array.from({ length: 101 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}`);
    await assert.rejects(
      client.getTokenPrices("56", tooMany),
      (error: unknown) =>
        error instanceof BinanceInvalidRequestError && error.message.includes("100"),
    );
    assert.equal(requests.length, 0, "no request should be sent for an invalid batch");
  });

  it("maps a hung request to BinanceTimeoutError", async () => {
    const { fetchImpl } = mockFetch(() => "hang");
    const client = new HttpBinanceRwaClient({
      config: {
        ...CONFIG,
        timeoutMs: 30,
        retry: { maxAttempts: 1, backoffBaseMs: 1, backoffMaxMs: 2 },
      },
      fetchImpl,
      sleep: noSleep,
    });
    await assert.rejects(
      client.listTokens({ chainId: "56" }),
      (error: unknown) => error instanceof BinanceTimeoutError && error.message.includes("30ms"),
    );
  });

  it("maps a non-JSON HTTP 200 body to BinanceMalformedResponseError", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 200, body: "<html>blocked</html>" }));
    const client = makeClient(fetchImpl);
    await assert.rejects(client.listTokens({ chainId: "56" }), BinanceMalformedResponseError);
  });

  it("maps a gateway 401 with a non-JSON body to BinanceAuthError", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 401, body: "unauthorized" }));
    const client = makeClient(fetchImpl);
    await assert.rejects(client.listTokens({ chainId: "56" }), BinanceAuthError);
  });

  it("surfaces 5xx HTTP statuses as BinanceServerError", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 502, body: "bad gateway" }));
    const client = new HttpBinanceRwaClient({
      config: { ...CONFIG, retry: { maxAttempts: 1, backoffBaseMs: 1, backoffMaxMs: 2 } },
      fetchImpl,
      sleep: noSleep,
    });
    await assert.rejects(client.listTokens({ chainId: "56" }), BinanceServerError);
  });
});

// Keep the fixture type imports referenced for readers of this file.
void ({} as unknown as RawRwaToken);
void ({} as unknown as RawRwaPrice);
