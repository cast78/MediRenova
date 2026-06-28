import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import authPlugin from "./auth.js";

export async function registerPlugins(server: FastifyInstance) {
  await server.register(helmet);
  const allowedOrigins = (process.env["CORS_ORIGIN"] ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim());
  await server.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.some((o) => o === origin || origin.endsWith(".vercel.app"))) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"), false);
      }
    },
    credentials: true,
  });
  await server.register(cookie, {
    secret: process.env["COOKIE_SECRET"] ?? "change-me-in-production",
  });
  await server.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });
  await server.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10 MB por archivo
  });

  // OpenAPI/Swagger de la API pública (tarea 14.8). Solo documenta /public/*.
  await server.register(swagger, {
    openapi: {
      info: {
        title: "MediRenova — API pública",
        version: "1.0.0",
        description: "API REST para integraciones de terceros. Autenticación por API Key en la cabecera `x-api-key`.",
      },
      components: { securitySchemes: { apiKey: { type: "apiKey", name: "x-api-key", in: "header" } } },
      security: [{ apiKey: [] }],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: ({ schema, url }: any) => {
      if (!url.startsWith("/api/v1/public/")) return { schema: { ...(schema ?? {}), hide: true }, url };
      return { schema, url };
    },
  });
  await server.register(swaggerUi, { routePrefix: "/docs" });

  await server.register(authPlugin);
}
