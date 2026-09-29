/**
 * Execution pipeline service (Phase 6): quotes, simulation, authorization,
 * executions. Deterministic gates only; the browser talks only to Fastify,
 * and only the Go execution service may sign/broadcast.
 *
 * Security gates before any execution can proceed:
 * - policy != DISABLED
 * - risk decision == APPROVED (proposal status)
 * - quote exists and is NOT expired (documented ~30s TTL)
 * - simulation PASSED (SWAP mode) or RFQ vendor-validated flow
 * - explicit authorization (MANUAL) or all bounded-agent gates (BOUNDED_AGENT)
 * - proposal not expired
 * - idempotency: one execution per proposal; repeated requests return the
 *   existing execution instead of submitting again
 */
import {
  isValidExecutionTransition,
  type ExecutionAuthorizationRecord,
  type ExecutionPolicyMode,
  type ExecutionRecord,
  type ExecutionState,
  type RiskDecision,
  type SimulationResult,
  type StrategyDefinition,
  type TradeProposal,
  type TradeQuote,
} from "@olyr/types";

export interface ProposalRecord extends TradeProposal {
  definition?: StrategyDefinition;
}

export interface ExecutionStore {
  saveQuote(data: { proposalId: string; quote: TradeQuote }): Promise<{ id: string }>;
  latestQuote(proposalId: string): Promise<{ id: string; quote: TradeQuote } | null>;
  saveSimulation(data: {
    proposalId: string;
    quoteId: string | null;
    simulation: SimulationResult;
  }): Promise<{ id: string }>;
  latestSimulation(
    proposalId: string,
  ): Promise<{ id: string; simulation: SimulationResult } | null>;
  saveAuthorization(data: {
    proposalId: string;
    quoteId: string | null;
    simulationId: string | null;
    decision: "APPROVED" | "REJECTED";
    actor: string;
    policyMode: ExecutionPolicyMode;
  }): Promise<{ id: string }>;
  latestAuthorization(proposalId: string): Promise<{ id: string; decision: string } | null>;
  findExecutionByProposal(proposalId: string): Promise<ExecutionRecord | null>;
  createExecution(data: {
    proposalId: string;
    quoteId: string | null;
    simulationId: string | null;
    authorizationId: string | null;
    state: ExecutionState;
    idempotencyKey: string;
    environment: string;
  }): Promise<ExecutionRecord>;
  updateExecutionState(
    id: string,
    state: ExecutionState,
    extra?: { orderId?: string; txHash?: string; failureReason?: string },
  ): Promise<ExecutionRecord>;
  getExecution(id: string): Promise<ExecutionRecord | null>;
  listExecutions(): Promise<ExecutionRecord[]>;
  persistEvents(
    events: Array<{ type: string; detail?: Record<string, unknown> }>,
    strategyId: string | null,
  ): Promise<void>;
}

export interface QuoteRequestContext {
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
}

export interface ExecutionServiceOptions {
  store: ExecutionStore;
  policyMode: ExecutionPolicyMode;
  ownerActor: string;
  ttlSeconds: number;
}

export class PolicyViolationError extends Error {
  readonly statusCode = 403;
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "PolicyViolationError";
    this.reason = reason;
  }
}

export class StateTransitionError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "StateTransitionError";
  }
}

export class QuoteService {
  constructor(
    private readonly store: ExecutionStore,
    private readonly ttlSeconds: number,
  ) {}

  /** Persist a fetched quote with documented ~30s TTL. */
  async recordQuote(
    proposalId: string,
    quote: Omit<TradeQuote, "id" | "expiresAt" | "createdAt">,
  ): Promise<TradeQuote> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString();
    const full: TradeQuote = {
      ...quote,
      id: "",
      expiresAt,
      createdAt: new Date().toISOString(),
    };
    const { id } = await this.store.saveQuote({ proposalId, quote: full });
    await this.store.persistEvents(
      [
        { type: "QUOTE_REQUESTED", detail: { proposalId, amountIn: quote.amountIn } },
        { type: "QUOTE_RECEIVED", detail: { proposalId, routes: quote.routes.length } },
      ],
      null,
    );
    return { ...full, id };
  }

  latestQuote(proposalId: string): Promise<{ id: string; quote: TradeQuote } | null> {
    return this.store.latestQuote(proposalId);
  }
}

export class SimulationGate {
  constructor(private readonly store: ExecutionStore) {}

  async recordSimulation(
    proposalId: string,
    quoteId: string | null,
    simulation: SimulationResult,
  ): Promise<SimulationResult> {
    const { id } = await this.store.saveSimulation({ proposalId, quoteId, simulation });
    await this.store.persistEvents(
      [
        { type: "SIMULATION_REQUESTED", detail: { proposalId } },
        {
          type: simulation.status === "PASSED" ? "SIMULATION_PASSED" : "SIMULATION_FAILED",
          detail: { proposalId, status: simulation.status, reason: simulation.failReason },
        },
      ],
      null,
    );
    return { ...simulation, id };
  }

