import { describe, it, expect } from "vitest";
import { validateSpanishDni, hashDni } from "../src/lib/dni";

describe("validateSpanishDni (tarea 8.2)", () => {
  it("acepta un DNI válido", () => {
    expect(validateSpanishDni("12345678Z")).toBe(true);
  });
  it("acepta un NIE válido", () => {
    expect(validateSpanishDni("X1234567L")).toBe(true);
  });
  it("rechaza letra de control incorrecta", () => {
    expect(validateSpanishDni("12345678A")).toBe(false);
  });
  it("rechaza formatos inválidos", () => {
    expect(validateSpanishDni("1234567")).toBe(false);
    expect(validateSpanishDni("ABCDEFGHZ")).toBe(false);
  });
  it("es case-insensitive y tolera espacios", () => {
    expect(validateSpanishDni(" 12345678z ")).toBe(true);
  });
});

describe("hashDni", () => {
  it("es determinista y normaliza mayúsculas/espacios", () => {
    expect(hashDni("12345678Z")).toBe(hashDni(" 12345678z "));
    expect(hashDni("12345678Z")).toHaveLength(64);
  });
});
