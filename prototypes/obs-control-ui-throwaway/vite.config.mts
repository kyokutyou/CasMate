import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Isolated throwaway preview. No production API, credentials or persistence.
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()],
  server: { host: '127.0.0.1', port: 5201, strictPort: true },
  build: { outDir: '../../tmp/obs-control-prototype-build', emptyOutDir: true } });
