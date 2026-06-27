import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// Abstracción de almacenamiento de objetos. El adaptador local (disco) se usa en
// desarrollo; el adaptador R2 (Paso B) implementará la misma interfaz para que el
// resto del código (pipeline de PDF, adjuntos) no cambie.
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  // URL servible/firmada. En R2 será una URL firmada con expiración; en local
  // devuelve un identificador `local://` (el contenido se sirve por endpoint).
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

// Sanea un nombre de archivo subido: quita ruta, limita caracteres y longitud.
export function sanitizeFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_").slice(0, 120);
  return clean.replace(/^[._]+/, "") || "archivo";
}

// Evita path traversal: descarta segmentos vacíos y `..`.
function safeKey(key: string): string {
  return key
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

class LocalStorage implements Storage {
  constructor(private readonly baseDir: string) {}

  private path(key: string): string {
    return join(this.baseDir, safeKey(key));
  }

  async put(key: string, body: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async getSignedUrl(key: string): Promise<string> {
    return `local://${safeKey(key)}`;
  }
}

function createStorage(): Storage {
  // Paso B: si hay credenciales R2 (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/...),
  // instanciar aquí el adaptador R2. De momento, disco local.
  const baseDir = resolve(process.env["LOCAL_STORAGE_DIR"] ?? ".storage");
  return new LocalStorage(baseDir);
}

export const storage: Storage = createStorage();
