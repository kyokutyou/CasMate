import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { runElectronFixture } from './helpers/electron-fixture';
import { managementSections } from '../src/renderer/management-navigation';

const editorIds = managementSections.flatMap(group => group.items.map(([id]) => `settings-${id}`));

let directory: string;
let html: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'casmate-studio-rendering-'));
  await build({ configFile: false, plugins: [react()], logLevel: 'error',
    resolve: { alias: [{ find: /^\.\.\/api$/, replacement: resolve('tests/fixtures/board-management-api.ts') }] },
    define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
    build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
      lib: { entry: resolve('tests/fixtures/board-management-renderer.tsx'), name: 'StudioHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
  await build({ configFile: false, logLevel: 'error', build: { outDir: directory, emptyOutDir: false,
    lib: { entry: resolve('src/main/management-window-open.ts'), formats: ['es'], fileName: () => 'management-window-open.mjs' } } });
  const snapshot = obsRegistrationSnapshot();
  const service = { ready: false, message: '', account: null, latest: null };
  snapshot.aiListener = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: false, authorization: null,
    postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, services: { youtube: { ...service }, twitch: { ...service }, shitaraba: { ...service }, jpnkn: { ...service } } };
  snapshot.comments = Array.from({ length: 30 }, (_, index) => ({ id: `comment-${index}`, externalId: `comment-${index}`, source: 'youtube', sequence: index, authorName: '確認用の利用者',
    content: [{ type: 'text', text: `確認用コメント ${index}。配信中の一覧を読み返せます。` }], initialHistory: false, receivedAt: new Date(0).toISOString() }));
  html = join(directory, 'index.html');
  await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script id="fixture-editor-ids" type="application/json">${JSON.stringify(editorIds)}</script><script id="fixture-data" type="application/json">${JSON.stringify(snapshot).replace(/</g, '\\u003c')}</script><script src="harness.js"></script>`);
}, 30_000);
afterAll(async () => {
  if (!directory) return;
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-studio-rendering-')) throw new Error('Unexpected fixture path');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
it('アプリ設定の配色・文字サイズ・詳細・通知をElectronと通常ブラウザで確認する', async () => {
  const captures=resolve('tmp/application-settings-layout');await mkdir(captures,{recursive:true});
  const electron=await runElectronFixture('tests/fixtures/application-settings-electron.mjs',html,directory,[captures],240000);
  expect(electron.stdout,electron.stderr).toContain('PASS: 30 application settings checks');
  const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);expect(browser).toBeTruthy();
  const native=await promisify(execFile)(process.execPath,[resolve('tests/fixtures/management-studio-native-browser.mjs'),browser!,html,captures,'--application-settings-only'],{cwd:directory,windowsHide:true,timeout:240000});
  expect(native.stdout,native.stderr).toContain('PASS: 30 application settings checks');
},485000);
