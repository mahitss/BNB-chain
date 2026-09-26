"""Agent service configuration.

All configuration comes from environment variables. LLM credentials are never
hardcoded and never returned by any API. Platform strategy limits are read
here and enforced in the validation pipeline — the LLM can never alter them.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal


def _env_int(key: str, default: int) -> int:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"Environment variable {key} must be an integer, got {raw!r}") from exc


def _env_float(key: str, default: float) -> float:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw.strip())
    except ValueError as exc:
        raise ValueError(f"Environment variable {key} must be a number, got {raw!r}") from exc


def _env_list(key: str) -> list[str]:
    raw = os.getenv(key, "")
    return [item.strip().upper() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class LLMConfig:
    """Provider selection. `provider` empty means the agent runs without an LLM."""

    provider: Literal["", "fake", "openai-compatible"]
    model: str
    api_key: str | None
    base_url: str
    timeout_seconds: float


@dataclass(frozen=True)
class StrategyLimits:
    """Platform-level hard limits. The LLM can NEVER override these."""

    max_strategy_trade_usd: float
    max_strategy_daily_usd: float
    max_spread_threshold_percent: float
    allowed_actions: list[str] = field(default_factory=list)  # empty = all supported
    allowed_assets: list[str] = field(default_factory=list)  # empty = any known ticker


@dataclass(frozen=True)
class AgentConfig:
    llm: LLMConfig
    limits: StrategyLimits
    olyr_api_base_url: str
    olyr_api_timeout_seconds: float
    agent_port: int


def load_agent_config() -> AgentConfig:
    provider = os.getenv("OLYR_LLM_PROVIDER", "").strip().lower()
    if provider not in ("", "fake", "openai-compatible"):
        raise ValueError(
            f"OLYR_LLM_PROVIDER must be one of '', 'fake', 'openai-compatible', got {provider!r}"
        )
    return AgentConfig(
        llm=LLMConfig(
            provider=provider,  # type: ignore[arg-type]
            model=os.getenv("OLYR_LLM_MODEL", "").strip(),
            api_key=os.getenv("OLYR_LLM_API_KEY") or None,
            base_url=os.getenv("OLYR_LLM_BASE_URL", "https://api.openai.com/v1").strip(),
            timeout_seconds=_env_float("OLYR_LLM_TIMEOUT_SECONDS", 30),
        ),
        limits=StrategyLimits(
            max_strategy_trade_usd=_env_float("OLYR_MAX_STRATEGY_TRADE_USD", 25),
            max_strategy_daily_usd=_env_float("OLYR_MAX_STRATEGY_DAILY_USD", 100),
            max_spread_threshold_percent=_env_float("OLYR_MAX_SPREAD_THRESHOLD", 10),
            allowed_actions=_env_list("OLYR_ALLOWED_ACTIONS"),
            allowed_assets=_env_list("OLYR_ALLOWED_ASSETS"),
        ),
        olyr_api_base_url=os.getenv("OLYR_API_BASE_URL", "http://localhost:4000").strip(),
        olyr_api_timeout_seconds=_env_float("OLYR_API_TIMEOUT_SECONDS", 10),
        agent_port=_env_int("AGENT_PORT", 8000),
    )
