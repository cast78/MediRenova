// Enlaces que viajan en los mensajes al paciente: siempre token de larga duración
// (30 días, salvo el portal, cuya sesión es de 60 min) + enlace corto /b/CODE
// (ShortLink). La página web /b/[code] redirige según `kind`.
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma.js";
import { signConfirmationToken } from "../jwt.js";

export type ShortLinkKind = "booking" | "confirm" | "portal";

export const PUBLIC_URL = process.env["PUBLIC_URL"] ?? "http://localhost:3000";

const DAY_MS = 86_400_000;

export async function createShortLink(token: string, kind: ShortLinkKind, ttlMs: number): Promise<{ code: string; url: string }> {
  const code = randomBytes(6).toString("base64url"); // ~8 caracteres, inadivinable
  await prisma.shortLink.create({ data: { code, token, kind, expiresAt: new Date(Date.now() + ttlMs) } });
  return { code, url: `${PUBLIC_URL}/b/${code}` };
}

// Ruta web destino de un enlace corto según su tipo.
export function shortLinkPath(kind: string, token: string): string {
  if (kind === "confirm") return `/confirmar/${token}`;
  if (kind === "portal") return `/mi-area/entrar?token=${token}`;
  return `/booking/${token}`;
}

// Auto-reserva de un producto (renovación, recuperación de no-show).
export async function createBookingLink(tenantId: string, customerId: string, productId: string): Promise<{ token: string; url: string }> {
  const token = signConfirmationToken({ cid: customerId, pid: productId, tid: tenantId, type: "magic_link" });
  const { url } = await createShortLink(token, "booking", 30 * DAY_MS);
  return { token, url };
}

// Confirmar / "no podré ir" de una cita concreta.
export async function createConfirmLink(a: { id: string; tenantId: string; customerId: string; productId: string }): Promise<{ token: string; url: string }> {
  const token = signConfirmationToken({ cid: a.customerId, pid: a.productId, tid: a.tenantId, aid: a.id, type: "magic_link" });
  const { url } = await createShortLink(token, "confirm", 30 * DAY_MS);
  return { token, url };
}

// Acceso al portal: el token ya viene firmado (60 min); el corto caduca igual.
export async function createPortalLink(portalToken: string): Promise<{ url: string }> {
  const { url } = await createShortLink(portalToken, "portal", 60 * 60_000);
  return { url };
}
