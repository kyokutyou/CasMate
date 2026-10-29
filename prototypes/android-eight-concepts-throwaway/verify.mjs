import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const fragment = await readFile(new URL('./fragment.html', import.meta.url), 'utf8');
const errors = [];
const networkCalls = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error));
let now = 0;
let nextTimer = 1;
const timers = new Map();
const dom = new JSDOM(`<!doctype html><html lang="ja"><body>${fragment}</body></html>`, {
  url: 'http://127.0.0.1:5216/',
  runScripts: 'dangerously',
  virtualConsole,
  beforeParse(window) {
    window.structuredClone = structuredClone;
    window.Date.now = () => now;
    window.setTimeout = (callback, delay = 0) => {
      const id = nextTimer++;
      timers.set(id, { callback, at: now + Number(delay) });
      return id;
    };
    window.clearTimeout = id => timers.delete(id);
    window.requestAnimationFrame = callback => { callback(now); return 0; };
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const prohibitNetwork = name => {
      networkCalls.push(name);
      throw new Error(`The comparison attempted a network API: ${name}`);
    };
    window.fetch = () => prohibitNetwork('fetch');
    window.WebSocket = class { constructor() { prohibitNetwork('WebSocket'); } };
    window.XMLHttpRequest = class { constructor() { prohibitNetwork('XMLHttpRequest'); } };
    window.EventSource = class { constructor() { prohibitNetwork('EventSource'); } };
    window.navigator.sendBeacon = () => prohibitNetwork('sendBeacon');
  },
});

