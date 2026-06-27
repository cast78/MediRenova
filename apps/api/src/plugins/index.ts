import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
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
  await server.register(authPlugin);
}
