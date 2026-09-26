"""Read-only agent tools. Each tool calls an actual OLYR backend service
(the Fastify API) with validated inputs. There is deliberately NO tool for
wallet access, transaction signing, arbitrary HTTP, shell commands, or
database writes — those capabilities do not exist in this service.
"""

from __future__ import annotations

import re

import httpx

from app.config import AgentConfig

TICKER_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,20}$")


class ToolInputError(ValueError):
    """Raised when a tool receives invalid input."""


def validate_ticker(ticker: str) -> str:
    if not isinstance(ticker, str) or not TICKER_PATTERN.match(ticker):
        raise ToolInputError(f"Invalid ticker: {ticker!r}")
    return ticker


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
