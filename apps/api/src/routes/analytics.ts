// API de analítica (capacidad crm-analitica): endpoints de SOLO LECTURA que sirven
// los KPIs de gestión para ADMIN y SUPERADMIN. Toda la lógica de cálculo vive en
// lib/analytics.ts (fuente única); aquí sólo se resuelve alcance/filtros, se valida
// y se serializa (JSON o CSV con ?format=csv).
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import {
  type AnalyticsScope, type AnalyticsFilters, type Granularity,
  MAX_RANGE_DAYS, rangeDays, toCsv,
  computeFunnel, computeOccupancy, computeSaturation, computeDoctors, computeComparison, computeVolume,
} from "../lib/analytics.js";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD");

// Filtros comunes a todos los endpoints. `scope`/`tenantId` sólo los honra SUPERADMIN.
export const filtersSchema = z.object({
  from: ymd,
  to: ymd,
  centerId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  granularity: z.enum(["day", "week", "month", "year"]).optional(),
  scope: z.enum(["all"]).optional(),
  tenantId: z.string().uuid().optional(),
  format: z.enum(["csv"]).optional(),
}).refine((v) => v.from <= v.to, { message: "El rango de fechas es inválido (from > to)" });

type Query = z.infer<typeof filtersSchema>;

// Resuelve el alcance (aislamiento) según rol. ADMIN → su tenant. SUPERADMIN →
// cross-tenant sólo si lo pide explícitamente (scope=all o tenantId), si no su propio
// contexto (que puede venir ya fijado por `x-act-as-tenant`).
async function resolveScope(request: FastifyRequest, q: Query): Promise<AnalyticsScope> {
  const { role, tenantId } = request.ctx;
  if (role === "SUPERADMIN") {
    if (q.scope === "all") {
      const tenants = await prisma.tenant.findMany({ where: { active: true, slug: { not: "system" } }, select: { id: true } });
      const ids = tenants.map((t) => t.id);
      return { tenantWhere: { tenantId: { in: ids } }, tenantIds: ids, isSuperadminAll: true };
    }
    const target = q.tenantId ?? tenantId;
    return { tenantWhere: { tenantId: target }, tenantIds: [target], isSuperadminAll: false };
  }
  return { tenantWhere: { tenantId }, tenantIds: [tenantId], isSuperadminAll: false };
}

// Filtros efectivos: el centro fijado en el token (recepción/centro) manda sobre el
// query; en cross-tenant (scope=all) no aplica un centro concreto.
function resolveFilters(request: FastifyRequest, q: Query, isSuperadminAll: boolean): AnalyticsFilters {
  const centerId = isSuperadminAll ? null : (request.ctx.centerId ?? q.centerId ?? null);
  return {
    from: q.from, to: q.to, centerId,
    roomId: q.roomId ?? null, doctorId: q.doctorId ?? null, productId: q.productId ?? null,
  };
}

// Envoltura común: parsea, valida rango, resuelve alcance/filtros y delega en `run`,
// que decide los datos JSON y (para CSV) las filas tabulares.
async function handle(
  request: FastifyRequest, reply: FastifyReply, name: string,
  run: (scope: AnalyticsScope, f: AnalyticsFilters, q: Query) => Promise<{ data: unknown; rows: Record<string, unknown>[] }>,
) {
  const parsed = filtersSchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({ errors: parsed.error.issues.map((i) => ({ code: "VALIDATION", message: i.message })) });
  }
  const q = parsed.data;
  if (rangeDays(q.from, q.to) > MAX_RANGE_DAYS) {
    return reply.status(400).send({ errors: [{ code: "VALIDATION", message: `El rango excede el máximo de ${MAX_RANGE_DAYS} días` }] });
  }
  const scope = await resolveScope(request, q);
  const f = resolveFilters(request, q, scope.isSuperadminAll);
  const { data, rows } = await run(scope, f, q);

  if (q.format === "csv") {
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${name}_${q.from}_${q.to}.csv"`)
      .send(toCsv(rows));
  }
  return reply.send({ data, errors: null });
}

const gran = (q: Query, fallback: Granularity, allowed: Granularity[]): Granularity => {
  const g = q.granularity;
  return g && allowed.includes(g) ? g : fallback;
};

