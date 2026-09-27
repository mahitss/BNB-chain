"""Validation pipeline — four independent layers, all deterministic.

LLM output
  ↓ schema validation      (Pydantic: shape, types, unknown fields)
  ↓ semantic validation    (numeric ranges, action/size coherence)
  ↓ capability validation  (fields/operators/actions/assets OLYR supports)
  ↓ safety validation      (platform hard limits — NEVER LLM-overridable)

The validators are authoritative. The model is never trusted to enforce any
rule: even if a prompt-injection attempt convinces the model to emit an
oversized strategy, the safety layer rejects it here.
"""

from __future__ import annotations

from app.config import StrategyLimits
from app.models.strategy import (
    ENUM_VALUES,
    NUMERIC_FIELDS,
    OBSERVATION_ACTIONS,
    PROPOSAL_ACTIONS,
    AgentError,
    StrategyDefinition,
)


def validate_schema(text: str) -> tuple[StrategyDefinition | None, list[AgentError]]:
    """Parse raw LLM output into a StrategyDefinition (schema layer)."""
    import json

    from pydantic import ValidationError

    from app.models.strategy import StrategyBuilder

    errors: list[AgentError] = []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        return None, [
            AgentError(
                layer="schema",
                code="malformed-llm-response",
                message=f"LLM returned malformed JSON: {exc.msg} (line {exc.lineno})",
            )
        ]
    if not isinstance(payload, dict):
        return None, [
            AgentError(
                layer="schema",
                code="malformed-llm-response",
                message="LLM response must be a JSON object",
            )
        ]
    try:
        builder = StrategyBuilder.model_validate(payload)
    except ValidationError as exc:
        return None, [
            AgentError(
                layer="schema",
                code="schema-violation",
                message=f"{err['loc'][0] if err['loc'] else 'payload'}: {err['msg']}",
            )
            for err in exc.errors()
        ]
    if builder.status == "NEEDS_CLARIFICATION":
        return None, []
    if builder.strategy is None:
        return None, [
            AgentError(
                layer="schema",
                code="missing-strategy",
                message="LLM reported PARSED but did not include a strategy",
            )
        ]
    return builder.strategy, errors


def validate_semantic(strategy: StrategyDefinition) -> list[AgentError]:
    """Numeric ranges and action/size coherence."""
    errors: list[AgentError] = []
    for condition in strategy.conditions:
        value = condition.value
        if condition.field in NUMERIC_FIELDS and isinstance(value, (int, float)):
            if condition.field in ("spread_percent",) and not -100 <= value <= 100:
                errors.append(
                    AgentError(
                        layer="semantic",
                        code="value-out-of-range",
                        message=f"spread_percent must be within [-100, 100], got {value}",
                    )
                )
            if condition.field in ("on_chain_price", "reference_price") and value < 0:
                errors.append(
                    AgentError(
                        layer="semantic",
                        code="negative-price",
                        message=f"{condition.field} cannot be negative",
                    )
                )
    if strategy.action.type in PROPOSAL_ACTIONS:
        if strategy.action.max_usd is None:
            errors.append(
                AgentError(
                    layer="semantic",
                    code="missing-trade-size",
                    message=f"Action {strategy.action.type} requires maxUsd "
                    "(the proposal size cap in USD)",
                )
            )
        elif strategy.action.max_usd <= 0:
            errors.append(
                AgentError(
                    layer="semantic",
                    code="invalid-trade-size",
                    message="maxUsd must be greater than zero "
                    "(trade sizes cannot be zero or negative)",
                )
            )
    elif strategy.action.type in OBSERVATION_ACTIONS and strategy.action.max_usd is not None:
        errors.append(
            AgentError(
                layer="semantic",
                code="unexpected-trade-size",
                message=f"Action {strategy.action.type} is informational and must not carry maxUsd",
            )
        )
    if strategy.constraints is not None:
        slippage = strategy.constraints.max_slippage_percent
        if slippage is not None and not 0 < slippage <= 100:
            errors.append(
                AgentError(
                    layer="semantic",
                    code="invalid-slippage",
                    message="maxSlippagePercent must be within (0, 100]",
                )
            )
        max_trade = strategy.constraints.max_trade_usd
        if max_trade is not None and max_trade <= 0:
            errors.append(
                AgentError(
                    layer="semantic",
                    code="invalid-trade-size",
                    message="constraints.maxTradeUsd must be greater than zero",
                )
            )
    return errors


