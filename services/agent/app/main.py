"""OLYR agent service entrypoint.

Phase 1 exposes a health endpoint only. Market intelligence, structured tool
calling, and the abstracted LLM provider arrive in later phases; this module
is intentionally minimal.
"""

import os
from datetime import UTC, datetime

from fastapi import FastAPI
from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Mirrors the shared HealthCheck contract from @olyr/types."""

    service: str
    status: str
    timestamp: str
    version: str


def create_app() -> FastAPI:
    """Application factory; future phases wire agent tooling here."""
    app = FastAPI(title="OLYR Agent", version="0.1.0")

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            service="agent",
            status="ok",
            timestamp=datetime.now(UTC).isoformat(),
            version=app.version,
        )

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
