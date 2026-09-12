-- AlterTable: atribución persistida de campañas (crm-captacion fase 2)
ALTER TABLE "campaign_recipients" ADD COLUMN     "converted_at" TIMESTAMP(3),
ADD COLUMN     "converted_appointment_id" TEXT;
