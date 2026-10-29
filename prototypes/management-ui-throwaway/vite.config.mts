// Throwaway UI exploration. Never used by the production build.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5190, strictPort: true },
  build: { outDir: '../../node_modules/.cache/casmate-management-ui-preview', emptyOutDir: true },
});
