"""OLYR agent service entrypoint.

The agent converts natural-language strategy requests into strict, validated,
machine-readable strategies. The LLM stops at structured intent: it cannot
execute transactions, access wallets or keys, call tools directly, or alter
platform limits — the deterministic validation pipeline is authoritative.

Endpoints:
  GET  /health          service health (no LLM dependency)
  GET  /agent/ready     reports provider/tool configuration state
  POST /agent/parse     natural language → validated strategy | clarification
  GET  /agent/tools/*   read-only market tools backed by the OLYR API
"""

from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.config import AgentConfig, load_agent_config
from app.providers.base import ProviderNotConfiguredError, create_provider
from app.services.strategy_agent import StrategyAgent
from app.tools.market_tools import MarketTools


class HealthResponse(BaseModel):
    """Mirrors the shared HealthCheck contract from @olyr/types."""

    service: str
    status: str
    timestamp: str
    version: str


class ParseRequest(BaseModel):
    text: str


def create_app(config: AgentConfig | None = None) -> FastAPI:
    """Application factory; the config is injectable for tests."""
    config = config or load_agent_config()
    app = FastAPI(title="OLYR Agent", version="0.1.0")
    tools = MarketTools(config)

    # The provider is constructed lazily so the service starts (and /health
    # works) even when no LLM provider is configured — dev mode.
    provider = None
    provider_error: str | None = None
    try:
        provider = create_provider(config.llm)
    except ProviderNotConfiguredError as exc:
        provider_error = str(exc)

    agent = StrategyAgent(provider, config) if provider else None

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            service="agent",
            status="ok",
            timestamp=datetime.now(UTC).isoformat(),
            version=app.version,
        )

    @app.get("/readiness")
    def readiness_alias() -> dict:
        return ready()

    @app.get("/agent/ready")
    def ready() -> dict:
        return {
            "ready": provider is not None,
            "provider": config.llm.provider or None,
            "model": config.llm.model or None,
            "detail": provider_error,
        }

    @app.post("/agent/parse")
    async def parse(request: ParseRequest) -> dict:
        if agent is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": {
                        "category": "provider-not-configured",
                        "message": provider_error,
                    }
                },
            )
        return await agent.parse(request.text)

    # Read-only tools exposed over the internal contract; they proxy the OLYR
    # API with validated inputs. Controlled tools accept ids only — every
    # state/authorization check happens server-side in Fastify.
    @app.get("/agent/tools/{tool_name}")
    async def run_tool(
        tool_name: str, ticker: str | None = None, amount_usd: float | None = None
    ) -> dict:
        if tool_name == "list_tokenized_assets":
            return await tools.list_tokenized_assets()
        if tool_name == "get_portfolio":
            return await tools.get_portfolio()
        if tool_name == "get_quote":
            if ticker is None or amount_usd is None:
                raise HTTPException(status_code=400, detail="ticker and amount_usd required")
            return await tools.get_quote(ticker, amount_usd)
        if ticker is None:
            raise HTTPException(status_code=400, detail="ticker parameter required")
        if tool_name == "get_tokenized_asset":
            return await tools.get_tokenized_asset(ticker)
        if tool_name == "get_market_snapshot":
            return await tools.get_market_snapshot(ticker)
        if tool_name == "get_market_state":
            return await tools.get_market_state(ticker)
        if tool_name == "get_opportunity":
            return await tools.get_opportunity(ticker)
        if tool_name == "get_position":
            return await tools.get_position(ticker)
        raise HTTPException(status_code=404, detail=f"Unknown tool {tool_name}")

    @app.post("/agent/tools/{tool_name}")
    async def run_controlled_tool(tool_name: str, payload: dict) -> dict:
        if tool_name == "create_trade_proposal":
            return await tools.create_trade_proposal(payload.get("strategy_id", ""))
        if tool_name == "request_simulation":
            return await tools.request_simulation(payload.get("proposal_id", ""))
        if tool_name == "request_execution":
            return await tools.request_execution(payload.get("proposal_id", ""))
        raise HTTPException(status_code=404, detail=f"Unknown controlled tool {tool_name}")

    return app


config = load_agent_config()
app = create_app(config)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=config.agent_port)
