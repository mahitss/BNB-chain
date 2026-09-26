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

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        placeholder={
          '"Watch NVDA during US market closure and alert me if the token trades 1.5% above reference."'
        }
        className="mt-6 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 p-4 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
      />
      <p className="mt-2 text-xs text-zinc-500">{EXAMPLE}</p>
      <button
        type="button"
        disabled={text.trim().length === 0 || parseMutation.isPending}
        onClick={() => parseMutation.mutate()}
        className="mt-4 rounded border border-amber-500/50 bg-amber-500/10 px-4 py-2 font-mono text-sm text-amber-400 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {parseMutation.isPending ? "Parsing…" : "CREATE STRATEGY"}
      </button>

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
