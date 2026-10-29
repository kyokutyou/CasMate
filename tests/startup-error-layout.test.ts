import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { runElectronFixture } from './helpers/electron-fixture';

it('初回読込エラーと長い技術詳細が狭幅・最小窓と拡大時も収まる', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-startup-error-'));
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-startup-error-')) throw new Error('Unexpected fixture directory');
  const captures = resolve('tmp/startup-error-layout');
  await mkdir(captures, { recursive: true });
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error',
      resolve: { alias: [{ find: /^\.\.\/api$/, replacement: resolve('tests/fixtures/startup-error-api.ts') }] },
      define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
      build: { outDir: directory, cssCodeSplit: false, lib: { entry: resolve('tests/fixtures/ui-clarity-renderer.tsx'), name: 'StartupError', formats: ['iife'], fileName: () => 'error.js', cssFileName: 'error' } } });
    const html = join(directory, 'index.html');
    const error = 'Failed to load C:\\' + 'LongPathSegmentWithoutBreaks'.repeat(80) + '\\settings.json';
    await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="error.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(obsRegistrationSnapshot()).replaceAll('<', '\\u003c')}</script><script id="startup-error" type="application/json">${JSON.stringify(error)}</script><script src="error.js"></script>`);
    const electron = await runElectronFixture('tests/fixtures/ui-clarity-electron.mjs', html, directory, [captures, '--startup-error-only'], 30_000)
      .catch(error => { throw new Error(`${String(error)}\n${error.stderr ?? ''}`); });
    expect(electron.stdout, electron.stderr).toContain('PASS: 6 UI clarity scenarios; zero HTTP(S) requests');
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    expect(browser).toBeTruthy();
    const native = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser!, html, captures, '--startup-error-only'], { cwd: directory, windowsHide: true, timeout: 30_000 });
    expect(native.stdout, native.stderr).toContain('PASS: 6 startup error scenarios; zero HTTP(S) requests');
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 90_000);
