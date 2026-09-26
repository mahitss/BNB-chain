"""Strict strategy schema (Pydantic v2).

Mirrors @olyr/types `StrategyDefinition` exactly. `model_config =
ConfigDict(extra="forbid")` rejects unknown fields/operators/actions — the
agent never silently reinterprets unsupported requests.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MarketStateValue = Literal[
    "OPEN",
    "CLOSED",
    "PRE_MARKET",
    "AFTER_HOURS",
    "WEEKEND",
    "HOLIDAY",
    "UNKNOWN",
]
FreshnessValue = Literal["FRESH", "AGING", "STALE", "UNKNOWN"]
LiquidityValue = Literal["AVAILABLE", "NONE", "UNKNOWN"]

StrategyField = Literal[
    "market_state",
    "spread_percent",
    "reference_freshness",
    "on_chain_price",
    "reference_price",
    "liquidity_status",
]
StrategyOperator = Literal[
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
]
StrategyActionType = Literal[
    "OBSERVE",
    "ALERT",
    "PROPOSE_REBALANCE",
    "PROPOSE_BUY",
    "PROPOSE_SELL",
    "PROPOSE_REDUCE_POSITION",
]

NUMERIC_FIELDS = frozenset({"spread_percent", "on_chain_price", "reference_price"})
ENUM_VALUES: dict[str, frozenset[str]] = {
    "market_state": frozenset(
        {"OPEN", "CLOSED", "PRE_MARKET", "AFTER_HOURS", "WEEKEND", "HOLIDAY", "UNKNOWN"}
    ),
    "reference_freshness": frozenset({"FRESH", "AGING", "STALE", "UNKNOWN"}),
    "liquidity_status": frozenset({"AVAILABLE", "NONE", "UNKNOWN"}),
}
PROPOSAL_ACTIONS = frozenset(
    {"PROPOSE_REBALANCE", "PROPOSE_BUY", "PROPOSE_SELL", "PROPOSE_REDUCE_POSITION"}
)
OBSERVATION_ACTIONS = frozenset({"OBSERVE", "ALERT"})


class StrategyCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: StrategyField
    operator: StrategyOperator
    value: float | int | str

    @field_validator("value")
    @classmethod
    def value_type_matches_field(cls, v: float | int | str, info) -> float | int | str:  # noqa: ANN001
        field_name = info.data.get("field")
        if field_name in NUMERIC_FIELDS:
            if isinstance(v, str) or not isinstance(v, (int, float)):
                raise ValueError(f"field {field_name!r} requires a numeric value")
        elif field_name in ENUM_VALUES:
            if not isinstance(v, str) or v not in ENUM_VALUES[field_name]:
                allowed = "|".join(sorted(ENUM_VALUES[field_name]))
                raise ValueError(f"field {field_name!r} requires one of: {allowed}")
        return v


class StrategyAction(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    type: StrategyActionType
    max_usd: float | None = Field(default=None, alias="maxUsd")


class StrategyConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_slippage_percent: float | None = Field(default=None, alias="maxSlippagePercent")
    max_trade_usd: float | None = Field(default=None, alias="maxTradeUsd")


class StrategyAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticker: str = Field(min_length=1, max_length=20)


class StrategyDefinition(BaseModel):
    """The only strategy shape OLYR accepts. Everything else is rejected."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(min_length=3, max_length=80)
    asset: StrategyAsset
    conditions: list[StrategyCondition] = Field(min_length=1, max_length=10)
    action: StrategyAction
    constraints: StrategyConstraints | None = None


class StrategyBuilder(BaseModel):
    """LLM output envelope: either a parsed strategy or clarification questions."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    status: Literal["PARSED", "NEEDS_CLARIFICATION"]
    strategy: StrategyDefinition | None = None
    questions: list[str] | None = None


class AgentError(BaseModel):
    layer: Literal["schema", "semantic", "capability", "safety"]
    code: str
    message: str


class AgentEventOut(BaseModel):
    type: str
    detail: dict | None = None
