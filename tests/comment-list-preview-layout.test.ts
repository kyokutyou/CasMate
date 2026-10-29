import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-list-preview-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('コメント一覧の常設プレビューが通常幅・最狭幅と最大文字サイズで収まる', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-list-preview-'));
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error',
      define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
      build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/comment-list-preview-renderer.tsx'), name: 'ListPreviewHarness',
          formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const html = join(directory, 'index.html');
    await writeFile(html, '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script>');
    const { stdout } = await runElectronFixture('tests/fixtures/comment-list-preview-layout.mjs', html, directory,
      [resolve('tmp/validation-scope/comment-list-preview')]);
    expect(stdout).toContain('PASS: 6 comment list preview layouts; zero external requests');
  } finally {
    await removeFixture(directory);
  }
}, 30_000);
