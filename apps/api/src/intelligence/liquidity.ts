/**
 * Liquidity evaluation from documented Binance data only.
 * Shared by the scanner and the on-demand snapshot service.
 */
import type { BinanceRwaClient } from "@olyr/binance";
import type { LiquidityInfo } from "@olyr/types";

function parseSafe(value: string | null): { value: bigint; scale: number } | null {
  if (value === null || !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    return null;
  }
  const [intPart, fracPart = ""] = value.trim().split(".");
  return { value: BigInt(intPart + fracPart), scale: fracPart.length };
}

export async function computeLiquidityInfo(
  client: BinanceRwaClient,
  chainId: string,
  tokenContractAddress: string,
): Promise<LiquidityInfo> {
  const checkedAt = new Date().toISOString();
  try {
    const pools = await client.getTokenLiquidity(chainId, tokenContractAddress);
    if (pools.length === 0) {
      return { status: "NONE", totalLiquidityUsd: null, poolCount: 0, checkedAt, warnings: [] };
    }
    // Sum documented pool liquidity with decimal-safe arithmetic (BigInt).
    const parsed = pools
      .map((p) => parseSafe(p.liquidityUsd))
      .filter((p): p is { value: bigint; scale: number } => p !== null);
    const scale = parsed.reduce((max, p) => Math.max(max, p.scale), 0);
    let total = 0n;
    for (const p of parsed) {
      total += p.value * 10n ** BigInt(scale - p.scale);
    }
    const unscaled = total.toString().padStart(scale + 1, "0");
    const totalLiquidityUsd =
      scale > 0 ? `${unscaled.slice(0, -scale)}.${unscaled.slice(-scale)}` : unscaled;
    return {
      status: "AVAILABLE",
      totalLiquidityUsd,
      poolCount: pools.length,
      checkedAt,
      warnings: [],
    };
  } catch {
    // Liquidity could not be determined — never assume it is sufficient.
    return {
      status: "UNKNOWN",
      totalLiquidityUsd: null,
      poolCount: null,
      checkedAt,
      warnings: ["liquidity-unavailable"],
    };
  }
}
