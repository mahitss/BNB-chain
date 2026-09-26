/**
 * TypeScript strategy validator — the persistence-side guard.
 *
 * The Python agent runs the authoritative validation pipeline, but the API
 * re-validates everything before persisting (defense in depth): even a
 * compromised or buggy agent cannot store an over-limit or malformed
 * strategy. Mirrors the Pydantic schema exactly, including
 * unknown-field rejection.
 */
import {
  NUMERIC_CONDITION_FIELDS,
  PROPOSAL_ACTIONS,
  STRATEGY_ACTION_TYPES,
  STRATEGY_CONDITION_FIELDS,
  STRATEGY_OPERATORS,
  type AgentValidationError,
  type StrategyConditionField,
  type StrategyDefinition,
} from "@olyr/types";

export interface StrategyLimitsConfig {
  maxStrategyTradeUsd: number;
  maxStrategyDailyUsd: number;
  maxSpreadThresholdPercent: number;
  allowedActions: string[]; // empty = all supported
  allowedAssets: string[]; // empty = any well-formed ticker
}

const MARKET_STATES = new Set([
  "OPEN",
  "CLOSED",
  "PRE_MARKET",
  "AFTER_HOURS",
  "WEEKEND",
  "HOLIDAY",
  "UNKNOWN",
]);
const FRESHNESS = new Set(["FRESH", "AGING", "STALE", "UNKNOWN"]);
const LIQUIDITY = new Set(["AVAILABLE", "NONE", "UNKNOWN"]);
const TICKER_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;

