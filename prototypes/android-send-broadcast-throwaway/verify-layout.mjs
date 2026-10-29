// Fictional UI verification only. Run Electron from a disposable absolute cwd.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const documentPath = resolve(process.argv[2]);
const outputDirectory = resolve(process.argv[3]);
app.disableHardwareAcceleration();
app.setPath('userData', join(outputDirectory, 'profile'));

app.whenReady().then(async () => {
const win = new BrowserWindow({ show: false, width: 820, height: 1100,
  webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
const browserErrors = [];
// The host supplies these libraries for the inline visual. Skip their CDN calls
// during local geometry checks, so a network outage cannot stall UI verification.
win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://unpkg.com/*'] }, (_request, callback) => callback({ cancel: true }));
win.webContents.on('console-message', detail => {
  if (detail.level === 'error' && !detail.message.includes('ERR_') && !detail.message.includes('Failed to load resource')) {
    browserErrors.push(detail.message);
  }
});
const pause = () => new Promise(done => setTimeout(done, 80));
let frame;
const run = code => frame.executeJavaScript(code);
const api = (name, value) => run(`document.getElementById('casmate-send-mock').casmateMock[${JSON.stringify(name)}](${value === undefined ? '' : JSON.stringify(value)})`);
const state = () => api('getState');
const click = id => run(`(() => {
  const variant = document.querySelector('[data-variant]:not([hidden])');
  const button = variant.querySelector('[data-testid=' + ${JSON.stringify(id)} + ']');
  if (!button || button.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(id)});
  button.click();
})()`);
const text = id => run(`document.querySelector('[data-variant]:not([hidden]) [data-testid=' + ${JSON.stringify(id)} + ']').textContent`);
const measure = () => run(`(() => {
  const variant = document.querySelector('[data-variant]:not([hidden])');
  const find = tag => variant.querySelector('[data-testid=' + tag + ']');
  const rect = e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
  const phone = find('phone'), menu = find('menu'), scroll = find('menu-scroll');
  const send = find('send-action'), obs = find('obs-action');
  return { send: rect(send), obs: rect(obs), phone: rect(phone), menu: rect(menu),
    scroll: scroll.scrollTop, overflow: scroll.scrollWidth > scroll.clientWidth + 1,
    documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    focus: document.activeElement.dataset.testid,
    allButtons: [...menu.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(rect),
    obsDisabled: obs.disabled,
    theme: getComputedStyle(phone).backgroundColor };
})()`);
const closeSurface = async () => { await click('surface-close'); await pause(); };

try {
  await mkdir(outputDirectory, { recursive: true });
  await win.loadFile(documentPath);
  console.log('Preview loaded; checking layouts.');
  for (let attempt = 0; attempt < 60; attempt++) {
    frame = win.webContents.mainFrame.frames.find(candidate => candidate.url === 'about:srcdoc');
    if (frame && await run(`!!document.getElementById('casmate-send-mock')?.casmateMock`).catch(() => false)) break;
    await pause();
  }
  assert.ok(frame, 'preview iframe loaded');
  assert.equal(await run(`!!document.getElementById('casmate-send-mock').casmateMock`), true, 'prototype API ready');
  await writeFile(join(outputDirectory, 'initial.png'), (await win.webContents.capturePage()).toPNG());
  const variantNames = await run(`[...document.querySelectorAll('.viz-carousel > [data-variant]')].map(e => e.dataset.variant)`);
  assert.equal(variantNames.length, 2, 'two distinct variants');
  const reports = [];

  for (let variantIndex = 0; variantIndex < variantNames.length; variantIndex++) {
    if (variantIndex) await run(`document.querySelector('.viz-carousel-next').click()`);
    for (const width of [320, 360, 400]) for (const fontScale of [1, 1.5, 2]) for (const appearance of ['light', 'dark']) {
      await api('setWidth', width);
      await api('setFontScale', fontScale);
      await api('setAppearance', appearance);
      await api('setScenario', 'normal');
      await api('showMenu');
      await pause();
      const label = `${variantNames[variantIndex]}/${width}/${fontScale}/${appearance}`;
      await run(`(() => {
        const variant = document.querySelector('[data-variant]:not([hidden])');
        variant.querySelector('[data-testid=menu-scroll]').scrollTop = 40;
        variant.querySelector('[data-testid=send-action]').focus({preventScroll:true});
      })()`);
      const before = await measure();
      assert.equal(before.overflow, false, label + ' no menu horizontal overflow');
      assert.equal(before.documentOverflow, false, label + ' no page horizontal overflow');
      for (const target of before.allButtons) assert.ok(target[2] >= 47.9 && target[3] >= 47.9, label + ' targets at least 48px');

      for (const scenario of ['stopped', 'obs-only', 'reconnecting', 'obs-disconnected', 'send-error',
        'obs-unknown-result', 'obs-busy', 'obs-starting', 'obs-stopping']) {
        await api('setScenario', scenario);
        assert.equal((await state()).scenario, scenario, label + ' scenario actually applied');
        await pause();
        const after = await measure();
        assert.deepEqual(after.send, before.send, label + ' send position stable: ' + scenario);
        assert.deepEqual(after.obs, before.obs, label + ' OBS position stable: ' + scenario);
        assert.equal(after.scroll, before.scroll, label + ' scroll stable: ' + scenario);
        assert.equal(after.focus, before.focus, label + ' focus stable: ' + scenario);
        assert.equal(after.overflow, false, label + ' no state horizontal overflow: ' + scenario);
        if (['obs-disconnected', 'obs-busy', 'obs-starting', 'obs-stopping'].includes(scenario)) {
          assert.equal(after.obsDisabled, true, label + ' invalid OBS action disabled: ' + scenario);
        }
      }
      await api('setScenario', 'normal');
      await run(`document.querySelector('[data-variant]:not([hidden]) [data-testid=menu-scroll]').scrollTop = 0`);
      await pause();
      if (width === 400 && fontScale === 1 || width === 320 && fontScale === 2) {
        await writeFile(join(outputDirectory, `variant-${variantIndex + 1}-${width}-${fontScale}x-${appearance}.png`),
          (await win.webContents.capturePage()).toPNG());
      }
      reports.push({ variant: variantNames[variantIndex], width, fontScale, appearance, ...before });
    }

    await api('setWidth', 400); await api('setFontScale', 1); await api('setAppearance', 'light');
    await api('setScenario', 'normal'); await api('showMenu');
    const original = await state();
    await click('send-action');
    assert.equal((await state()).send, original.send, 'stop needs confirmation');
    await pause();
    assert.equal((await state()).pending?.kind, 'send-stop', 'saved state echo preserves live confirmation');
    await click('dismiss-confirmation');
    assert.equal((await state()).send, original.send, 'cancel leaves sender running');
    await click('send-action'); await click('confirm-action');
    assert.equal((await state()).send, 'stopped', 'confirmed stop stops sender');
    assert.equal((await state()).obs, original.obs, 'sender stop leaves OBS state unchanged');
    await click('send-action');
    assert.equal((await state()).send, 'sending', 'explicit sender start');
    assert.equal((await state()).obs, original.obs, 'sender start leaves OBS state unchanged');

    await click('obs-action');
    assert.equal((await state()).obs, 'stopped', 'OBS start needs confirmation');
    await click('dismiss-confirmation');
    assert.equal((await state()).obs, 'stopped', 'OBS cancel does not start');
    await click('obs-action'); await click('confirm-action');
    assert.equal((await state()).obs, 'streaming', 'confirmed OBS start');
    assert.equal((await state()).send, 'sending', 'OBS start leaves sender running');
    await click('obs-action'); await click('confirm-action');
    assert.equal((await state()).obs, 'stopped', 'confirmed OBS end');
    assert.equal((await state()).send, 'sending', 'OBS end leaves sender running');

    await click('send-details'); await closeSurface();
    assert.equal((await state()).send, 'sending', 'details leave sender running');
    await click('obs-details'); await closeSurface();
    await click('obs-preview');
    assert.equal((await state()).send, 'sending', 'OBS image view leaves sender running');
    await click('preview-update'); await pause();
    await closeSurface();
    await api('showMenu');
    await api('setScenario', 'obs-unknown-result');
    assert.match(await text('obs-status'), /配信中/, 'result unknown keeps latest current state separate');
    await api('setScenario', 'obs-disconnected');
    assert.match(await text('obs-status'), /不明/, 'disconnection clears current stream state');

    await api('setScenario', 'normal');
    await click('obs-action');
    assert.equal((await state()).pending?.kind, 'obs-start', 'OBS confirmation prepared');
    await api('setScenario', 'obs-disconnected');
    assert.equal((await state()).pending, null, 'disconnection cancels pending OBS confirmation');
    await api('setScenario', 'normal');
    await click('obs-preview');
    await pause();
    const previewBefore = await run(`(() => { const e = document.querySelector('[data-variant]:not([hidden]) [data-testid=preview-update]'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; })()`);
    await api('setScenario', 'obs-disconnected');
    const previewAfter = await run(`(() => { const e = document.querySelector('[data-variant]:not([hidden]) [data-testid=preview-update]'); const r=e.getBoundingClientRect(); return {rect:[r.x,r.y,r.width,r.height],disabled:e.disabled}; })()`);
    assert.deepEqual(previewAfter.rect, previewBefore, 'image invalidation does not move update control');
    assert.equal(previewAfter.disabled, true, 'disconnected OBS image capture unavailable');
    assert.equal((await state()).previewTime, null, 'disconnection discards old capture time');
    await api('setScenario', 'normal');
    assert.equal((await state()).previewTime, null, 'reconnection does not restore an old capture');
    await click('preview-update');
    assert.ok((await state()).previewTime, 'explicit update retrieves a new capture after reconnection');
    await closeSurface();
  }

  // Inspect the in-conversation stage at a narrow host width, without shrinking typography.
  win.setContentSize(320, 1100);
  await api('setWidth', 400); await api('setFontScale', 2); await api('showMenu'); await pause();
  assert.equal((await measure()).documentOverflow, false, '320px host viewport fits');
  await writeFile(join(outputDirectory, 'geometry.json'), JSON.stringify(reports, null, 2));
  assert.deepEqual(browserErrors, [], 'no application JavaScript errors');
  console.log(`PASS: ${reports.length} layouts; state geometry, confirmations, separate send/OBS controls, details and image preview.`);
  win.close(); app.exit(0);
} catch (error) {
  console.error(error);
  win.close(); app.exit(1);
}
});
