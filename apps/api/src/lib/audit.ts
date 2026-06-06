import { prisma } from "./prisma.js";
import type { AuditAction } from "@prisma/client";

export interface AuditContext {
  tenantId: string;
  userId: string;
  ip?: string;
  userAgent?: string;
}

export async function auditLog(
  ctx: AuditContext,
  action: AuditAction,
  resourceType: string,
  resourceId: string,
  meta?: object | null,
) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action,
        resourceType,
        resourceId,
        ...(meta !== undefined && meta !== null ? { meta } : {}),
        ipAddress: ctx.ip ?? null,
      },
    });
  } catch (err) {
    // Never throw from audit - just log
    console.error("[audit] Failed to write audit log:", err);
  }
}
