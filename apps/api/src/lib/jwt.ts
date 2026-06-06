import jwt from "jsonwebtoken";

const privateKey = (process.env["JWT_PRIVATE_KEY"] ?? "").replace(/\\n/g, "\n");
const publicKey = (process.env["JWT_PUBLIC_KEY"] ?? "").replace(/\\n/g, "\n");

export interface AccessTokenPayload {
  sub: string;      // user_id
  tid: string;      // tenant_id
  role: string;
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
  return jwt.sign(payload, privateKey, {
    algorithm: "RS256",
    expiresIn: "15m",
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: "refresh" }, privateKey, {
    algorithm: "RS256",
    expiresIn: "7d",
  });
}

export function signMagicLinkToken(payload: Omit<MagicLinkPayload, "iat" | "exp">): string {
  return jwt.sign(payload, privateKey, {
    algorithm: "RS256",
    expiresIn: "24h",
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, publicKey, { algorithms: ["RS256"] }) as AccessTokenPayload;
}

export function verifyMagicLinkToken(token: string): MagicLinkPayload {
  const payload = jwt.verify(token, publicKey, { algorithms: ["RS256"] }) as MagicLinkPayload;
  if (payload.type !== "magic_link") throw new Error("Invalid token type");
  return payload;
}
