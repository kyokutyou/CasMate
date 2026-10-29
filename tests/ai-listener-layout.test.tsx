import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';
import { AiListenerPanel } from '../src/renderer/components/AiListenerPanel';
import { defaultAiSettings, type AiView } from '../src/shared/ai-listener';
import { ManagementNavigation } from '../src/renderer/management-navigation';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-ai-layout-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('AIの発話待ち・生成段階・OBS待機・投稿上限・4参加先の状態更新で入力位置とスクロールを動かさない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-ai-layout-'));
  try {
    const css = await Promise.all(['src/renderer/styles.css', 'src/renderer/components/compact-feedback.css', 'src/renderer/components/ai-listener-panel.css'].map(path => readFile(resolve(path), 'utf8')));
    const service = { ready: false, message: '', account: null, latest: null };
    const view: AiView = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: false,
      authorization: null, postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, services: { youtube: service, twitch: service, shitaraba: service, jpnkn: service } };
    const markup = renderToStaticMarkup(<main className="management-shell"><header /><nav /><div className="management-body">
      <ManagementNavigation.Provider value={{ editor: 'aiListener', reportError: () => {}, open: () => {} }}>
        <AiListenerPanel settings={defaultAiSettings()} view={view} change={() => {}} mutate={async () => {}} />
      </ManagementNavigation.Provider></div></main>);
    const html = join(directory, 'index.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><style>${css.join('\n')}</style>${markup}`);
    const { stdout } = await runElectronFixture('tests/fixtures/ai-listener-layout.mjs', html, directory);
    expect(stdout).toContain('PASS: 50 AI layout checks');
  } finally { await removeFixture(directory); }
}, 30_000);

it('採用画面の実状態更新・詳細保持・OBS入口をElectronと通常ブラウザで確認する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-ai-layout-'));
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
      oxc: { jsx: { development: false } }, build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/ai-listener-renderer.tsx'), name: 'AiHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const html = join(directory, 'index.html'), captures = resolve('tmp/ai-listener-layout');
    await writeFile(html, '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script>');
    const electron = await runElectronFixture('tests/fixtures/ai-listener-electron.mjs', html, directory, [captures], 60000);
    expect(electron.stdout, electron.stderr).toContain('PASS: 42 AI listener UI scenarios');
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    expect(browser, '通常ブラウザ').toBeTruthy();
    const native = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/ai-listener-browser.mjs'), browser!, html, directory, captures], { cwd: directory, windowsHide: true, timeout: 60000 });
    expect(native.stdout, native.stderr).toContain('PASS: 42 AI listener UI scenarios');
  } finally { await removeFixture(directory); }
}, 125000);
