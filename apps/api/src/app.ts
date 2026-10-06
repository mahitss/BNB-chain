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
import { randomUUID as cryptoRandomUUID } from "node:crypto";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
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
  envInt,
} from "@olyr/config";
import type { HealthCheck } from "@olyr/types";
import { createTtlCache } from "./cache.js";
import { RwaService } from "./services/rwa.js";
import { MarketIntelligenceService } from "./services/market.js";
import { OpportunityScanner } from "./scanner/scanner.js";
import { InMemoryScanStore } from "./scanner/store.js";
import { createDistributedLock } from "./scanner/lock.js";
import {
  AgentUnavailableError,
  HttpAgentClient,
  type AgentClient,
} from "./strategies/agent-client.js";
import { loadStrategyLimits } from "./strategies/limits.js";
import { RegistryValidationError, StrategyRegistry } from "./strategies/registry.js";
import { registerSystemStatusRoutes } from "./system/routes.js";
import { registerDiagnosticsRoutes } from "./system/diagnostics.js";
import { HttpRiskEngineClient, type RiskEngineClient } from "./proposals/risk-client.js";
import { PrismaProposalStore, type PrismaDelegate } from "./proposals/prisma-store.js";
import { ProposalService } from "./proposals/service.js";
import { RiskEngineUnavailableError } from "./proposals/risk-client.js";
import {
  ChainGuardError,
  KillSwitchError,
  assertExecutionPermitted,
  loadSecurityConfig,
} from "./security/hardening.js";
import {
  registerExecutionRoutes,
  createExecutionStore,
  type ExecutionDeps,
} from "./executions/routes.js";
import type { BinanceTradingClient } from "@olyr/binance";
import { registerWalletRoutes, type WalletDeps } from "./wallet/routes.js";
import { BawCliWalletProvider, ConfiguredAddressWalletProvider, WalletNotConfiguredError, WalletReadError, type AgenticWalletProvider } from "./wallet/providers.js";
import { StrategyLoopWorker } from "./wallet/strategy-loop.js";

export const API_VERSION = "0.3.0";

