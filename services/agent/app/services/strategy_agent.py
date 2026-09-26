"""Strategy agent orchestrator.

Pipeline (all deterministic except the single LLM call):
  user text → LLMProvider (raw JSON) → schema validation → semantic →
  capability → safety → PARSED | NEEDS_CLARIFICATION | REJECTED

Every run emits agent events (returned to the caller for persistence). The
LLM has no access to tools, keys, wallets, or the network beyond its own
provider endpoint; it cannot influence anything after producing text.
"""

from __future__ import annotations

import json

from app.config import AgentConfig
from app.models.strategy import AgentError, AgentEventOut
from app.providers.base import LLMProvider, ProviderNotConfiguredError
from app.validators.pipeline import validate_all, validate_schema


class AgentProviderUnavailable(RuntimeError):
    """No LLM provider is configured or the provider is unreachable."""


class StrategyAgent:
    def __init__(self, provider: LLMProvider, config: AgentConfig) -> None:
        self._provider = provider
        self._config = config

    async def parse(self, text: str) -> dict:
        """Parse one natural-language request into the agent contract."""
        events: list[AgentEventOut] = [
            AgentEventOut(type="STRATEGY_REQUESTED", detail={"textLength": len(text)})
        ]
        if not text or not text.strip():
            return self._clarification(
                events + [AgentEventOut(type="CLARIFICATION_REQUIRED")],
                [
                    'Describe the strategy you want — for example: "Watch NVDA while the US '
                    "market is closed and alert me if the token trades 1.5% above the "
                    'reference price."'
                ],
            )

        events.append(AgentEventOut(type="VALIDATION_STARTED"))
        try:
            raw = await self._provider.generate_structured_strategy(text)
        except ProviderNotConfiguredError as exc:
            raise AgentProviderUnavailable(str(exc)) from exc

        # Layer 1 — schema validation of the model's JSON envelope.
        strategy, errors = validate_schema(raw)
        if errors:
            dumped = _dump_errors(errors)
            events.append(AgentEventOut(type="VALIDATION_FAILED", detail={"errors": dumped}))
            return {"status": "REJECTED", "errors": dumped, "events": _dump(events)}

        payload = json.loads(raw)
        if payload.get("status") == "NEEDS_CLARIFICATION":
            events.append(AgentEventOut(type="CLARIFICATION_REQUIRED"))
            return self._clarification(events, payload.get("questions") or [])
        if strategy is None:
            missing = AgentError(
                layer="schema",
                code="missing-strategy",
                message="LLM reported PARSED but did not include a strategy",
            )
            dumped = _dump_errors([missing])
            events.append(AgentEventOut(type="VALIDATION_FAILED", detail={"errors": dumped}))
            return {"status": "REJECTED", "errors": dumped, "events": _dump(events)}

        # Layers 2-4 — semantic → capability → safety.
        errors = validate_all(strategy, self._config.limits)
        if errors:
            dumped = _dump_errors(errors)
            events.append(AgentEventOut(type="VALIDATION_FAILED", detail={"errors": dumped}))
            return {"status": "REJECTED", "errors": dumped, "events": _dump(events)}

        events.append(AgentEventOut(type="VALIDATION_PASSED"))
        events.append(AgentEventOut(type="STRATEGY_PARSED", detail={"name": strategy.name}))
        return {
            "status": "PARSED",
            "strategy": strategy.model_dump(by_alias=True),
            "errors": [],
            "events": _dump(events),
        }

    @staticmethod
    def _clarification(events: list[AgentEventOut], questions: list[str]) -> dict:
        return {
            "status": "NEEDS_CLARIFICATION",
            "questions": questions,
            "errors": [],
            "events": _dump(events),
        }


def _dump_errors(errors: list[AgentError]) -> list[dict]:
    return [error.model_dump() for error in errors]


def _dump(events: list[AgentEventOut]) -> list[dict]:
    return [event.model_dump() for event in events]
