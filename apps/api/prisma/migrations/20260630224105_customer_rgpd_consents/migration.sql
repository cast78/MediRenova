-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "accepts_email" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "accepts_sms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "accepts_whatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consent_signature_key" TEXT;
