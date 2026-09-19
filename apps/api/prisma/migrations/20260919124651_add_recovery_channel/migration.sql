-- CreateEnum
CREATE TYPE "NoShowRecoveryChannel" AS ENUM ('PHONE', 'WHATSAPP', 'EMAIL');

-- AlterTable
ALTER TABLE "no_show_recovery" ADD COLUMN     "channel" "NoShowRecoveryChannel";

-- AddForeignKey
ALTER TABLE "no_show_recovery" ADD CONSTRAINT "no_show_recovery_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
