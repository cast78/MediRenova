-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "recovered_from_id" TEXT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_recovered_from_id_fkey" FOREIGN KEY ("recovered_from_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
