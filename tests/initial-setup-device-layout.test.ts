import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { InitialSetupStore } from '../src/main/core/initial-setup-store';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-setup-devices-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('スマホ・音声認識A案をElectronと通常ブラウザーで描画し、実状態更新・最小幅を確認する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-setup-devices-'));
  const captures = resolve('tmp/initial-setup-devices'); await mkdir(captures, { recursive: true });
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error', resolve: { alias: [{ find: /^\.\.\/api$/, replacement: resolve('tests/fixtures/board-management-api.ts') }] }, define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } }, build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false, lib: { entry: resolve('tests/fixtures/board-management-renderer.tsx'), name: 'SetupDevices', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const snapshot = obsRegistrationSnapshot();
    snapshot.initialSetup = { ...new InitialSetupStore('unused', false).view(snapshot), started: true, selected: ['smartphone','speechRecognition'], smartphoneUses:['comments'], position:'smartphone' };
    const html = join(directory, 'index.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(snapshot).replace(/</g,'\\u003c')}</script><script src="harness.js"></script>`);
    const { stdout, stderr } = await runElectronFixture('tests/fixtures/initial-setup-device-layout.mjs', html, directory, [captures], 70_000);
    expect(stdout, stderr).toContain('PASS: 96 initial setup device layouts');
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    expect(browser).toBeTruthy();
    const native = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser!, html, captures, '--initial-setup-devices-only'], { cwd: directory, windowsHide: true, timeout: 60_000 });
    expect(native.stdout, native.stderr).toContain('PASS: 96 initial setup device browser checks');
  } finally {
    await removeFixture(directory);
  }
}, 120_000);
