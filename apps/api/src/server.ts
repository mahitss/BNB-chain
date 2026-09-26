/**
 * OLYR API service (Fastify).
 *
 * Phase 1 exposes a health endpoint only. Route handlers stay thin; business
 * logic will live in dedicated modules and downstream services as the
 * platform grows.
 */
import Fastify from "fastify";
import { envInt, loadEnvironment } from "@olyr/config";
import type { HealthCheck } from "@olyr/types";

const apiVersion = "0.1.0";
const environment = loadEnvironment();
const port = envInt("API_PORT", 4000);

const app = Fastify({
  logger: { level: environment === "development" ? "debug" : "info" },
});

app.get("/health", async (): Promise<HealthCheck> => {
  return {
    service: "api",
    status: "ok",
    timestamp: new Date().toISOString(),
    version: apiVersion,
  };
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

app
  .listen({ port, host: "0.0.0.0" })
  .then((address) => app.log.info(`OLYR API listening at ${address}`))
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
