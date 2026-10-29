import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { InitialSetupStore } from '../src/main/core/initial-setup-store';
import { setupFeatures } from '../src/shared/initial-setup';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-checkbox-layout-')) throw Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('初回設定の全チェック枠・チェック印・ラベル先頭行を文字拡大と折返しでもそろえる', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-checkbox-layout-'));
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } },
      build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false, lib: { entry: resolve('tests/fixtures/initial-setup-checkbox-renderer.tsx'), name: 'CheckboxHarness', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const snapshot = obsRegistrationSnapshot();
    snapshot.initialSetup = { ...new InitialSetupStore('unused', false).view(snapshot), selected: setupFeatures.map(([id]) => id), smartphoneUses: ['comments', 'speech', 'video'] };
    const html = join(directory, 'index.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(snapshot).replace(/</g, '\\u003c')}</script><script src="harness.js"></script><script>
      if(location.hash==='#verify') {
        const errors=[];
        for(const theme of ['graphite','midnight','ocean','burgundy','pearl','ivory','sakura','lavender']) for(const size of ['small','medium','large']) for(const checked of [false,true]) for(const pending of [false,true]) {
          checkboxHarness.render(theme,size,checked,pending);errors.push(...checkboxHarness.misaligned());
        }
        document.documentElement.dataset.checkboxResult=errors.length?'fail':'pass';
        checkboxHarness.render('ocean','medium',true,false);document.querySelector('.setup-personal-check').scrollIntoView({block:'start'});
      }
    </script>`);
    const captures = resolve('tmp/initial-setup-checkboxes'); await mkdir(captures, { recursive: true });
    const result = await runElectronFixture('tests/fixtures/initial-setup-checkbox-layout.mjs', html, directory, [captures], 30_000);
    expect(result.stdout, result.stderr).toContain('PASS: setup checkbox alignment');
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    expect(browser).toBeTruthy();
    const native = await promisify(execFile)(browser!, ['--headless', '--disable-gpu', '--force-device-scale-factor=1', '--window-size=1040,900', `--user-data-dir=${join(directory, 'chrome-profile')}`, '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(html).href + '#verify'], { cwd: directory, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
    expect(native.stdout, native.stderr).toContain('data-checkbox-result="pass"');
  } finally {
    await removeFixture(directory);
  }
}, 45_000);
