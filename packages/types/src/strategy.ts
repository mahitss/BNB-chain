/**
 * Strategy-domain types (Phase 4) — the strict contract between the Next.js
 * frontend, the Fastify API, and the Python agent.
 *
 * The schema represents ONLY capabilities OLYR actually supports (Phase 3
 * intelligence fields). Unknown fields/operators/actions/constraints are
 * rejected by validation on both the Python (authoritative pipeline) and
 * TypeScript (persistence guard) sides.
 */

export const STRATEGY_CONDITION_FIELDS = [
  "market_state",
  "spread_percent",
  "reference_freshness",
  "on_chain_price",
  "reference_price",
  "liquidity_status",
] as const;
export type StrategyConditionField = (typeof STRATEGY_CONDITION_FIELDS)[number];

/** Numeric-valued condition fields (all others are string enums). */
export const NUMERIC_CONDITION_FIELDS: readonly StrategyConditionField[] = [
  "spread_percent",
  "on_chain_price",
  "reference_price",
];

export const STRATEGY_OPERATORS = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
] as const;
export type StrategyOperator = (typeof STRATEGY_OPERATORS)[number];

export const STRATEGY_ACTION_TYPES = [
  "OBSERVE",
  "ALERT",
  "PROPOSE_REBALANCE",
  "PROPOSE_BUY",
  "PROPOSE_SELL",
  "PROPOSE_REDUCE_POSITION",
] as const;
export type StrategyActionType = (typeof STRATEGY_ACTION_TYPES)[number];

/** Actions that carry a position/size and therefore require maxUsd. */
export const PROPOSAL_ACTIONS: readonly StrategyActionType[] = [
  "PROPOSE_REBALANCE",
  "PROPOSE_BUY",
  "PROPOSE_SELL",
  "PROPOSE_REDUCE_POSITION",
];

export interface StrategyCondition {
  field: StrategyConditionField;
  operator: StrategyOperator;
  /** number for numeric fields; MarketState/freshness/liquidity enum for others. */
  value: number | string;
}

export interface StrategyAction {
  type: StrategyActionType;
  /** Required for PROPOSE_* actions; must be absent for OBSERVE/ALERT. USD. */
  maxUsd?: number;
}

export interface StrategyConstraints {
  maxSlippagePercent?: number;
  maxTradeUsd?: number;
}

export interface StrategyDefinition {
  name: string;
  asset: { ticker: string };
  conditions: StrategyCondition[];
  action: StrategyAction;
  constraints?: StrategyConstraints;
}

export type StrategyStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "DISABLED" | "INVALID";

/** Persisted strategy record as returned by the API. */
export interface StrategyRecord {
  id: string;
  ownerId: string;
  name: string;
  status: StrategyStatus;
  definition: StrategyDefinition;
  explanation: string;
  createdAt: string;
  updatedAt: string;
}

/** Agent-event types (Phase 4; becomes the Agent Activity Timeline). */
export const AGENT_EVENT_TYPES = [
  "STRATEGY_REQUESTED",
  "STRATEGY_PARSED",
  "VALIDATION_STARTED",
  "VALIDATION_FAILED",
  "VALIDATION_PASSED",
  "CLARIFICATION_REQUIRED",
  "STRATEGY_SAVED",
  "STRATEGY_ACTIVATED",
  "STRATEGY_PAUSED",
  // Proposal pipeline audit events (Phase 5)
  "STRATEGY_EVALUATED",
  "OPPORTUNITY_MATCHED",
  "PROPOSAL_CREATED",
  "RISK_EVALUATION_STARTED",
  "RISK_EVALUATION_COMPLETED",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export interface AgentEvent {
  type: AgentEventType;
  detail?: Record<string, unknown>;
  createdAt?: string;
}

export type AgentParseStatus = "PARSED" | "NEEDS_CLARIFICATION" | "REJECTED";

export interface AgentValidationError {
  /** validation layer: schema | semantic | capability | safety */
  layer: "schema" | "semantic" | "capability" | "safety";
  code: string;
  message: string;
}

/** Internal Fastify ↔ Python-agent contract for POST /agent/parse. */
export interface AgentParseResponse {
  status: AgentParseStatus;
  strategy?: StrategyDefinition;
  questions?: string[];
  errors?: AgentValidationError[];
  events: AgentEvent[];
}
