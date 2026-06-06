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
