"""Tools + app-endpoint tests (httpx MockTransport — no real network)."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient
from httpx import MockTransport

from app.config import AgentConfig, LLMConfig, StrategyLimits
from app.main import create_app
from app.tools.market_tools import MarketTools, ToolInputError


def _config(api_base: str) -> AgentConfig:
    return AgentConfig(
        llm=LLMConfig(provider="", model="", api_key=None, base_url="", timeout_seconds=1),
        limits=StrategyLimits(25, 100, 10, [], []),
        olyr_api_base_url=api_base,
        olyr_api_timeout_seconds=1,
        agent_port=0,
    )


def with_mock_transport(handler) -> None:
    """Route all httpx.AsyncClient traffic in this test through a mock."""
    original_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):
        kwargs["transport"] = MockTransport(handler)
        original_init(self, *args, **kwargs)

    httpx.AsyncClient.__init__ = patched_init


def restore_client() -> None:

    import app.tools.market_tools  # noqa: F401 — ensure module loaded

    httpx.AsyncClient.__init__ = original_async_client_init


original_async_client_init = httpx.AsyncClient.__init__


class TestMarketTools:
    async def test_get_market_snapshot_calls_olyr_api(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request.url.path)
            return httpx.Response(200, json={"ticker": "NVDA", "marketState": "OPEN"})

        with_mock_transport(handler)
        try:
            tools = MarketTools(_config("http://olyr-api.test"))
            snapshot = await tools.get_market_snapshot("NVDA")
            assert snapshot["ticker"] == "NVDA"
            assert calls == ["/api/market/NVDA/snapshot"]
        finally:
            httpx.AsyncClient.__init__ = original_async_client_init

    async def test_invalid_ticker_rejected_without_network(self):
        tools = MarketTools(_config("http://olyr-api.test"))
        with pytest.raises(ToolInputError):
            await tools.get_market_snapshot("bad ticker!!")
        with pytest.raises(ToolInputError):
            await tools.get_market_state("")

    async def test_upstream_http_error_propagates(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"error": {"category": "not-found"}})

        with_mock_transport(handler)
        try:
            tools = MarketTools(_config("http://olyr-api.test"))
            with pytest.raises(httpx.HTTPStatusError):
                await tools.get_market_snapshot("ZZZZ")
        finally:
            httpx.AsyncClient.__init__ = original_async_client_init


class TestAgentEndpoints:
    def test_health_works_without_provider(self):
        app = create_app(_config("http://olyr-api.test"))
        with TestClient(app) as client:
            response = client.get("/health")
            assert response.status_code == 200
            assert response.json()["service"] == "agent"

    def test_parse_returns_503_without_provider(self):
        app = create_app(_config("http://olyr-api.test"))
        with TestClient(app) as client:
            response = client.post("/agent/parse", json={"text": "watch NVDA"})
            assert response.status_code == 503
            assert response.json()["detail"]["error"]["category"] == "provider-not-configured"

    def test_agent_ready_reports_configuration(self):
        app = create_app(_config("http://olyr-api.test"))
        with TestClient(app) as client:
            response = client.get("/agent/ready")
            assert response.status_code == 200
            body = response.json()
            assert body["ready"] is False
            assert "OLYR_LLM_PROVIDER" in body["detail"]

    def test_unknown_tool_returns_404(self):
        app = create_app(_config("http://olyr-api.test"))
        with TestClient(app) as client:
            response = client.get("/agent/tools/nonexistent", params={"ticker": "NVDA"})
            assert response.status_code == 404

    def test_tool_without_ticker_returns_400(self):
        app = create_app(_config("http://olyr-api.test"))
        with TestClient(app) as client:
            response = client.get("/agent/tools/get_market_snapshot")
            assert response.status_code == 400
