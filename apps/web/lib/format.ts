/**
 * Shared formatting helpers — pure functions, unit-tested.
 */

export function formatUsd(
  value: string | number | null | undefined,
  opts: { compact?: boolean } = {},
): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "Unavailable";
  return `$${num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: opts.compact ? 0 : 6,
  })}`;
}

export function formatPercent(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "Unavailable";
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(decimals)}%`;
}

export function spreadTone(percent: string | null | undefined): "pass" | "fail" | "neutral" {
  if (percent === null || percent === undefined || percent === "") return "neutral";
  const num = Number(percent);
  if (!Number.isFinite(num) || num === 0) return "neutral";
  return num > 0 ? "pass" : "fail";
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { hour12: false });
}

/** Explorer link only for real hashes on a known network. */
export function explorerTxUrl(txHash: string | null | undefined): string | null {
  if (!txHash || !/^0x([a-fA-F0-9]{64})$/.test(txHash)) return null;
  return `https://bscscan.com/tx/${txHash}`;
}

/** Binance quote TTL: a quote is expired when its fetch time + TTL passed. */
export function isQuoteExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const then = Date.parse(expiresAt);
  return Number.isNaN(then) || then < now;
}
