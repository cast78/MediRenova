import "dotenv/config";
import Fastify from "fastify";
import { registerPlugins } from "./plugins/index.js";
import { registerRoutes } from "./routes/index.js";
import { startWorkflowCron } from "./lib/workflow-cron.js";

const server = Fastify({
  logger: {
    level: process.env["LOG_LEVEL"] ?? "info",
  },
  maxParamLength: 600, // JWT tokens en path params pueden superar los 100 chars del default
});

async function start() {
  await registerPlugins(server);
  await registerRoutes(server);

  const port = Number(process.env["PORT"] ?? 8080);
  const host = process.env["HOST"] ?? "0.0.0.0";

  await server.listen({ port, host });
  server.log.info(`API running at http://${host}:${port}`);

  if (process.env["NODE_ENV"] !== "test") {
    startWorkflowCron();
  }
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
