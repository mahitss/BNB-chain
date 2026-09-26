/** Prisma-backed proposal store implementing ProposalStoreLike. */
import type { RiskDecision, RiskInput } from "@olyr/types";
import type { ProposalStoreLike } from "./service.js";

export interface PrismaDelegate {
  tradeProposal: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
  riskEvaluation: {
    create(args: {
      data: Record<string, unknown> & { ruleResults: { create: Array<Record<string, unknown>> } };
    }): Promise<Record<string, unknown>>;
    findMany(args: {
      where: { proposalId: string };
      orderBy?: unknown;
    }): Promise<Array<Record<string, unknown>>>;
  };
}

export class PrismaProposalStore implements ProposalStoreLike {
  private readonly prisma: PrismaDelegate;

  constructor(prisma: PrismaDelegate) {
    this.prisma = prisma;
  }

  async createProposal(data: Record<string, unknown>): Promise<{ id: string; createdAt: Date }> {
    const row = await this.prisma.tradeProposal.create({ data });
    return { id: row.id as string, createdAt: row.createdAt as Date };
  }

  async listProposals(): Promise<Array<Record<string, unknown>>> {
    return this.prisma.tradeProposal.findMany({ orderBy: { createdAt: "desc" } });
  }

  async getProposal(id: string): Promise<Record<string, unknown> | null> {
    return this.prisma.tradeProposal.findUnique({ where: { id } });
  }

  async updateProposalStatus(id: string, status: string): Promise<void> {
    await this.prisma.tradeProposal.update({ where: { id }, data: { status } });
  }

  async createEvaluation(data: {
    proposalId: string;
    decision: string;
    input: RiskInput;
    decisionJson: RiskDecision;
  }): Promise<{ id: string }> {
    const row = await this.prisma.riskEvaluation.create({
      data: {
        proposalId: data.proposalId,
        decision: data.decision,
        input: data.input as never,
        rulesPassed: data.decisionJson.rulesPassed as never,
        rulesFailed: data.decisionJson.rulesFailed as never,
        warnings: data.decisionJson.warnings as never,
        requiresReview: data.decisionJson.requiresReview as never,
        rulesEvaluated: data.decisionJson.rulesEvaluated as never,
        ruleResults: {
          create: [...data.decisionJson.rulesFailed].map((rule) => ({
            rule: rule.rule,
            outcome: rule.outcome,
            reason: rule.reason ?? null,
            warning: rule.warning ?? null,
          })),
        },
      },
    });
    return { id: row.id as string };
  }

  async getEvaluations(proposalId: string): Promise<Array<Record<string, unknown>>> {
    return this.prisma.riskEvaluation.findMany({
      where: { proposalId },
      orderBy: { createdAt: "asc" },
    });
  }
}
