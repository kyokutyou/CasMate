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
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-setup-flow-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('初回設定の通し操作・保存失敗・単独経路をElectronと通常ブラウザーで確認する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-setup-flow-'));
  const captures = resolve('tmp/initial-setup-flow'); await mkdir(captures, { recursive: true });
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error', resolve: { alias: [{ find: /^\.\.\/api$/, replacement: resolve('tests/fixtures/board-management-api.ts') }] }, define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } }, build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false, lib: { entry: resolve('tests/fixtures/board-management-renderer.tsx'), name: 'SetupDevices', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const snapshot = obsRegistrationSnapshot();
    // This file:// harness verifies navigation without an HTTP asset server.
    snapshot.settings.character.simple.closedAsset = null;
    snapshot.settings.character.simple.openAsset = null;
    snapshot.initialSetup = { ...new InitialSetupStore('unused', false).view(snapshot), started: true, selected: ['aiListener','textEffects','character'], smartphoneUses:[], position:'aiListener' };
    const service = { ready: false, message: '', account: null, latest: null };
    snapshot.aiListener = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: false, authorization: null, postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, services: { youtube: { ...service }, twitch: { ...service }, shitaraba: { ...service }, jpnkn: { ...service } } };
    const html = join(directory, 'index.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(snapshot).replace(/</g,'\\u003c')}</script><script src="harness.js"></script>`);
    const { stdout, stderr } = await runElectronFixture('tests/fixtures/initial-setup-flow-layout.mjs', html, directory, [captures], 80_000);
    expect(stdout, stderr).toContain('PASS: initial setup complete flow');
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    expect(browser).toBeTruthy();
    const native = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser!, html, captures, '--initial-setup-flow-only'], { cwd: directory, windowsHide: true, timeout: 70_000 });
    expect(native.stdout, native.stderr).toContain('PASS: initial setup complete flow');
  } finally {
    await removeFixture(directory);
  }
}, 180_000);
