-- Usuario asignable a un centro (BackOffice Centro médico, nivel 3).
-- Additiva: los usuarios existentes quedan con center_id NULL (ámbito tenant-wide).

ALTER TABLE "users" ADD COLUMN "center_id" TEXT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_center_id_idx" ON "users"("center_id");
