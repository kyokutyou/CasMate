import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Throwaway, memory-only preview. Not imported by the production entry point.
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()],
  server: { host: '127.0.0.1', port: 5198, strictPort: true },
  build: { outDir: '../../tmp/text-effects-prototype-build', emptyOutDir: true } });
