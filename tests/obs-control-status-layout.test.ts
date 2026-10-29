import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-obs-status-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('OBS操作の末尾の空欄をなくし、処理中・長いエラーでも既存の操作位置を保つ', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-obs-status-'));
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error',
      define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
      build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/obs-control-status-renderer.tsx'), name: 'ObsStatusHarness',
          formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const html = join(directory, 'index.html');
    await writeFile(html, '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script>');
    const capture = process.env.CASMATE_OBS_CAPTURE;
    const { stdout } = await runElectronFixture('tests/fixtures/obs-control-status-layout.mjs', html, directory, capture ? [resolve(capture)] : [], 60_000);
    expect(stdout).toContain('PASS: OBS status reuses existing area at 3 widths without position changes');
    expect(stdout).toContain('240 theme/size/width layouts');
  } finally { await removeFixture(directory); }
}, 65_000);
