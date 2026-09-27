/**
 * Execution pipeline routes (Phase 6). The browser only ever talks to these
 * Fastify endpoints; only the Go execution service may sign transactions and
 * it reaches Binance exclusively through the token-guarded internal routes
 * below. No route here ever fakes a success state.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { BinanceTradingClient } from "@olyr/binance";
import type { SimulationResult, SwapPreparation, TradeQuote } from "@olyr/types";
import {
  AuthorizationService,
  ExecutionService,
  QuoteService,
  SimulationGate,
  PolicyViolationError,
  StateTransitionError,
  type ExecutionStore,
} from "./service.js";
import { PrismaExecutionStore, type PrismaExecutionDelegate } from "./prisma-store.js";

export interface ExecutionDeps {
  tradingClient: BinanceTradingClient;
  policyMode: "MANUAL" | "BOUNDED_AGENT" | "DISABLED";
  ownerActor: string;
  executorAddress: string | null;
  quoteTtlSeconds: number;
  internalToken: string | null;
  chainId: string;
}

interface StoredSimulation extends SimulationResult {
  swapPreparation?: SwapPreparation | null;
}

export function registerExecutionRoutes(
  app: FastifyInstance,
  deps: ExecutionDeps,
  store: ExecutionStore,
): void {
  const quoteService = new QuoteService(store, deps.quoteTtlSeconds);
  const simulationGate = new SimulationGate(store);
  const authorizationService = new AuthorizationService(store, deps.policyMode, deps.ownerActor);
  const executionService = new ExecutionService(store, deps.policyMode);

  const requireInternalToken = (
    request: { headers: Record<string, unknown> },
    reply: FastifyReply,
  ): boolean => {
    if (!deps.internalToken) {
      void reply.code(503).send({
        error: {
          category: "not-configured",
          message: "Internal execution API requires OLYR_INTERNAL_TOKEN",
        },
      });
      return false;
    }
    if (request.headers["x-olyr-internal-token"] !== deps.internalToken) {
      void reply
        .code(401)
        .send({ error: { category: "unauthorized", message: "Invalid internal token" } });
      return false;
    }
    return true;
  };

  const requireTradingClient = (reply: FastifyReply): boolean => {
    if (!deps.tradingClient) {
      void reply.code(503).send({
        error: {
          category: "not-configured",
          message:
            "Binance Web3 API credentials are not configured; quotes, simulation and broadcast are unavailable (see .env.example).",
        },
      });
      return false;
    }
    return true;
  };

  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PolicyViolationError) {
      return reply
        .code(403)
        .send({ error: { category: "policy-violation", message: error.reason } });
    }
    if (error instanceof StateTransitionError) {
      return reply.code(409).send({ error: { category: "invalid-state", message: error.message } });
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return reply.code(404).send({ error: { category: "not-found", message: "Not found" } });
    }
    throw error;
  };

  // ---- Quotes -------------------------------------------------------------

  app.post<{
    Body: {
      proposalId?: string;
      fromTokenAddress?: string;
      toTokenAddress?: string;
      amount?: string;
    };
  }>("/api/quotes", async (request, reply) => {
    const { proposalId, fromTokenAddress, toTokenAddress, amount } = request.body ?? {};
    if (
      typeof proposalId !== "string" ||
      typeof fromTokenAddress !== "string" ||
      typeof toTokenAddress !== "string" ||
      typeof amount !== "string" ||
      !/^\d+$/.test(amount)
    ) {
      return reply.code(400).send({
        error: {
          category: "invalid-request",
          message:
            "proposalId, fromTokenAddress, toTokenAddress and a positive integer-string amount are required",
        },
      });
    }
    const proposal = await app.inject({ method: "GET", url: `/api/proposals/${proposalId}` });
    if (proposal.statusCode !== 200) {
      return reply.code(proposal.statusCode).send(proposal.body);
    }
    const proposalBody = JSON.parse(proposal.body) as { status: string };
    if (proposalBody.status !== "APPROVED") {
      return reply.code(409).send({
        error: {
          category: "invalid-state",
          message: `Quotes require an APPROVED proposal (current: ${proposalBody.status})`,
        },
      });
    }
    if (!requireTradingClient(reply)) return;
    try {
      const routes = await deps.tradingClient.getQuote({
        chainId: deps.chainId,
        fromTokenAddress,
        toTokenAddress,
        amount,
        userWalletAddress: deps.executorAddress ?? undefined,
      });
      if (routes.length === 0) {
        return reply.code(502).send({
          error: { category: "quote-unavailable", message: "No vendor returned a quote" },
        });
      }
      const best = routes[0]!;
      const quote = await quoteService.recordQuote(proposalId, {
        chainId: deps.chainId,
        fromTokenAddress,
        toTokenAddress,
        amountIn: amount,
        estimatedAmountOut: best.toTokenAmount,
        routes,
        source: "binance-web3",
      });
      return reply.code(201).send(quote);
    } catch (error) {
      app.log.error(
        { message: error instanceof Error ? error.message : String(error) },
        "quote.failed",
      );
      return reply.code(502).send({
        error: {
          category: "quote-unavailable",
          message: error instanceof Error ? error.message : "quote failed",
        },
      });
    }
  });

  // ---- Simulation ---------------------------------------------------------

  app.post<{ Params: { id: string } }>("/api/proposals/:id/simulate", async (request, reply) => {
    const proposalId = request.params.id;
    const proposalRow = await app.inject({ method: "GET", url: `/api/proposals/${proposalId}` });
    if (proposalRow.statusCode !== 200) {
      return reply.code(proposalRow.statusCode).send(proposalRow.body);
    }
    const proposal = JSON.parse(proposalRow.body) as {
      status: string;
      requestedAmountUsd: number;
      asset: string;
    };
    if (proposal.status !== "APPROVED") {
      return reply.code(409).send({
        error: {
          category: "invalid-state",
          message: `Simulation requires an APPROVED proposal (current: ${proposal.status})`,
        },
      });
    }
    const existingQuote = await quoteService.latestQuote(proposalId);
    if (!existingQuote || Date.parse(existingQuote.quote.expiresAt) < Date.now()) {
      return reply.code(409).send({
        error: {
          category: "invalid-state",
          message: "Quote missing or expired — fetch a fresh quote first",
        },
      });
    }
    const quote = existingQuote.quote;
    const bestRoute = quote.routes[0];
    if (!bestRoute?.vendorName) {
      return reply.code(502).send({
        error: { category: "quote-unavailable", message: "Stored quote has no vendor route" },
      });
    }
    if (!requireTradingClient(reply)) return;
    try {
      // RFQ routes (equity/RWA) REQUIRE the wallet address for quoting.
      const swap = await deps.tradingClient.buildSwap({
        chainId: deps.chainId,
        fromTokenAddress: quote.fromTokenAddress,
        toTokenAddress: quote.toTokenAddress,
        amount: quote.amountIn,
        quoteId: bestRoute.quoteId ?? "",
        userWalletAddress: deps.executorAddress ?? undefined,
      });
      let simulation: SimulationResult & { swapPreparation?: SwapPreparation };
      if (swap.mode === "SWAP" && swap.tx) {
        simulation = {
          ...(await deps.tradingClient.simulateTransaction(deps.chainId, swap.tx)),
          swapPreparation: swap,
        };
      } else {
        // RFQ: settlement is validated by the vendor during order submission;
        // the EVM transaction simulator does not apply to EIP-712 orders.
        simulation = {
          id: `rfq_${Date.now()}`,
          proposalId,
          status: "UNKNOWN",
          apiStatus: "RFQ",
          failReason: null,
          gasEstimate: null,
          balanceChanges: [],
          allowanceChanges: [],
          warnings: ["RFQ order: settlement validity is enforced by the vendor at submission"],
          timestamp: new Date().toISOString(),
          source: "binance-web3",
          swapPreparation: swap,
        };
      }
      const stored = await simulationGate.recordSimulation(
        proposalId,
        existingQuote.id,
        simulation,
      );
      return reply.code(201).send({
        ...stored,
        swap: {
          mode: swap.mode,
          toTokenAmount: swap.toTokenAmount,
          minReceiveAmount: swap.minReceiveAmount,
          slippagePercent: swap.slippagePercent,
          priceImpactPercent: swap.priceImpactPercent,
          tradeFeeUsd: swap.tradeFeeUsd,
          estimateGasFee: swap.estimateGasFee,
        },
      });
    } catch (error) {
      app.log.error(
        { message: error instanceof Error ? error.message : String(error) },
        "simulate.failed",
      );
      return reply.code(502).send({
        error: {
          category: "simulation-unavailable",
          message: error instanceof Error ? error.message : "simulation failed",
        },
      });
    }
  });

  app.get<{ Params: { id: string } }>("/api/simulations/:id", async (request, reply) => {
    void request;
    void reply;
    // Simulations are exposed through the proposal record; kept for the
    // documented surface. Fetching a single simulation by id is not needed by
    // any current flow — 501 makes that explicit instead of faking it.
    return reply.code(501).send({
      error: { category: "not-implemented", message: "Fetch simulations via the proposal" },
    });
  });

  // ---- Authorization ------------------------------------------------------

  app.post<{ Params: { id: string }; Body: { decision?: "APPROVE" | "REJECT" } }>(
    "/api/proposals/:id/authorize",
    async (request, reply) => {
      const proposalId = request.params.id;
      const proposalRow = await app.inject({ method: "GET", url: `/api/proposals/${proposalId}` });
      if (proposalRow.statusCode !== 200) {
        return reply.code(proposalRow.statusCode).send(proposalRow.body);
      }
      const proposal = JSON.parse(proposalRow.body) as {
        status: string;
        riskDecision: { decision: string } | null;
      };
      const quote = await quoteService.latestQuote(proposalId);
      const simulation = await simulationGate.latestSimulation(proposalId);
      try {
        const record = await authorizationService.authorize(
          {
            ...(proposal as unknown as import("@olyr/types").TradeProposal),
            definition: undefined,
          },
          {
            proposal: proposal as unknown as import("@olyr/types").TradeProposal,
            riskDecision: (proposal.riskDecision as never) ?? null,
            quote: quote as { id: string; quote: TradeQuote } | null,
            simulation: simulation as { id: string; simulation: SimulationResult } | null,
          },
          request.body?.decision,
        );
        return reply.code(201).send(record);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  // ---- Executions ---------------------------------------------------------

  app.post<{ Body: { proposalId?: string } }>("/api/executions", async (request, reply) => {
    const proposalId = request.body?.proposalId;
    if (typeof proposalId !== "string") {
      return reply
        .code(400)
        .send({ error: { category: "invalid-request", message: "proposalId is required" } });
    }
    const proposalRow = await app.inject({ method: "GET", url: `/api/proposals/${proposalId}` });
    if (proposalRow.statusCode !== 200) {
      return reply.code(proposalRow.statusCode).send(proposalRow.body);
    }
    const proposal = JSON.parse(proposalRow.body) as {
      status: string;
      riskDecision: { decision: string } | null;
      expiresAt: string;
    };
    const quote = await quoteService.latestQuote(proposalId);
    const simulation = await simulationGate.latestSimulation(proposalId);
    const authorization = await store.latestAuthorization(proposalId);
    try {
      const execution = await executionService.createExecution({
        proposal: proposal as unknown as import("@olyr/types").TradeProposal,
        riskDecision: (proposal.riskDecision as never) ?? null,
        quote: quote as { id: string; quote: TradeQuote } | null,
        simulation: simulation as { id: string; simulation: SimulationResult } | null,
        authorization,
        environment: deps.tradingClient ? "DRY_RUN" : "DRY_RUN",
      });
      return reply.code(201).send(execution);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get("/api/executions", async () => {
    return { executions: await executionService.list() };
  });

  app.get<{ Params: { id: string } }>("/api/executions/:id", async (request, reply) => {
    const execution = await executionService.get(request.params.id);
    if (!execution) {
      return reply
        .code(404)
        .send({ error: { category: "not-found", message: "Execution not found" } });
    }
    return execution;
  });

  app.post<{ Params: { id: string } }>("/api/executions/:id/cancel", async (request, reply) => {
    try {
      return await executionService.cancel(request.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  // ---- Internal (Go execution service only; token-guarded) ----------------

  app.get<{ Params: { executionId: string } }>(
    "/api/internal/execution-bundle/:executionId",
    async (request, reply) => {
      if (!requireInternalToken(request, reply)) return;
      const execution = await executionService.get(request.params.executionId);
      if (!execution) {
        return reply
          .code(404)
          .send({ error: { category: "not-found", message: "Execution not found" } });
      }
      const proposalRow = await app.inject({
        method: "GET",
        url: `/api/proposals/${execution.proposalId}`,
      });
      const proposal = proposalRow.statusCode === 200 ? JSON.parse(proposalRow.body) : null;
      const simulation = await simulationGate.latestSimulation(execution.proposalId);
      const storedSimulation = simulation?.simulation as StoredSimulation | undefined;
      return {
        execution,
        proposal,
        quote: await quoteService.latestQuote(execution.proposalId),
        simulation: storedSimulation ?? null,
        swapPreparation: storedSimulation?.swapPreparation ?? null,
        authorization: await store.latestAuthorization(execution.proposalId),
        chainId: deps.chainId,
        executorAddress: deps.executorAddress,
      };
    },
  );

  app.post<{
    Body: { executionId?: string; signedTransaction?: string };
  }>("/api/internal/broadcast", async (request, reply) => {
    if (!requireInternalToken(request, reply)) return;
    if (!requireTradingClient(reply)) return;
    const { executionId, signedTransaction } = request.body ?? {};
    if (
      typeof executionId !== "string" ||
      typeof signedTransaction !== "string" ||
      !signedTransaction.startsWith("0x")
    ) {
      return reply.code(400).send({
        error: {
          category: "invalid-request",
          message: "executionId and signedTransaction (0x…) are required",
        },
      });
    }
    const execution = await executionService.get(executionId);
    if (!execution) {
      return reply
        .code(404)
        .send({ error: { category: "not-found", message: "Execution not found" } });
    }
    try {
      await executionService.transition(executionId, "AUTHORIZED", "BROADCAST_REQUESTED");
      const broadcast = await deps.tradingClient.broadcastTransaction(
        deps.chainId,
        signedTransaction,
        deps.executorAddress ?? "",
      );
      const updated = await executionService.transition(
        executionId,
        "BROADCAST_REQUESTED",
        "BROADCAST",
        { txHash: broadcast.txHash, orderId: broadcast.orderId },
      );
      await store.persistEvents(
        [{ type: "BROADCASTED", detail: { executionId, txHash: broadcast.txHash } }],
        null,
      );
      return reply.code(200).send(updated);
    } catch (error) {
      if (error instanceof StateTransitionError) {
        return fail(reply, error);
      }
      await executionService
        .transition(executionId, "BROADCAST_REQUESTED", "FAILED", {
          failureReason: error instanceof Error ? error.message : "broadcast failed",
        })
        .catch(() => {});
      await store.persistEvents(
        [{ type: "EXECUTION_FAILED", detail: { executionId, stage: "broadcast" } }],
        null,
      );
      return reply.code(502).send({
        error: {
          category: "broadcast-failed",
          message: error instanceof Error ? error.message : "broadcast failed",
        },
      });
    }
  });

  app.post<{
    Body: {
      executionId?: string;
      userSignature?: string;
      vendor?: string;
      quoteId?: string;
      signingScheme?: string | null;
    };
  }>("/api/internal/rfq/submit", async (request, reply) => {
    if (!requireInternalToken(request, reply)) return;
    const { executionId, userSignature, vendor, quoteId, signingScheme } = request.body ?? {};
    if (
      typeof executionId !== "string" ||
      typeof userSignature !== "string" ||
      typeof vendor !== "string" ||
      typeof quoteId !== "string"
    ) {
      return reply.code(400).send({
        error: {
          category: "invalid-request",
          message: "executionId, userSignature, vendor, quoteId are required",
        },
      });
    }
    try {
      const order = await deps.tradingClient.submitRfqOrder({
        requestId: executionId, // deterministic idempotency key per execution
        userSignature,
        vendor,
        quoteId,
        signingScheme: signingScheme ?? null,
      });
      await executionService.transition(executionId, "AUTHORIZED", "BROADCAST_REQUESTED");
      const updated = await executionService.transition(
        executionId,
        "BROADCAST_REQUESTED",
        "BROADCAST",
        {
          orderId: order.orderId,
        },
      );
      await store.persistEvents(
        [{ type: "BROADCASTED", detail: { executionId, orderId: order.orderId, rfq: true } }],
        null,
      );
      return reply.code(200).send(updated);
    } catch (error) {
      if (error instanceof StateTransitionError) return fail(reply, error);
      return reply.code(502).send({
        error: {
          category: "rfq-submit-failed",
          message: error instanceof Error ? error.message : "submit failed",
        },
      });
    }
  });

  app.post<{ Body: { executionId?: string; state?: string; failureReason?: string } }>(
    "/api/internal/execution-state",
    async (request, reply) => {
      if (!requireInternalToken(request, reply)) return;
      const { executionId, state, failureReason } = request.body ?? {};
      if (typeof executionId !== "string" || typeof state !== "string") {
        return reply.code(400).send({
          error: { category: "invalid-request", message: "executionId and state are required" },
        });
      }
      try {
        const current = await executionService.get(executionId);
        if (!current) {
          return reply
            .code(404)
            .send({ error: { category: "not-found", message: "Execution not found" } });
        }
        const from = current.state;
        const to = state as Parameters<typeof executionService.transition>[2];
        if (from !== to) {
          const updated = await executionService.transition(executionId, from, to, {
            failureReason: failureReason ?? undefined,
          });
          if (to === "CONFIRMED") {
            await store.persistEvents([{ type: "CONFIRMED", detail: { executionId } }], null);
          } else if (to === "FAILED") {
            await store.persistEvents(
              [{ type: "EXECUTION_FAILED", detail: { executionId, failureReason } }],
              null,
            );
          }
          return reply.code(200).send(updated);
        }
        return reply.code(200).send(current);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.get<{ Params: { txHash: string } }>(
    "/api/internal/tx-status/:txHash",
    async (request, reply) => {
      if (!requireInternalToken(request, reply)) return;
      try {
        const status = await deps.tradingClient.getTransactionStatus(
          deps.chainId,
          request.params.txHash,
        );
        return reply.code(200).send(status);
      } catch (error) {
        return reply.code(502).send({
          error: {
            category: "status-unavailable",
            message: error instanceof Error ? error.message : "status failed",
          },
        });
      }
    },
  );

  app.get<{ Params: { orderId: string } }>(
    "/api/internal/rfq/order/:orderId",
    async (request, reply) => {
      if (!requireInternalToken(request, reply)) return;
      try {
        return reply
          .code(200)
          .send(await deps.tradingClient.getRfqOrderStatus(request.params.orderId));
      } catch (error) {
        return reply.code(502).send({
          error: {
            category: "status-unavailable",
            message: error instanceof Error ? error.message : "status failed",
          },
        });
      }
    },
  );
}

export function createExecutionStore(prisma: unknown): ExecutionStore {
  return new PrismaExecutionStore(prisma as PrismaExecutionDelegate);
}
