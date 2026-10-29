import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { runElectronFixture } from './helpers/electron-fixture';
import ts from 'typescript';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-management-history-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
it('実Electronでネイティブ履歴通知・入力保持・保存先リンクの通知位置を確認する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-management-history-'));
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error',
      resolve: { alias: [{ find: /^\.\.\/api$/, replacement: resolve('tests/fixtures/board-management-api.ts') }] },
      define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
      build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/board-management-renderer.tsx'), name: 'HistoryHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    // Match the unbundled TypeScript output used by pnpm build / pnpm start.
    await writeFile(join(directory, 'preload.cjs'), ts.transpileModule(await readFile('src/main/management-preload.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText);
    await build({ configFile: false, logLevel: 'error', build: { outDir: directory, emptyOutDir: false,
      lib: { entry: resolve('src/main/management-history.ts'), formats: ['es'], fileName: () => 'management-history.mjs' } } });
    const html = join(directory, 'index.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(obsRegistrationSnapshot()).replace(/</g, '\\u003c')}</script><script src="harness.js"></script>`);
    const captures = resolve('tmp/management-history-layout'); await mkdir(captures, { recursive: true });
    const result = await runElectronFixture('tests/fixtures/management-history.mjs', html, directory, [captures], 40_000);
    expect(result.stdout, result.stderr).toContain('PASS: native history, preserved drafts, directory link geometry');
  } finally {
    await removeFixture(directory);
  }
}, 60_000);