function error(
  layer: AgentValidationError["layer"],
  code: string,
  message: string,
): AgentValidationError {
  return { layer, code, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allowedEnumFor(field: StrategyConditionField): Set<string> | null {
  if (field === "market_state") return MARKET_STATES;
  if (field === "reference_freshness") return FRESHNESS;
  if (field === "liquidity_status") return LIQUIDITY;
  return null;
}

/**
 * Validates an untrusted object as a StrategyDefinition.
 * Returns the normalized definition or the accumulated errors.
 */
export function validateStrategyDefinition(
  input: unknown,
  limits: StrategyLimitsConfig,
): { definition: StrategyDefinition | null; errors: AgentValidationError[] } {
  const errors: AgentValidationError[] = [];
  if (!isPlainObject(input)) {
    return {
      definition: null,
      errors: [error("schema", "schema-violation", "Strategy must be a JSON object")],
    };
  }

  const { name, asset, conditions, action, constraints, ...unknownTop } = input;
  if (Object.keys(unknownTop).length > 0) {
    errors.push(
      error(
        "schema",
        "unknown-field",
        `Unknown top-level fields: ${Object.keys(unknownTop).join(", ")}`,
      ),
    );
  }
  if (typeof name !== "string" || name.trim().length < 3 || name.length > 80) {
    errors.push(error("schema", "invalid-name", "name must be a string of 3-80 characters"));
  }
  if (
    !isPlainObject(asset) ||
    Object.keys(asset).length !== 1 ||
    typeof asset.ticker !== "string"
  ) {
    errors.push(
      error("schema", "invalid-asset", "asset must be an object with exactly a ticker string"),
    );
  } else if (!TICKER_PATTERN.test(asset.ticker)) {
    errors.push(error("schema", "invalid-asset", `Invalid ticker: ${asset.ticker}`));
  }
  if (!Array.isArray(conditions) || conditions.length < 1 || conditions.length > 10) {
    errors.push(
      error("schema", "invalid-conditions", "conditions must be an array of 1-10 entries"),
    );
  }
  if (!isPlainObject(action)) {
    errors.push(error("schema", "invalid-action", "action must be an object"));
  }

  const parsedConditions: StrategyDefinition["conditions"] = [];
  if (Array.isArray(conditions)) {
    for (const condition of conditions) {
      if (!isPlainObject(condition)) {
        errors.push(error("schema", "invalid-condition", "each condition must be an object"));
        continue;
      }
      const { field, operator, value, ...unknownCondition } = condition;
      if (Object.keys(unknownCondition).length > 0) {
        errors.push(
          error(
            "schema",
            "unknown-field",
            `Unknown condition fields: ${Object.keys(unknownCondition).join(", ")}`,
          ),
        );
      }
      const fieldOk =
        typeof field === "string" &&
        (STRATEGY_CONDITION_FIELDS as readonly string[]).includes(field);
      if (!fieldOk) {
        errors.push(
          error(
            "capability",
            "unsupported-field",
            `Condition field ${String(field)} is not supported`,
          ),
        );
        continue;
      }
      const typedField = field as StrategyConditionField;
      const operatorOk =
        typeof operator === "string" &&
        (STRATEGY_OPERATORS as readonly string[]).includes(operator);
      if (!operatorOk) {
        errors.push(
          error(
            "capability",
            "unsupported-operator",
            `Operator ${String(operator)} is not supported`,
          ),
        );
        continue;
      }
      const allowedEnum = allowedEnumFor(typedField);
      if (allowedEnum) {
        if (typeof value !== "string" || !allowedEnum.has(value)) {
          errors.push(
            error(
              "schema",
              "invalid-value",
              `field ${typedField} requires one of: ${[...allowedEnum].join(", ")}`,
            ),
          );
          continue;
        }
      } else if (NUMERIC_CONDITION_FIELDS.includes(typedField)) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(
            error("schema", "invalid-value", `field ${typedField} requires a finite number`),
          );
          continue;
        }
      }
      parsedConditions.push({
        field: typedField,
        operator: operator as never,
        value: value as never,
      });
    }
  }

  let parsedAction: StrategyDefinition["action"] | null = null;
  if (isPlainObject(action)) {
    const { type, maxUsd, ...unknownAction } = action;
    if (Object.keys(unknownAction).length > 0) {
      errors.push(
        error(
          "schema",
          "unknown-field",
          `Unknown action fields: ${Object.keys(unknownAction).join(", ")}`,
        ),
      );
    }
    if (typeof type !== "string" || !(STRATEGY_ACTION_TYPES as readonly string[]).includes(type)) {
      errors.push(
        error("capability", "unsupported-action", `Action ${String(type)} is not supported`),
      );
    } else if (
      typeof maxUsd !== "undefined" &&
      (typeof maxUsd !== "number" || !Number.isFinite(maxUsd))
    ) {
      errors.push(error("schema", "invalid-value", "action.maxUsd must be a finite number"));
    } else {
      parsedAction = { type: type as never, maxUsd: maxUsd as number | undefined };
    }
  }

  let parsedConstraints: StrategyDefinition["constraints"] | undefined;
  if (constraints !== undefined && constraints !== null) {
    if (!isPlainObject(constraints)) {
      errors.push(
        error("schema", "invalid-constraints", "constraints must be an object when present"),
      );
    } else {
      const { maxSlippagePercent, maxTradeUsd, ...unknownConstraints } = constraints;
      if (Object.keys(unknownConstraints).length > 0) {
        errors.push(
          error(
            "schema",
            "unknown-field",
            `Unknown constraint fields: ${Object.keys(unknownConstraints).join(", ")}`,
          ),
        );
      }
      parsedConstraints = {};
      if (maxSlippagePercent !== undefined) {
        if (
          typeof maxSlippagePercent !== "number" ||
          !Number.isFinite(maxSlippagePercent) ||
          maxSlippagePercent <= 0 ||
          maxSlippagePercent > 100
        ) {
          errors.push(
            error("semantic", "invalid-slippage", "maxSlippagePercent must be within (0, 100]"),
          );
        } else {
          parsedConstraints.maxSlippagePercent = maxSlippagePercent;
        }
      }
      if (maxTradeUsd !== undefined) {
        if (typeof maxTradeUsd !== "number" || !Number.isFinite(maxTradeUsd) || maxTradeUsd <= 0) {
          errors.push(
            error(
              "semantic",
              "invalid-trade-size",
              "constraints.maxTradeUsd must be greater than zero",
            ),
          );
        } else {
          parsedConstraints.maxTradeUsd = maxTradeUsd;
        }
      }
    }
  }

  if (errors.length > 0) {
    return { definition: null, errors };
  }

  const definition: StrategyDefinition = {
    name: (name as string).trim(),
    asset: { ticker: (asset as { ticker: string }).ticker },
    conditions: parsedConditions,
    action: parsedAction!,
  };
  if (parsedConstraints !== undefined) {
    definition.constraints = parsedConstraints;
  }

  // ---- Semantic + capability + safety layers (post-shape) ----
  if (PROPOSAL_ACTIONS.includes(definition.action.type)) {
    if (definition.action.maxUsd === undefined) {
      errors.push(
        error("semantic", "missing-trade-size", `Action ${definition.action.type} requires maxUsd`),
      );
    } else if (definition.action.maxUsd <= 0) {
      errors.push(error("semantic", "invalid-trade-size", "maxUsd must be greater than zero"));
    }
  } else if (definition.action.maxUsd !== undefined) {
    errors.push(
      error(
        "semantic",
        "unexpected-trade-size",
        `Action ${definition.action.type} must not carry maxUsd`,
      ),
    );
  }

  const allowedActions =
    limits.allowedActions.length > 0 ? limits.allowedActions : [...STRATEGY_ACTION_TYPES];
  if (!allowedActions.includes(definition.action.type)) {
    errors.push(
      error(
        "capability",
        "unsupported-action",
        `Action ${definition.action.type} is not allowed by platform policy`,
      ),
    );
  }
  if (
    limits.allowedAssets.length > 0 &&
    !limits.allowedAssets.includes(definition.asset.ticker.toUpperCase())
  ) {
    errors.push(
      error(
        "capability",
        "unsupported-asset",
        `Asset ${definition.asset.ticker} is not in the configured allowed assets`,
      ),
    );
  }
  for (const condition of definition.conditions) {
    if (
      condition.field === "spread_percent" &&
      Math.abs(condition.value as number) > limits.maxSpreadThresholdPercent
    ) {
      errors.push(
        error(
          "safety",
          "spread-threshold-exceeds-platform-limit",
          `spread_percent threshold ${condition.value}% exceeds the platform limit (${limits.maxSpreadThresholdPercent}%)`,
        ),
      );
    }
  }
  const sizes: Array<[string, number | undefined]> = [
    ["action.maxUsd", definition.action.maxUsd],
    ["constraints.maxTradeUsd", definition.constraints?.maxTradeUsd],
  ];
  for (const [label, amount] of sizes) {
    if (amount !== undefined && amount > limits.maxStrategyTradeUsd) {
      errors.push(
        error(
          "safety",
          "trade-size-exceeds-platform-limit",
          `${label} (${amount} USD) exceeds the platform limit (${limits.maxStrategyTradeUsd} USD). Rejected — intent not silently altered.`,
        ),
      );
    }
  }
  if (
    definition.action.maxUsd !== undefined &&
    definition.action.maxUsd > limits.maxStrategyDailyUsd
  ) {
    errors.push(
      error(
        "safety",
        "daily-limit-exceeds-platform-limit",
        `maxUsd exceeds the daily platform limit (${limits.maxStrategyDailyUsd} USD)`,
      ),
    );
  }

  if (errors.length > 0) {
    return { definition: null, errors };
  }
  return { definition, errors: [] };
}
