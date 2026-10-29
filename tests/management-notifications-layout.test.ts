import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-notification-layout-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('共通通知の実状態更新で操作位置・寸法・スクロール・フォーカスを保ち、ヘッダーを覆わない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-notification-layout-'));
  const captures = resolve('tmp/validation-scope/notifications');
  await mkdir(captures, { recursive: true });
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
      oxc: { jsx: { development: false } },
      build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/management-notifications.tsx'), name: 'NotificationHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const html = join(directory, 'index.html');
    await writeFile(html, '<!doctype html><meta charset="utf-8"><meta name="casmate-management" content="test-only"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script>');
    for (const file of ['index.html', 'harness.js', 'harness.css']) await copyFile(join(directory, file), join(captures, file));
    const { stdout } = await runElectronFixture('tests/fixtures/management-notifications-layout.mjs', html, directory, [captures]);
    expect(stdout).toContain('PASS: 288 notification scenarios');
    expect(stdout).toContain('PASS: all current editor entries');
    expect(stdout).toContain('PASS: native minimum and zoom');
    expect(stdout).toContain('PASS: update notice acknowledgement layouts');
  } finally {
    await removeFixture(directory);
  }
}, 60_000);