const TICKER_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;
const CONTRACT_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export interface BuildAppOptions {
  /** Test seam: inject a client instead of the HTTP implementation. */
  binanceClient?: BinanceRwaClient;
  /** Test seam: inject the agent client instead of HTTP transport. */
  agentClient?: AgentClient;
  /** Test seam: inject a Prisma-like client instead of the real one. */
  prisma?: import("./strategies/registry.js").PrismaClientLike;
  /** Test seam: inject the risk-engine client instead of HTTP transport. */
  riskClient?: RiskEngineClient;
  /** Test seam: inject the Binance trading client instead of HTTP transport. */
  tradingClient?: BinanceTradingClient;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: loadEnvironment() === "development" ? "debug" : "info" },
    bodyLimit: 256 * 1024, // 256 KB — no legitimate request is larger
    genReqId: () => cryptoRandomUUID(),
  });
  // The web app calls this API cross-origin in local dev (different ports);
  // the API is the only Binance-capable upstream, so it must answer the
  // browser directly. Reflect the origin; never expose credentials here.
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    // Internal endpoints are token-guarded separately; still rate-limited.
  });
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

  // Strategy registry (Phase 4): Prisma-backed; endpoints degrade to 503 in
  // dev mode when DATABASE_URL is not configured.
  let registry: StrategyRegistry | null = null;
  let prisma: import("@prisma/client").PrismaClient | null = null;
  if (options.prisma) {
    registry = new StrategyRegistry({
      prisma: options.prisma,
      limits: loadStrategyLimits(),
      ownerId: envOptionalString("OLYR_DEFAULT_OWNER") ?? "local-dev",
    });
  } else if (process.env["DATABASE_URL"]) {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    registry = new StrategyRegistry({
      prisma: prisma as unknown as import("./strategies/registry.js").PrismaClientLike,
      limits: loadStrategyLimits(),
      ownerId: envOptionalString("OLYR_DEFAULT_OWNER") ?? "local-dev",
    });
  }
  (app as unknown as { olyrPrisma?: unknown }).olyrPrisma = prisma;
  registerSystemStatusRoutes(app, {
    prismaReady: Boolean(options.prisma ?? prisma),
    binanceConfigured: Boolean(binanceConfig),
    riskUrl: envOptionalString("OLYR_RISK_URL") ?? "http://localhost:8002",
    agentUrl: envOptionalString("OLYR_AGENT_URL") ?? "http://localhost:8000",
    executionUrl: envOptionalString("OLYR_EXECUTION_URL") ?? "http://localhost:8101",
    policyMode: (envOptionalString("OLYR_EXECUTION_POLICY") ?? "MANUAL").toUpperCase(),
    scannerEnabled: intelligenceConfig.scan.enabled,
  });
  const agentClient: AgentClient =
    options.agentClient ??
    new HttpAgentClient(envOptionalString("OLYR_AGENT_URL") ?? "http://localhost:8000");

  // Trade proposals (Phase 5): built from validated strategies + Phase 3
  // market data; risk decisions come exclusively from the Rust engine.
  // The wallet provider is selected below; the position resolver reads it
  // lazily so real positions flow into POSITION_LIMIT (null when unknown).
  // eslint-disable-next-line prefer-const -- assigned once below, after executionDeps exists
  let walletProvider: AgenticWalletProvider;
  let proposalService: ProposalService | null = null;
  const prismaDelegate = (options.prisma ?? prisma) as unknown as PrismaDelegate | null;
  if (prismaDelegate) {
    proposalService = new ProposalService(
      new PrismaProposalStore(prismaDelegate),
      options.riskClient ??
        new HttpRiskEngineClient(envOptionalString("OLYR_RISK_URL") ?? "http://localhost:8002"),
      envInt("OLYR_PROPOSAL_TTL_SECONDS", 300),
      {
        positionUsdForTicker: async (ticker: string): Promise<number | null> => {
          try {
            if (!marketService) return null;
            const snapshot = await marketService.getSnapshot(ticker);
            const contract = snapshot?.tokenContractAddress;
            if (!contract) return null;
            const positions = await walletProvider.getPositions([contract]);
            const raw = positions[0]?.valueUsd;
            const value = raw === null || raw === undefined ? NaN : Number(raw);
            return Number.isFinite(value) && value >= 0 ? value : null;
          } catch {
            return null;
          }
        },
      },
    );
  }

  const executionStore = prismaDelegate ? createExecutionStore(prismaDelegate) : null;
  const securityConfig = loadSecurityConfig();
  const guardExecution = (): void => {
    assertExecutionPermitted(securityConfig);
  };

  const executionDeps: ExecutionDeps = {
    tradingClient:
      options.tradingClient ??
      (binanceConfig
        ? new (await import("@olyr/binance")).HttpBinanceTradingClient({
            config: {
              apiKey: binanceConfig.apiKey,
              apiSecret: binanceConfig.apiSecret,
              baseUrl: binanceConfig.baseUrl,
              timeoutMs: binanceConfig.timeoutMs,
              retry: binanceConfig.retry,
            },
            logger: appLogger,
          })
        : (null as unknown as BinanceTradingClient)),
    policyMode: (
      envOptionalString("OLYR_EXECUTION_POLICY") ?? "MANUAL"
    ).toUpperCase() as ExecutionDeps["policyMode"],
    ownerActor: envOptionalString("OLYR_DEFAULT_OWNER") ?? "local-dev",
    executorAddress: envOptionalString("OLYR_EXECUTOR_ADDRESS") ?? null,
    quoteTtlSeconds: envInt("OLYR_QUOTE_TTL_SECONDS", 30),
    internalToken: envOptionalString("OLYR_INTERNAL_TOKEN") ?? null,
    chainId,
    guardExecution,
  };

  // Diagnostics (Phase 10.1): safe credential-presence check + agent state
  // source of truth. Registered after the trading client exists so the live
  // probe can distinguish NOT_CONFIGURED from AUTHENTICATION_FAILED.
  registerDiagnosticsRoutes(app, {
    scanEnabled: intelligenceConfig.scan.enabled,
    binanceConfigured: Boolean(binanceConfig),
    lastScanAt: store.lastScanOutcome().at,
    tradingClient: executionDeps.tradingClient,
  });
  if (executionStore) {
    registerExecutionRoutes(app, executionDeps, executionStore);
  }

  // Wallet + agent-status routes (Phase 7) + the bounded agent loop.
  // Provider selection: a configured on-chain identity (OLYR_EXECUTOR_ADDRESS)
  // enables the read-only address provider backed by the Binance balance API;
  // otherwise the baw CLI adapter applies (fails closed until provisioned).
  // Neither path holds signing material — execution stays with the Go service.
  const walletLimits = loadStrategyLimits();
  const addressProvider =
    executionDeps.executorAddress && binanceConfig
      ? new ConfiguredAddressWalletProvider({
          address: executionDeps.executorAddress,
          chainId,
          readBalances: (balanceChainId, address) =>
            (
              executionDeps.tradingClient as BinanceTradingClient
            ).getAllTokenBalances(balanceChainId, address),
        })
      : null;
  walletProvider = addressProvider ?? new BawCliWalletProvider({});
  registerWalletRoutes(app, {
    provider: walletProvider,
    policyMode: executionDeps.policyMode,
    limits: { ...walletLimits, maxSlippagePercent: envInt("OLYR_MAX_SLIPPAGE_PERCENT", 1) },
    binanceConfigured: Boolean(binanceConfig),
  } satisfies WalletDeps);

  let strategyLoop: StrategyLoopWorker | null = null;
  if (service && executionStore && intelligenceConfig.scan.enabled) {
    strategyLoop = new StrategyLoopWorker({
      registry: registry!,
      proposals: {
        create: (definition, strategyId, snapshot) => {
          const svc = requireProposals();
          return svc.create(definition, strategyId, snapshot);
        },
        updateProposalStatus: async (id, status) => {
          // Delegate to the proposal service's store through its public method.
          await requireProposals().updateStatus(id, status);
        },
      },
      riskClient:
        options.riskClient ??
        new (await import("./proposals/risk-client.js")).HttpRiskEngineClient(
          envOptionalString("OLYR_RISK_URL") ?? "http://localhost:8002",
        ),
      tradingClient: executionDeps.tradingClient,
      executionStore,
      marketService: marketService!,
      intelligenceConfig,
      policy: {
        mode: executionDeps.policyMode,
        maxTradeUsd: walletLimits.maxStrategyTradeUsd,
        maxDailyUsd: walletLimits.maxStrategyDailyUsd,
        maxSlippagePercent: envInt("OLYR_MAX_SLIPPAGE_PERCENT", 1),
        allowedAssets: envOptionalString("OLYR_ALLOWED_ASSETS")
          ? envOptionalString("OLYR_ALLOWED_ASSETS")!
              .split(",")
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean)
          : [],
        allowedActions: envOptionalString("OLYR_ALLOWED_ACTIONS")
          ? envOptionalString("OLYR_ALLOWED_ACTIONS")!
              .split(",")
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean)
          : [],
        requireHumanApprovalAboveUsd: envInt("OLYR_REQUIRE_HUMAN_APPROVAL_ABOVE_USD", 10),
      },
      limits: walletLimits,
      cooldownSeconds: envInt("OLYR_STRATEGY_COOLDOWN_SECONDS", 900),
      intervalSeconds: envInt("OLYR_STRATEGY_LOOP_SECONDS", 300),
      chainId,
      logger: appLogger,
    });
    strategyLoop.start();
  }

  app.get("/api/agent/status", async () => {
    const strategies = registry ? await registry.list() : [];
    const active = strategies.filter((s) => s.status === "ACTIVE");
    const latest = store.latest();
    return {
      loopEnabled: strategyLoop !== null,
      executionPolicy: executionDeps.policyMode,
      activeStrategies: active.length,
      totalStrategies: strategies.length,
      lastScanAt: latest.completedAt,
      lastRun: strategyLoop?.getStatus() ?? null,
      opportunities: latest.opportunities,
      timestamp: new Date().toISOString(),
    };
  });

  const requireProposals = (): ProposalService => {
    if (!proposalService) {
      throw Object.assign(
        new Error("Proposal pipeline not configured: set DATABASE_URL (see .env.example)"),
        {
          statusCode: 503,
          payload: {
            error: {
              category: "not-configured",
              message:
                "Proposal pipeline requires DATABASE_URL (PostgreSQL). See .env.example and docker-compose.yml.",
            },
          },
        },
      );
    }
    return proposalService;
  };

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

  const requireRegistry = (): StrategyRegistry => {
    if (!registry) {
      throw Object.assign(
        new Error("Strategy registry not configured: set DATABASE_URL (see .env.example)"),
        {
          statusCode: 503,
          payload: {
            error: {
              category: "not-configured",
              message:
                "Strategy registry requires DATABASE_URL (PostgreSQL). See .env.example and docker-compose.yml.",
            },
          },
        },
      );
    }
    return registry;
  };

  // ---- Strategy endpoints (Phase 4) --------------------------------------

  app.post<{ Body: { text?: string } }>("/api/strategies/parse", async (request, reply) => {
    const text = typeof request.body?.text === "string" ? request.body.text : "";
    try {
      return await requireRegistry().parseWithAgent(agentClient, text);
    } catch (error) {
      if (error instanceof AgentUnavailableError) {
        return reply.code(error.status).send({
          error: {
            category: error.status === 503 ? "provider-not-configured" : "agent-unavailable",
            message: error.message,
          },
        });
      }
      throw error;
    }
  });

  app.post<{ Body: { strategy?: unknown } }>("/api/strategies", async (request, reply) => {
    try {
      const record = await requireRegistry().create(request.body?.strategy);
      return reply.code(201).send(record);
    } catch (error) {
      if (error instanceof RegistryValidationError) {
        return reply.code(422).send({
          error: { category: "validation-failed", message: error.message, errors: error.errors },
        });
      }
      throw error;
    }
  });

  app.get("/api/strategies", async () => {
    return { strategies: await requireRegistry().list() };
  });

  app.get<{ Params: { id: string } }>("/api/strategies/:id", async (request, reply) => {
    const record = await requireRegistry().get(request.params.id);
    if (!record) {
      return reply
        .code(404)
        .send({ error: { category: "not-found", message: "Strategy not found" } });
    }
    return record;
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; status?: string } }>(
    "/api/strategies/:id",
    async (request, reply) => {
      const { name, status } = request.body ?? {};
      try {
        if (typeof status === "string") {
          return await requireRegistry().updateStatus(request.params.id, status as never, [
            "DRAFT",
            "ACTIVE",
            "PAUSED",
          ]);
        }
        if (typeof name === "string") {
          return await requireRegistry().updateName(request.params.id, name);
        }
        return reply.code(400).send({
          error: { category: "invalid-request", message: "Provide name or status to update" },
        });
      } catch (error) {
        if (error instanceof RegistryValidationError) {
          return reply.code(422).send({
            error: { category: "validation-failed", message: error.message, errors: error.errors },
          });
        }
        if (error instanceof Error && error.message === "NOT_FOUND") {
          return reply
            .code(404)
            .send({ error: { category: "not-found", message: "Strategy not found" } });
        }
        throw error;
      }
    },
  );

  const statusTransition =
    (to: "ACTIVE" | "PAUSED", allowedFrom: string[]) =>
    async (request: { params: { id: string } }, reply: FastifyReply) => {
      try {
        return await requireRegistry().updateStatus(request.params.id, to, allowedFrom as never);
      } catch (error) {
        if (error instanceof RegistryValidationError) {
          return reply.code(422).send({
            error: { category: "validation-failed", message: error.message, errors: error.errors },
          });
        }
        if (error instanceof Error && error.message === "NOT_FOUND") {
          return reply
            .code(404)
            .send({ error: { category: "not-found", message: "Strategy not found" } });
        }
        throw error;
      }
    };

  app.post<{ Params: { id: string } }>(
    "/api/strategies/:id/activate",
    statusTransition("ACTIVE", ["DRAFT", "PAUSED"]),
  );
  app.post<{ Params: { id: string } }>(
    "/api/strategies/:id/pause",
    statusTransition("PAUSED", ["ACTIVE"]),
  );

  app.get<{ Params: { id: string } }>("/api/strategies/:id/events", async (request) => {
    requireRegistry();
    return {
      strategyId: request.params.id,
      events: await registry!.events(request.params.id),
    };
  });

  // ---- Portfolio: real read-only balances when the wallet resolves,
  // otherwise an explicit error (never fabricated zeros) ----

  const portfolioOf = async (ticker?: string) => {
    const balances = await walletProvider.getBalances();
    const wanted = ticker?.toUpperCase();
    const positions = balances
      .filter(
        (b) =>
          !wanted ||
          b.symbol?.toUpperCase() === wanted ||
          b.tokenContractAddress.toLowerCase() === wanted.toLowerCase(),
      )
      .map((b) => {
        const amount = b.balance !== null ? Number(b.balance) : NaN;
        const price = b.tokenPrice !== null ? Number(b.tokenPrice) : NaN;
        const valueUsd =
          Number.isFinite(amount) && Number.isFinite(price) && amount >= 0 && price >= 0
            ? String(amount * price)
            : null;
        return {
          symbol: b.symbol,
          tokenContractAddress: b.tokenContractAddress,
          chainId: b.chainId,
          balance: b.balance,
          tokenPrice: b.tokenPrice,
          valueUsd,
        };
      });
    return {
      positions,
      source: "binance-web3",
      timestamp: new Date().toISOString(),
    };
  };

  app.get("/api/portfolio", async (_request, reply) => {
    try {
      return await portfolioOf();
    } catch (error) {
      if (error instanceof WalletNotConfiguredError) {
        return reply.code(503).send({
          error: {
            category: "wallet-not-configured",
            message:
              "Portfolio requires a configured wallet: set OLYR_EXECUTOR_ADDRESS to a BSC address or provision the Agentic Wallet (baw CLI signed in).",
          },
        });
      }
      if (error instanceof WalletReadError) {
        return reply.code(502).send({
          error: { category: "wallet-read-failed", message: error.message },
        });
      }
      throw error;
    }
  });

  app.get<{ Params: { ticker: string } }>("/api/portfolio/:ticker", async (request, reply) => {
    requireTicker(request.params.ticker);
    try {
      return await portfolioOf(request.params.ticker);
    } catch (error) {
      if (error instanceof WalletNotConfiguredError) {
        return reply.code(503).send({
          error: {
            category: "wallet-not-configured",
            message: "Portfolio requires a configured wallet (OLYR_EXECUTOR_ADDRESS or baw CLI).",
          },
        });
      }
      if (error instanceof WalletReadError) {
        return reply.code(502).send({
          error: { category: "wallet-read-failed", message: error.message },
        });
      }
      throw error;
    }
  });

  // ---- Trade proposal pipeline (Phase 5) ---------------------------------

  app.post<{ Body: { strategyId?: string; ticker?: string } }>(
    "/api/proposals",
    async (request, reply) => {
      const proposals = requireProposals();
      const strategyId =
        typeof request.body?.strategyId === "string" ? request.body.strategyId : null;
      const ticker = typeof request.body?.ticker === "string" ? request.body.ticker : null;
      // Resolve the strategy definition: by id from the registry, or inline
      // validated strategy? Only registry strategies can create proposals.
      let definition: import("@olyr/types").StrategyDefinition | null = null;
      if (strategyId) {
        const record = await requireRegistry().get(strategyId);
        if (!record) {
          return reply
            .code(404)
            .send({ error: { category: "not-found", message: "Strategy not found" } });
        }
        definition = record.definition;
      }
      if (!definition && ticker) {
        // Fall back to the latest scanner opportunity for the ticker.
        definition = null;
      }
      if (!definition) {
        return reply.code(400).send({
          error: {
            category: "invalid-request",
            message: "Provide strategyId (a saved strategy) to create a proposal",
          },
        });
      }
      // Latest market snapshot from market intelligence — OPTIONAL: without
      // Binance data the proposal is still created and the risk engine will
      // reject (missing price) rather than the pipeline inventing numbers.
      const snapshot = marketService
        ? await marketService.getSnapshot(definition.asset.ticker)
        : null;
      const proposal = await proposals.create(definition, strategyId, snapshot);
      appLogger.info("proposal.created", { proposalId: proposal.id, asset: proposal.asset });
      await registry?.persistProposalEvents(strategyId, proposal.id, definition.asset.ticker);
      return reply.code(201).send(proposal);
    },
  );

  app.get("/api/proposals", async () => {
    return { proposals: await requireProposals().list() };
  });

  app.get<{ Params: { id: string } }>("/api/proposals/:id", async (request, reply) => {
    const result = await requireProposals().get(request.params.id);
    if (!result) {
      return reply
        .code(404)
        .send({ error: { category: "not-found", message: "Proposal not found" } });
    }
    return { ...result.proposal, evaluations: result.evaluations };
  });

  app.post<{ Params: { id: string } }>(
    "/api/proposals/:id/evaluate-risk",
    async (request, reply) => {
      try {
        return await requireProposals().evaluateStored(request.params.id);
      } catch (error) {
        if (error instanceof Error && error.message === "NOT_FOUND") {
          return reply
            .code(404)
            .send({ error: { category: "not-found", message: "Proposal not found" } });
        }
        if (error instanceof RiskEngineUnavailableError) {
          return reply.code(502).send({
            error: { category: "risk-engine-unavailable", message: error.message },
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/proposals/:id/re-evaluate", async (request, reply) => {
    try {
      return await requireProposals().reevaluate(request.params.id, marketService);
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_FOUND") {
        return reply
          .code(404)
          .send({ error: { category: "not-found", message: "Proposal not found" } });
      }
      if (error instanceof RiskEngineUnavailableError) {
        return reply.code(502).send({
          error: { category: "risk-engine-unavailable", message: error.message },
        });
      }
      throw error;
    }
  });

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
    if (!marketService) {
      // Binance not configured: US equities can still be derived from the
      // calendar; on-chain market is explicitly NOT_CONFIGURED (not UNKNOWN).
      const { getUsEquityCalendarState } = await import("./intelligence/us-equity-calendar.js");
      return {
        usEquities: getUsEquityCalendarState(new Date()),
        usEquitiesSource: "olyr-us-equity-calendar (NYSE rules, America/New_York)",
        onChainMarket: "NOT_CONFIGURED" as const,
        onChainMarketDetail:
          "Binance Web3 API credentials are not configured. Set BINANCE_API_KEY and BINANCE_API_SECRET to enable on-chain market data.",
        timestamp: new Date().toISOString(),
      };
    }
    return marketService.getGlobalState();
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
    if (!marketService) {
      // Binance not configured: the scanner never ran. Return explicit
      // NOT_CONFIGURED so the UI can distinguish "configured + no signals"
      // from "not configured + scanner never evaluated anything".
      return {
        timestamp: new Date().toISOString(),
        dataSource: "none",
        lastScanAt: null,
        opportunities: [],
        configurationStatus: "NOT_CONFIGURED" as const,
        configurationDetail:
          "Binance Web3 API credentials are not configured. The scanner cannot evaluate divergence signals without market data.",
      };
    }
    requireMarketService();
    const latest = store.latest();
    return {
      timestamp: new Date().toISOString(),
      dataSource: "binance-web3",
      lastScanAt: latest.completedAt,
      opportunities: latest.opportunities,
      configurationStatus: "CONFIGURED" as const,
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
    if (error instanceof KillSwitchError) {
      return reply
        .code(503)
        .send({ error: { category: "kill-switch-enabled", message: error.message } });
    }
    if (error instanceof ChainGuardError) {
      return reply.code(403).send({ error: { category: "chain-guard", message: error.message } });
    }
    if (typeof error.statusCode === "number") {
      const payload = (error as unknown as { payload?: unknown }).payload;
      return reply
        .code(error.statusCode)
        .send(payload ?? { error: { category: "invalid-request", message: error.message } });
    }
    if (error instanceof KillSwitchError) {
      return reply
        .code(503)
        .send({ error: { category: "kill-switch-enabled", message: error.message } });
    }
    if (error instanceof ChainGuardError) {
      return reply.code(403).send({ error: { category: "chain-guard", message: error.message } });
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
    await strategyLoop?.stop();
    await scanner?.stop();
    await cache.close();
    await prisma?.$disconnect();
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
