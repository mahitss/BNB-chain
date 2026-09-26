/**
 * OLYR API application factory.
 *
 * Route handlers are thin adapters: validation + service calls only.
 * Business logic lives in services/, Binance access in @olyr/binance.
 *
 * Dev mode (requirement 17): without Binance credentials the API starts
 * normally; RWA endpoints return a structured 503 with setup instructions —
 * never fake data.
 */
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import {
  BinanceError,
  BinanceNotConfiguredError,
  HttpBinanceRwaClient,
  type Logger,
} from "@olyr/binance";
import { loadBinanceConfig, loadEnvironment, envOptionalString } from "@olyr/config";
import type { HealthCheck } from "@olyr/types";
import { createTtlCache, type TtlCache } from "./cache.js";
import { RwaService } from "./services/rwa.js";

export const API_VERSION = "0.2.0";

export interface AppComponents {
  service: RwaService | null;
  cache: TtlCache;
  binanceConfigured: boolean;
  chainId: string;
  logger: Logger;
}

const TICKER_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;
const CONTRACT_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: loadEnvironment() === "development" ? "debug" : "info" },
  });
  // The web app calls this API cross-origin in local dev (different ports);
  // the API is the only Binance-capable upstream, so it must answer the
  // browser directly. Reflect the origin; never expose credentials here.
  await app.register(cors, { origin: true });
  const environment = loadEnvironment();
  const appLogger: Logger = {
    debug: (m, meta) => app.log.debug(meta ?? {}, m),
    info: (m, meta) => app.log.info(meta ?? {}, m),
    warn: (m, meta) => app.log.warn(meta ?? {}, m),
    error: (m, meta) => app.log.error(meta ?? {}, m),
  };

  const binanceConfig = loadBinanceConfig();
  const chainId = envOptionalString("BINANCE_CHAIN_ID") ?? "56";
  const redisUrl = envOptionalString("REDIS_URL");
  const cache = await createTtlCache(redisUrl, appLogger);

  const service = binanceConfig
    ? new RwaService({
        client: new HttpBinanceRwaClient({
          config: {
            apiKey: binanceConfig.apiKey,
            apiSecret: binanceConfig.apiSecret,
            baseUrl: binanceConfig.baseUrl,
            timeoutMs: binanceConfig.timeoutMs,
            retry: binanceConfig.retry,
          },
          logger: appLogger,
        }),
        cache,
        chainId,
        metadataTtlSeconds: binanceConfig.cacheTtls.metadataSeconds,
        priceTtlSeconds: binanceConfig.cacheTtls.priceSeconds,
        logger: appLogger,
      })
    : null;

  const notConfiguredResponse = () => ({
    error: {
      category: "not-configured",
      message:
        "Binance Web3 API credentials are not configured. Set BINANCE_API_KEY and BINANCE_API_SECRET in the API environment (see .env.example).",
    },
  });

  app.get("/health", async (): Promise<HealthCheck> => {
    return {
      service: "api",
      status: "ok",
      timestamp: new Date().toISOString(),
      version: API_VERSION,
    };
  });

  /**
   * Readiness: reports configuration state. /health must NOT depend on
   * Binance; /ready with ?probe=1 additionally performs one live read-only
   * Binance call to verify connectivity.
   */
  app.get<{ Querystring: { probe?: string } }>("/ready", async (request, reply) => {
    if (!service) {
      return reply.code(503).send({
        ready: false,
        binanceConfigured: false,
        detail:
          "Binance credentials missing; RWA endpoints disabled. Set BINANCE_API_KEY and BINANCE_API_SECRET.",
      });
    }
    if (request.query.probe !== "1") {
      return { ready: true, binanceConfigured: true };
    }
    try {
      await service.listPlatforms();
      return { ready: true, binanceConfigured: true, binanceConnectivity: "ok" };
    } catch (error) {
      appLogger.warn("ready.probe_failed", {
        category: error instanceof BinanceError ? error.category : "unknown",
      });
      return reply.code(503).send({
        ready: false,
        binanceConfigured: true,
        binanceConnectivity: "failed",
        detail: error instanceof Error ? error.message : "probe failed",
      });
    }
  });

  const requireService = (): RwaService => {
    if (!service) {
      throw Object.assign(new Error("Binance credentials not configured"), {
        statusCode: 503,
        payload: notConfiguredResponse(),
      });
    }
    return service;
  };

  app.get<{ Querystring: { chainId?: string; platformId?: string } }>(
    "/api/rwa/assets",
    async (request) => {
      const { chainId, platformId } = request.query;
      return {
        chainId: chainId ?? chainIdOf(),
        assets: await requireService().listAssets({ chainId, platformId }),
        retrievedAt: new Date().toISOString(),
      };
    },
  );

  app.get<{ Params: { ticker: string } }>("/api/rwa/assets/:ticker", async (request, reply) => {
    const { ticker } = request.params;
    requireTicker(ticker);
    const results = await requireService().searchAssets(ticker);
    const exact = results.filter((r) => r.ticker.toLowerCase() === ticker.toLowerCase());
    if (exact.length === 0) {
      return reply.code(404).send({
        error: { category: "not-found", message: `No RWA token matches ticker ${ticker}` },
      });
    }
    return { results: exact };
  });

  app.get<{ Params: { ticker: string }; Querystring: { chainId?: string; address?: string } }>(
    "/api/rwa/assets/:ticker/market",
    async (request, reply) => {
      const { ticker } = request.params;
      requireTicker(ticker);
      requireAddress(request.query.address);
      const resolved = await requireService().resolveAsset(ticker, {
        chainId: request.query.chainId,
        address: request.query.address,
      });
      if (!resolved) {
        return reply.code(404).send({
          error: { category: "not-found", message: `No tokenized asset found for ${ticker}` },
        });
      }
      const snapshot = await requireService().getAssetMarket(
        resolved.chainId,
        resolved.tokenContractAddress,
      );
      return { ...snapshot, resolved };
    },
  );

  app.get<{ Params: { ticker: string }; Querystring: { chainId?: string; address?: string } }>(
    "/api/rwa/assets/:ticker/price",
    async (request, reply) => {
      const { ticker } = request.params;
      requireTicker(ticker);
      requireAddress(request.query.address);
      const resolved = await requireService().resolveAsset(ticker, {
        chainId: request.query.chainId,
        address: request.query.address,
      });
      if (!resolved) {
        return reply.code(404).send({
          error: { category: "not-found", message: `No tokenized asset found for ${ticker}` },
        });
      }
      return await requireService().getAssetQuote(resolved.chainId, resolved.tokenContractAddress);
    },
  );

  app.get("/api/rwa/platforms", async () => {
    return { platforms: await requireService().listPlatforms() };
  });

  // Validate query/param shapes up front; business errors come from services.
  function requireTicker(ticker: string): void {
    if (!TICKER_PATTERN.test(ticker)) {
      throw Object.assign(new Error(`Invalid ticker: ${ticker}`), { statusCode: 400 });
    }
  }
  function requireAddress(address: string | undefined): void {
    if (address !== undefined && !CONTRACT_PATTERN.test(address)) {
      throw Object.assign(new Error(`Invalid contract address: ${address}`), { statusCode: 400 });
    }
  }
  function chainIdOf(): string {
    return chainId;
  }

  // Map typed errors to structured HTTP responses (never leak config values).
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    if (typeof error.statusCode === "number") {
      const payload = (error as unknown as { payload?: unknown }).payload;
      return reply
        .code(error.statusCode)
        .send(payload ?? { error: { category: "invalid-request", message: error.message } });
    }
    if (error instanceof BinanceNotConfiguredError) {
      return reply.code(503).send(notConfiguredResponse());
    }
    if (error instanceof BinanceError) {
      const statusCode = error.category === "invalid-request" ? 400 : 502;
      appLogger.error("rwa.upstream_error", { category: error.category, code: error.code });
      return reply.code(statusCode).send({
        error: {
          category: error.category,
          code: error.code,
          message: error.message,
        },
      });
    }
    appLogger.error("api.unhandled_error", { message: error.message });
    return reply.code(500).send({
      error: { category: "internal", message: "Internal server error" },
    });
  });

  app.addHook("onClose", async () => {
    await cache.close();
  });

  app.log.info({ environment, binanceConfigured: Boolean(binanceConfig) }, "api.components_built");
  return app;
}
