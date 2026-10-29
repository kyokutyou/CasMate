import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A separate build prevents the public listener from serving management bundles.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/direct-mobile',
    emptyOutDir: true,
    rolldownOptions: { input: 'direct-mobile.html' },
  },
});
