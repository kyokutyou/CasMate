import { copyFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-smartphone-layout-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true });
}

it.each(['lan', 'tailscale', 'direct'] as const)('スマホ連携%sの実状態更新・5画面幅・キーボード操作をElectronで確認する', async route => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-smartphone-layout-'));
  const captures = resolve('tmp/smartphone-layout', route); await mkdir(captures, { recursive: true });
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
      oxc: { jsx: { development: false } }, build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/smartphone-renderer.tsx'), name: 'SmartphoneHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const html = join(directory, 'index.html');
    await writeFile(html, '<!doctype html><meta charset="utf-8"><title>スマホ連携・描画確認</title><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script>');
    for (const file of ['index.html', 'harness.js', 'harness.css']) await copyFile(join(directory, file), join(captures, file));
    const { stdout } = await runElectronFixture('tests/fixtures/smartphone-layout.mjs', html, directory, [captures, route], 150_000);
    expect(stdout).toContain('PASS: 35 smartphone state scenarios');
    expect(stdout).toContain('PASS: keyboard, return state, minimum and zoom');
    if(route==='lan') {
      const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
      expect(browser).toBeTruthy();
      const native=await promisify(execFile)(process.execPath,[resolve('tests/fixtures/management-studio-native-browser.mjs'),browser!,html,captures,'--smartphone-hub-only'],{cwd:directory,windowsHide:true,timeout:30_000});
      expect(native.stdout,native.stderr).toContain('PASS: 6 smartphone hub browser checks; zero HTTP(S) requests');
    }
  } finally {
    await removeFixture(directory);
  }
}, 155_000);
