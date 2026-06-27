-- Campos de médico (DNI, Nº Colegiado, firma) y centros asignados (N:M). Additiva.

ALTER TABLE "users" ADD COLUMN "dni" TEXT;
ALTER TABLE "users" ADD COLUMN "license_number" TEXT;
ALTER TABLE "users" ADD COLUMN "signature_key" TEXT;

CREATE TABLE "user_centers" (
  "user_id" TEXT NOT NULL,
  "center_id" TEXT NOT NULL,
  CONSTRAINT "user_centers_pkey" PRIMARY KEY ("user_id", "center_id")
);
CREATE INDEX "user_centers_center_id_idx" ON "user_centers"("center_id");

ALTER TABLE "user_centers"
  ADD CONSTRAINT "user_centers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_centers"
  ADD CONSTRAINT "user_centers_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
