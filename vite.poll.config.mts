import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Only the public poll entry is built here. No management renderer is served by the tunnel.
export default defineConfig({ plugins: [react()], build: { outDir: 'dist/listener-poll', emptyOutDir: true, rolldownOptions: { input: 'listener-poll.html' } } });
