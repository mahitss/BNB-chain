"""Deterministic FakeLLMProvider — TESTS ONLY.

Scripted responses for deterministic tests. It is never selected in
production configuration and never exposed through the UI as live AI: the
factory only constructs it when OLYR_LLM_PROVIDER=fake, and the production
default is provider-less.
"""

from __future__ import annotations

from app.providers.base import LLMProvider


class FakeLLMProvider(LLMProvider):
    """Returns pre-scripted responses in FIFO order (last one repeats)."""

    def __init__(self) -> None:
        self._scripted: list[str] = []

    def script(self, *responses: str) -> FakeLLMProvider:
        self._scripted = list(responses)
        return self

    async def generate_structured_strategy(self, user_text: str) -> str:
        if not self._scripted:
            raise AssertionError("FakeLLMProvider has no scripted response for this test")
        return self._scripted.pop(0)


def parsed_strategy_json() -> str:
    """A well-formed NVDA watcher strategy (the canonical happy path)."""
    return (
        '{"status": "PARSED", "strategy": {'
        '"name": "NVDA weekend premium watcher",'
        '"asset": {"ticker": "NVDA"},'
        '"conditions": ['
        '{"field": "market_state", "operator": "equals", "value": "CLOSED"},'
        '{"field": "spread_percent", "operator": "greater_than", "value": 1.5}'
        "],"
        '"action": {"type": "PROPOSE_REDUCE_POSITION", "maxUsd": 20}'
        "}}"
    )
