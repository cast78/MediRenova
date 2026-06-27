import jwt from "jsonwebtoken";

const secret = process.env["JWT_SECRET"] ?? "dev-secret-change-in-production";

export interface AccessTokenPayload {
  sub: string;      // user_id
  tid: string;      // tenant_id
  role: string;
  cen?: string | null; // center_id — si está, el usuario solo ve ese centro (BackOffice)
  iat?: number;
  exp?: number;
}

export interface MagicLinkPayload {
  cid: string;      // customer_id
  pid: string;      // product_id
  tid: string;      // tenant_id
  type: "magic_link";
  iat?: number;
  exp?: number;
}

export function signAccessToken(payload: Omit<AccessTokenPayload, "iat" | "exp">): string {
  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: "15m",
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: "refresh" }, secret, {
    algorithm: "HS256",
    expiresIn: "7d",
  });
}

export function signMagicLinkToken(payload: Omit<MagicLinkPayload, "iat" | "exp">): string {
  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: "24h",
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, secret, { algorithms: ["HS256"] }) as AccessTokenPayload;
}

export function verifyMagicLinkToken(token: string): MagicLinkPayload {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as MagicLinkPayload;
  if (payload.type !== "magic_link") throw new Error("Invalid token type");
  return payload;
}
