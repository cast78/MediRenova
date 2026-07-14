import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/authorization.js";
import {
  DEFAULT_CERTIFICATE_TEMPLATE,
  renderWithTemplate,
  sampleCertificateData,
} from "../lib/certificate.js";
import {
  DEFAULT_CERTIFICATE_CONFIG,
  certificateConfigSchema,
  configToTemplate,
  resolveCertificateHtml,
} from "../lib/certificate-config.js";
import { htmlToPdf } from "../lib/pdf.js";
import { DEFAULT_EXPLORATION_FORM_FIELDS } from "../lib/default-form.js";

// ¿El formulario activo es (byte a byte) el formulario por defecto del sistema?
// El fallback de revisiones materializa ese formulario en el producto, así que
// "tiene campos" no basta para saber si el centro lo personalizó.
function isDefaultForm(fields: unknown[]): boolean {
  if (fields.length !== DEFAULT_EXPLORATION_FORM_FIELDS.length) return false;
  return DEFAULT_EXPLORATION_FORM_FIELDS.every((d, i) => {
    const f = fields[i] as { name?: string; type?: string } | undefined;
    return f?.name === d.name && f?.type === d.type;
  });
}

const ageRuleSchema = z.object({
  minAge: z.number().int().min(0).max(120),
  maxAge: z.number().int().min(0).max(120),
  validityDays: z.number().int().min(0), // 0 = no permitido
});

const renewalRulesSchema = z.object({
  requiresMedical: z.boolean().optional(),
  requiresPsych: z.boolean().optional(),
  requiresVision: z.boolean().optional(),
  // Simple single validity (no age ranges)
  validityDays: z.number().int().min(1).optional(),
  // Age-based ranges
  ageRules: z.array(ageRuleSchema).optional(),
});

function validateAgeRuleCoverage(rules: { minAge: number; maxAge: number; validityDays: number }[]): string | null {
  if (rules.length === 0) return null;
  const sorted = [...rules].sort((a, b) => a.minAge - b.minAge);
  if (sorted[0]!.minAge !== 0) return "Los tramos deben comenzar en edad 0";
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.minAge !== sorted[i - 1]!.maxAge + 1) {
      return `Hay un hueco o solapamiento entre los tramos ${sorted[i - 1]!.maxAge} y ${sorted[i]!.minAge}`;
    }
  }
  if (sorted[sorted.length - 1]!.maxAge < 120) {
    return "Los tramos deben cubrir hasta edad 120";
  }
  return null;
}

const productSchema = z.object({
  name: z.string().min(2).max(150),
  type: z.enum(["CARNET_CONDUCIR", "LICENCIA_ARMAS", "DNI", "OTRO"]),
  slotDuration: z.number().int().min(5),
  renewalRules: renewalRulesSchema.optional(),
  active: z.boolean().optional(),
});

