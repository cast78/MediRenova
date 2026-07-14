import { AsyncLocalStorage } from "node:async_hooks";

// Contexto de tenant por request, poblado por el plugin de auth tras decodificar
// el JWT / API Key. La Prisma query extension (ver lib/prisma.ts) lo lee para
// inyectar `tenantId` automáticamente como segunda capa de aislamiento.
export interface TenantStore {
  tenantId: string;
  role: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

// enterWith fija el store para el contexto async actual del request (hook
// onRequest) y persiste hasta el handler. Si nunca se llama (rutas públicas,
// login), getTenantId() devuelve undefined y la extensión no inyecta nada.
export function setTenantContext(ctx: TenantStore): void {
  tenantStorage.enterWith(ctx);
}

export function getTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId;
}

// ── Lógica de filtrado por tenant (pura, testeable) ──────────────────────────

// Modelos con columna `tenant_id`. Solo en estos se inyecta el filtro.
export const TENANT_SCOPED_MODELS = new Set<string>([
  "ApiKey",
  "Appointment",
  "AuditLog",
  "Campaign",
  "Center",
  "Customer",
  "CustomerEvent",
  "MessageTemplate",
  "Product",
  "Revision",
  "Segment",
  "TenantConfig",
  "User",
  "Visit",
  "WorkflowRule",
]);

// Operaciones con `where` arbitrario donde es seguro añadir `tenantId`. Se
// excluyen findUnique/update/delete/upsert (where por clave única: añadir
// tenantId lo invalidaría) y create* (no llevan where; lo fija la ruta).
export const TENANT_INJECT_OPS = new Set<string>([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaArgs = { where?: Record<string, any> } & Record<string, any>;

// Devuelve los args con `where: { tenantId }` inyectado cuando procede. Pura: no
// inyecta si no hay tenant, si el modelo no es tenant-scoped, si la operación no
// es de las seguras, o si el `where` ya constriñe `tenantId`.
export function withTenantFilter(
  model: string,
  operation: string,
  args: PrismaArgs,
  tenantId: string | undefined,
): PrismaArgs {
  if (!tenantId) return args;
  if (!TENANT_SCOPED_MODELS.has(model)) return args;
  if (!TENANT_INJECT_OPS.has(operation)) return args;
  const where = args?.where ?? {};
  if ("tenantId" in where) return args;
  return { ...args, where: { ...where, tenantId } };
}
