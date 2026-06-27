import { describe, it, expect } from "vitest";
import { encryptDni, decryptDni, hashApiKey, generateApiKey } from "../src/lib/crypto";

describe("crypto: cifrado de DNI AES-256-GCM (tarea 8.1, GDPR)", () => {
  it("round-trip: cifra y descifra al valor original", () => {
    const dni = "12345678Z";
    const enc = encryptDni(dni);
    expect(enc).not.toContain(dni);
    expect(enc.split(":")).toHaveLength(3);
    expect(decryptDni(enc)).toBe(dni);
  });

  it("produce ciphertext distinto cada vez (IV aleatorio)", () => {
    expect(encryptDni("12345678Z")).not.toBe(encryptDni("12345678Z"));
  });

  it("detecta manipulación del ciphertext (authTag GCM)", () => {
    const enc = encryptDni("12345678Z");
    const [iv, tag, ct] = enc.split(":") as [string, string, string];
    const flipped = (ct[0] === "a" ? "b" : "a") + ct.slice(1);
    expect(() => decryptDni(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it("rechaza formato inválido", () => {
    expect(() => decryptDni("formato-malo")).toThrow("Invalid encrypted DNI format");
  });
});

describe("crypto: API keys (tarea 14.1)", () => {
  it("hashApiKey es determinista y de 64 hex (SHA-256)", () => {
    expect(hashApiKey("sk_live_abc")).toBe(hashApiKey("sk_live_abc"));
    expect(hashApiKey("sk_live_abc")).toHaveLength(64);
  });

  it("generateApiKey usa prefijo sk_live_ y hash coherente con hashApiKey", () => {
    const { raw, hash, prefix } = generateApiKey();
    expect(raw.startsWith("sk_live_")).toBe(true);
    expect(prefix).toBe(raw.substring(0, 16));
    expect(hash).toBe(hashApiKey(raw));
  });
});
