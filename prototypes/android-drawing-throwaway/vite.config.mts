import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Standalone throwaway preview; never enters the product's renderer build.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  server: { host: '127.0.0.1', port: 5212, strictPort: true, hmr: false },
  preview: { host: '127.0.0.1', port: 5212, strictPort: true },
  build: { outDir: '../../tmp/android-drawing-prototype-build', emptyOutDir: true },
});
