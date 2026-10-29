import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Throwaway preview. Isolated from the real backend and production entry point.
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()],
  server: { host: '127.0.0.1', port: 5198, strictPort: true },
  build: { outDir: '../../tmp/mobile-speech-prototype-build', emptyOutDir: true } });