export async function productRoutes(server: FastifyInstance) {
  server.get("/products", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const products = await prisma.product.findMany({
        where: { tenantId: request.ctx.tenantId },
        orderBy: { name: "asc" },
        include: { formTemplates: { where: { isActive: true }, select: { schema: true } } },
      });
      // Flags de configuración para el catálogo: formulario propio (plantilla activa
      // con campos) y plantilla de certificado propia (si no, se usa la del sistema).
      const data = products.map(({ formTemplates, certificateTemplate, certificateConfig, ...p }) => {
        const fields = (formTemplates[0]?.schema as { fields?: unknown[] } | undefined)?.fields ?? [];
        return {
          ...p,
          // Propio = tiene campos y NO es el formulario por defecto del sistema.
          hasOwnForm: fields.length > 0 && !isDefaultForm(fields),
          // Propia = tiene config del editor visual o plantilla HTML personalizada.
          hasCertificateTemplate: certificateConfig != null || (certificateTemplate != null && certificateTemplate.trim() !== ""),
        };
      });
      return reply.send({ data, errors: null });
    });

  server.post("/products", { preHandler: [requireRole("ADMIN")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = productSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const ageRules = body.data.renewalRules?.ageRules;
      if (ageRules && ageRules.length > 0) {
        const coverageError = validateAgeRuleCoverage(ageRules);
        if (coverageError) return reply.status(400).send({ errors: [{ code: "INVALID_AGE_RULES", message: coverageError }] });
      }
      const product = await prisma.product.create({
        data: {
          tenantId: request.ctx.tenantId,
          name: body.data.name,
          type: body.data.type,
          slotDuration: body.data.slotDuration,
          renewalRules: body.data.renewalRules ?? {},
          active: body.data.active ?? true,
        },
      });
      return reply.status(201).send({ data: product, errors: null });
    });

  server.get<{ Params: { id: string } }>("/products/:id", { preHandler: [requireRole("RECEPTIONIST")] },
    async (request, reply: FastifyReply) => {
      const product = await prisma.product.findFirst({ where: { id: request.params.id, tenantId: request.ctx.tenantId } });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: product, errors: null });
    });

  server.patch<{ Params: { id: string } }>("/products/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = productSchema.partial().safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });
      const ageRules = body.data.renewalRules?.ageRules;
      if (ageRules && ageRules.length > 0) {
        const coverageError = validateAgeRuleCoverage(ageRules);
        if (coverageError) return reply.status(400).send({ errors: [{ code: "INVALID_AGE_RULES", message: coverageError }] });
      }
      const updateData: Record<string, unknown> = {};
      if (body.data.name !== undefined) updateData["name"] = body.data.name;
      if (body.data.type !== undefined) updateData["type"] = body.data.type;
      if (body.data.slotDuration !== undefined) updateData["slotDuration"] = body.data.slotDuration;
      if (body.data.renewalRules !== undefined) updateData["renewalRules"] = body.data.renewalRules;
      if (body.data.active !== undefined) updateData["active"] = body.data.active;
      const result = await prisma.product.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, data: updateData });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { updated: true }, errors: null });
    });

  server.delete<{ Params: { id: string } }>("/products/:id", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      await prisma.product.updateMany({ where: { id: request.params.id, tenantId: request.ctx.tenantId }, data: { active: false } });
      return reply.status(204).send();
    });

  // ── Plantilla PDF del certificado por producto (tarea 6.4) ─────────────────

  // Devuelve el estado de la plantilla del producto: config del editor visual (o
  // null), plantilla HTML personalizada (o null), y las por defecto del sistema.
  server.get<{ Params: { id: string } }>("/products/:id/template", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const product = await prisma.product.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        select: { certificateTemplate: true, certificateConfig: true },
      });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({
        data: {
          template: product.certificateTemplate,
          config: product.certificateConfig,
          default: DEFAULT_CERTIFICATE_TEMPLATE,
          defaultConfig: DEFAULT_CERTIFICATE_CONFIG,
        },
        errors: null,
      });
    });

  // Cuerpo del PUT/preview: config visual XOR plantilla HTML. Si llega `config`, se
  // guarda en modo visual (template = null). Si llega `template`, modo HTML avanzado
  // (config = null). Ambos vacíos/null = plantilla por defecto del sistema.
  const templateBodySchema = z.object({
    template: z.string().max(100_000).nullable().optional(),
    config: certificateConfigSchema.nullable().optional(),
  });

  // Guarda la plantilla del producto (config visual o HTML). Valida que compila y
  // renderiza con datos de ejemplo antes de persistir.
  server.put<{ Params: { id: string } }>("/products/:id/template", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const body = templateBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ errors: body.error.flatten().fieldErrors });

      let certificateConfig: unknown = null;
      let certificateTemplate: string | null = null;

      if (body.data.config) {
        try {
          renderWithTemplate(configToTemplate(body.data.config), sampleCertificateData());
        } catch (err) {
          return reply.status(400).send({ errors: [{ code: "INVALID_TEMPLATE", message: err instanceof Error ? err.message : "Configuración inválida" }] });
        }
        certificateConfig = body.data.config;
      } else if (body.data.template && body.data.template.trim().length > 0) {
        try {
          renderWithTemplate(body.data.template, sampleCertificateData());
        } catch (err) {
          return reply.status(400).send({ errors: [{ code: "INVALID_TEMPLATE", message: err instanceof Error ? err.message : "Plantilla inválida" }] });
        }
        certificateTemplate = body.data.template;
      }

      const result = await prisma.product.updateMany({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        data: {
          certificateTemplate,
          certificateConfig: certificateConfig === null ? Prisma.DbNull : (certificateConfig as Prisma.InputJsonValue),
        },
      });
      if (result.count === 0) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      return reply.send({ data: { updated: true, usesDefault: certificateConfig === null && certificateTemplate === null }, errors: null });
    });

  // Renderiza el certificado con datos de ejemplo y devuelve el HTML (para el preview
  // en vivo del editor). Acepta config o template en el body, sin guardar.
  server.post<{ Params: { id: string }; Body: { template?: string; config?: unknown } }>("/products/:id/template/preview-html", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const product = await prisma.product.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        select: { certificateTemplate: true, certificateConfig: true },
      });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const source = resolvePreviewSource(request.body, product);
      const html = resolveCertificateHtml(source, sampleCertificateData());
      return reply.type("text/html").send(html);
    });

  // Previsualiza y devuelve el PDF. Acepta config o template en el body (sin guardar)
  // o usa lo guardado del producto / la por defecto.
  server.post<{ Params: { id: string }; Body: { template?: string; config?: unknown } }>("/products/:id/template/preview", { preHandler: [requireRole("ADMIN")] },
    async (request, reply: FastifyReply) => {
      const product = await prisma.product.findFirst({
        where: { id: request.params.id, tenantId: request.ctx.tenantId },
        select: { certificateTemplate: true, certificateConfig: true },
      });
      if (!product) return reply.status(404).send({ errors: [{ code: "NOT_FOUND" }] });
      const source = resolvePreviewSource(request.body, product);
      const html = resolveCertificateHtml(source, sampleCertificateData());
      const pdf = await htmlToPdf(html);
      return reply.type("application/pdf").send(pdf);
    });
}

// Determina la fuente a previsualizar: lo enviado en el body tiene prioridad (config
// o template sin guardar); si no, lo guardado en el producto.
function resolvePreviewSource(
  body: { template?: string; config?: unknown } | undefined,
  product: { certificateTemplate: string | null; certificateConfig: unknown },
): { certificateConfig?: unknown; certificateTemplate?: string | null } {
  if (body?.config && typeof body.config === "object") return { certificateConfig: body.config };
  if (typeof body?.template === "string" && body.template.trim().length > 0) return { certificateTemplate: body.template };
  return { certificateConfig: product.certificateConfig, certificateTemplate: product.certificateTemplate };
}
