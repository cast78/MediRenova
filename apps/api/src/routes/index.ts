import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.js";
import { tenantRoutes } from "./tenants.js";
import { centerRoutes } from "./centers.js";
import { productRoutes } from "./products.js";
import { formRoutes } from "./forms.js";
import { customerRoutes } from "./customers.js";
import { appointmentRoutes } from "./appointments.js";
import { magicLinkRoutes } from "./magic-link.js";
import { revisionRoutes } from "./revisions.js";
import { workflowRoutes } from "./workflow.js";
import { dashboardRoutes } from "./dashboard.js";

export async function registerRoutes(server: FastifyInstance) {
  server.get("/health", async () => ({ status: "ok" }));
  const prefix = "/api/v1";
  await server.register(authRoutes, { prefix });
  await server.register(tenantRoutes, { prefix });
  await server.register(centerRoutes, { prefix });
  await server.register(productRoutes, { prefix });
  await server.register(formRoutes, { prefix });
  await server.register(customerRoutes, { prefix });
  await server.register(appointmentRoutes, { prefix });
  await server.register(magicLinkRoutes, { prefix });
  await server.register(revisionRoutes, { prefix });
  await server.register(workflowRoutes, { prefix });
  await server.register(dashboardRoutes, { prefix });
}
