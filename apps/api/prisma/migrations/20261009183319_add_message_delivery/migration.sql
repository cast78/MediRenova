-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "short_links" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'booking';

-- CreateTable
CREATE TABLE "message_deliveries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "appointment_id" TEXT,
    "event" TEXT NOT NULL,
    "channel" "MessageChannel",
    "provider" TEXT NOT NULL DEFAULT 'demo',
    "status" "MessageDeliveryStatus" NOT NULL DEFAULT 'SENT',
    "to" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "cta" TEXT,
    "link" TEXT,
    "template_name" TEXT,
    "vars" JSONB,
    "reason" TEXT,
    "by_user_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_deliveries_tenant_id_customer_id_created_at_idx" ON "message_deliveries"("tenant_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "message_deliveries_tenant_id_created_at_idx" ON "message_deliveries"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "message_deliveries_tenant_id_status_idx" ON "message_deliveries"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
