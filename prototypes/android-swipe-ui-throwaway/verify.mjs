import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const fragmentPath = fileURLToPath(new URL('./fragment.html', import.meta.url));
const fragment = await readFile(fragmentPath, 'utf8');
const errors = [];
const networkCalls = [];
const savedWidgetStates = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error));
let now = 0;
let nextTimer = 1;
const timers = new Map();
const dom = new JSDOM(`<!doctype html><html lang="ja"><body>${fragment}</body></html>`, {
  url: 'http://127.0.0.1:5209/',
  runScripts: 'dangerously',
  virtualConsole,
  beforeParse(window) {
    window.structuredClone = structuredClone;
    window.Date.now = () => now;
    window.setTimeout = (callback, delay = 0) => {
      const id = nextTimer++;
      timers.set(id, { callback, at: now + Number(delay), repeat: 0 });
      return id;
    };
    window.clearTimeout = id => timers.delete(id);
    window.setInterval = (callback, delay = 0) => {
      const id = nextTimer++;
      timers.set(id, { callback, at: now + Number(delay), repeat: Number(delay) });
      return id;
    };
    window.clearInterval = id => timers.delete(id);
    const prohibitNetwork = name => {
      networkCalls.push(name);
      throw new Error(`The throwaway prototype attempted ${name}.`);
    };
    window.fetch = () => prohibitNetwork('fetch');
    window.WebSocket = class { constructor() { prohibitNetwork('WebSocket'); } };
    window.XMLHttpRequest = class { constructor() { prohibitNetwork('XMLHttpRequest'); } };
    window.EventSource = class { constructor() { prohibitNetwork('EventSource'); } };
    window.navigator.sendBeacon = () => prohibitNetwork('sendBeacon');
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.openai = { widgetState: null, setWidgetState: data => { savedWidgetStates.push(structuredClone(data)); return Promise.resolve(); } };
  },
});

const { document } = dom.window;
const api = dom.window.casmatePrototype;
assert.ok(api, 'The comparison must expose its local test interface.');
assert.equal(api.getState('A').registered, false, 'The initial preview exposes the first-launch registration entry.');
assert.ok(document.querySelector('.cm-onboarding [data-action="qr"]'));
assert.equal(document.querySelector('[data-phone="A"]').style.colorScheme, 'light', 'The accepted light palette is the initial appearance.');
assert.equal(typeof api.getState, 'function');
assert.equal(typeof api.setScenario, 'function');
assert.equal(typeof api.expireConfirmation, 'function');
assert.equal(typeof api.switchScreen, 'function');

