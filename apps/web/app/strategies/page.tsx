"use client";

/**
 * OLYR Strategy Builder (Phase 4): natural language → validated strategy
 * preview → saved strategy registry. The preview shows the structured
 * strategy returned by the agent's deterministic validation pipeline, and
 * the explanation is generated from the stored definition — never from LLM
 * text. There are no execution buttons: strategies only create proposals.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiRequestError, get as apiGet } from "../../lib/api";
import type { StrategyRecord } from "@olyr/types";

const EXAMPLE =
  'Example: "Watch NVDA during US market closure and alert me if the token trades 1.5% above reference."';

interface ParseResponse {
  status: "PARSED" | "NEEDS_CLARIFICATION" | "REJECTED";
  strategy?: StrategyRecord["definition"];
  questions?: string[];
  errors?: Array<{ layer: string; code: string; message: string }>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${process.env.NEXT_PUBLIC_OLYR_API_URL ?? "http://localhost:4000"}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => {
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const errorBody =
        (body as { error?: { category: string; message: string } } | null)?.error ?? null;
      throw new ApiRequestError(response.status, errorBody);
    }
    return body as T;
  });
}

export default function StrategiesPage() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ParseResponse | null>(null);
  const [mode, setMode] = useState<"NL" | "ADVANCED">("NL");
  const [advanced, setAdvanced] = useState({
    name: "",
    ticker: "",
    field: "spread_percent",
    operator: "greater_than",
    value: "1.5",
    action: "ALERT",
    maxUsd: "",
  });

  const parseMutation = useMutation({
    mutationFn: () => post<ParseResponse>("/api/strategies/parse", { text }),
    onSuccess: (result) => setPreview(result),
  });
  const saveMutation = useMutation({
    mutationFn: () => post<StrategyRecord>("/api/strategies", { strategy: preview!.strategy }),
    onSuccess: () => {
      setPreview(null);
      setText("");
      void queryClient.invalidateQueries({ queryKey: ["strategies"] });
    },
  });
  const strategiesQuery = useQuery({
    queryKey: ["strategies"],
    queryFn: () => apiGet<{ strategies: StrategyRecord[] }>("/api/strategies"),
  });

  const notConfigured =
    parseMutation.isError &&
    parseMutation.error instanceof ApiRequestError &&
    (parseMutation.error.body?.category === "provider-not-configured" ||
      parseMutation.error.body?.category === "not-configured");

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-500">
          OLYR · Strategy Builder
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-zinc-50">Describe your strategy</h1>
      </header>

      <div role="group" aria-label="Builder mode" className="mt-4 flex gap-1">
        {(["NL", "ADVANCED"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded px-2.5 py-1.5 font-mono text-xs ${
              mode === m ? "bg-zinc-800 text-amber-400" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {m === "NL" ? "NATURAL LANGUAGE" : "ADVANCED"}
          </button>
        ))}
      </div>
      {mode === "NL" && (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder={
            '"Watch NVDA during US market closure and alert me if the token trades 1.5% above reference."'
          }
          className="mt-6 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 p-4 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
        />
      )}
      {mode === "ADVANCED" && (
        <div className="mt-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div>
            <label
              htmlFor="adv-name"
              className="font-mono text-xs uppercase tracking-widest text-zinc-500"
            >
              Name
            </label>
            <input
              id="adv-name"
              value={advanced.name}
              onChange={(e) => setAdvanced({ ...advanced, name: e.target.value })}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 font-mono text-sm text-zinc-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="adv-ticker"
                className="font-mono text-xs uppercase tracking-widest text-zinc-500"
              >
                Ticker
              </label>
              <input
                id="adv-ticker"
                value={advanced.ticker}
                onChange={(e) => setAdvanced({ ...advanced, ticker: e.target.value.toUpperCase() })}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 font-mono text-sm text-zinc-100"
              />
            </div>
            <div>
              <label
                htmlFor="adv-action"
                className="font-mono text-xs uppercase tracking-widest text-zinc-500"
              >
                Action
              </label>
              <select
                id="adv-action"
                value={advanced.action}
                onChange={(e) => setAdvanced({ ...advanced, action: e.target.value })}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 font-mono text-sm text-zinc-100"
              >
                {["OBSERVE", "ALERT", "PROPOSE_BUY", "PROPOSE_SELL", "PROPOSE_REDUCE_POSITION"].map(
                  (a) => (
                    <option key={a}>{a}</option>
                  ),
                )}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="adv-field"
                className="font-mono text-xs uppercase tracking-widest text-zinc-500"
              >
                Field
              </label>
              <select
                id="adv-field"
                value={advanced.field}
                onChange={(e) => setAdvanced({ ...advanced, field: e.target.value })}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 font-mono text-sm text-zinc-100"
              >
                {[
                  "market_state",
                  "spread_percent",
                  "reference_freshness",
                  "on_chain_price",
                  "reference_price",
                  "liquidity_status",
                ].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="adv-op"
                className="font-mono text-xs uppercase tracking-widest text-zinc-500"
              >
                Operator
              </label>
              <select
                id="adv-op"
                value={advanced.operator}
                onChange={(e) => setAdvanced({ ...advanced, operator: e.target.value })}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 font-mono text-sm text-zinc-100"
              >
                {[
                  "equals",
                  "not_equals",
                  "greater_than",
                  "greater_than_or_equal",
                  "less_than",
                  "less_than_or_equal",
                ].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="adv-value"
                className="font-mono text-xs uppercase tracking-widest text-zinc-500"
              >
                Value
              </label>
              <input
                id="adv-value"
                value={advanced.value}
                onChange={(e) => setAdvanced({ ...advanced, value: e.target.value })}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 font-mono text-sm text-zinc-100"
              />
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Only supported fields/operators/actions are offered. PROPOSE_* actions require maxUsd;
            every strategy is validated server-side regardless of this form.
          </p>
          <button
            type="button"
            disabled={!advanced.name || !advanced.ticker}
            onClick={() => {
              const isProposal = advanced.action.startsWith("PROPOSE");
              setPreview({
                status: "PARSED",
                strategy: {
                  name: advanced.name,
                  asset: { ticker: advanced.ticker },
                  conditions: [
                    {
                      field: advanced.field as never,
                      operator: advanced.operator as never,
                      value: Number.isNaN(Number(advanced.value))
                        ? advanced.value
                        : Number(advanced.value),
                    },
                  ],
                  action: {
                    type: advanced.action as never,
                    ...(isProposal && advanced.maxUsd ? { maxUsd: Number(advanced.maxUsd) } : {}),
                  },
                },
              });
            }}
            className="rounded border border-amber-500/50 bg-amber-500/10 px-4 py-1.5 font-mono text-xs text-amber-400 hover:bg-amber-500/20 disabled:opacity-40"
          >
            BUILD STRATEGY
          </button>
        </div>
      )}
      {mode === "NL" && <p className="mt-2 text-xs text-zinc-500">{EXAMPLE}</p>}
      {mode === "NL" && (
        <button
          type="button"
          disabled={text.trim().length === 0 || parseMutation.isPending}
          onClick={() => parseMutation.mutate()}
          className="mt-4 rounded border border-amber-500/50 bg-amber-500/10 px-4 py-2 font-mono text-sm text-amber-400 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {parseMutation.isPending ? "Parsing…" : "CREATE STRATEGY"}
        </button>
      )}

      {notConfigured && (
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-sm leading-relaxed text-amber-300">
          <p className="font-semibold">The LLM provider is not configured.</p>
          <p className="mt-2 text-amber-200/80">
            Strategy parsing requires <code className="font-mono">OLYR_LLM_PROVIDER</code>,{" "}
            <code className="font-mono">OLYR_LLM_MODEL</code>, and{" "}
            <code className="font-mono">OLYR_LLM_API_KEY</code> in the agent service environment
            (see <code className="font-mono">.env.example</code>). OLYR never fabricates parsed
            strategies.
          </p>
        </div>
      )}

      {preview?.status === "PARSED" && preview.strategy && (
        <section className="mt-8 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
          <h2 className="font-mono text-xs uppercase tracking-widest text-emerald-400">
            Strategy preview · VALID
          </h2>
          <p className="mt-3 text-lg font-semibold text-zinc-50">{preview.strategy.name}</p>
          <ul className="mt-3 space-y-1 text-sm text-zinc-300">
            {preview.strategy.conditions.map((condition, index) => (
              <li key={index} className="font-mono">
                • {condition.field} {condition.operator.replace(/_/g, " ")}{" "}
                {String(condition.value)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-zinc-300">
            Action: <span className="font-mono">{preview.strategy.action.type}</span>
            {preview.strategy.action.maxUsd !== undefined && (
              <>
                {" "}
                · Maximum: <span className="font-mono">${preview.strategy.action.maxUsd}</span>
              </>
            )}
          </p>
          {saveMutation.isError && (
            <p className="mt-3 rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
              {(saveMutation.error as ApiRequestError).message}
            </p>
          )}
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="mt-4 rounded border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 font-mono text-sm text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {saveMutation.isPending ? "Saving…" : "SAVE STRATEGY"}
          </button>
        </section>
      )}

      {preview?.status === "NEEDS_CLARIFICATION" && (
        <section className="mt-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
          <h2 className="font-mono text-xs uppercase tracking-widest text-amber-400">
            NEEDS CLARIFICATION
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-amber-200/90">
            {(preview.questions ?? []).map((question, index) => (
              <li key={index}>
                {index + 1}. {question}
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview?.status === "REJECTED" && (
        <section className="mt-8 rounded-lg border border-red-500/30 bg-red-500/5 p-5">
          <h2 className="font-mono text-xs uppercase tracking-widest text-red-400">
            STRATEGY REJECTED
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-red-300/90">
            {(preview.errors ?? []).map((error, index) => (
              <li key={index}>
                [{error.layer}] {error.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Saved strategies
        </h2>
        {strategiesQuery.data?.strategies.length ? (
          <ul className="mt-4 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {strategiesQuery.data.strategies.map((strategy) => (
              <li key={strategy.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-zinc-100">{strategy.name}</p>
                  <span className="rounded border border-zinc-700 px-2 py-0.5 font-mono text-xs text-zinc-400">
                    {strategy.status}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{strategy.explanation}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">No strategies saved yet.</p>
        )}
      </section>
    </main>
  );
}
