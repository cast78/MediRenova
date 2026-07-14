-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('CLIENTE', 'CENTRO', 'DUPLICADA', 'ERROR', 'OTRO');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "cancel_reason" "CancellationReason";

