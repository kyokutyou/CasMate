import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { build } from 'vite';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import react from '@vitejs/plugin-react';
import { expect, it } from 'vitest';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { runElectronFixture } from './helpers/electron-fixture';

it('実際の編集ウィンドウで両配色・拡大・狭幅・保存失敗・対象切替と窓操作を確認する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-design-rendering-'));
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error',
      resolve: { alias: [{ find: /^\.\.\/api$/, replacement: resolve('tests/fixtures/obs-design-api.ts') }, { find: /^\.\.\/windows-fonts$/, replacement: resolve('tests/fixtures/obs-design-fonts.ts') }] },
      define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
      build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false, lib: { entry: resolve('tests/fixtures/obs-design-renderer.tsx'), name: 'DesignHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    for (const [source, file, format] of [['obs-design-window.ts', 'window.mjs', 'es'], ['obs-design-window-controller.ts', 'controller.mjs', 'es'], ['obs-design-preload.ts', 'preload.cjs', 'cjs']] as const) {
      await build({ configFile: false, logLevel: 'error', build: { outDir: directory, emptyOutDir: false,
        lib: { entry: resolve('src/main', source), formats: [format], fileName: () => file }, rolldownOptions: { external: ['electron', 'node:path'] } } });
    }
    const html = join(directory, 'index.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(obsRegistrationSnapshot()).replaceAll('<', '\\u003c')}</script><script src="harness.js"></script>`);
    const result = await runElectronFixture('tests/fixtures/obs-design-electron.mjs', html, directory, [resolve('tmp/obs-design-captures')], 150000);
    expect(result.stdout, result.stderr).toContain('PASS: 16 OBS design layout and input checks; native singleton');
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    expect(browser).toBeTruthy();
    const native = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser!, html, resolve('tmp/obs-design-captures'), '--obs-design-only'], { cwd: directory, windowsHide: true, timeout: 150000 });
    expect(native.stdout, native.stderr).toContain('PASS: 16 OBS design native browser checks; zero HTTP(S) requests');
  } finally {
    if (basename(directory).startsWith('casmate-design-rendering-') && resolve(directory).startsWith(resolve(tmpdir()))) {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}, 330000);
