import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { verifyPassword } from "../lib/password.js";
import { signAccessToken } from "../lib/jwt.js";
import { generateRefreshToken } from "../lib/crypto.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function authRoutes(server: FastifyInstance) {
  // POST /auth/login
  server.post(
    "/auth/login",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = loginSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      }

      const { email, password } = body.data;

      // Find user by email (search across all tenants for login; tenant resolved after)
      const user = await prisma.user.findFirst({
        where: { email, active: true },
      });

      if (!user) {
        return reply.status(401).send({ errors: [{ code: "INVALID_CREDENTIALS", message: "Credenciales incorrectas" }] });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ errors: [{ code: "INVALID_CREDENTIALS", message: "Credenciales incorrectas" }] });
      }

      const accessToken = signAccessToken({
        sub: user.id,
        tid: user.tenantId,
        role: user.role,
      });

      const rawRefresh = generateRefreshToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.userSession.create({
        data: {
          userId: user.id,
          refreshToken: rawRefresh,
          expiresAt,
        },
      });

      return reply.status(200).send({
        data: {
          accessToken,
          refreshToken: rawRefresh,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            tenantId: user.tenantId,
          },
        },
        errors: null,
      });
    },
  );

  // POST /auth/refresh
  server.post(
    "/auth/refresh",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = z.object({ refreshToken: z.string() }).safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ errors: [{ code: "INVALID_INPUT", message: "refreshToken requerido" }] });
      }

      const session = await prisma.userSession.findFirst({
        where: {
          refreshToken: body.data.refreshToken,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { user: true },
      });

      if (!session) {
        return reply.status(401).send({ errors: [{ code: "INVALID_REFRESH_TOKEN", message: "Token inválido o caducado" }] });
      }

      // Rotate refresh token
      const newRefreshToken = generateRefreshToken();
      await prisma.userSession.update({
        where: { id: session.id },
        data: {
          refreshToken: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const accessToken = signAccessToken({
        sub: session.user.id,
        tid: session.user.tenantId,
        role: session.user.role,
      });

      return reply.status(200).send({
        data: { accessToken, refreshToken: newRefreshToken },
        errors: null,
      });
    },
  );

  // POST /auth/logout
  server.post(
    "/auth/logout",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = z.object({ refreshToken: z.string() }).safeParse(request.body);
      if (!body.success) {
        return reply.status(204).send();
      }

      await prisma.userSession.updateMany({
        where: { refreshToken: body.data.refreshToken },
        data: { revokedAt: new Date() },
      });

      return reply.status(204).send();
    },
  );
}
