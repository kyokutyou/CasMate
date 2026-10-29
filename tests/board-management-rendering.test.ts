import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import type { AppSnapshot, ConnectionKey } from '../src/shared/types';
import { runElectronFixture } from './helpers/electron-fixture';

let directory: string;
let html: string;
const nativeBrowser = [process.env.CASMATE_NATIVE_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path));

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'casmate-board-management-'));
  await build({ configFile: false, plugins: [react()], logLevel: 'error',
    resolve: { alias: [{ find: /^\.\.\/api$/, replacement: resolve('tests/fixtures/board-management-api.ts') }] },
    define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
    build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
      lib: { entry: resolve('tests/fixtures/board-management-renderer.tsx'), name: 'BoardManagementHarness', formats: ['iife'],
        fileName: () => 'harness.js', cssFileName: 'harness' } } });
  html = join(directory, 'index.html');
  const payload = JSON.stringify(fixtureSnapshot()).replace(/</g, '\\u003c');
  await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div>
    <script id="fixture-data" type="application/json">${payload}</script><script src="harness.js"></script>`);
}, 30_000);

afterAll(async () => {
  if (!directory) return;
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-board-management-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

it.each([false, true])('Electronで掲示板3枠・取得欄・通知位置とAI4参加先・ブラウザ復旧を描画する（リサイズ遅延=%s）', async (deferredResize) => {
  const capture = process.env.CASMATE_BOARD_MANAGEMENT_CAPTURE ? resolve(process.env.CASMATE_BOARD_MANAGEMENT_CAPTURE) : '';
  const { stdout } = await runElectronFixture('tests/fixtures/board-management-electron.mjs', html, directory,
    deferredResize ? [capture, '--deferred-resize'] : capture ? [capture] : []);
  expect(stdout).toContain('PASS: 11 board management Electron checks; zero HTTP(S) requests');
}, 30_000);

it.skipIf(!nativeBrowser)('通常ChromeまたはEdgeで掲示板の代表操作・往復・AI4参加先・認証後URL登録を確認する', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    [resolve('tests/fixtures/board-management-native-browser.mjs'), nativeBrowser!, html,
      ...(process.env.CASMATE_BOARD_MANAGEMENT_CAPTURE ? [resolve(process.env.CASMATE_BOARD_MANAGEMENT_CAPTURE)] : [])],
    { cwd: directory, windowsHide: true, timeout: 30_000 });
  expect(stdout).toContain('PASS: 7 board management native browser checks;');
  expect(stdout).toContain('zero HTTP(S) requests');
}, 35_000);

function fixtureSnapshot(): AppSnapshot {
  const settings = createDefaultSettings();
  settings.sources.shitaraba.enabled = true;
  settings.sources.shitaraba.threadUrl = 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791458242/';
  Object.assign(settings.sources.shitaraba.nextThread, { enabled: true, titleMode: 'manual', manualTitle: '配信2', bodyMode: 'manual', manualBody: '次の配信スレッドです。' });
  const status = (source: ConnectionKey) => ({ source, state: 'stopped' as const, message: null, updatedAt: '2026-10-08T00:00:00Z' });
  const service = { ready: false, message: '', account: null, latest: null };
  return { settings, settingsRevision: 1, comments: [],
    sourceStatuses: { youtube: status('youtube'), twitch: status('twitch'), shitaraba: { ...status('shitaraba'), service: 'jpnkn', state: 'connected' } },
    commentOverlay: { active: [], queue: [] }, character: { mouthShape: 'closed', assetWarning: null },
    commentSpeech: { engineStatus: 'disabled', currentCommentId: null, queueLength: 0, droppedCount: 0, warning: null },
    mobileSpeech: { urls: [], tailscaleStatus: 'disabled', activeClient: false, currentCommentId: null, queueLength: 0, droppedCount: 0, audioAvailable: false, warning: null },
    shitarabaNextThread: { status: 'manualReady', maxResponseNumber: 949, remainingResponses: 1, plannedTitle: '配信2', plannedBody: '次の配信スレッドです。', nextThreadUrl: null, message: null, updatedAt: '2026-10-08T00:00:00Z' },
    speechRecognition: { status: 'disabled', modelStatus: 'missing', modelDownloadProgress: null, microphones: [], previewActive: false, wavSaving: false, previewHistory: [], sessionId: null, warning: null },
    speechRecognitionOverlay: { active: null },
    aiListener: { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: false,
      authorization: null, postingBudget: { used: 0, limit: 60, nextAllowedAt: null },
      services: { youtube: { ...service }, twitch: { ...service }, shitaraba: { ...service }, jpnkn: { ...service } } },
  };
}
