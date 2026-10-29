import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import prototypeTests from './tools/prototype-tests.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    // pnpm test uses tools/test.mjs to run light files with 4 workers, then
    // native-rendering files with 2. This is also the direct/watch default.
    maxWorkers: 4,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: [...configDefaults.exclude, ...prototypeTests],
    setupFiles: ['./tests/setup.ts'],
    css: { include: [/docs\/templates\/obs\//u, /src\/renderer\/styles\.css/u] },
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
