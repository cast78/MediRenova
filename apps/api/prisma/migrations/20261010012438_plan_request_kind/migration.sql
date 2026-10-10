-- CreateEnum
CREATE TYPE "PlanRequestKind" AS ENUM ('UPGRADE', 'TRIAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlanRequestStatus" ADD VALUE 'APPROVED';
ALTER TYPE "PlanRequestStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "plan_requests" ADD COLUMN     "kind" "PlanRequestKind" NOT NULL DEFAULT 'UPGRADE';
