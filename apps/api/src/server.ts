/**
 * OLYR API service entrypoint.
 */
import { buildApp } from "./app.js";
import { envInt } from "@olyr/config";

const port = envInt("API_PORT", 4000);
const app = await buildApp();

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
