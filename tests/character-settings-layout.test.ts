import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-character-settings-')) throw new Error('Unexpected fixture path');
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

it('簡易キャラクター設定で左右配置・狭幅・拡大・保存状態と通知の位置保持を描画確認する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-character-settings-'));
  const captures = resolve('tmp/character-settings-ux-layout');
  await mkdir(captures, { recursive: true });
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error',
      resolve: { alias: [{ find: /^\.\.\/api$/, replacement: resolve('tests/fixtures/character-settings-api.ts') }] },
      define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
      build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: resolve('tests/fixtures/character-settings-renderer.tsx'), name: 'CharacterSettingsHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const snapshot = obsRegistrationSnapshot();
    const image = (open: boolean) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="440" viewBox="0 0 320 440"><path fill="#8d9ee8" d="M70 440V290Q160 230 250 290V440"/><circle cx="160" cy="150" r="95" fill="#f6d3b1"/><path fill="#46425e" d="M60 150V90Q160-10 260 90V150L200 65L150 115L110 75Z"/><circle cx="125" cy="155" r="7"/><circle cx="195" cy="155" r="7"/><ellipse cx="160" cy="195" rx="16" ry="${open ? 14 : 3}" fill="#8c4653"/></svg>`);
    snapshot.settings.character.simple.closedAsset = image(false);
    snapshot.settings.character.simple.openAsset = image(true);
    snapshot.character.motion = snapshot.settings.character.simple.motion;
    snapshot.character.motionStartedAtMs = Date.now();
    const html = join(directory, 'index.html');
    await copyFile(resolve('public/placeholder.svg'), join(directory, 'placeholder.svg'));
    await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(snapshot).replace(/</g, '\\u003c')}</script><script src="harness.js"></script>`);
    const result = await runElectronFixture('tests/fixtures/character-settings-layout.mjs', html, directory, [captures], 50_000);
    expect(result.stdout, result.stderr).toContain('PASS: character settings layout, sticky preview, save states and local mouth test; zero HTTP(S)');
  } finally {
    await removeFixture(directory);
  }
}, 60_000);
