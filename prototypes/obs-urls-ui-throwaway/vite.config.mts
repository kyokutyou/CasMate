import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Throwaway preview, isolated from production and the real backend.
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()],
  server: { host: '127.0.0.1', port: 5205, strictPort: true },
  build: { outDir: '../../tmp/obs-urls-prototype-build', emptyOutDir: true } });
