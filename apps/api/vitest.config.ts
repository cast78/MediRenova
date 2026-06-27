import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Clave de prueba para el cifrado de DNI (32 bytes en hex). NO es secreto real.
    env: {
      DNI_ENCRYPTION_KEY: "0".repeat(64),
    },
  },
});
