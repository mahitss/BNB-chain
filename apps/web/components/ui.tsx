/**
 * OLYR design system — shared primitives.
 *
 * Restrained institutional aesthetic: flat surfaces, hairline borders, dense
 * data typography (mono for numbers), status indicators that never rely on
 * color alone (✓ / ! / × glyphs + text). Motion only communicates state.
 */
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-900/40 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-800 px-4 py-3">
      <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">{title}</h2>
      {meta && <div className="font-mono text-xs text-zinc-500">{meta}</div>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  meta,
  actions,
}: {
  eyebrow: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-500">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">{title}</h1>
      </div>
      {(meta || actions) && (
        <div className="flex flex-wrap items-center gap-3">
          {meta && <div className="font-mono text-xs text-zinc-500">{meta}</div>}
          {actions}
        </div>
      )}
    </header>
  );
}

export type StatusTone = "pass" | "warn" | "fail" | "neutral";

/** Status badge with glyph + text (never color alone — accessibility). */
export function StatusBadge({
  tone,
  label,
  title,
}: {
  tone: StatusTone;
  label: string;
  title?: string;
}) {
  const tones: Record<StatusTone, { cls: string; glyph: string }> = {
    pass: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", glyph: "✓" },
    warn: { cls: "border-amber-500/30 bg-amber-500/10 text-amber-400", glyph: "!" },
    fail: { cls: "border-red-500/30 bg-red-500/10 text-red-400", glyph: "×" },
    neutral: { cls: "border-zinc-700 bg-zinc-800/60 text-zinc-400", glyph: "·" },
  };
  const t = tones[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs ${t.cls}`}
    >
      <span aria-hidden>{t.glyph}</span>
      {label}
    </span>
  );
}

export function toneForStatus(status: string): StatusTone {
  if (
    [
      "APPROVED",
      "PASSED",
      "CONFIRMED",
      "OPEN",
      "ACTIVE",
      "CONNECTED",
      "OPPORTUNITY",
      "FILLED",
      "FRESH",
      "SUFFICIENT",
      "AVAILABLE",
      "ok",
    ].includes(status)
  ) {
    return "pass";
  }
  if (
    [
      "REQUIRES_REVIEW",
      "AWAITING_AUTHORIZATION",
      "WATCH",
      "PRE_MARKET",
      "POST_MARKET",
      "AGING",
      "PENDING_RISK",
      "UNKNOWN",
      "degraded",
      "not-configured",
    ].includes(status)
  ) {
    return "warn";
  }
  if (
    [
      "REJECTED",
      "FAILED",
      "BLOCKED",
      "EXPIRED",
      "CANCELLED",
      "CLOSED",
      "WEEKEND",
      "HOLIDAY",
      "STALE",
      "INSUFFICIENT",
      "unreachable",
      "unavailable",
    ].includes(status)
  ) {
    return "fail";
  }
  return "neutral";
}

export function EmptyState({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 px-5 py-8 text-center">
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {detail && (
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">{detail}</p>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 px-5 py-6">
      <p className="text-sm font-medium text-red-300">
        <span aria-hidden>× </span>Unable to load data.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-red-200/70">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded border border-red-500/40 px-3 py-1.5 font-mono text-xs text-red-300 transition-colors hover:bg-red-500/10"
        >
          RETRY
        </button>
      )}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-2" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-zinc-800/70" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: StatusTone;
  hint?: string;
}) {
  const valueCls =
    tone === "pass"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "fail"
          ? "text-red-400"
          : "text-zinc-100";
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-0.5 font-mono text-lg font-medium ${valueCls}`}>{value}</p>
      {hint && <p className="text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

export function Dot({ tone }: { tone: StatusTone }) {
  const cls =
    tone === "pass"
      ? "bg-emerald-400"
      : tone === "warn"
        ? "bg-amber-400"
        : tone === "fail"
          ? "bg-red-400"
          : "bg-zinc-500";
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

export function buttonClass(
  variant: "primary" | "secondary" | "danger" | "ghost" = "secondary",
): string {
  const base =
    "rounded border px-3 py-1.5 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  switch (variant) {
    case "primary":
      return `${base} border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20`;
    case "danger":
      return `${base} border-red-500/40 bg-red-500/5 text-red-400 hover:bg-red-500/15`;
    case "ghost":
      return `${base} border-zinc-700 text-zinc-400 hover:text-zinc-200`;
    default:
      return `${base} border-zinc-600 text-zinc-200 hover:border-zinc-500`;
  }
}
