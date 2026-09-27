/** Prisma-backed execution store implementing ExecutionStore. */
import type {
  ExecutionRecord,
  ExecutionState,
  ExecutionPolicyMode,
  SimulationResult,
  TradeQuote,
} from "@olyr/types";
import type { ExecutionStore } from "./service.js";

export interface PrismaExecutionDelegate {
  tradeQuote: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  };
  simulation: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  };
  executionAuthorization: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  };
  execution: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
    findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    findMany(args?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
  agentEvent: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
  };
}

export class PrismaExecutionStore implements ExecutionStore {
  constructor(private readonly prisma: PrismaExecutionDelegate) {}

  async saveQuote(data: { proposalId: string; quote: TradeQuote }): Promise<{ id: string }> {
    const row = await this.prisma.tradeQuote.create({
      data: {
        proposalId: data.proposalId,
        chainId: data.quote.chainId,
        fromTokenAddress: data.quote.fromTokenAddress,
        toTokenAddress: data.quote.toTokenAddress,
        amountIn: data.quote.amountIn,
        estimatedAmountOut: data.quote.estimatedAmountOut,
        routes: data.quote.routes as never,
        tradeFeeUsd: data.quote.routes[0]?.tradeFeeUsd ?? null,
        priceImpactPercent: data.quote.routes[0]?.priceImpactPercent ?? null,
        expiresAt: new Date(data.quote.expiresAt),
      },
    });
    return { id: row.id as string };
  }

  async latestQuote(proposalId: string): Promise<{ id: string; quote: TradeQuote } | null> {
    const row = await this.prisma.tradeQuote.findFirst({
      where: { proposalId },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return {
      id: row.id as string,
      quote: {
        id: row.id as string,
        chainId: row.chainId as string,
        fromTokenAddress: row.fromTokenAddress as string,
        toTokenAddress: row.toTokenAddress as string,
        amountIn: row.amountIn as string,
        estimatedAmountOut: (row.estimatedAmountOut as string | null) ?? null,
        routes: row.routes as TradeQuote["routes"],
        expiresAt: (row.expiresAt as Date).toISOString(),
        source: "binance-web3",
        createdAt: (row.createdAt as Date).toISOString(),
      },
    };
  }

  async saveSimulation(data: {
    proposalId: string;
    quoteId: string | null;
    simulation: SimulationResult;
  }): Promise<{ id: string }> {
    const row = await this.prisma.simulation.create({
      data: {
        proposalId: data.proposalId,
        quoteId: data.quoteId,
        status: data.simulation.status,
        apiStatus: data.simulation.apiStatus,
        failReason: data.simulation.failReason,
        result: data.simulation as never,
      },
    });
    return { id: row.id as string };
  }

  async latestSimulation(
    proposalId: string,
  ): Promise<{ id: string; simulation: SimulationResult } | null> {
    const row = await this.prisma.simulation.findFirst({
      where: { proposalId },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return { id: row.id as string, simulation: row.result as SimulationResult };
  }

  async saveAuthorization(data: {
    proposalId: string;
    quoteId: string | null;
    simulationId: string | null;
    decision: "APPROVED" | "REJECTED";
    actor: string;
    policyMode: ExecutionPolicyMode;
  }): Promise<{ id: string }> {
    const row = await this.prisma.executionAuthorization.create({ data });
    return { id: row.id as string };
  }

  async latestAuthorization(proposalId: string): Promise<{ id: string; decision: string } | null> {
    const row = await this.prisma.executionAuthorization.findFirst({
      where: { proposalId, decision: "APPROVED" },
      orderBy: { createdAt: "desc" },
    });
    return row ? { id: row.id as string, decision: row.decision as string } : null;
  }

  async findExecutionByProposal(proposalId: string): Promise<ExecutionRecord | null> {
    const row = await this.prisma.execution.findFirst({ where: { proposalId } });
    return row ? this.toRecord(row) : null;
  }

  async createExecution(data: {
    proposalId: string;
    quoteId: string | null;
    simulationId: string | null;
    authorizationId: string | null;
    state: ExecutionState;
    idempotencyKey: string;
    environment: string;
  }): Promise<ExecutionRecord> {
    const row = await this.prisma.execution.create({ data });
    return this.toRecord(row);
  }

  async updateExecutionState(
    id: string,
    state: ExecutionState,
    extra?: { orderId?: string; txHash?: string; failureReason?: string },
  ): Promise<ExecutionRecord> {
    const row = await this.prisma.execution.update({
      where: { id },
      data: {
        state,
        ...(extra?.orderId ? { orderId: extra.orderId } : {}),
        ...(extra?.txHash ? { txHash: extra.txHash } : {}),
        ...(extra?.failureReason ? { failureReason: extra.failureReason } : {}),
      },
    });
    return this.toRecord(row);
  }

  async getExecution(id: string): Promise<ExecutionRecord | null> {
    const row = await this.prisma.execution.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async listExecutions(): Promise<ExecutionRecord[]> {
    const rows = await this.prisma.execution.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((row) => this.toRecord(row));
  }

  async persistEvents(
    events: Array<{ type: string; detail?: Record<string, unknown> }>,
    strategyId: string | null,
  ): Promise<void> {
    if (events.length === 0) return;
    await this.prisma.agentEvent.createMany({
      data: events.map((e) => ({
        strategyId,
        type: e.type,
        detail: (e.detail ?? undefined) as never,
      })),
    });
  }

  private toRecord(row: Record<string, unknown>): ExecutionRecord {
    return {
      id: row.id as string,
      proposalId: row.proposalId as string,
      quoteId: (row.quoteId as string | null) ?? null,
      simulationId: (row.simulationId as string | null) ?? null,
      authorizationId: (row.authorizationId as string | null) ?? null,
      state: row.state as ExecutionState,
      orderId: (row.orderId as string | null) ?? null,
      txHash: (row.txHash as string | null) ?? null,
      failureReason: (row.failureReason as string | null) ?? null,
      idempotencyKey: row.idempotencyKey as string,
      createdAt: (row.createdAt as Date).toISOString(),
      updatedAt: (row.updatedAt as Date).toISOString(),
    };
  }
}
