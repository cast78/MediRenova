import { describe, it, expect } from "vitest";
import { sanitizeFileName } from "../src/lib/storage";

describe("sanitizeFileName (adjuntos, tarea 11.3)", () => {
  it("quita la ruta y deja el nombre", () => {
    expect(sanitizeFileName("C:\\fotos\\dni.jpg")).toBe("dni.jpg");
    expect(sanitizeFileName("/var/tmp/foto.png")).toBe("foto.png");
  });

  it("reemplaza caracteres no seguros y colapsa underscores", () => {
    expect(sanitizeFileName("mi foto (1).jpg")).toBe("mi_foto_1_.jpg");
    expect(sanitizeFileName("a___b.png")).toBe("a_b.png");
  });

  it("evita path traversal y nombres vacíos", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("")).toBe("archivo");
    expect(sanitizeFileName("...")).toBe("archivo");
  });
});
