import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-obs-registration-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('OBS登録の入口・ダイアログ・状態前後・復旧を320pxと縦横画面でElectron描画確認する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-obs-registration-'));
  const captures = resolve('tmp/obs-registration-layout'); await mkdir(captures, { recursive: true });
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
      oxc: { jsx: { development: false } }, build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/obs-registration-renderer.tsx'), name: 'ObsRegistrationHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const html = join(directory, 'index.html');
    await writeFile(html, '<!doctype html><meta charset="utf-8"><title>OBS登録・描画確認</title><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script>');
    for (const file of ['index.html', 'harness.js', 'harness.css']) await copyFile(join(directory, file), join(captures, file));
    const membership = await runElectronFixture('tests/fixtures/obs-registration-layout.mjs', html, directory,
      [captures, '--registration-status-only'], 30_000);
    expect(membership.stdout, membership.stderr).toContain('PASS: 3 OBS registration status checks');
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => existsSync(path));
    const selection = await runElectronFixture('tests/fixtures/obs-registration-layout.mjs', html, directory,
      [captures, '--source-cards-only'], 60_000);
    expect(selection.stdout, selection.stderr).toContain('PASS: 960 OBS source cards checks');
    if (browser) {
      const nativeSelection = await promisify(execFile)(process.execPath,
        [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser, html, captures, '--source-cards-only'],
        { cwd: directory, windowsHide: true, timeout: 60_000 });
      expect(nativeSelection.stdout, nativeSelection.stderr).toContain('PASS: 960 OBS source cards checks; zero HTTP(S) requests');
    }
    if (browser) {
      const native = await promisify(execFile)(process.execPath,
        [resolve('tests/fixtures/management-studio-native-browser.mjs'), browser, html, captures, '--registration-status-only'],
        { cwd: directory, windowsHide: true, timeout: 30_000 });
      expect(native.stdout, native.stderr).toContain('PASS: 3 OBS registration status checks');
    }
    const disconnected = await runElectronFixture('tests/fixtures/obs-registration-layout.mjs', html, directory, [captures, '--disconnected-metrics-only'], 40_000);
    expect(disconnected.stdout, disconnected.stderr).toContain('PASS: 60 disconnected OBS guidance scenarios');
    const { stdout, stderr } = await runElectronFixture('tests/fixtures/obs-registration-layout.mjs', html, directory, [captures], 40_000);
    expect(stdout, stderr).toContain('PASS: 36 OBS registration layout/state scenarios');
    expect(stdout).toContain('PASS: four entries, manual phone fallback, recovery and keyboard');
    const recovery = await runElectronFixture('tests/fixtures/obs-registration-layout.mjs', html, directory,
      [captures, '--recovery-metrics-only'], 40_000);
    expect(recovery.stdout, recovery.stderr).toContain('PASS: 48 OBS recovery text-size/scroll/stability scenarios');
    for (const scale of [1.25, 1.5]) {
      const scaled = await runElectronFixture('tests/fixtures/obs-registration-layout.mjs', html, directory,
        [captures, '--select-metrics-only', `--force-device-scale-factor=${scale}`], 30_000);
      expect(scaled.stdout, scaled.stderr).toContain(`PASS: 12 OBS select text/zoom scenarios at device scale ${scale}`);
    }
  } finally { await removeFixture(directory); }
}, 240_000);
