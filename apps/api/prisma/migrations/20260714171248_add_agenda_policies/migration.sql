-- AlterTable
ALTER TABLE "tenant_configs" ADD COLUMN     "cancellation_window_hours" INTEGER,
ADD COLUMN     "min_booking_lead_hours" INTEGER,
ADD COLUMN     "no_show_grace_minutes" INTEGER;
