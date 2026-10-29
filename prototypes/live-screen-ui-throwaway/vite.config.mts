// Throwaway UI route. No production API, persistence, or distribution entry.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5207, strictPort: true },
  build: { outDir: '../../node_modules/.cache/casmate-live-screen-preview', emptyOutDir: true },
  test: { environment: 'jsdom', include: ['./*.test.tsx'], setupFiles: ['../../tests/setup.ts'] },
});
