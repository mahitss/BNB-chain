"""OpenAI-compatible structured-output provider (chat completions API).

Works with any OpenAI-compatible endpoint (OpenAI, Azure-style gateways,
local gateways) via OLYR_LLM_BASE_URL. The API key is sent only to the
configured LLM endpoint over HTTPS, never logged, never returned to callers,
and never exposed to the frontend.
"""

from __future__ import annotations

import httpx

from app.config import LLMConfig
from app.prompts.strategy_parser import SYSTEM_PROMPT
from app.providers.base import LLMProvider


class LLMRequestError(RuntimeError):
    """The LLM HTTP request failed (transport/timeout/HTTP error)."""


class OpenAICompatibleProvider(LLMProvider):
    def __init__(self, config: LLMConfig) -> None:
        self._config = config

    async def generate_structured_strategy(self, user_text: str) -> str:
        payload = {
            "model": self._config.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_text},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0,
        }
        headers = {"Authorization": f"Bearer {self._config.api_key}"}
        try:
            async with httpx.AsyncClient(timeout=self._config.timeout_seconds) as client:
                response = await client.post(
                    f"{self._config.base_url.rstrip('/')}/chat/completions",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as exc:
            raise LLMRequestError(f"LLM request failed: {type(exc).__name__}") from exc
        try:
            return body["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMRequestError("LLM response missing choices[0].message.content") from exc
