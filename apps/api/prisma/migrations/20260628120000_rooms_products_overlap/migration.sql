-- Salas: productos permitidos por ID; granularidad de reserva por empresa;
-- y se permite solapar reservas (se elimina el índice único anti-double-booking;
-- el solape pasa a controlarse por aplicación, con aviso, solo en backoffice).

ALTER TABLE "tenant_configs" ADD COLUMN "booking_granularity" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "rooms" ADD COLUMN "allowed_product_ids" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "rooms" DROP COLUMN "allowed_product_types";

DROP INDEX IF EXISTS "appointments_room_id_scheduled_at_active_key";
