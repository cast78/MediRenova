-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('ESSENTIAL', 'PRO');

-- CreateEnum
CREATE TYPE "PlanRequestStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "feature_overrides" JSONB,
ADD COLUMN     "max_centers" INTEGER,
ADD COLUMN     "plan" "PlanTier" NOT NULL DEFAULT 'PRO',
ADD COLUMN     "trial_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "plan_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requested_plan" "PlanTier" NOT NULL,
    "by_user_id" TEXT,
    "note" TEXT,
    "status" "PlanRequestStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "plan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_requests_status_created_at_idx" ON "plan_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "plan_requests_tenant_id_idx" ON "plan_requests"("tenant_id");

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
