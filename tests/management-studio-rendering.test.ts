import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const introductionChecks = editorIds.length * (2 * 3 * 6 + 1);

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
it('Electronで3画面と全編集先、移動・入力保持・最狭幅・拡大を描画検証する', async () => {
  const captures = process.env.CASMATE_STUDIO_CAPTURE ? resolve(process.env.CASMATE_STUDIO_CAPTURE) : '';
  const { stdout } = await runElectronFixture('tests/fixtures/management-studio-electron.mjs', html, directory, captures ? [captures] : [], 180_000);
  expect(stdout).toMatch(/PASS: \d+ studio checks; native minimum and zoom; zero HTTP\(S\) requests/);
  expect(stdout).toContain('comment URL dispatched without popup');
}, 185_000);
const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => existsSync(path));
it('最小窓の描画面をWindowsの表示倍率と全採用拡大率で照合する', async () => {
  const electron = await runElectronFixture('tests/fixtures/management-studio-electron.mjs', html, directory, ['', '--minimum-viewport-only']);
  expect(electron.stdout, electron.stderr).toContain('PASS: 3 native minimum viewport checks; zero HTTP(S) requests');
}, 30_000);
it('説明欄を必要な高さに収め、入力エラー・長文でも全編集先の操作位置を保つ', async () => {
  const captures = resolve('tmp/validation-scope/compact-feedback');
  const electron = await runElectronFixture('tests/fixtures/management-studio-electron.mjs', html, directory, [captures, '--compact-feedback-only'], 60000);
  expect(electron.stdout, electron.stderr).toContain('PASS: compact feedback');
  expect(browser).toBeTruthy();
  const native = await promisify(execFile)(process.execPath,
    [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser!, html, captures, '--compact-feedback-only'],
    { cwd: directory, windowsHide: true, timeout: 60000 });
  expect(native.stdout, native.stderr).toContain('PASS: compact feedback');
}, 125000);
it('接続保存中の別枠操作・同期補正・失敗後の入力保持をElectronと通常ブラウザで確認する', async () => {
  const captures = resolve('tmp/source-save-layout');
  const electron = await runElectronFixture('tests/fixtures/management-studio-electron.mjs', html, directory, [captures, '--source-save-only'], 45000);
  expect(electron.stdout, electron.stderr).toContain('PASS: 48 comment source save checks');
  expect(browser, '通常ブラウザの確認環境').toBeTruthy();
  const native = await promisify(execFile)(process.execPath,
    [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser!, html, captures, '--source-save-only'],
    { cwd: directory, windowsHide: true, timeout: 45000 });
  expect(native.stdout, native.stderr).toContain('PASS: 48 comment source save checks');
}, 95000);
it('コメント読み上げの設定導線と試聴の案内を両配色・文字拡大・狭幅で確認する', async () => {
  const captures=resolve('tmp/speech-guidance-layout');
  const electron=await runElectronFixture('tests/fixtures/management-studio-electron.mjs',html,directory,[captures,'--comment-speech-only'],60_000);
  expect(electron.stdout,electron.stderr).toContain('PASS: 97 comment speech guidance checks; zero HTTP(S) requests');
  if(browser) {
    const native=await promisify(execFile)(process.execPath,[resolve('tests/fixtures/management-studio-native-browser.mjs'),browser,html,captures,'--comment-speech-only'],{cwd:directory,windowsHide:true,timeout:60_000});
    expect(native.stdout,native.stderr).toContain('PASS: 97 comment speech guidance checks;');
    expect(native.stdout).toContain('zero HTTP(S) requests');
  }
},125_000);
it('全現行編集先の短い説明枠を、両配色・文字サイズ・狭幅・最小窓と往復で確認する', async () => {
  const captures=resolve('tmp/short-intros-layout');
  const electron=await runElectronFixture('tests/fixtures/management-studio-electron.mjs',html,directory,[captures,'--editor-intros-only'],150_000);
  expect(electron.stdout,electron.stderr).toContain(`PASS: ${introductionChecks} editor introduction checks; zero HTTP(S) requests`);
  if(browser) {
    const native=await promisify(execFile)(process.execPath,[resolve('tests/fixtures/management-studio-native-browser.mjs'),browser,html,captures,'--editor-intros-only'],{cwd:directory,windowsHide:true,timeout:150_000});
    expect(native.stdout,native.stderr).toContain(`PASS: ${introductionChecks} studio native browser checks;`);
    expect(native.stdout).toContain('zero HTTP(S) requests');
  }
},305_000);
it('主画面の見出しとホームのOBS配置を、段組み境界・文字拡大・編集先からの復帰で確認する', async () => {
  const captures=resolve('tmp/page-heading-layout');
  const electron=await runElectronFixture('tests/fixtures/management-studio-electron.mjs',html,directory,[captures,'--page-headings-only'],50_000);
  expect(electron.stdout,electron.stderr).toContain('PASS: 134 page heading checks; zero HTTP(S) requests');
  if(browser) {
    const native=await promisify(execFile)(process.execPath,[resolve('tests/fixtures/management-studio-native-browser.mjs'),browser,html,captures,'--page-headings-only'],{cwd:directory,windowsHide:true,timeout:50_000});
    expect(native.stdout,native.stderr).toContain('PASS: 134 page heading checks;');
    expect(native.stdout).toContain('zero HTTP(S) requests');
  }
},105_000);
it('配信中A案の操作順・幅・状態更新・詳細と設定の往復を本体の描画で確認する', async () => {
  const captures = resolve('tmp/live-adoption-layout');
  const electron = await runElectronFixture('tests/fixtures/management-studio-electron.mjs', html, directory, [captures, '--live-only'], 65_000);
  expect(electron.stdout, electron.stderr).toContain('live workspace checks; zero HTTP(S) requests');
  if (browser) {
    const native = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser, html, captures, '--live-only'],
      { cwd:directory, windowsHide:true, timeout:65_000 });
    expect(native.stdout, native.stderr).toContain('live workspace checks;');
    expect(native.stdout).toContain('zero HTTP(S) requests');
  }
}, 135_000);
it('認識設定の入力・状態・準備と復旧が文字拡大でも収まり、状態更新で操作位置が動かない', async () => {
  const captures = resolve('tmp/recognition-apply-layout');
  const electron = await runElectronFixture('tests/fixtures/management-studio-electron.mjs', html, directory,
    [captures, '--recognition-apply-only'], 90_000);
  expect(electron.stdout, electron.stderr).toContain('PASS: 30 recognition apply checks');
  if (browser) {
    const native = await promisify(execFile)(process.execPath,
      [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser, html, captures, '--recognition-apply-only'],
      { cwd:directory, windowsHide:true, timeout:90_000 });
    expect(native.stdout, native.stderr).toContain('PASS: 30 recognition apply checks');
  }
}, 185_000);
it('AI映像の初期設定とAPIテストの処理中・成功・失敗をElectronと通常ブラウザで確認する', async () => {
  const captures = resolve('tmp/ai-settings-layout');
  const electron = await runElectronFixture('tests/fixtures/management-studio-electron.mjs', html, directory,
    [captures, '--ai-settings-only'], 40_000);
  expect(electron.stdout, electron.stderr).toContain('PASS: 44 AI settings checks');
  if (browser) {
    const native = await promisify(execFile)(process.execPath,
      [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser, html, captures, '--ai-settings-only'],
      { cwd:directory, windowsHide:true, timeout:40_000 });
    expect(native.stdout, native.stderr).toContain('PASS: 44 AI settings checks');
  }
}, 85_000);
it('配信中のコメント領域で実ホイール入力が一覧と本文を適切にスクロールする', async () => {
  const captures = process.env.CASMATE_STUDIO_CAPTURE ? resolve(process.env.CASMATE_STUDIO_CAPTURE) : '';
  const electron = await runElectronFixture('tests/fixtures/management-studio-electron.mjs', html, directory, [captures, '--comment-scroll-only'], 65_000);
  expect(electron.stdout, electron.stderr).toContain('PASS: 42 comment wheel scroll checks; zero HTTP(S) requests');
  if (browser) {
    const native = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser, html, '', '--comment-scroll-only'],
      {cwd:directory,windowsHide:true,timeout:65_000});
    expect(native.stdout, native.stderr).toContain('PASS: 42 comment wheel scroll checks');
    expect(native.stdout).toContain('zero HTTP(S) requests');
  }
}, 135_000);
it.skipIf(!browser)('通常ブラウザで3画面、編集往復、認識入力とコメント追従を確認する', async () => {
  const captures = process.env.CASMATE_STUDIO_CAPTURE ? resolve(process.env.CASMATE_STUDIO_CAPTURE) : '';
  const { stdout } = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser!, html, ...(captures ? [captures] : [])], { cwd: directory, windowsHide: true, timeout: 90_000 });
  expect(stdout).toMatch(/PASS: \d+ studio native browser checks/);
  expect(stdout).toContain('zero HTTP(S) requests');
}, 95_000);
