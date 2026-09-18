-- CreateEnum
CREATE TYPE "NoShowRecoveryState" AS ENUM ('CONTACTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "no_show_recovery" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "state" "NoShowRecoveryState" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_user_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "no_show_recovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "no_show_recovery_appointment_id_key" ON "no_show_recovery"("appointment_id");

-- CreateIndex
CREATE INDEX "no_show_recovery_tenant_id_idx" ON "no_show_recovery"("tenant_id");

-- AddForeignKey
ALTER TABLE "no_show_recovery" ADD CONSTRAINT "no_show_recovery_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