const designIds = [...document.querySelectorAll('[data-phone]')].map(element => element.dataset.phone);
const state = id => JSON.parse(JSON.stringify(api.getState(id)));
const serviceState = id => {
  const value = state(id);
  return { sending: value.sending, listening: value.listening, broadcast: value.broadcast };
};
const phone = id => {
  const element = document.querySelector(`[data-phone="${id}"]`);
  assert.ok(element, `${id}: phone surface exists`);
  return element;
};
const actionRegion = id => phone(id).querySelector('.cm-sheet') ?? phone(id);
const button = (id, action) => {
  let element = actionRegion(id).querySelector(`[data-action="${action}"]`);
  if (!element && phone(id).querySelector('.cm-sheet')) {
    const close = actionRegion(id).querySelector('[data-action="close"]');
    assert.ok(close, `${id}: an open sheet can be closed before another action`);
    close.focus();
    close.click();
    element = actionRegion(id).querySelector(`[data-action="${action}"]`);
  }
  if (!element && ['read', 'follow'].includes(action)) {
    api.switchScreen(id, 'comments');
    element = actionRegion(id).querySelector(`[data-action="${action}"]`);
  }
  if (!element && ['send', 'obs', 'mic', 'video', 'preview', 'diagnostics'].includes(action)) {
    api.switchScreen(id, 'camera');
    element = actionRegion(id).querySelector(`[data-action="${action}"]`);
  }
  if (!element && ['send', 'obs', 'mic', 'video'].includes(action)) {
    const tray = actionRegion(id).querySelector('[data-action="tray"]');
    if (tray) tray.click();
    else click(id, 'controls');
    element = actionRegion(id).querySelector(`[data-action="${action}"]`);
  }
  if (!element && ['preview', 'diagnostics'].includes(action)) {
    click(id, 'settings');
    element = actionRegion(id).querySelector(`[data-action="${action}"]`);
  }
  assert.ok(element, `${id}: ${action} action exists`);
  assert.equal(element.tagName, 'BUTTON', `${id}: ${action} is a native button`);
  return element;
};
const click = (id, action) => {
  const element = button(id, action);
  if (!element.disabled) element.focus();
  element.click();
};
const qrButton = id => {
  const buttons = [...actionRegion(id).querySelectorAll('button')];
  const element = buttons.find(item => ['qr', 'register', 'qr-register'].includes(item.dataset.action))
    ?? buttons.find(item => /QR.*読み取/.test(item.textContent));
  assert.ok(element, `${id}: the QR registration stub exists`);
  return element;
};
const changeSetting = (id, name, value) => {
  const element = actionRegion(id).querySelector(`[data-setting="${name}"]`);
  assert.ok(element, `${id}: ${name} input exists`);
  assert.equal(element.disabled, false, `${id}: ${name} can be adjusted`);
  element.value = String(value);
  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
};
const key = (element, value, shiftKey = false) => {
  element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
};
const pointer = (element, type, { x, y, id = 1, primary = true, pointerType = 'touch' }) => {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x }, clientY: { value: y }, pointerId: { value: id },
    pointerType: { value: pointerType }, isPrimary: { value: primary }, button: { value: 0 },
  });
  element.dispatchEvent(event);
};
const swipe = (id, {
  x = 280, y = 160, endX = 60, endY = 165, duration = 150, pointerId = 1,
  target = phone(id).querySelector('.cm-product-layer'),
} = {}) => {
  pointer(target, 'pointerdown', { x, y, id: pointerId });
  tick(duration);
  pointer(target, 'pointerup', { x: endX, y: endY, id: pointerId });
};
function tick(milliseconds) {
  const end = now + milliseconds;
  let executions = 0;
  while (true) {
    const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    if (++executions > 1000) throw new Error('Prototype timers failed to settle.');
    const [id, timer] = due;
    now = timer.at;
    if (timer.repeat > 0) timer.at += timer.repeat;
    else timers.delete(id);
    timer.callback();
  }
  now = end;
}
function assertUniqueIds() {
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length, 'DOM IDs must be unique across all four designs.');
}

let checks = 0;
function check(name, callback) {
  api.setScenario('running');
  callback();
  checks += 1;
  process.stdout.write(`PASS ${name}\n`);
}
async function checkAsync(name, callback) {
  api.setScenario('running');
  await callback();
  checks += 1;
  process.stdout.write(`PASS ${name}\n`);
}

