import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const fragmentPath = fileURLToPath(new URL('./fragment.html', import.meta.url));
const fragment = await readFile(fragmentPath, 'utf8');
const errors = [];
const networkCalls = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error));
let now = 0;
let nextTimer = 1;
const timers = new Map();
const dom = new JSDOM(`<!doctype html><html lang="ja"><body>${fragment}</body></html>`, {
  url: 'http://127.0.0.1:5208/',
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
    window.openai = { widgetState: null, setWidgetState: () => Promise.resolve() };
  },
});

const { document } = dom.window;
const api = dom.window.casmatePrototype;
assert.ok(api, 'The comparison must expose its local test interface.');
assert.equal(typeof api.getState, 'function');
assert.equal(typeof api.setScenario, 'function');
assert.equal(typeof api.expireConfirmation, 'function');

const designIds = ['A', 'B', 'C', 'D'];
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
  if (!element && ['send', 'obs', 'mic', 'video'].includes(action)) {
    click(id, 'controls');
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
  check('four named alternatives and unique DOM IDs', () => {
    const sections = [...document.querySelectorAll('.viz-carousel > [data-variant]')];
    assert.deepEqual(sections.map(section => section.dataset.design), designIds);
    assert.equal(new Set(sections.map(section => section.dataset.variant)).size, 4);
    assertUniqueIds();
  });

  for (const id of designIds) {
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
      if (phone(id).querySelector('[data-action="comments"]')) {
        click(id, 'comments');
        assert.deepEqual(serviceState(id), original);
        click(id, 'main');
        assert.deepEqual(serviceState(id), original);
      }
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
      click(id, 'send');
      click(id, 'obs');
      assert.deepEqual(serviceState(id), { sending: false, listening: false, broadcast: 'unknown' });
      assert.equal(state(id).pending, null);
      click(id, 'connection');
      const direct = phone(id).querySelector('[data-network="direct"]');
      assert.ok(direct, 'direct route option exists');
      assert.equal(direct.disabled, true, 'unregistered route must not become selectable');
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
      if (id === 'C') click(id, 'camera');
      for (const meter of phone(id).querySelectorAll('.cm-meter')) {
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
      if (id !== 'D') {
        if (id === 'C') click(id, 'camera');
        const stopped = phone(id).querySelector('.cm-hidden-camera');
        assert.ok(stopped);
        assert.match(stopped.textContent, /まだ送信していません/);
        assert.doesNotMatch(stopped.textContent, /送信は継続|代替映像を送信|カメラ停止中/);
      }
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
      phone(id).querySelector('.cm-product-layer [data-action="read"]').click();
      assert.deepEqual(serviceState(id), before, 'background UI cannot run through the modal');
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

  check('alternative interactions do not change another design', () => {
    const otherStates = designIds.slice(1).map(state);
    click('A', 'mic');
    click('A', 'video');
    click('A', 'read');
    click('A', 'obs');
    assert.deepEqual(designIds.slice(1).map(state), otherStates);
  });

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

  check('unregistered headers and disconnected guide do not claim a prepared PC', () => {
    api.setScenario('unregistered');
    for (const id of ['A', 'B', 'C']) {
      const summary = phone(id).querySelector('.cm-header-title small');
      assert.ok(summary);
      assert.match(summary.textContent, /QR.*登録/);
      assert.doesNotMatch(summary.textContent, /自宅のPC|Tailscale|接続済み|接続待ち/);
    }
    for (const scenario of ['running', 'offline']) {
      api.setScenario(scenario);
      const heading = phone('D').querySelector('.cm-guide-heading h1');
      assert.ok(heading);
      assert.doesNotMatch(heading.textContent, /準備.*でき|準備完了|接続済み/);
    }
  });

  await checkAsync('leaving a carousel design cancels its pending OBS confirmation', async () => {
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
  process.stdout.write(`Android UI prototype: ${checks} checks passed.\n`);
} finally {
  dom.window.close();
}
