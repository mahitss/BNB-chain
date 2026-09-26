"""LLM provider abstraction.

The application depends only on `LLMProvider`. Provider-specific code is
isolated in this package and selected via OLYR_LLM_PROVIDER. Providers return
raw text; ALL interpretation happens in the deterministic validation
pipeline — providers never execute actions and have no access to keys beyond
their own LLM credential, which is never logged or returned.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.config import LLMConfig


class LLMProvider(ABC):
    """Generates a raw structured-output response for a strategy parse."""

    @abstractmethod
    async def generate_structured_strategy(self, user_text: str) -> str:
        """Return the model's raw JSON text for the given user request."""


class ProviderNotConfiguredError(RuntimeError):
    """Raised when no LLM provider is configured (supported dev mode)."""


def create_provider(config: LLMConfig) -> LLMProvider:
    """Factory: select the provider from configuration."""
    if config.provider == "fake":
        from app.providers.fake import FakeLLMProvider

        return FakeLLMProvider()
    if config.provider == "openai-compatible":
        from app.providers.openai_compatible import OpenAICompatibleProvider

        if not config.api_key:
            raise ProviderNotConfiguredError(
                "OLYR_LLM_PROVIDER=openai-compatible requires OLYR_LLM_API_KEY"
            )
        return OpenAICompatibleProvider(config)
    raise ProviderNotConfiguredError(
        "No LLM provider configured. Set OLYR_LLM_PROVIDER (and OLYR_LLM_MODEL / "
        "OLYR_LLM_API_KEY) to enable strategy parsing."
    )