try {
  check('selected bottom-control design and unique DOM IDs', () => {
    assert.deepEqual(designIds, ['A']);
    assert.equal(document.querySelector('.viz-carousel'), null);
    assert.equal(phone('A').querySelector('.cm-notice'), null, 'the removed explanation has no empty row');
    assertUniqueIds();
  });

  for (const id of designIds) {
    check(`${id}: appearance changes preserve services, camera settings and focused controls`, () => {
      click(id, 'mic');
      click(id, 'settings');
      changeSetting(id, 'zoom', 2);
      const before = state(id);
      click(id, 'theme-dark');
      assert.equal(phone(id).dataset.appearance, 'dark');
      assert.equal(phone(id).style.colorScheme, 'dark');
      assert.equal(button(id, 'theme-dark').getAttribute('aria-pressed'), 'true');
      assert.equal(document.activeElement.dataset.action, 'theme-dark');
      assert.deepEqual(state(id), before);
      click(id, 'close');
      api.switchScreen(id, 'comments');
      click(id, 'settings');
      assert.equal(button(id, 'theme-dark').getAttribute('aria-pressed'), 'true');
      const commentsBefore = state(id);
      click(id, 'theme-light');
      assert.deepEqual(state(id), commentsBefore);
      assert.equal(phone(id).style.colorScheme, 'light');
    });

    check(`${id}: first-launch appearance persists through registration, scene changes and view restoration`, () => {
      api.setScenario('unregistered');
      click(id, 'theme-toggle');
      assert.equal(phone(id).dataset.appearance, 'dark');
      assert.deepEqual(serviceState(id), { sending: false, listening: false, broadcast: 'unknown' });
      const saved = structuredClone(savedWidgetStates.at(-1));
      assert.equal(saved.privateContent.appearance, 'dark');
      click(id, 'qr');
      click(id, 'qr-success');
      assert.equal(phone(id).dataset.appearance, 'dark');
      assert.deepEqual(serviceState(id), { sending: false, listening: false, broadcast: 'stopped' });
      api.setScenario('running');
      assert.equal(phone(id).dataset.appearance, 'dark');
      dom.window.dispatchEvent(new dom.window.CustomEvent('openai:set_globals', { detail: { globals: { widgetState: saved } } }));
      assert.ok(phone(id).querySelector('.cm-onboarding'));
      assert.equal(phone(id).dataset.appearance, 'dark');
      assert.equal(document.querySelector('#cm-scenario').value, 'unregistered');
      assert.deepEqual(serviceState(id), { sending: false, listening: false, broadcast: 'unknown' });
      click(id, 'theme-toggle');
      assert.equal(phone(id).dataset.appearance, 'light');
    });

    check(`${id}: routine actions do not add the removed bottom explanation row`, () => {
      const assertNoExplanation = () => assert.equal(phone(id).querySelector('.cm-product-layer > .cm-notice'), null);
      for (const action of ['mic', 'mic', 'video', 'video', 'preview', 'preview', 'read', 'read']) {
        click(id, action);
        assertNoExplanation();
        if (state(id).sheet) click(id, 'close');
        assertNoExplanation();
      }
      click(id, 'send');
      click(id, 'confirm-send-stop');
      assertNoExplanation();
      click(id, 'send');
      assertNoExplanation();
      click(id, 'obs');
      click(id, 'confirm-obs');
      assertNoExplanation();
      api.setScenario('offline');
      assertNoExplanation();
      assert.match(phone(id).querySelector('.cm-header-title small').textContent, /接続待ち/);
      assert.match(phone(id).querySelector('.cm-obs-row').textContent, /状態不明/);
    });

    check(`${id}: camera and comments are separate function screens`, () => {
      assert.equal(state(id).screen, 'camera');
      assert.equal(phone(id).querySelector('[data-action="read"]'), null, 'camera has no reading control');
      assert.equal(phone(id).querySelector('[data-action="expand-comments"]'), null);
      assert.equal(phone(id).querySelector('.cm-comment-list'), null, 'camera has no comment list');
      assert.doesNotMatch(phone(id).textContent, /フリック/);
      assert.ok(phone(id).querySelector('.cm-scene'), 'camera preview belongs on the camera screen');
      for (const action of ['screen-camera', 'screen-comments']) {
        assert.ok(button(id, action), 'a visible alternative to flick is available');
      }
      click(id, 'settings');
      assert.equal(phone(id).querySelector('[data-action="read"]'), null, 'camera settings do not restore reading controls');
      click(id, 'close');
      click(id, 'screen-comments');
      assert.equal(state(id).screen, 'comments');
      assert.equal(phone(id).querySelector('.cm-notice'), null);
      assert.doesNotMatch(phone(id).textContent, /フリック/);
      assert.ok(phone(id).querySelector('[data-action="read"]'));
      assert.ok(phone(id).querySelector('[data-action="follow"]'));
      assert.equal(phone(id).querySelector('.cm-scene, .cm-hidden-camera'), null, 'comment screen has no camera preview');
      for (const action of ['send', 'obs', 'mic', 'video', 'expand-comments']) {
        assert.equal(phone(id).querySelector(`[data-action="${action}"]`), null, `${action} does not appear on the comment screen`);
      }
      click(id, 'settings');
      for (const action of ['send', 'obs', 'mic', 'video', 'preview']) {
        assert.equal(actionRegion(id).querySelector(`[data-action="${action}"]`), null, `${action} does not appear in comment settings`);
      }
      assert.equal(actionRegion(id).querySelector('[data-setting="zoom"]'), null, 'comment settings do not contain camera zoom');
      click(id, 'close');
      click(id, 'screen-camera');
      assert.equal(state(id).screen, 'camera');
    });

    check(`${id}: left and right flick preserve service and camera state`, () => {
      click(id, 'mic');
      click(id, 'video');
      if (state(id).sheet) click(id, 'close');
      const before = state(id);
      swipe(id);
      assert.equal(state(id).screen, 'comments', 'left flick opens comments');
      for (const name of ['sending', 'listening', 'broadcast', 'micMuted', 'videoHidden', 'previewClosed', 'gain', 'zoom', 'network']) {
        assert.equal(state(id)[name], before[name], `${name} survives the view transition`);
      }
      swipe(id, { x: 60, endX: 280 });
      assert.equal(state(id).screen, 'camera', 'right flick returns to camera');
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
      assert.equal(state(id).micMuted, true);
      assert.equal(state(id).videoHidden, true);
    });

    check(`${id}: flick ignores short, vertical, slow, cancelled and multiple pointer gestures`, () => {
      const surface = phone(id).querySelector('.cm-product-layer');
      swipe(id, { x: 280, endX: 225 });
      assert.equal(state(id).screen, 'camera', 'short movement remains on camera');
      swipe(id, { x: 280, endX: 180, endY: 360 });
      assert.equal(state(id).screen, 'camera', 'vertical scroll remains on camera');
      swipe(id, { duration: 701 });
      assert.equal(state(id).screen, 'camera', 'slow horizontal drag remains on camera');
      pointer(surface, 'pointerdown', { x: 280, y: 160 });
      pointer(surface, 'pointercancel', { x: 160, y: 160 });
      pointer(surface, 'pointerup', { x: 60, y: 160 });
      assert.equal(state(id).screen, 'camera', 'cancelled pointer cannot switch screens');
      pointer(surface, 'pointerdown', { x: 280, y: 160 });
      pointer(surface, 'pointerdown', { x: 260, y: 180, id: 2, primary: false });
      pointer(surface, 'pointerup', { x: 60, y: 160 });
      pointer(surface, 'pointerup', { x: 60, y: 180, id: 2, primary: false });
      assert.equal(state(id).screen, 'camera', 'two pointers cannot trigger screen navigation');
      pointer(surface, 'pointerdown', { x: 280, y: 160 });
      pointer(surface, 'pointerup', { x: 60, y: 160, id: 3 });
      assert.equal(state(id).screen, 'camera', 'a different pointer cannot finish the gesture');
      pointer(surface, 'pointercancel', { x: 60, y: 160 });
      swipe(id, { x: 280, endX: 224 });
      assert.equal(state(id).screen, 'comments', 'a new single pointer works after cancellation');
    });

    check(`${id}: controls, sliders and dialogs do not initiate screen flick`, () => {
      swipe(id, { target: button(id, 'screen-comments') });
      assert.equal(state(id).screen, 'camera', 'a button drag does not switch views');
      click(id, 'settings');
      swipe(id, { target: actionRegion(id) });
      assert.equal(state(id).screen, 'camera', 'dragging a sheet does not switch views');
      const zoom = actionRegion(id).querySelector('[data-setting="zoom"]');
      assert.ok(zoom);
      swipe(id, { target: zoom });
      assert.equal(state(id).screen, 'camera', 'slider drag does not switch views');
      assert.equal(state(id).zoom, 1);
      const before = serviceState(id);
      swipe(id, { target: phone(id).querySelector('.cm-product-layer') });
      assert.equal(state(id).screen, 'camera', 'background flick is blocked by the modal');
      assert.deepEqual(serviceState(id), before);
      click(id, 'close');
    });

    await checkAsync(`${id}: pointers released outside the phone and blur do not leave stale gestures`, async () => {
      pointer(button(id, 'settings'), 'pointerdown', { x: 280, y: 160, id: 11 });
      pointer(document.body, 'pointerup', { x: 60, y: 160, id: 11 });
      await Promise.resolve();
      swipe(id, { pointerId: 12 });
      assert.equal(state(id).screen, 'comments', 'outside release must not block the next pointer');
      api.switchScreen(id, 'camera');
      pointer(button(id, 'settings'), 'pointerdown', { x: 280, y: 160, id: 21 });
      pointer(document.body, 'pointercancel', { x: 60, y: 160, id: 21 });
      await Promise.resolve();
      swipe(id, { pointerId: 22 });
      assert.equal(state(id).screen, 'comments', 'outside cancellation must not block the next pointer');
      api.switchScreen(id, 'camera');
      const surface = phone(id).querySelector('.cm-product-layer');
      pointer(surface, 'pointerdown', { x: 280, y: 160, id: 31 });
      dom.window.dispatchEvent(new dom.window.Event('blur'));
      pointer(surface, 'pointerup', { x: 60, y: 160, id: 31 });
      assert.equal(state(id).screen, 'camera', 'blur cancels a gesture instead of finishing navigation');
      await Promise.resolve();
      swipe(id, { pointerId: 32 });
      assert.equal(state(id).screen, 'comments', 'a fresh pointer works after blur');
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
    });

    check(`${id}: keyboard screen switching respects focused controls`, () => {
      const surface = phone(id).querySelector('.cm-product-layer');
      key(surface, 'ArrowLeft');
      assert.equal(state(id).screen, 'comments');
      key(phone(id).querySelector('.cm-product-layer'), 'ArrowRight');
      assert.equal(state(id).screen, 'camera');
      key(button(id, 'settings'), 'ArrowLeft');
      assert.equal(state(id).screen, 'camera', 'a focused function control retains its arrow keys');
      key(button(id, 'screen-comments'), 'ArrowLeft');
      assert.equal(state(id).screen, 'comments', 'navigation tabs support arrow-key movement');
      key(button(id, 'screen-camera'), 'ArrowRight');
      assert.equal(state(id).screen, 'camera');
      click(id, 'settings');
      key(actionRegion(id).querySelector('[data-setting="zoom"]'), 'ArrowLeft');
      assert.equal(state(id).screen, 'camera', 'range adjustment does not navigate');
      click(id, 'close');
    });

    check(`${id}: comment reading and follow choices survive returning to camera`, () => {
      click(id, 'screen-comments');
      click(id, 'read');
      click(id, 'follow');
      assert.equal(state(id).listening, false);
      assert.equal(state(id).follow, false);
      swipe(id, { x: 60, endX: 280 });
      assert.equal(state(id).screen, 'camera');
      assert.equal(phone(id).querySelector('[data-action="read"]'), null);
      swipe(id);
      assert.equal(state(id).screen, 'comments');
      assert.equal(state(id).listening, false);
      assert.equal(state(id).follow, false);
      assert.equal(phone(id).querySelector('[data-action="follow"]').getAttribute('aria-pressed'), 'false');
      assert.deepEqual(serviceState(id), { sending: true, listening: false, broadcast: 'live' });
    });

    check(`${id}: flick is available after registration and during disconnection without auto-start`, () => {
      for (const scenario of ['ready', 'offline']) {
        api.setScenario(scenario);
        const before = serviceState(id);
        swipe(id);
        assert.equal(state(id).screen, 'comments');
        assert.deepEqual(serviceState(id), before);
        swipe(id, { x: 60, endX: 280 });
        assert.equal(state(id).screen, 'camera');
        assert.deepEqual(serviceState(id), before);
      }
    });

    check(`${id}: first launch exposes QR reading and contextual help without starting services`, () => {
      api.setScenario('unregistered');
      assert.equal(phone(id).querySelector('.cm-page-nav'), null);
      assert.equal(phone(id).querySelector('[data-action="send"]'), null);
      assert.equal(phone(id).querySelector('[data-action="obs"]'), null);
      const before = serviceState(id);
      swipe(id);
      assert.equal(state(id).screen, 'camera', 'registration is completed before entering function pages');
      click(id, 'qr-help');
      assert.match(actionRegion(id).textContent, /設定.*スマホ連携/);
      click(id, 'close');
      assert.equal(document.activeElement.dataset.action, 'qr-help');
      click(id, 'qr');
      assert.equal(state(id).sheet, 'qr', 'the primary button opens QR reading directly');
      click(id, 'qr-denied');
      assert.equal(state(id).registered, false);
      assert.deepEqual(serviceState(id), before);
      click(id, 'close');
      assert.ok(phone(id).querySelector('.cm-onboarding [data-action="qr"]'));
      click(id, 'qr');
      click(id, 'qr-success');
      assert.equal(state(id).sheet, null);
      assert.equal(state(id).screen, 'camera');
      assert.equal(phone(id).querySelector('.cm-onboarding'), null);
      assert.ok(button(id, 'send'));
      assert.deepEqual(serviceState(id), { sending: false, listening: false, broadcast: 'stopped' });
    });

    check(`${id}: leaving a screen cancels pending OBS and stale callbacks`, () => {
      click(id, 'obs');
      const staleButton = actionRegion(id).querySelector('[data-action="confirm-obs"]');
      assert.ok(staleButton);
      assert.ok(state(id).pending);
      api.switchScreen(id, 'comments');
      assert.equal(state(id).screen, 'comments');
      assert.equal(state(id).pending, null);
      assert.equal(state(id).sheet, null);
      staleButton.click();
      tick(10000);
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
      api.switchScreen(id, 'camera');
      assert.equal(phone(id).querySelector('[data-action="confirm-obs"]'), null);
    });

    check(`${id}: independent service controls`, () => {
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
      click(id, 'read');
      assert.deepEqual(serviceState(id), { sending: true, listening: false, broadcast: 'live' });
      click(id, 'read');
      click(id, 'mic');
      assert.equal(state(id).micMuted, true);
      click(id, 'video');
      assert.equal(state(id).videoHidden, true);
      click(id, 'preview');
      assert.equal(state(id).previewClosed, true);
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
    });

    check(`${id}: opening settings, diagnostics and comments preserves services`, () => {
      const original = serviceState(id);
      for (const action of ['settings', 'diagnostics', 'connection']) {
        click(id, action);
        assert.ok(state(id).sheet, `${action} opens a sheet`);
        assert.deepEqual(serviceState(id), original);
        click(id, 'close');
        assert.equal(state(id).sheet, null);
        assert.deepEqual(serviceState(id), original);
      }
      click(id, 'screen-comments');
      assert.deepEqual(serviceState(id), original);
      click(id, 'screen-camera');
      assert.deepEqual(serviceState(id), original);
    });

    check(`${id}: send stop requires confirmation and leaves OBS and listening running`, () => {
      click(id, 'send');
      assert.ok(state(id).sheet, 'stop opens a confirmation');
      assert.equal(state(id).sending, true);
      click(id, 'close');
      assert.equal(state(id).sending, true, 'cancellation must not stop the sender');
      click(id, 'send');
      click(id, 'confirm-send-stop');
      assert.deepEqual(serviceState(id), { sending: false, listening: true, broadcast: 'live' });
      click(id, 'send');
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
    });

    check(`${id}: OBS requires confirmation and does not stop sender or listening`, () => {
      click(id, 'obs');
      assert.ok(state(id).pending, 'OBS action has a pending confirmation');
      assert.equal(state(id).broadcast, 'live');
      click(id, 'close');
      assert.equal(state(id).pending, null);
      assert.equal(state(id).broadcast, 'live');
      click(id, 'obs');
      click(id, 'confirm-obs');
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'stopped' });
      click(id, 'obs');
      click(id, 'confirm-obs');
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
    });

    check(`${id}: expired OBS confirmation cannot control broadcast`, () => {
      click(id, 'obs');
      assert.ok(state(id).pending);
      api.expireConfirmation(id);
      assert.equal(state(id).pending, null);
      assert.equal(state(id).broadcast, 'live');
      const remaining = phone(id).querySelector('[data-action="confirm-obs"]');
      if (remaining) remaining.click();
      assert.equal(state(id).broadcast, 'live', 'expired confirmation is not executed');
    });

    check(`${id}: sending protects QR registration and route selection`, () => {
      click(id, 'connection');
      const before = state(id);
      const network = phone(id).querySelector('[data-network="lan"]');
      assert.ok(network, 'LAN route option exists');
      assert.equal(network.disabled, true, 'route changes are disabled while sending');
      network.click();
      assert.equal(state(id).network, before.network);
      const qr = qrButton(id);
      assert.equal(qr.disabled, true, 'QR registration is disabled while sending');
      qr.click();
      assert.equal(state(id).registered, before.registered);
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
    });

    check(`${id}: ready does not auto-start any service`, () => {
      api.setScenario('ready');
      assert.equal(state(id).registered, true);
      assert.equal(state(id).connected, true);
      assert.deepEqual(serviceState(id), { sending: false, listening: false, broadcast: 'stopped' });
      click(id, 'send');
      assert.deepEqual(serviceState(id), { sending: true, listening: false, broadcast: 'stopped' });
    });

    check(`${id}: offline prevents new send and OBS commands`, () => {
      api.setScenario('offline');
      assert.equal(state(id).connected, false);
      assert.equal(state(id).sending, true, 'offline retains the explicit send wish');
      assert.equal(state(id).listening, true, 'offline retains the explicit listening wish');
      assert.equal(state(id).broadcast, 'unknown');
      click(id, 'send');
      click(id, 'confirm-send-stop');
      assert.equal(state(id).sending, false, 'the user can stop while offline');
      const before = serviceState(id);
      click(id, 'send');
      click(id, 'obs');
      assert.deepEqual(serviceState(id), before);
      assert.equal(state(id).pending, null);
    });

    check(`${id}: QR registration is explicit and never auto-starts services`, () => {
      api.setScenario('unregistered');
      assert.equal(state(id).registered, false);
      assert.deepEqual(serviceState(id), { sending: false, listening: false, broadcast: 'unknown' });
      assert.equal(phone(id).querySelector('[data-action="send"]'), null);
      assert.equal(phone(id).querySelector('[data-action="obs"]'), null);
      assert.deepEqual(serviceState(id), { sending: false, listening: false, broadcast: 'unknown' });
      assert.equal(state(id).pending, null);
      qrButton(id).click();
      assert.equal(state(id).registered, false, 'opening the QR reader does not register a PC');
      click(id, 'qr-success');
      assert.equal(state(id).registered, true, 'the explicit QR stub registers the example');
      assert.deepEqual(serviceState(id), { sending: false, listening: false, broadcast: 'stopped' });
    });

    check(`${id}: denied QR camera permission preserves the existing registration`, () => {
      api.setScenario('ready');
      const before = serviceState(id);
      click(id, 'connection');
      qrButton(id).click();
      click(id, 'qr-denied');
      assert.equal(state(id).registered, true);
      assert.equal(state(id).connected, true);
      assert.equal(state(id).network, 'tailscale');
      assert.match(state(id).notice, /権限/);
      assert.deepEqual(serviceState(id), before);
    });

    check(`${id}: updating QR registration preserves active OBS, listening and selected route`, () => {
      click(id, 'send');
      click(id, 'confirm-send-stop');
      click(id, 'connection');
      const lan = actionRegion(id).querySelector('[data-network="lan"]');
      assert.ok(lan);
      assert.equal(lan.disabled, false);
      lan.click();
      assert.equal(state(id).network, 'lan');
      const before = serviceState(id);
      qrButton(id).click();
      click(id, 'qr-success');
      assert.equal(state(id).network, 'lan', 're-registering does not switch a selected registered route');
      assert.deepEqual(serviceState(id), before, 're-registering must not report OBS stopped or change listening');
      assert.equal(state(id).sheet, 'connection');
    });

    check(`${id}: zero microphone gain preserves manual mute state and silences the visible meter`, () => {
      click(id, 'settings');
      changeSetting(id, 'gain', 0);
      assert.equal(state(id).gain, 0);
      assert.equal(state(id).micMuted, false, 'gain zero is distinct from manual mute');
      click(id, 'close');
      if (phone(id).querySelector('[data-action="tray"]')?.getAttribute('aria-expanded') === 'false') click(id, 'tray');
      const meters = phone(id).querySelectorAll('.cm-meter');
      assert.ok(meters.length, 'camera has a visible microphone meter');
      for (const meter of meters) {
        assert.equal(meter.getAttribute('aria-valuenow'), '0');
        assert.equal(meter.querySelector('span').style.width, '0%');
        assert.match(meter.closest('.cm-meter-row').textContent, /音量0%/);
        assert.doesNotMatch(meter.closest('.cm-meter-row').textContent, /マイク入力あり/);
      }
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
    });

    check(`${id}: restarting send resets hidden camera, manual mute, zoom and closed preview`, () => {
      click(id, 'settings');
      changeSetting(id, 'zoom', 2);
      changeSetting(id, 'gain', 150);
      click(id, 'mic');
      click(id, 'video');
      click(id, 'preview');
      click(id, 'close');
      assert.equal(state(id).zoom, 2);
      assert.equal(state(id).micMuted, true);
      assert.equal(state(id).videoHidden, true);
      assert.equal(state(id).previewClosed, true);
      click(id, 'send');
      click(id, 'confirm-send-stop');
      assert.equal(state(id).sending, false);
      const stopped = phone(id).querySelector('.cm-hidden-camera');
      assert.ok(stopped);
      assert.match(stopped.textContent, /まだ送信していません/);
      assert.doesNotMatch(stopped.textContent, /送信は継続|代替映像を送信|カメラ停止中/);
      click(id, 'send');
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
      assert.equal(state(id).videoHidden, false);
      assert.equal(state(id).micMuted, false);
      assert.equal(state(id).zoom, 1);
      assert.equal(state(id).previewClosed, false);
      assert.equal(state(id).gain, 150, 'saved microphone gain is retained');
    });

    check(`${id}: camera hidden state locks zoom and returning the camera resets zoom`, () => {
      click(id, 'settings');
      changeSetting(id, 'zoom', 2.5);
      click(id, 'video');
      const zoom = actionRegion(id).querySelector('[data-setting="zoom"]');
      assert.ok(zoom);
      assert.equal(zoom.disabled, true, 'camera adjustment is unavailable while the camera is stopped');
      zoom.value = '3';
      zoom.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      assert.equal(state(id).zoom, 2.5, 'disabled input must not update the zoom');
      click(id, 'video');
      assert.equal(actionRegion(id).querySelector('[data-setting="zoom"]').disabled, false);
      assert.equal(state(id).zoom, 1, 'returning the camera resets the previous camera adjustment');
      assert.equal(actionRegion(id).querySelector('[data-setting="zoom"]').value, '1');
    });

    check(`${id}: modal traps focus, rejects background actions and closes with Escape`, () => {
      click(id, 'settings');
      const modal = actionRegion(id);
      assert.ok(modal.classList.contains('cm-sheet'));
      assert.ok(modal.contains(document.activeElement), 'opening puts focus inside the dialog');
      assert.equal(phone(id).querySelector('.cm-product-layer').hasAttribute('inert'), true);
      const before = serviceState(id);
      phone(id).querySelector('.cm-product-layer [data-action="screen-comments"]').click();
      assert.deepEqual(serviceState(id), before, 'background UI cannot run through the modal');
      assert.equal(state(id).screen, 'camera', 'background navigation cannot run through the modal');
      const focusable = [...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')];
      const first = focusable[0];
      const last = focusable.at(-1);
      last.focus();
      key(last, 'Tab');
      assert.equal(document.activeElement, first, 'Tab wraps to the first dialog control');
      first.focus();
      key(first, 'Tab', true);
      assert.equal(document.activeElement, last, 'Shift+Tab wraps to the last dialog control');
      key(last, 'Escape');
      assert.equal(state(id).sheet, null);
      assert.equal(phone(id).querySelector('.cm-product-layer').hasAttribute('inert'), false);
      assert.equal(document.activeElement.dataset.action, 'settings', 'closing restores focus to the opening action');
      assert.deepEqual(serviceState(id), before);
    });

    check(`${id}: backdrop and Escape cancel pending OBS without changing broadcast`, () => {
      click(id, 'obs');
      assert.ok(state(id).pending);
      phone(id).querySelector('.cm-sheet-backdrop').click();
      assert.equal(state(id).pending, null);
      assert.equal(state(id).sheet, null);
      assert.equal(state(id).broadcast, 'live');
      click(id, 'obs');
      assert.ok(state(id).pending);
      key(document.activeElement, 'Escape');
      assert.equal(state(id).pending, null);
      assert.equal(state(id).sheet, null);
      assert.deepEqual(serviceState(id), { sending: true, listening: true, broadcast: 'live' });
    });
  }

  check('OBS confirmation expires after ten seconds without service effects', () => {
    click('A', 'obs');
    assert.ok(state('A').pending);
    tick(9999);
    assert.ok(state('A').pending, 'the confirmation remains within its ten-second deadline');
    tick(1);
    assert.equal(state('A').pending, null, 'the confirmation expires at its deadline');
    assert.deepEqual(serviceState('A'), { sending: true, listening: true, broadcast: 'live' });
  });

  check('leaving foreground clears pending OBS confirmation', () => {
    click('A', 'obs');
    assert.ok(state('A').pending);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.equal(state('A').pending, null);
    assert.equal(state('A').broadcast, 'live');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  check('unregistered headers do not claim a prepared PC', () => {
    api.setScenario('unregistered');
    for (const id of designIds) {
      const summary = phone(id).querySelector('.cm-header-title small');
      assert.ok(summary);
      assert.match(summary.textContent, /QR.*登録/);
      assert.doesNotMatch(summary.textContent, /自宅のPC|Tailscale|接続済み|接続待ち/);
    }
  });

  await checkAsync('leaving the design cancels its pending OBS confirmation', async () => {
    for (const id of designIds) {
      const section = phone(id).closest('[data-design]');
      section.hidden = false;
      await Promise.resolve();
      click(id, 'obs');
      assert.ok(state(id).pending);
      const before = serviceState(id);
      section.hidden = true;
      await Promise.resolve();
      assert.equal(state(id).pending, null, `${id}: hidden alternatives cannot retain an OBS confirmation`);
      assert.equal(state(id).sheet, null);
      assert.deepEqual(serviceState(id), before, `${id}: leaving a design does not execute or stop services`);
      const staleConfirmation = phone(id).querySelector('[data-action="confirm-obs"]');
      assert.equal(staleConfirmation, null);
      section.hidden = id !== 'A';
      await Promise.resolve();
    }
  });

  check('no external I/O, DOM duplication or script errors', () => {
    assert.deepEqual(networkCalls, [], 'UI prototype must not invoke network APIs');
    assert.equal(document.querySelectorAll('script[src],iframe,form').length, 0);
    assertUniqueIds();
    assert.deepEqual(errors, [], 'all inline scripts execute without errors');
  });
  process.stdout.write(`Android swipe UI prototype: ${checks} checks passed.\n`);
} finally {
  dom.window.close();
}