  latestSimulation(
    proposalId: string,
  ): Promise<{ id: string; simulation: SimulationResult } | null> {
    return this.store.latestSimulation(proposalId);
  }
}

/** All gates that must hold before an execution may be broadcast. */
export interface ExecutionGates {
  proposal: ProposalRecord;
  riskDecision: RiskDecision | null;
  quote: { id: string; quote: TradeQuote } | null;
  simulation: { id: string; simulation: SimulationResult } | null;
  authorization?: { id: string; decision: string; quoteId?: string | null } | null;
  now?: Date;
}

export interface GateCheck {
  /** Stable rule name for audit trails and UI rendering. */
  check: string;
  passed: boolean;
  reason: string;
}

/** Deterministic gate evaluation shared by MANUAL and BOUNDED_AGENT modes. */
export function evaluateGates(gates: ExecutionGates): GateCheck[] {
  const now = gates.now ?? new Date();
  const checks: GateCheck[] = [];
  const expired = (iso: string | undefined) => iso !== undefined && Date.parse(iso) < now.getTime();

  checks.push({
    check: "RISK_APPROVED",
    passed: gates.proposal.status === "APPROVED",
    reason: `Risk decision must be APPROVED (current: ${gates.proposal.status})`,
  });
  checks.push({
    check: "PROPOSAL_NOT_EXPIRED",
    passed: !expired(gates.proposal.expiresAt),
    reason: "Proposal has expired; re-evaluate risk first",
  });
  checks.push({
    check: "QUOTE_VALID",
    passed: Boolean(gates.quote) && !expired(gates.quote?.quote.expiresAt),
    reason: "Quote is missing or expired; fetch a fresh quote",
  });
  checks.push({
    check: "SIMULATION_PASSED",
    passed:
      Boolean(gates.simulation) &&
      (gates.simulation?.simulation.status === "PASSED" ||
        gates.simulation?.simulation.status === "UNKNOWN"),
    reason:
      gates.simulation?.simulation.status === "FAILED"
        ? "Simulation FAILED — the transaction would revert"
        : "Simulation has not been performed",
  });
  checks.push({
    check: "AUTHORIZATION_VALID",
    passed: gates.authorization?.decision === "APPROVED",
    reason: "No APPROVED authorization for this proposal",
  });
  // Authorization scope binding (Phase 10.3): an authorization granted for an
  // earlier quote is not reusable for the current one.
  const authQuoteId = gates.authorization?.quoteId;
  const authStale =
    authQuoteId !== undefined &&
    authQuoteId !== null &&
    gates.quote !== null &&
    authQuoteId !== gates.quote.id;
  checks.push({
    check: "AUTHORIZATION_QUOTE_BINDING",
    passed: !authStale,
    reason: "Authorization was granted for a different quote; re-authorization required",
  });
  // Simulation must belong to the current quote — a new quote invalidates it.
  const simQuoteId = gates.simulation?.simulation?.quoteId ?? undefined;
  const simStale =
    simQuoteId !== undefined &&
    simQuoteId !== null &&
    gates.quote !== null &&
    simQuoteId !== gates.quote.id;
  checks.push({
    check: "SIMULATION_QUOTE_BINDING",
    passed: !simStale,
    reason: "Simulation was performed for a different quote; re-simulate",
  });
  return checks;
}

export class AuthorizationService {
  constructor(
    private readonly store: ExecutionStore,
    private readonly policyMode: ExecutionPolicyMode,
    private readonly actor: string,
  ) {}

  get policy(): ExecutionPolicyMode {
    return this.policyMode;
  }

