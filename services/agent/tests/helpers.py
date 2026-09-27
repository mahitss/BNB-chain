"""Shared test helpers."""

from __future__ import annotations

from app.config import AgentConfig, LLMConfig, StrategyLimits

LIMITS = StrategyLimits(
    max_strategy_trade_usd=25,
    max_strategy_daily_usd=100,
    max_spread_threshold_percent=10,
    max_slippage_percent=1,
    allowed_actions=[],
    allowed_assets=[],
)


def _config() -> AgentConfig:
    return AgentConfig(
        llm=LLMConfig(
            provider="fake", model="fake-1", api_key=None, base_url="", timeout_seconds=1
        ),
        limits=LIMITS,
        olyr_api_base_url="http://olyr-api.test",
        olyr_api_timeout_seconds=1,
        agent_port=0,
    )
