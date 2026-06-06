import { randomBytes, createHash, createCipheriv, createDecipheriv } from "crypto";

export function generateRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `sk_live_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = raw.substring(0, 16);
  return { raw, hash, prefix };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function getDniKey(): Buffer {
  const hex = process.env["DNI_ENCRYPTION_KEY"] ?? "";
  if (hex.length !== 64) throw new Error("DNI_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  return Buffer.from(hex, "hex");
}

// AES-256-GCM: returns "iv:authTag:ciphertext" as hex, colon-separated
export function encryptDni(plaintext: string): string {
  const key = getDniKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptDni(stored: string): string {
  const key = getDniKey();
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted DNI format");
  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}
