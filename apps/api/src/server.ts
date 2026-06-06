import "dotenv/config";
import Fastify from "fastify";
import { registerPlugins } from "./plugins/index.js";
import { registerRoutes } from "./routes/index.js";
import { startWorkflowCron } from "./lib/workflow-cron.js";

const server = Fastify({
  logger: {
    level: process.env["LOG_LEVEL"] ?? "info",
  },
});

async function start() {
  await registerPlugins(server);
  await registerRoutes(server);

  const port = Number(process.env["PORT"] ?? 3001);
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
