-- Reserva única activa por (tenant, cliente, producto). crm-reservas.

-- 1) Nuevo flag: NO_SHOW automático (barrido/sistema) vs marcado por recepción.
ALTER TABLE "appointments" ADD COLUMN     "auto_closed" BOOLEAN NOT NULL DEFAULT false;

-- 2) Barrido de caducadas ANTES del índice: citas activas pasadas (>2h), sin walk-in
--    y SIN visita asociada (el paciente no llegó) -> NO_SHOW auto-cerrada. Es lo mismo
--    que hará el cron horario; se hace aquí para dejar limpio antes del de-dup/índice.
UPDATE "appointments" a
SET status = 'NO_SHOW', auto_closed = true
WHERE a.status IN ('PENDING', 'CONFIRMED')
  AND a.source <> 'WALK_IN'
  AND a.scheduled_at < now() - interval '2 hours'
  AND NOT EXISTS (SELECT 1 FROM "visits" v WHERE v.appointment_id = a.id);

-- 3) De-duplicar lo que quede activo (duplicados futuros reales): conservar la de
--    scheduled_at más próxima y marcar el resto CANCELADA/DUPLICADA (la analítica ya
--    trata 'DUPLICADA' como ruido, fuera de tasas).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tenant_id, customer_id, product_id
    ORDER BY scheduled_at ASC, created_at ASC
  ) AS rn
  FROM "appointments"
  WHERE status IN ('PENDING', 'CONFIRMED') AND source <> 'WALK_IN'
)
UPDATE "appointments" a
SET status = 'CANCELLED', cancel_reason = 'DUPLICADA'
FROM ranked r
WHERE a.id = r.id AND r.rn > 1;

-- 4) Índice único parcial: máx. 1 reserva activa por cliente+producto (walk-in exento).
CREATE UNIQUE INDEX "appointments_customer_product_active_key"
  ON "appointments"("tenant_id", "customer_id", "product_id")
  WHERE status IN ('PENDING', 'CONFIRMED') AND source <> 'WALK_IN';
