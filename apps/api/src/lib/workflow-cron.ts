import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { signMagicLinkToken } from "./jwt.js";

const PUBLIC_URL = process.env["PUBLIC_URL"] ?? "http://localhost:3000";

/**
 * Daily cron job: detects expiring revisions and sends workflow notifications.
 * Runs at 08:00 Europe/Madrid time every day.
 */
export function startWorkflowCron(): void {
  cron.schedule(
    "0 8 * * *",
    async () => {
      try {
        await runWorkflowJob();
      } catch (err) {
        console.error("[workflow-cron] Error:", err);
      }
    },
    { timezone: "Europe/Madrid" },
  );
  console.log("[workflow-cron] Scheduled daily at 08:00 Europe/Madrid");
}

export async function runWorkflowJob(): Promise<void> {
  console.log("[workflow-cron] Running workflow job...");
  const today = new Date();

  // Get all active workflow rules
  const rules = await prisma.workflowRule.findMany({ where: { active: true } });

  for (const rule of rules) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + rule.daysBeforeExpiry);
    const windowStart = new Date(targetDate); windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(targetDate); windowEnd.setHours(23, 59, 59, 999);

    // Find revisions expiring in this window for this product
    const expiringRevisions = await prisma.revision.findMany({
      where: {
        productId: rule.productId,
        expiryDate: { gte: windowStart, lte: windowEnd },
        outcome: "APTO",
      },
      include: { customer: true },
    });

    for (const revision of expiringRevisions) {
      // Check if customer already has a future confirmed appointment for this product
      const futureAppt = await prisma.appointment.findFirst({
        where: {
          customerId: revision.customerId,
          productId: revision.productId,
          scheduledAt: { gt: today },
          status: { in: ["CONFIRMED", "PENDING"] },
        },
      });
      if (futureAppt) continue; // Skip - already booked

      // Check if there's already a pending workflow execution
      const existing = await prisma.workflowExecution.findFirst({
        where: {
          ruleId: rule.id,
          customerId: revision.customerId,
          revisionId: revision.id,
          status: { in: ["PENDING_SEND", "SENT"] },
        },
      });

      if (existing) {
        // Check if retry is due
        if (existing.nextAttemptAt && existing.nextAttemptAt <= today && existing.attemptCount < rule.maxRetries) {
          await sendWorkflowNotification(rule, revision, existing.id);
        }
        continue;
      }

      // Create new execution
      const execution = await prisma.workflowExecution.create({
        data: {
          ruleId: rule.id,
          customerId: revision.customerId,
          revisionId: revision.id,
          status: "PENDING_SEND",
          nextAttemptAt: today,
        },
      });

      await sendWorkflowNotification(rule, revision, execution.id);
    }
  }

  console.log("[workflow-cron] Done.");
}

async function sendWorkflowNotification(
  rule: { id: string; actionType: string; templateName: string; retryEveryDays: number },
  revision: { id: string; customerId: string; productId: string; customer: { phone: string | null } },
  executionId: string,
): Promise<void> {
  try {
    // Generate magic link
    const tenant = await prisma.workflowRule.findUnique({ where: { id: rule.id }, select: { tenantId: true } });
    if (!tenant) return;

    const token = signMagicLinkToken({ cid: revision.customerId, pid: revision.productId, tid: tenant.tenantId, type: "magic_link" });
    const magicUrl = `${PUBLIC_URL}/link/${token}`;

    if (rule.actionType === "WHATSAPP") {
      // TODO (task 12.5): Implement Meta Cloud API WhatsApp send
      console.log(`[workflow] Would send WhatsApp to ${revision.customer.phone ?? "?"} with template ${rule.templateName}, URL: ${magicUrl}`);
    }

    const nextAttemptAt = new Date();
    nextAttemptAt.setDate(nextAttemptAt.getDate() + rule.retryEveryDays);

    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: "SENT",
        lastAttemptAt: new Date(),
        nextAttemptAt,
        attemptCount: { increment: 1 },
      },
    });
  } catch (err) {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: "FAILED", lastAttemptAt: new Date() },
    });
    console.error(`[workflow] Failed to send notification for execution ${executionId}:`, err);
  }
}
