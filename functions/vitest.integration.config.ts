import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Run via `npm run test:functions` from the repo root (starts emulators).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
