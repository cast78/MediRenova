import { z } from "zod";

/**
 * Email de cuenta de acceso (login, alta de usuarios/médicos/admins): se guarda y
 * se busca siempre en minúsculas y sin espacios, para que "Doctor@x.es" y
 * "doctor@x.es" sean la misma cuenta.
 */
export const loginEmail = z.string().trim().toLowerCase().email();

/**
 * Removes keys with `undefined` values from an object.
 * Required because exactOptionalPropertyTypes=true prevents passing undefined
 * to Prisma where it expects null | T.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
}
