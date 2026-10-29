import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Throwaway UI comparison: no backend, production entry, or persistence.
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()],
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  build: { outDir: '../../tmp/comment-overlay-prototype-build', emptyOutDir: true } });
