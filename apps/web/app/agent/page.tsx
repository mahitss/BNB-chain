"use client";

/**
 * OLYR Agent Studio page (Phase 7): live agent status from backend state —
 * active strategies, latest observations, pending proposals, execution
 * policy. Every value comes from the API; nothing is fabricated.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, get as apiGet } from "../../lib/api";
import type { MarketOpportunity, StrategyRecord } from "@olyr/types";
import Timeline from "./timeline";

interface AgentStatusResponse {
  loopEnabled: boolean;
  executionPolicy: string;
  activeStrategies: number;
  totalStrategies: number;
  lastScanAt: string | null;
  lastRun: { at: string | null; ok: boolean | null; error: string | null } | null;
  opportunities: MarketOpportunity[];
  timestamp: string;
}

interface AgentStateResponse {
  state: "DISABLED" | "STANDBY" | "SCANNING" | "ERROR";
  detail: string;
  scanEnabled: boolean;
  binanceConfigured: boolean;
  lastScanAt: string | null;
}

export default function AgentPage() {
  const statusQuery = useQuery({
    queryKey: ["agent-status"],
    queryFn: () => apiGet<AgentStatusResponse>("/api/agent/status"),
    refetchInterval: 30_000,
  });
  const stateQuery = useQuery({
    queryKey: ["agent-state"],
    queryFn: () => apiGet<AgentStateResponse>("/api/agent/state"),
    refetchInterval: 30_000,
  });
  const strategiesQuery = useQuery({
    queryKey: ["strategies"],
    queryFn: () => apiGet<{ strategies: StrategyRecord[] }>("/api/strategies"),
  });

  if (statusQuery.isPending) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="font-mono text-sm text-zinc-400">Loading agent status…</p>
      </main>
    );
  }

  if (statusQuery.isError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-zinc-50">OLYR Agent</h1>
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-sm leading-relaxed text-amber-300">
          {statusQuery.error instanceof ApiRequestError &&
          statusQuery.error.body?.category === "not-configured" ? (
            <p>
              Agent status requires the strategy registry (DATABASE_URL) and Binance configuration.
            </p>
          ) : (
            <p>
              Failed to load:{" "}
              {statusQuery.error instanceof Error ? statusQuery.error.message : "unknown"}
            </p>
          )}
          <button
            type="button"
            onClick={() => void statusQuery.refetch()}
            className="mt-4 rounded border border-amber-500/40 px-3 py-1.5 font-mono text-xs text-amber-300 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
          >
            RETRY
          </button>
        </div>
      </main>
    );
  }

  const status = statusQuery.data;
  const active = status.opportunities.filter(
    (o) => o.status === "OPPORTUNITY" || o.status === "WATCH" || o.status === "BLOCKED",
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-500">OLYR Agent</p>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold text-zinc-50">
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                status.loopEnabled ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            {status.loopEnabled ? "RUNNING" : "STANDBY"}
          </h1>
        </div>
        <p className="font-mono text-xs text-zinc-500">
          policy {status.executionPolicy} · cooldowns + dedup enforced server-side
        </p>
      </header>

      <div
        aria-label="Agent telemetry"
        className="mt-6 flex flex-col divide-y divide-zinc-800/80 rounded-lg border border-zinc-800 bg-zinc-900/40 sm:flex-row sm:divide-x sm:divide-y-0"
      >
        {[
          { label: "Status", value: status.loopEnabled ? "RUNNING" : "STANDBY" },
          {
            label: "Monitoring",
            value: `${status.activeStrategies} of ${status.totalStrategies} strategies`,
          },
          {
            label: "Last scan",
            value: status.lastScanAt
              ? new Date(status.lastScanAt).toLocaleTimeString("en-US", { hour12: false })
              : "never",
          },
        ].map((s) => (
          <div key={s.label} className="min-w-0 flex-1 px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              {s.label}
            </p>
            <p className="mt-0.5 truncate font-mono text-base font-medium text-zinc-100">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 font-mono text-xs text-zinc-500">
        {status.loopEnabled
          ? `Monitoring ${status.activeStrategies} strategies · ${status.totalStrategies} total`
          : (stateQuery.data?.detail ?? "Bounded agent loop is disabled.")}
      </p>

      {status.lastRun && status.lastRun.ok === false && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm leading-relaxed text-red-300"
        >
          Last scan failed
          {status.lastRun.at
            ? ` at ${new Date(status.lastRun.at).toLocaleTimeString("en-US", { hour12: false })}`
            : ""}
          : {status.lastRun.error ?? "unknown error"}. The agent loop is active but could not
          evaluate market data.
        </div>
      )}

      <section className="mt-8">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Current observations
        </h2>
        {active.length === 0 ? (
          <p className="mt-3 rounded-lg border border-zinc-800 px-4 py-5 text-sm text-zinc-400">
            No market observations yet. The bounded loop evaluates active strategies on its
            configured interval and records every event from real backend state.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {active.map((o) => (
              <div
                key={`${o.ticker}-${o.tokenContractAddress}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono text-lg text-zinc-50">{o.ticker}</p>
                  <p
                    className={`font-mono text-sm ${
                      o.direction === "PREMIUM"
                        ? "text-emerald-400"
                        : o.direction === "DISCOUNT"
                          ? "text-red-400"
                          : "text-zinc-400"
                    }`}
                  >
                    {o.spreadPercent !== null
                      ? `${Number(o.spreadPercent) >= 0 ? "+" : ""}${Number(o.spreadPercent).toFixed(2)}% divergence`
                      : "—"}
                  </p>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Market: {o.marketState} · Reference freshness: {o.referenceFreshness} · Status:{" "}
                  {o.status}
                </p>
                {o.reasons.length > 0 && (
                  <div className="mt-2">
                    <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
                      Why it matters
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
                      {o.reasons.slice(0, 3).map((reason, i) => (
                        <li key={i}>• {reason.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-2 text-xs">
                  <span className="text-zinc-500">Available action: </span>
                  {o.status === "BLOCKED" ? (
                    <span className="text-zinc-300">blocked — see signal detail</span>
                  ) : (
                    <span className="text-zinc-300">monitor via signal detail</span>
                  )}{" "}
                  <a
                    href={`/opportunities/${encodeURIComponent(o.id)}`}
                    className="text-amber-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                  >
                    View intelligence →
                  </a>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Active strategies
        </h2>
        {strategiesQuery.data?.strategies.filter((s) => s.status === "ACTIVE").length ? (
          <ul className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {strategiesQuery.data.strategies
              .filter((s) => s.status === "ACTIVE")
              .map((s) => (
                <li key={s.id} className="px-4 py-3 text-sm">
                  <p className="text-zinc-100">{s.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{s.explanation}</p>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            No ACTIVE strategies. Activate one from the strategy builder.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Activity timeline
        </h2>
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <Timeline />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Execution policy
        </h2>
        <p className="mt-3 font-mono text-sm text-zinc-200">{status.executionPolicy}</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          The agent can never modify its own limits — the policy, cooldowns, and deduplication
          windows are server configuration. See{" "}
          <a href="/wallet" className="text-amber-400 hover:underline">
            /wallet
          </a>{" "}
          for limits and capabilities.
        </p>
      </section>

      <p className="mt-8 font-mono text-xs text-zinc-600">
        Last loop scan:{" "}
        {status.lastScanAt
          ? new Date(status.lastScanAt).toLocaleTimeString("en-US", { hour12: false })
          : "never"}
      </p>
    </main>
  );
}
