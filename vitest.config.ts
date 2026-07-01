import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Resuelve el alias `@/…` (igual que tsconfig) para los tests.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
