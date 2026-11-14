import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: 'dist/listener-reactions', emptyOutDir: true, rolldownOptions: { input: 'listener-reactions.html' } } });
