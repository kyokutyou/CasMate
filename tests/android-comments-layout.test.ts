import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-android-comments-')) {
    throw new Error('Unexpected Android comments fixture directory');
  }
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('Androidコメントの実描画で配色・通信断・文字拡大・フリック操作の境界を維持する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-android-comments-'));
  const captures = resolve('tmp/android-comments-layout');
  await mkdir(captures, { recursive: true });
  try {
    await build({
      configFile: false,
      plugins: [react()],
      logLevel: 'error',
      define: { 'process.env.NODE_ENV': '"production"' },
      oxc: { jsx: { development: false } },
      build: {
        outDir: directory,
        emptyOutDir: false,
        cssCodeSplit: false,
        lib: {
          entry: resolve('tests/fixtures/android-comments-renderer.tsx'),
          name: 'AndroidCommentsHarness',
          formats: ['iife'],
          fileName: () => 'harness.js',
          cssFileName: 'harness',
        },
      },
    });
    const html = join(directory, 'index.html');
    await writeFile(html, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Androidコメント・描画確認</title><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script>');
    for (const file of ['index.html', 'harness.js', 'harness.css']) {
      await copyFile(join(directory, file), join(captures, file));
    }
    const { stdout, stderr } = await runElectronFixture('tests/fixtures/android-comments-layout.mjs', html, directory, [captures], 45_000);
    expect(stdout, stderr).toContain('PASS: 12 Android comments color/layout/text scenarios');
    expect(stdout, stderr).toContain('PASS: native mouse flicks exclude controls, vertical drags and short movements');
    expect(stdout, stderr).toContain('PASS: real touchscreen flicks cover comments, metadata, status, gutter and empty area while preserving scroll and controls');
  } finally {
    await removeFixture(directory);
  }
}, 60_000);
