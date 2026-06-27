import { PrismaClient } from "@prisma/client";
import { getTenantId, withTenantFilter } from "./tenant-context.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = basePrisma;
}

// Segunda capa de aislamiento multitenant (defensa en profundidad junto al RLS
// de PostgreSQL): inyecta `where: { tenantId }` cuando hay contexto de tenant y
// el `where` no lo trae ya. Sin contexto (login, rutas públicas) es un no-op,
// por lo que no puede romper queries cross-tenant legítimas.
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async $allOperations({ model, operation, args, query }: any) {
        return query(withTenantFilter(model, operation, args, getTenantId()));
      },
    },
  },
});
