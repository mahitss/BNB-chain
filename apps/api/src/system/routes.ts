/**
 * System status endpoint: aggregates real health from every backend service.
 * The status bar consumes this — degraded states are shown, never hidden.
 */
import type { FastifyInstance } from "fastify";
import { envOptionalString } from "@olyr/config";

export function registerSystemStatusRoutes(
  app: FastifyInstance,
  deps: {
    prismaReady: boolean;
    binanceConfigured: boolean;
    riskUrl: string;
    agentUrl: string;
    executionUrl: string;
    policyMode: string;
    scannerEnabled: boolean;
  },
): void {
  app.get("/api/system/status", async () => {
    const fetchHealth = async (url: string): Promise<"ok" | "unreachable"> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return response.ok ? "ok" : "unreachable";
      } catch {
        return "unreachable";
      }
    };

    let database: "ok" | "unavailable" = "unavailable";
    if (deps.prismaReady) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma = (app as any).olyrPrisma;
        if (prisma) {
          await prisma.$queryRaw`SELECT 1`;
          database = "ok";
        }
      } catch {
        database = "unavailable";
      }
    }

    const [risk, agent, execution] = await Promise.all([
      fetchHealth(`${deps.riskUrl}/health`),
      fetchHealth(`${deps.agentUrl}/health`),
      fetchHealth(`${deps.executionUrl}/health`),
    ]);

    return {
      services: {
        api: "ok" as const,
        database: deps.prismaReady ? database : "not-configured",
        riskEngine: risk,
        agent: agent,
        executionService: execution,
        binance: deps.binanceConfigured ? "configured" : "not-configured",
        wallet: "not-configured",
      },
      executionPolicy: deps.policyMode,
      scannerEnabled: deps.scannerEnabled,
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/agent/events", async (request) => {
    const limitParam = Number((request.query as { limit?: string }).limit ?? 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
    void envOptionalString;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = (app as any).olyrPrisma;
    if (!prisma) {
      return { events: [] };
    }
    const rows = await prisma.agentEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return {
      events: rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        type: row.type,
        strategyId: row.strategyId,
        detail: row.detail ?? undefined,
        createdAt: (row.createdAt as Date).toISOString(),
      })),
    };
  });
}
