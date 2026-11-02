import { configDefaults, defineConfig } from 'vitest/config';
import productConfig from './vite.config.mts';
import prototypeTests from './tools/prototype-tests.json' with { type: 'json' };

export default defineConfig({
  ...productConfig,
  test: {
    ...productConfig.test,
    include: prototypeTests,
    exclude: configDefaults.exclude,
  },
});
