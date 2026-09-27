"""SSRF / URL security tests (Phase 9): OLYR accepts no user-controlled
outbound URLs. Tool inputs are validated tickers/ids; the base URL is server
config. These tests prove hostile inputs cannot redirect requests to
arbitrary hosts (localhost, metadata endpoints, path traversal)."""

from __future__ import annotations

import pytest

from app.config import AgentConfig, LLMConfig, StrategyLimits
from app.tools.market_tools import MarketTools, ToolInputError, validate_ticker

CONFIG = AgentConfig(
    llm=LLMConfig(provider="", model="", api_key=None, base_url="", timeout_seconds=1),
    limits=StrategyLimits(25, 100, 10, 1, [], []),
    olyr_api_base_url="http://olyr-api.test",
    olyr_api_timeout_seconds=1,
    agent_port=0,
)

HOSTILE_TARGETS = [
    "../admin",
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1:5432",
    "file:///etc/passwd",
    "a/b",
    "%2e%2e%2f",
]


def test_validate_ticker_blocks_traversal_and_schemes():
    for hostile in HOSTILE_TARGETS:
        with pytest.raises(ToolInputError):
            validate_ticker(hostile)


async def test_tools_reject_hostile_tickers_before_any_http():
    tools = MarketTools(CONFIG)
    for hostile in HOSTILE_TARGETS:
        with pytest.raises(ToolInputError):
            await tools.get_market_snapshot(hostile)
        with pytest.raises(ToolInputError):
            await tools.get_position(hostile)


async def test_controlled_tools_reject_hostile_ids():
    tools = MarketTools(CONFIG)
    for hostile in ["'; DROP TABLE strategies; --", "a/b/c", "", "../../executions"]:
        with pytest.raises(ToolInputError):
            await tools.create_trade_proposal(hostile)
        with pytest.raises(ToolInputError):
            await tools.request_execution(hostile)
