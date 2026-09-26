/**
 * OLYR API application factory.
 *
 * Route handlers are thin adapters: validation + service calls only.
 * Business logic lives in services/ and intelligence/, Binance access in
 * @olyr/binance.
 *
 * Dev mode: without Binance credentials the API starts normally; RWA and
 * market-intelligence endpoints return a structured 503 with setup
 * instructions — never fake data.
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
  type BinanceRwaClient,
  type Logger,
} from "@olyr/binance";
import {
  loadBinanceConfig,
  loadEnvironment,
  loadIntelligenceConfig,
  envOptionalString,
} from "@olyr/config";
import type { HealthCheck } from "@olyr/types";
import { createTtlCache } from "./cache.js";
import { RwaService } from "./services/rwa.js";
import { MarketIntelligenceService } from "./services/market.js";
import { OpportunityScanner } from "./scanner/scanner.js";
import { InMemoryScanStore } from "./scanner/store.js";
import { createDistributedLock } from "./scanner/lock.js";

export const API_VERSION = "0.3.0";

const TICKER_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;
const CONTRACT_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export interface BuildAppOptions {
  /** Test seam: inject a client instead of the HTTP implementation. */
  binanceClient?: BinanceRwaClient;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
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
  const intelligenceConfig = loadIntelligenceConfig();
  const chainId = envOptionalString("BINANCE_CHAIN_ID") ?? "56";
  const redisUrl = envOptionalString("REDIS_URL");
  const cache = await createTtlCache(redisUrl, appLogger);
  const store = new InMemoryScanStore();

  const client: BinanceRwaClient | null =
    options.binanceClient ??
    (binanceConfig
      ? new HttpBinanceRwaClient({
          config: {
            apiKey: binanceConfig.apiKey,
            apiSecret: binanceConfig.apiSecret,
            baseUrl: binanceConfig.baseUrl,
            timeoutMs: binanceConfig.timeoutMs,
            retry: binanceConfig.retry,
          },
          logger: appLogger,
        })
      : null);

  const service = client
    ? new RwaService({
        client,
        cache,
        chainId,
        metadataTtlSeconds: binanceConfig?.cacheTtls.metadataSeconds ?? 300,
        priceTtlSeconds: binanceConfig?.cacheTtls.priceSeconds ?? 15,
        logger: appLogger,
      })
    : null;

  const marketService =
    service && client
      ? new MarketIntelligenceService({
          rwaService: service,
          client,
          config: intelligenceConfig,
          chainId,
          store,
          logger: appLogger,
        })
      : null;

  const scanner =
    service && client && intelligenceConfig.scan.enabled
      ? new OpportunityScanner({
          client,
          store,
          config: intelligenceConfig,
          chainId,
          logger: appLogger,
          distributedLock: (await createDistributedLock(redisUrl, appLogger)) ?? undefined,
        })
      : null;
  scanner?.start();

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

  const requireMarketService = (): MarketIntelligenceService => {
    if (!marketService) {
      throw Object.assign(new Error("Binance credentials not configured"), {
        statusCode: 503,
        payload: notConfiguredResponse(),
      });
    }
    return marketService;
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

  // ---- Market intelligence (Phase 3) ------------------------------------

  /** Global banner: US equities calendar state + on-chain observability. */
  app.get("/api/market/state", async () => {
    return requireMarketService().getGlobalState();
  });

  app.get<{ Params: { ticker: string } }>(
    "/api/market/:ticker/snapshot",
    async (request, reply) => {
      requireTicker(request.params.ticker);
      const snapshot = await requireMarketService().getSnapshot(request.params.ticker);
      if (!snapshot) {
        return reply.code(404).send({
          error: {
            category: "not-found",
            message: `No tokenized asset found for ticker ${request.params.ticker} on chain ${chainIdOf()}`,
          },
        });
      }
      return snapshot;
    },
  );

  app.get<{ Params: { ticker: string } }>("/api/market/:ticker/state", async (request, reply) => {
    requireTicker(request.params.ticker);
    const snapshot = await requireMarketService().getSnapshot(request.params.ticker);
    if (!snapshot) {
      return reply.code(404).send({
        error: {
          category: "not-found",
          message: `No tokenized asset found for ticker ${request.params.ticker} on chain ${chainIdOf()}`,
        },
      });
    }
    return {
      ticker: snapshot.ticker,
      marketState: snapshot.marketState,
      marketStateSource: snapshot.marketStateSource,
      warnings: snapshot.warnings,
      dataSource: snapshot.source,
      timestamp: snapshot.timestamp,
    };
  });

  /** Latest scanner results (empty until the first scan completes). */
  app.get("/api/opportunities", async () => {
    requireMarketService();
    const latest = store.latest();
    return {
      timestamp: new Date().toISOString(),
      dataSource: "binance-web3",
      lastScanAt: latest.completedAt,
      opportunities: latest.opportunities,
    };
  });

  app.get<{ Params: { ticker: string } }>("/api/opportunities/:ticker", async (request, reply) => {
    requireMarketService();
    requireTicker(request.params.ticker);
    const fromStore = store.latestForTicker(request.params.ticker);
    if (fromStore) {
      return { ...fromStore, dataSource: "binance-web3" };
    }
    // Not covered by the last scan: evaluate on demand.
    const evaluated = await requireMarketService().getOpportunity(request.params.ticker);
    if (!evaluated) {
      return reply.code(404).send({
        error: {
          category: "not-found",
          message: `No tokenized asset found for ticker ${request.params.ticker} on chain ${chainIdOf()}`,
        },
      });
    }
    return { ...evaluated, dataSource: "binance-web3" };
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
    await scanner?.stop();
    await cache.close();
  });

  app.log.info(
    {
      environment,
      binanceConfigured: Boolean(binanceConfig),
      scannerEnabled: Boolean(scanner),
    },
    "api.components_built",
  );
  return app;
}
