import { z } from "zod";
import type { Prisma } from "@prisma/client";

// Definición de un segmento: filtros opcionales que resuelven a un conjunto de
// clientes. Se guarda como JSON y se traduce a un `where` de Customer en runtime,
// así el conteo es siempre "en vivo".
export const segmentDefinitionSchema = z
  .object({
    channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]).optional(), // exige consentimiento + medio de contacto
    productIds: z.array(z.string().uuid()).optional(), // tomó alguno de estos productos
    expiringInDays: z.number().int().min(1).max(3650).optional(), // revisión APTA que caduca en ≤ N días
    includeExpired: z.boolean().optional(), // incluir también las ya caducadas
    ageMin: z.number().int().min(0).max(120).optional(),
    ageMax: z.number().int().min(0).max(120).optional(),
    centerIds: z.array(z.string().uuid()).optional(), // tuvo cita en alguno
    hasNoShow: z.boolean().optional(), // tiene alguna cita NO_SHOW
  })
  .strict();

export type SegmentDefinition = z.infer<typeof segmentDefinitionSchema>;

// Fecha de hace N años (para traducir edad → fecha de nacimiento).
function yearsAgo(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

// Traduce la definición a un `where` de Customer. El tenantId lo inyecta la
// extensión de Prisma en count/findMany, así que NO se añade aquí. Cada filtro
// relacional va en su propia rama de AND para no exigir que coincidan en la misma
// fila (p. ej. "tuvo cita en el centro X" Y "tiene algún no-show" por separado).
export function buildCustomerWhere(def: SegmentDefinition): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = { deletedAt: null };
  const AND: Prisma.CustomerWhereInput[] = [];

  // Consentimiento + medio de contacto por canal.
  if (def.channel === "EMAIL") { where.acceptsEmail = true; where.email = { not: null }; }
  if (def.channel === "WHATSAPP") { where.acceptsWhatsapp = true; where.phone = { not: null }; }
  if (def.channel === "SMS") { where.acceptsSms = true; where.phone = { not: null }; }

  // Edad → límites de fecha de nacimiento.
  if (def.ageMin != null || def.ageMax != null) {
    const bd: Prisma.DateTimeNullableFilter = {};
    if (def.ageMin != null) bd.lte = yearsAgo(def.ageMin); // ≥ ageMin años
    if (def.ageMax != null) bd.gte = yearsAgo(def.ageMax + 1); // ≤ ageMax años (aprox.)
    where.birthDate = bd;
  }

  // Producto tomado + ventana de caducidad → un único `some` sobre revisiones.
  const rev: Prisma.RevisionWhereInput = {};
  if (def.productIds?.length) rev.productId = { in: def.productIds };
  if (def.expiringInDays != null) {
    rev.outcome = "APTO";
    const exp: Prisma.DateTimeNullableFilter = { lte: new Date(Date.now() + def.expiringInDays * 86_400_000) };
    if (!def.includeExpired) exp.gte = new Date();
    rev.expiryDate = exp;
  }
  if (Object.keys(rev).length) AND.push({ revisions: { some: rev } });

  // Centro: tuvo cita en alguno de estos centros.
  if (def.centerIds?.length) AND.push({ appointments: { some: { room: { centerId: { in: def.centerIds } } } } });

  // No-shows: tiene alguna cita marcada NO_SHOW.
  if (def.hasNoShow) AND.push({ appointments: { some: { status: "NO_SHOW" } } });

  if (AND.length) where.AND = AND;
  return where;
}
