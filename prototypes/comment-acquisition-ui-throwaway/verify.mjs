// Bounded behavior checks for the disposable mockup. No external connections.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ESLint } from 'eslint';

const fragment = readFileSync(new URL('./fragment.html', import.meta.url), 'utf8');
const errors = [];
const console = new VirtualConsole();
console.on('jsdomError', error => errors.push(error));
const timers = new Map();
let nextTimer = 0;
const dom = new JSDOM(fragment, {
  url: 'http://localhost/?variant=A', runScripts: 'dangerously', virtualConsole: console,
  beforeParse(window) {
    window.setTimeout = (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; };
    window.clearTimeout = id => timers.delete(id);
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  },
});
const d = dom.window.document;
const get = s => { const el = d.querySelector(s); assert.ok(el, s); return el; };
const click = s => get(s).click();
const state = () => JSON.parse(get('#ca-payload').textContent);
const runTimers = ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } };
function input(selector, value) { const el = get(selector); el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }
function scenario(value) { const el = get('#ca-scenario'); el.value = value; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }

for (const v of ['A', 'B', 'C']) {
  click(`[data-variant=${v}]`);
  assert.equal(state().variant, v);
  assert.equal(new URL(dom.window.location.href).searchParams.get('variant'), v);
  assert.match(get('h1').textContent, /コメント取得/);
  const ids = [...d.querySelectorAll('[id]')].map(el => el.id);
  assert.equal(ids.length, new Set(ids).size);
}
click('[data-variant=A]');
input('#ca-target-youtube', '@new_channel');
get('#ca-target-youtube').focus();
runTimers(500);
assert.equal(d.activeElement.id, 'ca-target-youtube', 'save must not replace or steal input focus');
runTimers(650);
assert.equal(state().sources.youtube.status, 'waiting');
assert.equal(state().sources.twitch.status, 'connected');
click('[data-variant=B]');
assert.equal(get('#ca-target-youtube').value, '@new_channel');
click('[data-source=shitaraba]');
input('#ca-interval', '2'); runTimers(500);
assert.equal(state().savedInterval, 5);
assert.match(state().intervalError, /3〜60/);
input('#ca-interval', '8'); runTimers(500);
assert.equal(state().savedInterval, 8);
click('[data-variant=C]');
assert.equal(get('#ca-target-youtube').value, '@new_channel');
click('[data-step="1"]'); click('#ca-auto');
assert.equal(state().autoConnect, true);
click('[data-step="2"]'); click('[data-action=stop-all]');
assert.equal(state().sources.youtube.enabled, true, 'bulk stop keeps enabled sources');
assert.equal(state().sources.youtube.status, 'stopped');
click('[data-action=start-all]'); runTimers(650);
assert.equal(state().sources.youtube.status, 'waiting');
assert.equal(state().sources.shitaraba.status, 'stopped', 'bulk start respects disabled source');

click('[data-variant=A]'); scenario('error');
click('[data-action=start-all]'); runTimers(650);
assert.equal(state().sources.shitaraba.status, 'error');
assert.equal(state().sources.twitch.status, 'connected', 'invalid source does not stop others');
click('[data-toggle=shitaraba]');
assert.equal(state().sources.shitaraba.enabled, false, 'error-on can stop with one toggle');
scenario('empty'); click('[data-toggle=youtube]');
assert.equal(state().sources.youtube.enabled, false);
assert.equal(get('[data-toggle=youtube]').checked, false);
assert.match(get('#ca-help-youtube').textContent, /入力/);
input('#ca-target-youtube', '@new_channel'); runTimers(500);
click('[data-toggle=youtube]'); runTimers(650);
assert.equal(state().sources.youtube.status, 'waiting');
assert.equal(get('[data-toggle=youtube]').checked, true);
get('#ca-target-youtube').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
assert.equal(state().variant, 'A', 'arrows inside input must not switch variants');

scenario('save-error'); input('#ca-target-twitch', 'new_channel'); runTimers(500);
assert.equal(state().sources.twitch.target, 'new_channel');
assert.equal(state().sources.twitch.savedTarget, 'casmate_live');
click('[data-action=warnings]');
assert.equal(get('#ca-warning-dialog').open, true);
click('[data-warning-target=save]'); runTimers(650);
assert.equal(state().sources.twitch.savedTarget, 'new_channel');
assert.equal(state().saveFailure, false);
scenario('error'); click('[data-action=warnings]'); click('[data-warning-target=shitaraba]');
assert.equal(d.activeElement.id, 'ca-target-shitaraba');
assert.equal(state().sources.shitaraba.status, 'error', 'warning navigation must not reconnect');
click('[data-page=home]'); click('[data-edit=twitch]');
assert.equal(state().origin, 'home');
assert.match(get('.ca-back').textContent, /ホームに戻る/);
assert.equal(d.activeElement.id, 'ca-target-twitch');

for (const s of ['normal','empty','connecting','reconnecting','error','save-error']) {
  scenario(s);
  assert.equal(state().scenario, s);
}
scenario('normal'); click('#ca-auto');
assert.equal(get('#ca-toast').hidden, false); runTimers(4000);
assert.equal(get('#ca-toast').hidden, true);
assert.deepEqual(errors, []);
assert.doesNotMatch(fragment, /\bfetch\s*\(|new\s+(?:WebSocket|XMLHttpRequest)|localStorage|sessionStorage/);
const script = fragment.match(/<script>([\s\S]*?)<\/script>/)[1];
const lint = await new ESLint().lintText(script, { filePath: 'prototypes/comment-acquisition-ui-throwaway/inline.mjs' });
assert.equal(lint[0].errorCount, 0, JSON.stringify(lint[0].messages));
process.stdout.write('PASS: 3 variants, retained drafts, 6 scenarios, input validation, source isolation, bulk actions, recovery, focus, toast lifetime, inline-script lint.\n');
dom.window.close();