def validate_capability(strategy: StrategyDefinition, limits: StrategyLimits) -> list[AgentError]:
    """Fields/operators/actions/assets OLYR actually supports."""
    errors: list[AgentError] = []
    allowed_actions = limits.allowed_actions or [
        "OBSERVE",
        "ALERT",
        "PROPOSE_REBALANCE",
        "PROPOSE_BUY",
        "PROPOSE_SELL",
        "PROPOSE_REDUCE_POSITION",
    ]
    if strategy.action.type not in allowed_actions:
        errors.append(
            AgentError(
                layer="capability",
                code="unsupported-action",
                message=f"Action {strategy.action.type} is not currently supported. "
                f"Supported actions: {', '.join(allowed_actions)}",
            )
        )
    if limits.allowed_assets and strategy.asset.ticker.upper() not in limits.allowed_assets:
        errors.append(
            AgentError(
                layer="capability",
                code="unsupported-asset",
                message=f"Asset {strategy.asset.ticker} is not in the configured allowed assets "
                f"({', '.join(limits.allowed_assets)})",
            )
        )
    if strategy.constraints is not None and strategy.constraints.max_slippage_percent is not None:
        slippage = strategy.constraints.max_slippage_percent
        if limits.max_slippage_percent > 0 and slippage > limits.max_slippage_percent:
            errors.append(
                AgentError(
                    layer="capability",
                    code="slippage-exceeds-platform-limit",
                    message=f"maxSlippagePercent {slippage}% exceeds the platform limit "
                    f"({limits.max_slippage_percent}%); unlimited or near-total "
                    "slippage tolerance is not permitted.",
                )
            )
    for condition in strategy.conditions:
        if condition.field not in NUMERIC_FIELDS and condition.field not in ENUM_VALUES:
            errors.append(
                AgentError(
                    layer="capability",
                    code="unsupported-field",
                    message=f"Condition field {condition.field!r} is not currently supported",
                )
            )
    return errors


def validate_safety(strategy: StrategyDefinition, limits: StrategyLimits) -> list[AgentError]:
    """Platform hard limits. The LLM can never bypass these."""
    errors: list[AgentError] = []
    max_trade = limits.max_strategy_trade_usd
    for label, amount in (
        ("action.maxUsd", strategy.action.max_usd),
        (
            "constraints.maxTradeUsd",
            strategy.constraints.max_trade_usd if strategy.constraints else None,
        ),
    ):
        if amount is not None and amount > max_trade:
            errors.append(
                AgentError(
                    layer="safety",
                    code="trade-size-exceeds-platform-limit",
                    message=f"{label} ({amount} USD) exceeds the platform limit "
                    f"({max_trade} USD). Rejected — user intent was not silently altered.",
                )
            )
    for condition in strategy.conditions:
        if condition.field == "spread_percent" and isinstance(condition.value, (int, float)):
            if abs(condition.value) > limits.max_spread_threshold_percent:
                errors.append(
                    AgentError(
                        layer="safety",
                        code="spread-threshold-exceeds-platform-limit",
                        message=f"spread_percent threshold {condition.value}% exceeds "
                        f"the platform limit ({limits.max_spread_threshold_percent}%)",
                    )
                )
    return errors


def validate_all(strategy: StrategyDefinition, limits: StrategyLimits) -> list[AgentError]:
    """Full pipeline in documented order; layers after a schema failure don't run."""
    errors = validate_semantic(strategy)
    errors += validate_capability(strategy, limits)
    errors += validate_safety(strategy, limits)
    return errors
