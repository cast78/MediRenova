-- crm-episodios-sin-cerrar (fase 1): campos para la gestión de episodios sin cerrar.
-- Aditiva y segura: solo añade columnas nullable/con default y un valor de enum.

-- ② Revisión completada fuera del día de la cita ("cerrada fuera de plazo").
ALTER TABLE "revisions" ADD COLUMN "closed_late" BOOLEAN NOT NULL DEFAULT false;

-- ① / ③ Motivo al cerrar una visita fuera del flujo normal (se fue / anulada por error).
ALTER TABLE "visits" ADD COLUMN "cancel_reason" TEXT;

-- ④ Cierre administrativo: nuevo estado terminal + auditoría en la propia cita.
-- (En PostgreSQL 12+ ADD VALUE es válido dentro de la transacción si el valor no
--  se usa en la misma migración; aquí solo se declara.)
ALTER TYPE "AppointmentStatus" ADD VALUE 'CLOSED_ADMIN';
ALTER TABLE "appointments" ADD COLUMN "admin_closed_at" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN "admin_closed_by_id" TEXT;
ALTER TABLE "appointments" ADD COLUMN "admin_closure_note" TEXT;
