import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-board-next-layout-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('掲示板の作成・認証・登録状態で操作位置・スクロール・フォーカスを保つ', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-board-next-layout-'));
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
      oxc: { jsx: { development: false } }, build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/board-next-thread-renderer.tsx'), name: 'BoardNextThreadHarness', formats: ['iife'],
          fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const html = join(directory, 'index.html');
    await writeFile(html, '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script>');
    const { stdout } = await runElectronFixture('tests/fixtures/board-next-thread-layout.mjs', html, directory,
      process.env.CASMATE_BOARD_CAPTURE_DIRECTORY ? [resolve(process.env.CASMATE_BOARD_CAPTURE_DIRECTORY)] : []);
    expect(stdout).toContain('PASS: 354 board next-thread drawing scenarios');
  } finally {
    await removeFixture(directory);
  }
}, 30_000);
