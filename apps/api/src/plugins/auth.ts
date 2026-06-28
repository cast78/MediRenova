import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { hashApiKey } from "../lib/crypto.js";
import { setTenantContext } from "../lib/tenant-context.js";

declare module "fastify" {
  interface FastifyRequest {
    ctx: {
      userId: string;
      tenantId: string;
      role: string;
      centerId: string | null;
    };
  }
}

async function authPlugin(server: FastifyInstance) {
  server.decorateRequest("ctx", null);

  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip public routes
    const skipPaths = ["/health", "/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/logout"];
    if (skipPaths.includes(request.routerPath ?? request.url)) return;

    // Skip solo el magic-link público. La API pública (/public) exige API Key,
    // así que pasa por la autenticación de abajo.
    if (request.url.startsWith("/api/v1/link/")) return;
    // Documentación OpenAPI/Swagger pública.
    if (request.url.startsWith("/docs")) return;

    const authHeader = request.headers.authorization;

    // Try Bearer JWT
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const payload: AccessTokenPayload = verifyAccessToken(token);
        request.ctx = { userId: payload.sub, tenantId: payload.tid, role: payload.role, centerId: payload.cen ?? null };
        setTenantContext({ tenantId: payload.tid, role: payload.role });
        return;
      } catch {
        return reply.status(401).send({ errors: [{ code: "UNAUTHORIZED", message: "Token inválido o caducado" }] });
      }
    }

    // Try API Key
    if (authHeader?.startsWith("Bearer sk_live_") || request.headers["x-api-key"]) {
      const rawKey = (request.headers["x-api-key"] as string) ?? authHeader?.slice(7) ?? "";
      const keyHash = hashApiKey(rawKey);
      const apiKey = await prisma.apiKey.findFirst({
        where: { keyHash, revokedAt: null },
      });
      if (!apiKey) {
        return reply.status(401).send({ errors: [{ code: "UNAUTHORIZED", message: "API Key inválida" }] });
      }
      // No lastUsedAt field in schema - skip update
      request.ctx = { userId: apiKey.id, tenantId: apiKey.tenantId, role: "API_KEY", centerId: null };
      setTenantContext({ tenantId: apiKey.tenantId, role: "API_KEY" });
      return;
    }

    return reply.status(401).send({ errors: [{ code: "UNAUTHORIZED", message: "Autenticación requerida" }] });
  });
}

export default fp(authPlugin, { name: "auth" });
