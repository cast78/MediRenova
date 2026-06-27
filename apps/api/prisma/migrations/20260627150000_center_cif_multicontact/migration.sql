-- Center: añadir CIF y soportar múltiples teléfonos/emails por centro.
-- Se preservan los valores existentes copiándolos a los nuevos arrays antes de
-- eliminar las columnas escalares `phone`/`email`.

ALTER TABLE "centers" ADD COLUMN "cif" TEXT;
ALTER TABLE "centers" ADD COLUMN "phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "centers" ADD COLUMN "emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "centers" SET "phones" = ARRAY["phone"] WHERE "phone" IS NOT NULL AND "phone" <> '';
UPDATE "centers" SET "emails" = ARRAY["email"] WHERE "email" IS NOT NULL AND "email" <> '';

ALTER TABLE "centers" DROP COLUMN "phone";
ALTER TABLE "centers" DROP COLUMN "email";
