"use client";

/**
 * Persistent application shell: sidebar navigation (desktop), top bar
 * (mobile), and a global status bar fed by /api/system/status. Navigation
 * state survives page transitions — the shell never unmounts between routes.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get as apiGet } from "../lib/api";
import { Dot, toneForStatus } from "./ui";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/markets", label: "Markets" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/strategies", label: "Strategies" },
  { href: "/agent", label: "Agent" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/proposals", label: "Proposals" },
  { href: "/executions", label: "Executions" },
  { href: "/wallet", label: "Wallet" },
  { href: "/settings", label: "Settings" },
];

interface SystemStatus {
  services: Record<string, string>;
  timestamp: string;
}

function useSystemStatus() {
  return useQuery({
    queryKey: ["system-status"],
    queryFn: () => apiGet<SystemStatus>("/api/system/status"),
    refetchInterval: 30_000,
    retry: 1,
  });
}

function StatusBarItem({ label, value }: { label: string; value: string }) {
  const tone = toneForStatus(value);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
      <Dot tone={tone} />
      {label}
      <span className="text-zinc-400">
        {value === "not-configured" ? "OFF" : value.toUpperCase()}
      </span>
    </span>
  );
}

function StatusBar() {
  const status = useSystemStatus();
  const services = status.data?.services;
  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-zinc-800 bg-zinc-950/95 px-4 py-2">
      <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-600">System</span>
      {status.isPending || !services ? (
        <span className="font-mono text-[11px] text-zinc-600">loading status…</span>
      ) : (
        <>
          <StatusBarItem label="API" value={String(services.api ?? "unknown")} />
          <StatusBarItem label="DB" value={String(services.database)} />
          <StatusBarItem label="Risk" value={String(services.riskEngine)} />
          <StatusBarItem label="Agent svc" value={String(services.agent)} />
          <StatusBarItem label="Execution" value={String(services.executionService)} />
          <StatusBarItem label="Binance" value={String(services.binance)} />
          <StatusBarItem label="Wallet" value={String(services.wallet)} />
        </>
      )}
    </footer>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const navLinks = (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={`rounded px-3 py-2 font-mono text-sm transition-colors ${
            isActive(item.href)
              ? "bg-zinc-800/80 text-amber-400"
              : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 lg:hidden">
        <Link href="/" className="font-mono text-lg font-semibold tracking-widest text-zinc-50">
          OLYR
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation"
          className="rounded border border-zinc-700 px-3 py-1.5 font-mono text-xs text-zinc-300"
        >
          {mobileOpen ? "CLOSE" : "MENU"}
        </button>
      </div>
      {mobileOpen && <div className="border-b border-zinc-800 px-4 py-3 lg:hidden">{navLinks}</div>}

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-52 shrink-0 flex-col border-r border-zinc-800 px-3 py-5 lg:flex">
          <Link
            href="/"
            className="mb-6 px-3 font-mono text-xl font-semibold tracking-[0.3em] text-zinc-50"
          >
            OLYR
          </Link>
          {navLinks}
        </aside>

        <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>

      <StatusBar />
    </div>
  );
}