try {
  const { document } = dom.window;
  const api = dom.window.casmateEight;
  assert.ok(document.querySelector('#cm-eight'), 'Comparison root is present.');
  assert.ok(api, 'The comparison exposes its local verification interface.');
  assert.equal(typeof api.render, 'function');
  assert.equal(typeof api.openDesign, 'function');
  assert.equal(typeof api.setScreen, 'function');
  assert.ok(api.state, 'Local presentation state is available.');
  assert.equal(api.designs.length, 8, 'There are exactly eight design directions.');
  assert.equal(new Set(api.designs.map(design => design.name)).size, 8, 'Each design has a distinct name.');
  assert.equal(api.sample.length, 4, 'All designs use four shared sample comments.');

  const assertUniqueIds = () => {
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    assert.equal(new Set(ids).size, ids.length, 'Every rendered element ID is unique.');
  };
  const phone = () => document.querySelector('[data-detail-phone]');
  const localState = () => api.state.phones[api.state.selectedDesign];
  const serviceState = () => {
    const s = localState();
    return { sending: s.sending, obs: s.obs, speech: s.speech };
  };
  const currentButton = (action, attrs = '') => {
    const region = phone().querySelector('[role="dialog"]') ?? phone();
    return region.querySelector(`[data-action="${action}"]${attrs}`);
  };
  const clickExisting = (action, attrs = '') => {
    const element = currentButton(action, attrs);
    assert.ok(element, `A public ${action} control is available.`);
    assert.equal(element.tagName, 'BUTTON', 'Actions use native buttons.');
    assert.equal(element.disabled, false, `${action} is available in the current state.`);
    element.click();
  };
  const click = action => {
    if (!currentButton(action) && localState().sheet) clickExisting('close-sheet');
    if (!currentButton(action)) {
      const entry = ['controls', 'menu', 'obs-panel'].find(name => currentButton(name));
      assert.ok(entry, `The design offers an entry to ${action}.`);
      clickExisting(entry);
    }
    clickExisting(action);
  };
  const navigate = screen => {
    if (localState().sheet) clickExisting('close-sheet');
    const selector = `[data-screen="${screen}"]`;
    if (!currentButton('nav', selector) && !currentButton(`nav-${screen}`)) clickExisting('menu');
    if (currentButton('nav', selector)) clickExisting('nav', selector);
    else clickExisting(`nav-${screen}`);
    assert.equal(api.state.screen, screen, 'App navigation opens the requested screen.');
  };
  const tick = milliseconds => {
    now += milliseconds;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
  };
  assertUniqueIds();
  assert.equal(document.querySelectorAll('.cx-gallery > article.cx-concept[data-design-index]').length, 8,
    'All eight designs appear simultaneously in the gallery.');
  for (let index = 0; index < 8; index += 1) {
    assert.ok(document.querySelector(`.cx-gallery > article[data-design-index="${index}"]`), `Design ${index + 1} appears in the comparison.`);
    api.openDesign(index);
    for (const screen of ['comments', 'outdoor', 'connection', 'settings']) {
      api.setScreen(screen);
      const phone = document.querySelector('[data-detail-phone]');
      assert.ok(phone, `Design ${index + 1}: enlarged phone is available.`);
      assert.equal(Number(api.state.selectedDesign), index, 'Selected design is preserved.');
      assert.equal(api.state.screen, screen, 'Selected main screen is preserved.');
      assert.equal(Number(phone.dataset.designIndex), index, 'Enlarged phone matches the selected design.');
      assert.equal(phone.dataset.screen, screen, 'Enlarged phone matches the selected screen.');
      assert.ok(phone.textContent.trim().length > 20, `Design ${index + 1}, ${screen}: screen has visible sample content.`);
      assertUniqueIds();
    }
    api.setScreen('comments');
    const comments = [...phone().querySelectorAll('.cm-comment')];
    assert.equal(comments.length, api.sample.length, 'The comments screen contains the common sample.');
    comments.forEach((comment, i) => {
      assert.equal(comment.querySelector('.cm-service').textContent, api.sample[i].service);
      assert.equal(comment.querySelector('.cm-author').textContent, api.sample[i].author);
      assert.equal(comment.querySelector('.cm-body').textContent, api.sample[i].body);
      assert.equal(comment.querySelectorAll('time, img, .cm-avatar, [data-comment-time], [data-comment-number]').length, 0,
        'Comment rows contain no unsupported time, avatar, or number decorations.');
    });

    click('hide');
    click('mute');
    assert.equal(localState().hidden, true);
    assert.equal(localState().muted, true);
    navigate('settings');
    assert.equal(phone().querySelector('select[aria-label="映像の向き"]').disabled, true);
    assert.equal(phone().querySelector('select[aria-label="品質プリセット"]').disabled, true);
    const volume = phone().querySelector('[data-input="volume"]');
    volume.value = '125';
    volume.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    navigate('connection');
    for (const route of phone().querySelectorAll('[data-action="route"]')) assert.equal(route.disabled, true);
    assert.equal(phone().querySelector('[data-action="qr"]').disabled, true);
    assert.equal(localState().route, 'Tailscale');
    navigate('outdoor');
    assert.equal(localState().hidden, true, 'Navigation preserves hidden camera state.');
    assert.equal(localState().muted, true, 'Navigation preserves manual mute.');
    assert.equal(localState().volume, 125, 'Navigation preserves microphone volume.');
    assert.deepEqual(serviceState(), { sending: true, obs: true, speech: true }, 'Navigation does not start or stop services.');
    click('diagnostics');
    clickExisting('diagnostic-tab', '[data-tab="概要"]');
    assert.match(phone().querySelector('[role="dialog"]').textContent, /手動非表示/,
      'Diagnostics reflect the current manual camera hiding state.');
    clickExisting('diagnostic-tab', '[data-tab="自動調整"]');
    assert.match(phone().querySelector('[role="dialog"]').textContent, /手動非表示/);
    clickExisting('close-sheet');

    click('obs');
    assert.deepEqual(serviceState(), { sending: true, obs: true, speech: true }, 'Opening OBS confirmation does not execute it.');
    tick(10001);
    assert.equal(currentButton('confirm-obs').disabled, true, 'OBS confirmation expires after ten seconds.');
    assert.deepEqual(serviceState(), { sending: true, obs: true, speech: true }, 'Expired confirmation does not execute.');
    clickExisting('close-sheet');
    click('obs');
    clickExisting('confirm-obs');
    assert.deepEqual(serviceState(), { sending: true, obs: false, speech: true }, 'OBS stop preserves phone transmission and speech.');
    click('obs');
    clickExisting('confirm-obs');
    assert.deepEqual(serviceState(), { sending: true, obs: true, speech: true }, 'OBS start preserves other service states.');

    click('stop-send');
    assert.equal(localState().sending, true, 'Opening transmission confirmation does not stop it.');
    clickExisting('close-sheet');
    assert.equal(localState().sending, true, 'Cancelling transmission stop keeps it running.');
    click('stop-send');
    clickExisting('confirm-send');
    assert.deepEqual(serviceState(), { sending: false, obs: true, speech: true }, 'Transmission stop preserves OBS broadcast and speech.');
    click('diagnostics');
    clickExisting('diagnostic-tab', '[data-tab="概要"]');
    const stoppedSummary = phone().querySelector('[role="dialog"]');
    assert.match(stoppedSummary.textContent, /停止中/, 'Diagnostics reflect stopped transmission.');
    assert.ok([...stoppedSummary.querySelectorAll('.cm-metrics b')].every(value => value.textContent.includes('—')),
      'Stopped diagnostic metrics do not show live readings.');
    clickExisting('diagnostic-tab', '[data-tab="通信"]');
    assert.match(phone().querySelector('[role="dialog"]').textContent, /送信待ち/);
    clickExisting('close-sheet');
    navigate('settings');
    assert.equal(phone().querySelector('select[aria-label="映像の向き"]').disabled, false);
    assert.equal(phone().querySelector('select[aria-label="品質プリセット"]').disabled, false);
    navigate('connection');
    clickExisting('route', '[data-route="LAN"]');
    assert.equal(localState().route, 'LAN', 'A saved route can be explicitly selected after stopping.');
    assert.deepEqual(serviceState(), { sending: false, obs: true, speech: true }, 'Route selection does not start transmission or alter other services.');
    clickExisting('qr');
    assert.deepEqual(serviceState(), { sending: false, obs: true, speech: true }, 'The QR example does not start services.');
    clickExisting('close-sheet');
    navigate('comments');
    click('speech');
    assert.deepEqual(serviceState(), { sending: false, obs: true, speech: false }, 'Speech stop is independent.');
    click('auto');
    assert.equal(localState().auto, false, 'Existing auto-scroll control can be toggled.');
    click('start-send');
    assert.deepEqual(serviceState(), { sending: true, obs: true, speech: false }, 'Explicit transmission start does not start speech.');
    assert.equal(localState().hidden, false, 'A new transmission starts with its camera visible.');
    assert.equal(localState().muted, false, 'A new transmission resets the previous session manual mute.');
    assertUniqueIds();
  }
  assert.equal(document.querySelectorAll('script[src], link[rel="stylesheet"], iframe').length, 0,
    'The fragment does not import scripts, stylesheets, or frames.');
  assert.equal(document.querySelectorAll('[src^="http"], [src^="//"]').length, 0,
    'Sample media does not fetch remote resources.');
  assert.deepEqual(networkCalls, [], 'The comparison uses no network APIs.');
  assert.deepEqual(errors, [], 'All comparison screens render without script errors.');
  console.log('Verified: 8 designs × 4 screens; common samples; navigation; independent services; confirmations and expiry; sending restrictions; current diagnostics; new-session controls; unique IDs; no network calls.');
} finally {
  dom.window.close();
}