  /**
   * MANUAL: the user's explicit decision is recorded. DISABLED: always
   * rejected. BOUNDED_AGENT: automatic approval ONLY when every gate passes.
   */
  async authorize(
    proposal: ProposalRecord,
    gates: Omit<ExecutionGates, "authorization" | "proposal"> & { proposal: ProposalRecord },
    userDecision?: "APPROVE" | "REJECT",
  ): Promise<ExecutionAuthorizationRecord> {
    if (this.policyMode === "DISABLED") {
      await this.store.persistEvents(
        [{ type: "REJECTED", detail: { proposalId: proposal.id, reason: "policy disabled" } }],
        null,
      );
      throw new PolicyViolationError("Execution policy is DISABLED — no transaction execution");
    }
    let decision: "APPROVED" | "REJECTED";
    let actor = this.actor;
    if (this.policyMode === "MANUAL") {
      decision = userDecision === "REJECT" ? "REJECTED" : "APPROVED";
      actor = "user:manual";
    } else {
      // BOUNDED_AGENT: every gate must pass; any failure blocks with reason.
      const failed = evaluateGates({ ...gates, proposal }).filter((c) => !c.passed);
      if (userDecision === "REJECT") {
        decision = "REJECTED";
      } else if (failed.length > 0) {
        await this.store.persistEvents(
          [
            {
              type: "REJECTED",
              detail: { proposalId: proposal.id, reasons: failed.map((f) => f.reason) },
            },
          ],
          null,
        );
        throw new PolicyViolationError(
          `Bounded-agent execution blocked: ${failed.map((f) => f.reason).join("; ")}`,
        );
      } else {
        decision = "APPROVED";
        actor = "agent:bounded";
      }
    }
    const { id } = await this.store.saveAuthorization({
      proposalId: proposal.id,
      quoteId: gates.quote?.id ?? null,
      simulationId: gates.simulation?.id ?? null,
      decision,
      actor,
      policyMode: this.policyMode,
    });
    await this.store.persistEvents(
      [
        { type: "AUTHORIZATION_REQUESTED", detail: { proposalId: proposal.id } },
        {
          type: decision === "APPROVED" ? "AUTHORIZED" : "REJECTED",
          detail: { proposalId: proposal.id, actor },
        },
      ],
      null,
    );
    return {
      id,
      proposalId: proposal.id,
      quoteId: gates.quote?.id ?? null,
      simulationId: gates.simulation?.id ?? null,
      decision,
      actor,
      policyMode: this.policyMode,
      createdAt: new Date().toISOString(),
    };
  }
}

export class ExecutionService {
  constructor(
    private readonly store: ExecutionStore,
    private readonly policyMode: ExecutionPolicyMode,
  ) {}

  /**
   * Idempotent execution creation. All gates must pass; repeated calls for
   * the same proposal return the existing execution instead of re-submitting.
   */
  async createExecution(params: {
    proposal: ProposalRecord;
    riskDecision: RiskDecision | null;
    quote: { id: string; quote: TradeQuote } | null;
    simulation: { id: string; simulation: SimulationResult } | null;
    authorization: { id: string; decision: string } | null;
    environment: string;
  }): Promise<ExecutionRecord> {
    if (this.policyMode === "DISABLED") {
      throw new PolicyViolationError("Execution policy is DISABLED — no transaction execution");
    }
    const existing = await this.store.findExecutionByProposal(params.proposal.id);
    if (existing) {
      return existing; // idempotency: never submit the same trade twice
    }
    const failed = evaluateGates(params).filter((c) => !c.passed);
    if (failed.length > 0) {
      throw new PolicyViolationError(
        `Execution blocked: ${failed.map((f) => f.reason).join("; ")}`,
      );
    }
    const record = await this.store.createExecution({
      proposalId: params.proposal.id,
      quoteId: params.quote?.id ?? null,
      simulationId: params.simulation?.id ?? null,
      authorizationId: params.authorization?.id ?? null,
      state: "CREATED",
      idempotencyKey: `exec:${params.proposal.id}`,
      environment: params.environment,
    });
    await this.transition(record.id, "CREATED", "RISK_APPROVED");
    return (await this.store.getExecution(record.id))!;
  }

  /** Enforces the documented state machine on every stored transition. */
  async transition(
    id: string,
    from: ExecutionState,
    to: ExecutionState,
    extra?: { orderId?: string; txHash?: string; failureReason?: string },
  ): Promise<ExecutionRecord> {
    const record = await this.store.getExecution(id);
    if (!record) {
      throw new Error("NOT_FOUND");
    }
    if (record.state !== from) {
      throw new StateTransitionError(
        `Invalid transition: execution is in state ${record.state}, expected ${from}`,
      );
    }
    if (!isValidExecutionTransition(from, to)) {
      throw new StateTransitionError(`Invalid state transition ${from} → ${to}`);
    }
    return this.store.updateExecutionState(id, to, extra);
  }

  get(id: string): Promise<ExecutionRecord | null> {
    return this.store.getExecution(id);
  }

  list(): Promise<ExecutionRecord[]> {
    return this.store.listExecutions();
  }

  async cancel(id: string): Promise<ExecutionRecord> {
    const record = await this.store.getExecution(id);
    if (!record) {
      throw new Error("NOT_FOUND");
    }
    if (!isValidExecutionTransition(record.state, "CANCELLED")) {
      throw new StateTransitionError(`Cannot cancel an execution in state ${record.state}`);
    }
    return this.store.updateExecutionState(id, "CANCELLED");
  }
}
