/**
 * Deterministic strategy explainer.
 *
 * Generates the human-readable explanation FROM the validated structured
 * strategy — never from LLM text — so the UI explanation always corresponds
 * to the stored definition.
 */
import type { StrategyCondition, StrategyDefinition } from "@olyr/types";

function describeOperator(operator: string): string {
  switch (operator) {
    case "equals":
      return "equals";
    case "not_equals":
      return "does not equal";
    case "greater_than":
      return "is more than";
    case "greater_than_or_equal":
      return "is at least";
    case "less_than":
      return "is less than";
    case "less_than_or_equal":
      return "is at most";
    default:
      return operator;
  }
}

const FIELD_LABELS: Record<string, string> = {
  market_state: "the US market state",
  spread_percent: "the price spread",
  reference_freshness: "the reference-price freshness",
  on_chain_price: "the on-chain price",
  reference_price: "the reference price",
  liquidity_status: "on-chain liquidity",
};

function describeValue(condition: StrategyCondition): string {
  const value = condition.value;
  if (typeof value === "number") {
    if (condition.field === "spread_percent") {
      return `${value}%`;
    }
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  }
  return value;
}

function describeCondition(condition: StrategyCondition): string {
  const label = FIELD_LABELS[condition.field] ?? condition.field;
  return `${label} ${describeOperator(condition.operator)} ${describeValue(condition)}`;
}

function describeAction(definition: StrategyDefinition): string {
  const action = definition.action;
  switch (action.type) {
    case "OBSERVE":
      return "continue observing the asset";
    case "ALERT":
      return "raise an alert";
    case "PROPOSE_REBALANCE":
      return `create a proposal to rebalance the position by up to $${action.maxUsd?.toLocaleString("en-US")}`;
    case "PROPOSE_BUY":
      return `create a proposal to buy for up to $${action.maxUsd?.toLocaleString("en-US")}`;
    case "PROPOSE_SELL":
      return `create a proposal to sell for up to $${action.maxUsd?.toLocaleString("en-US")}`;
    case "PROPOSE_REDUCE_POSITION":
      return `create a proposal to reduce the position by up to $${action.maxUsd?.toLocaleString("en-US")}`;
    default:
      return `take action ${action.type}`;
  }
}

/** Deterministic explanation of a validated strategy. */
export function explainStrategy(definition: StrategyDefinition): string {
  const parts: string[] = [];
  parts.push(
    `Monitor ${definition.asset.ticker} when ${describeCondition(definition.conditions[0]!)}.`,
  );
  for (const condition of definition.conditions.slice(1)) {
    parts.push(`Additionally require that ${describeCondition(condition)}.`);
  }
  parts.push(`When all conditions hold, ${describeAction(definition)}.`);
  parts.push(
    "This strategy only creates proposals — OLYR does not execute trades from strategies.",
  );
  if (definition.constraints?.maxSlippagePercent !== undefined) {
    parts.push(`Maximum acceptable slippage: ${definition.constraints.maxSlippagePercent}%.`);
  }
  return parts.join(" ");
}