// Esquema de parámetros para OpenAPI (documentación). Permisivo (no `required`,
// additionalProperties) para no interferir con la validación real (Zod en `handle`),
// que es la fuente única de verdad de la validación.
const FILTER_QS = {
  type: "object",
  additionalProperties: true,
  properties: {
    from: { type: "string", description: "Fecha inicio YYYY-MM-DD (inclusive). Obligatorio." },
    to: { type: "string", description: "Fecha fin YYYY-MM-DD (inclusive). Obligatorio." },
    centerId: { type: "string", format: "uuid", description: "Filtrar por centro" },
    roomId: { type: "string", format: "uuid", description: "Filtrar por sala" },
    doctorId: { type: "string", format: "uuid", description: "Filtrar por médico" },
    productId: { type: "string", format: "uuid", description: "Filtrar por producto" },
    granularity: { type: "string", enum: ["day", "week", "month", "year"], description: "Agrupación temporal (según endpoint)" },
    scope: { type: "string", enum: ["all"], description: "Solo SUPERADMIN: rollup de todos los tenants" },
    tenantId: { type: "string", format: "uuid", description: "Solo SUPERADMIN: acotar a un tenant" },
    format: { type: "string", enum: ["csv"], description: "Exportar el resultado en CSV" },
  },
};

// Construye el `schema` OpenAPI de un endpoint de analítica (no define `response`
// para no alterar la serialización real de la respuesta).
const doc = (summary: string) => ({
  schema: { tags: ["Analítica"], summary, security: [{ bearerAuth: [] }], querystring: FILTER_QS },
});

export async function analyticsRoutes(server: FastifyInstance) {
  const guard = { preHandler: [requireRole("ADMIN")] }; // ADMIN + SUPERADMIN (rango); recepción/médico → 403

  // GET /analytics/funnel — embudo de conversión + fugas
  server.get("/analytics/funnel", { ...guard, ...doc("Embudo de conversión y fugas del periodo") }, async (req, reply) =>
    handle(req, reply, "funnel", async (scope, f) => {
      const r = await computeFunnel(scope, f);
      const rows = [{
        reservas: r.reservas, confirmadas: r.confirmadas, atendidas: r.atendidas, visitasCompletadas: r.visitasCompletadas,
        canceladasCliente: r.fugas.canceladasCliente, canceladasCentro: r.fugas.canceladasCentro, canceladasOtras: r.fugas.canceladasOtras,
        reprogramadas: r.fugas.reprogramadas, noShow: r.fugas.noShow, seFue: r.fugas.seFue, ruido: r.ruido,
        tasaConfirmacion: r.tasas.confirmacion, tasaAtencion: r.tasas.atencion, tasaNoShow: r.tasas.noShow, tasaCancelacion: r.tasas.cancelacion,
      }];
      return { data: r, rows };
    }));

  // GET /analytics/occupancy — ocupación por sala vs disponibilidad
  server.get("/analytics/occupancy", { ...guard, ...doc("Ocupación por sala frente a disponibilidad") }, async (req, reply) =>
    handle(req, reply, "occupancy", async (scope, f) => {
      const r = await computeOccupancy(scope, f);
      return { data: r, rows: r.salas as unknown as Record<string, unknown>[] };
    }));

  // GET /analytics/saturation — serie demanda vs capacidad
  server.get("/analytics/saturation", { ...guard, ...doc("Saturación de la demanda (demanda vs capacidad)") }, async (req, reply) =>
    handle(req, reply, "saturation", async (scope, f, q) => {
      const r = await computeSaturation(scope, f, gran(q, "day", ["day", "week", "month"]));
      return { data: r, rows: r as unknown as Record<string, unknown>[] };
    }));

  // GET /analytics/doctors — rendimiento por médico
  server.get("/analytics/doctors", { ...guard, ...doc("Rendimiento por médico") }, async (req, reply) =>
    handle(req, reply, "doctors", async (scope, f) => {
      const r = await computeDoctors(scope, f);
      return { data: r, rows: r as unknown as Record<string, unknown>[] };
    }));

  // GET /analytics/comparison — comparativa salas y centros
  server.get("/analytics/comparison", { ...guard, ...doc("Comparativa entre salas y entre centros") }, async (req, reply) =>
    handle(req, reply, "comparison", async (scope, f) => {
      const r = await computeComparison(scope, f);
      const rows = [
        ...r.porCentro.map((c) => ({ nivel: "centro", ...c })),
        ...r.porSala.map((s) => ({ nivel: "sala", ...s })),
      ];
      return { data: r, rows };
    }));

  // GET /analytics/volume — series de volumen (visitas/reservas)
  server.get("/analytics/volume", { ...guard, ...doc("Volumen de reservas y visitas") }, async (req, reply) =>
    handle(req, reply, "volume", async (scope, f, q) => {
      const r = await computeVolume(scope, f, gran(q, "month", ["month", "year"]));
      return { data: r, rows: r as unknown as Record<string, unknown>[] };
    }));
}
