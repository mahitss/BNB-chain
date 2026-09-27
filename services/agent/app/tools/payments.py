"""b402 PaymentProvider — OPTIONAL interface, deliberately DISABLED.

B402 (x402 V2) lets a service charge stablecoin payments via HTTP 402 with
off-chain verification and gas-sponsored settlement. OLYR does NOT wire
payments into the trading path in this phase. Documented future use cases:
the agent pays another agent/service for market intelligence, specialized
inference, or external data — never for risk, execution, or anything that
could trade money movement against safety checks.

Documented API surface (from the official docs, base URL
https://web3.binance.com/build): POST /api/v2/b402/supported, /verify,
/settle — implementable later behind this interface without touching the
execution pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class PaymentProviderStatus:
    enabled: Literal[False] = False
    reason: str = (
        "b402 payments are intentionally disabled in OLYR. Future use case: "
        "agent-to-agent payments for market intelligence or external data. "
        "Payments will never be placed on the trade-execution path."
    )


class PaymentProvider:
    """Disabled payment seam. get_status() always reports disabled."""

    def __init__(self, base_url: str = "https://web3.binance.com/build") -> None:
        self._base_url = base_url

    def get_status(self) -> PaymentProviderStatus:
        return PaymentProviderStatus()

    async def supported(self) -> dict:
        raise NotImplementedError(
            "b402 payments are disabled in OLYR; nothing may call the payment API."
        )

    async def verify(self, payment_payload: str) -> dict:
        raise NotImplementedError("b402 payments are disabled in OLYR.")

    async def settle(self, payment_payload: str) -> dict:
        raise NotImplementedError("b402 payments are disabled in OLYR.")
