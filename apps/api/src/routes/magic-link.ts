import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signMagicLinkToken, verifyMagicLinkToken } from "../lib/jwt.js";

const confirmSchema = z.object({
  roomId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
});

const rescheduleSchema = z.object({
  roomId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  appointmentId: z.string().uuid(), // existing appointment to cancel
});

export async function magicLinkRoutes(server: FastifyInstance) {
  // GET /link/:token — validate and return booking context
  server.get<{ Params: { token: string } }>("/link/:token",
    async (request, reply: FastifyReply) => {
      try {
        const payload = verifyMagicLinkToken(request.params.token);

        const [customer, product] = await Promise.all([
          prisma.customer.findFirst({ where: { id: payload.cid, tenantId: payload.tid, deletedAt: null } }),
          prisma.product.findFirst({ where: { id: payload.pid, tenantId: payload.tid, active: true } }),
        ]);

        if (!customer || !product) {
          return reply.status(404).send({ errors: [{ code: "NOT_FOUND", message: "Enlace inválido" }] });
        }

        // Get centers with rooms for this tenant
        const centers = await prisma.center.findMany({
          where: { tenantId: payload.tid, active: true },
          include: {
            rooms: {
              where: { active: true },
              select: { id: true, name: true, schedule: true },
            },
          },
        });

        return reply.send({
          data: {
            customer: { firstName: customer.firstName, lastName: customer.lastName },
            product: { id: product.id, name: product.name, slotDuration: product.slotDuration },
            centers,
            tokenPayload: { cid: payload.cid, pid: payload.pid, tid: payload.tid },
          },
          errors: null,
        });
      } catch {
        return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN", message: "Enlace expirado o inválido" }] });
      }
    });

  // POST /link/:token/confirm — book slot
  server.post<{ Params: { token: string } }>("/link/:token/confirm",
    async (request, reply: FastifyReply) => {
      try {
        const payload = verifyMagicLinkToken(request.params.token);
        const body = confirmSchema.safeParse(request.body);
        if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

        const product = await prisma.product.findFirst({ where: { id: payload.pid, tenantId: payload.tid, active: true } });
        if (!product) return reply.status(400).send({ errors: [{ code: "INVALID_PRODUCT" }] });

        const room = await prisma.room.findFirst({
          where: { id: body.data.roomId, center: { tenantId: payload.tid, active: true } },
        });
        if (!room) return reply.status(400).send({ errors: [{ code: "INVALID_ROOM" }] });

        try {
          const appointment = await prisma.appointment.create({
            data: {
              tenantId: payload.tid,
              customerId: payload.cid,
              productId: payload.pid,
              roomId: body.data.roomId,
              scheduledAt: new Date(body.data.scheduledAt),
              durationMinutes: product.slotDuration,
              source: "MAGIC_LINK",
              status: "CONFIRMED",
            },
          });
          return reply.status(201).send({ data: { appointmentId: appointment.id, scheduledAt: appointment.scheduledAt }, errors: null });
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes("unique constraint")) {
            return reply.status(409).send({ errors: [{ code: "SLOT_TAKEN", message: "Franja ya reservada, elige otra" }] });
          }
          throw err;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique constraint")) throw err;
        return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN" }] });
      }
    });

  // POST /link/:token/reschedule — cancel old + book new slot
  server.post<{ Params: { token: string } }>("/link/:token/reschedule",
    async (request, reply: FastifyReply) => {
      try {
        const payload = verifyMagicLinkToken(request.params.token);
        const body = rescheduleSchema.safeParse(request.body);
        if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

        const product = await prisma.product.findFirst({ where: { id: payload.pid, tenantId: payload.tid, active: true } });
        if (!product) return reply.status(400).send({ errors: [{ code: "INVALID_PRODUCT" }] });

        const room = await prisma.room.findFirst({ where: { id: body.data.roomId, center: { tenantId: payload.tid, active: true } } });
        if (!room) return reply.status(400).send({ errors: [{ code: "INVALID_ROOM" }] });

        // Cancel the old appointment (must belong to this customer + tenant)
        await prisma.appointment.updateMany({
          where: { id: body.data.appointmentId, customerId: payload.cid, tenantId: payload.tid, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          data: { status: "CANCELLED" },
        });

        try {
          const appointment = await prisma.appointment.create({
            data: {
              tenantId: payload.tid,
              customerId: payload.cid,
              productId: payload.pid,
              roomId: body.data.roomId,
              scheduledAt: new Date(body.data.scheduledAt),
              durationMinutes: product.slotDuration,
              source: "MAGIC_LINK",
              status: "CONFIRMED",
            },
          });
          return reply.status(201).send({ data: { appointmentId: appointment.id, scheduledAt: appointment.scheduledAt }, errors: null });
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes("unique constraint")) {
            return reply.status(409).send({ errors: [{ code: "SLOT_TAKEN", message: "Franja ya reservada, elige otra" }] });
          }
          throw err;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique constraint")) throw err;
        return reply.status(401).send({ errors: [{ code: "INVALID_TOKEN" }] });
      }
    });

  // POST /link/generate — generate a magic link token (internal/admin use)
  server.post("/link/generate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = z.object({ customerId: z.string().uuid(), productId: z.string().uuid(), tenantId: z.string().uuid() }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      const token = signMagicLinkToken({ cid: body.data.customerId, pid: body.data.productId, tid: body.data.tenantId, type: "magic_link" });
      const url = `${process.env["PUBLIC_URL"] ?? "http://localhost:3000"}/link/${token}`;
      return reply.send({ data: { token, url }, errors: null });
    });
}
