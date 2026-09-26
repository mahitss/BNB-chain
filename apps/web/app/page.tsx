/**
 * Phase 1 landing page. This page is intentionally static: it describes the
 * platform and the service layout without presenting any live or fabricated
 * market data. Real dashboards arrive with the market-data phase.
 */
const SERVICES = [
  {
    name: "api",
    stack: "TypeScript · Fastify",
    port: 4000,
    scope: "Phase 1 — service gateway",
  },
  {
    name: "agent",
    stack: "Python · FastAPI",
    port: 8000,
    scope: "Later phase — market intelligence",
  },
  {
    name: "execution",
    stack: "Go",
    port: 8001,
    scope: "Later phase — bounded on-chain execution",
  },
  {
    name: "risk-engine",
    stack: "Rust · axum",
    port: 8002,
    scope: "Later phase — deterministic risk checks",
  },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-500">
          BNB Smart Chain
        </p>
        <h1 className="text-5xl font-semibold tracking-tight text-zinc-50">OLYR</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-zinc-400">
          Autonomous tokenized-equity intelligence and execution. OLYR monitors tokenized stocks on
          BNB Smart Chain, detects spreads against their reference markets, validates risk
          deterministically, and executes bounded spot trades through Binance Web3 infrastructure.
        </p>
      </header>

      <section aria-labelledby="status-heading" className="flex flex-col gap-3">
        <h2
          id="status-heading"
          className="font-mono text-xs uppercase tracking-widest text-zinc-500"
        >
          Status
        </h2>
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 font-mono text-sm leading-relaxed text-amber-300">
          Phase 2 — Binance Web3 RWA data integration. No trading, no wallet activity yet.
        </p>
        <a
          href="/rwa"
          className="inline-block w-fit rounded border border-zinc-700 px-4 py-2 font-mono text-sm text-zinc-200 transition-colors hover:border-amber-500/50 hover:text-amber-400"
        >
          View RWA data →
        </a>
        <a
          href="/markets"
          className="inline-block w-fit rounded border border-zinc-700 px-4 py-2 font-mono text-sm text-zinc-200 transition-colors hover:border-amber-500/50 hover:text-amber-400"
        >
          Market intelligence →
        </a>
        <a
          href="/strategies"
          className="inline-block w-fit rounded border border-zinc-700 px-4 py-2 font-mono text-sm text-zinc-200 transition-colors hover:border-amber-500/50 hover:text-amber-400"
        >
          Strategy builder →
        </a>
        <a
          href="/proposals"
          className="inline-block w-fit rounded border border-zinc-700 px-4 py-2 font-mono text-sm text-zinc-200 transition-colors hover:border-amber-500/50 hover:text-amber-400"
        >
          Trade proposals →
        </a>
      </section>

      <section aria-labelledby="services-heading" className="flex flex-col gap-3">
        <h2
          id="services-heading"
          className="font-mono text-xs uppercase tracking-widest text-zinc-500"
        >
          Services
        </h2>
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {SERVICES.map((service) => (
            <li
              key={service.name}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3"
            >
              <div>
                <p className="font-mono text-sm text-zinc-100">{service.name}</p>
                <p className="text-xs text-zinc-500">{service.stack}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm text-zinc-300">:{service.port}</p>
                <p className="text-xs text-zinc-500">{service.scope}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
