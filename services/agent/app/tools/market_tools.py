"""Agent tools (Phase 7): read-only market/portfolio tools plus NARROW,
backend-gated controlled tools. There is deliberately NO generic
"execute_transaction" tool — request_execution only accepts a proposal id and
the Fastify-side ExecutionGate performs every state/authorization check.
"""

from __future__ import annotations

import re

import httpx

from app.config import AgentConfig

TICKER_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,20}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,64}$")


class ToolInputError(ValueError):
    """Raised when a tool receives invalid input."""


def validate_ticker(ticker: str) -> str:
    if not isinstance(ticker, str) or not TICKER_PATTERN.match(ticker):
        raise ToolInputError(f"Invalid ticker: {ticker!r}")
    return ticker


def validate_id(value: str, kind: str) -> str:
    if not isinstance(value, str) or not ID_PATTERN.match(value):
        raise ToolInputError(f"Invalid {kind}: {value!r}")
    return value


class MarketTools:
    """Read-only market-data tools backed by the OLYR API."""

    def __init__(self, config: AgentConfig) -> None:
        self._base_url = config.olyr_api_base_url.rstrip("/")
        self._timeout = config.olyr_api_timeout_seconds

    async def _get(self, path: str) -> dict:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.get(f"{self._base_url}{path}")
            response.raise_for_status()
            return response.json()

    async def _post(self, path: str, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(f"{self._base_url}{path}", json=payload)
            response.raise_for_status()
            return response.json()

    # ---- Read-only tools (Phase 4 + 7) ------------------------------------

    async def get_tokenized_asset(self, ticker: str) -> dict:
        """RWA search results for a ticker (asset registry lookup)."""
        return await self._get(f"/api/rwa/assets/{validate_ticker(ticker)}")

    async def get_market_snapshot(self, ticker: str) -> dict:
        """Full deterministic market snapshot: prices, freshness, divergence."""
        return await self._get(f"/api/market/{validate_ticker(ticker)}/snapshot")

    async def get_market_state(self, ticker: str) -> dict:
        """Market state for one tokenized asset (Binance + calendar)."""
        return await self._get(f"/api/market/{validate_ticker(ticker)}/state")

    async def get_opportunity(self, ticker: str) -> dict:
        """Deterministic opportunity evaluation for one ticker."""
        return await self._get(f"/api/opportunities/{validate_ticker(ticker)}")

    async def list_tokenized_assets(self) -> dict:
        """Tokenized assets currently listed on the configured chain."""
        return await self._get("/api/rwa/assets")

    async def get_portfolio(self) -> dict:
        """Wallet balances via the wallet API (503 when wallet unconfigured)."""
        return await self._get("/api/wallet/balances")

    async def get_position(self, ticker: str) -> dict:
        """Tokenized-stock position for one ticker (balance of its contract)."""
        return await self._get(f"/api/portfolio/{validate_ticker(ticker)}")

    async def get_quote(self, ticker: str, amount_usd: float) -> dict:
        """Quote for buying/selling the tokenized asset (read-only; no order)."""
        validate_ticker(ticker)
        if not isinstance(amount_usd, (int, float)) or amount_usd <= 0:
            raise ToolInputError("amount_usd must be a positive number")
        snapshot = await self.get_market_snapshot(ticker)
        contract = snapshot.get("tokenContractAddress")
        if not contract:
            raise ToolInputError(f"No token contract known for {ticker}")
        return await self._post(
            "/api/quotes",
            {
                "proposalId": snapshot.get("id") or "quote-only",
                "fromTokenAddress": contract,
                "toTokenAddress": contract,
                "amount": str(int(amount_usd * 1e18)),
            },
        )

    # ---- Controlled tools (backend gates are authoritative) ----------------

    async def create_trade_proposal(self, strategy_id: str) -> dict:
        """Create a trade proposal from a SAVED strategy (gated server-side)."""
        return await self._post(
            "/api/proposals", {"strategyId": validate_id(strategy_id, "strategy id")}
        )

    async def request_simulation(self, proposal_id: str) -> dict:
        """Request transaction simulation for an APPROVED proposal."""
        return await self._post(
            f"/api/proposals/{validate_id(proposal_id, 'proposal id')}/simulate", {}
        )

    async def request_execution(self, proposal_id: str) -> dict:
        """Request execution of a proposal. The backend ExecutionGate performs
        EVERY state/authorization check; this tool cannot bypass anything."""
        return await self._post(
            "/api/executions", {"proposalId": validate_id(proposal_id, "proposal id")}
        )
