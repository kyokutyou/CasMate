import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Throwaway, memory-only exploration. No production entry point imports this route.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5195, strictPort: true },
  build: { outDir: '../../tmp/comment-filter-prototype-build', emptyOutDir: true },
});
