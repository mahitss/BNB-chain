/**
 * Strategy registry service — Prisma persistence + event log + the
 * deterministic explainer. Platform hard limits are re-enforced here before
 * anything is written (defense in depth on top of the agent's pipeline).
 */
import type { AgentEvent, AgentParseResponse, StrategyRecord } from "@olyr/types";
import { explainStrategy } from "./explainer.js";
import { validateStrategyDefinition, type StrategyLimitsConfig } from "./validator.js";
import type { StrategyLimitsConfig as Limits } from "./validator.js";

export { type StrategyLimitsConfig };

export interface RegistryDependencies {
  prisma: PrismaClientLike;
  limits: StrategyLimitsConfig;
  ownerId: string;
}

/** Minimal Prisma surface used by the registry (testable). */
export interface PrismaClientLike {
  strategy: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    findUnique(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    update(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  agentEvent: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
    findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  };
}

export class RegistryValidationError extends Error {
  readonly errors: import("@olyr/types").AgentValidationError[];
  constructor(errors: import("@olyr/types").AgentValidationError[]) {
    super(`Strategy validation failed: ${errors.map((e) => e.message).join("; ")}`);
    this.name = "RegistryValidationError";
    this.errors = errors;
  }
}

function toRecord(row: Record<string, unknown>): StrategyRecord {
  return {
    id: row.id as string,
    ownerId: row.ownerId as string,
    name: row.name as string,
    status: row.status as StrategyRecord["status"],
    definition: row.definition as StrategyRecord["definition"],
    explanation: row.explanation as string,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
  };
}

export class StrategyRegistry {
  private readonly prisma: PrismaClientLike;
  private readonly limits: Limits;
  private readonly ownerId: string;

  constructor(deps: RegistryDependencies) {
    this.prisma = deps.prisma;
    this.limits = deps.limits;
    this.ownerId = deps.ownerId;
  }

  /** Parse via the agent; persist the run's events; never persists a strategy. */
  async parseWithAgent(
    agentClient: { parse(text: string): Promise<AgentParseResponse> },
    text: string,
  ): Promise<AgentParseResponse> {
    const response = await agentClient.parse(text);
    await this.persistEvents(response.events, null);
    return response;
  }

  /** Validate + explain + persist a new strategy (status DRAFT). */
  async create(input: unknown): Promise<StrategyRecord> {
    const { definition, errors } = validateStrategyDefinition(input, this.limits);
    if (!definition) {
      throw new RegistryValidationError(errors);
    }
    const explanation = explainStrategy(definition);
    const row = await this.prisma.strategy.create({
      data: {
        ownerId: this.ownerId,
        name: definition.name,
        status: "DRAFT",
        definition,
        explanation,
      },
    });
    const strategyId = row.id as string;
    await this.persistEvents(
      [{ type: "STRATEGY_SAVED", detail: { name: definition.name, status: "DRAFT" } }],
      strategyId,
    );
    return toRecord(row);
  }

  async list(): Promise<StrategyRecord[]> {
    const rows = await this.prisma.strategy.findMany({
      where: { ownerId: this.ownerId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async get(id: string): Promise<StrategyRecord | null> {
    const row = await this.prisma.strategy.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async updateStatus(
    id: string,
    status: StrategyRecord["status"],
    allowedFrom: StrategyRecord["status"][],
  ): Promise<StrategyRecord> {
    const existing = await this.prisma.strategy.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("NOT_FOUND");
    }
    if (!allowedFrom.includes(existing.status as StrategyRecord["status"])) {
      throw new RegistryValidationError([
        {
          layer: "capability",
          code: "invalid-status-transition",
          message: `Cannot move strategy from ${existing.status} to ${status}`,
        },
      ]);
    }
    const row = await this.prisma.strategy.update({ where: { id }, data: { status } });
    await this.persistEvents(
      [
        {
          type: status === "ACTIVE" ? "STRATEGY_ACTIVATED" : "STRATEGY_PAUSED",
          detail: { status },
        },
      ],
      id,
    );
    return toRecord(row);
  }

  async updateName(id: string, name: string): Promise<StrategyRecord> {
    if (typeof name !== "string" || name.trim().length < 3 || name.length > 80) {
      throw new RegistryValidationError([
        {
          layer: "schema",
          code: "invalid-name",
          message: "name must be a string of 3-80 characters",
        },
      ]);
    }
    const row = await this.prisma.strategy.update({ where: { id }, data: { name: name.trim() } });
    return toRecord(row);
  }

  async events(id: string): Promise<AgentEvent[]> {
    const rows = await this.prisma.agentEvent.findMany({
      where: { strategyId: id },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      type: row.type as AgentEvent["type"],
      detail: (row.detail ?? undefined) as AgentEvent["detail"],
      createdAt: (row.createdAt as Date).toISOString(),
    }));
  }

  /** Audit-trail events for the proposal pipeline (Phase 5). */
  async persistProposalEvents(
    strategyId: string | null,
    proposalId: string,
    ticker: string,
  ): Promise<void> {
    await this.persistEvents(
      [
        { type: "STRATEGY_EVALUATED", detail: { ticker } },
        { type: "OPPORTUNITY_MATCHED", detail: { ticker } },
        { type: "PROPOSAL_CREATED", detail: { proposalId, ticker } },
      ],
      strategyId,
    );
  }

  private async persistEvents(events: AgentEvent[], strategyId: string | null): Promise<void> {
    if (events.length === 0) {
      return;
    }
    await this.prisma.agentEvent.createMany({
      data: events.map((event) => ({
        strategyId,
        type: event.type,
        detail: (event.detail ?? undefined) as never,
      })),
    });
  }
}
