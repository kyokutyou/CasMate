import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { InitialSetupStore } from '../src/main/core/initial-setup-store';
import { setupFeatures } from '../src/shared/initial-setup';
import { runElectronFixture } from './helpers/electron-fixture';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-initial-layout-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('初回設定を実Electronで各配色・文字サイズ・狭幅・拡大・通知中に描画する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-initial-layout-'));
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error',
      resolve: { alias: [{ find: /^\.\.\/api$/, replacement: resolve('tests/fixtures/board-management-api.ts') }] },
      define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
      build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/board-management-renderer.tsx'), name: 'SetupHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const snapshot = obsRegistrationSnapshot();
    snapshot.initialSetup = { ...new InitialSetupStore('unused', false).view(snapshot), started: true, selected: setupFeatures.map(f => f[0]), position: 'features' };
    const service = { ready: false, message: '', account: null, latest: null };
    snapshot.aiListener = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: false, authorization: null,
      postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, services: { youtube: { ...service }, twitch: { ...service }, shitaraba: { ...service }, jpnkn: { ...service } } };
    const html = join(directory, 'index.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(snapshot).replace(/</g, '\\u003c')}</script><script src="harness.js"></script>`);
    const captures = resolve('tmp/initial-setup-layout'); await mkdir(captures, { recursive: true });
    const { stdout, stderr } = await runElectronFixture('tests/fixtures/initial-setup-layout.mjs', html, directory, [captures], 120_000);
    expect(stdout, stderr).toContain('PASS: initial setup layouts and notification geometry');
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => existsSync(path));
    if (browser) {
      const native = await promisify(execFile)(process.execPath,
        [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser, html, captures, '--initial-setup-obs-only'],
        { cwd: directory, windowsHide: true, timeout: 70_000 });
      expect(native.stdout, native.stderr).toContain('PASS: 16');
    }
  } finally {
    await removeFixture(directory);
  }
}, 180_000);
