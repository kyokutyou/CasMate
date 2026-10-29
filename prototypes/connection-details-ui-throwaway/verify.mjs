// Behavior checks of the comparison only, with no external connections.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ESLint } from 'eslint';

const fragment = readFileSync(new URL('./fragment.html', import.meta.url), 'utf8');
const timers = new Map(); let nextTimer = 0; const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', e => errors.push(e.message));
const dom = new JSDOM(fragment, { runScripts: 'dangerously', url: 'http://localhost/', virtualConsole,
  beforeParse(w) {
    w.structuredClone = structuredClone;
    w.setTimeout = (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; };
    w.clearTimeout = id => timers.delete(id);
    w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
    w.HTMLDialogElement.prototype.close = function() { this.open = false; };
  },
});
const d = dom.window.document;
const get = s => { const el = d.querySelector(s); assert.ok(el, s); return el; };
const state = () => JSON.parse(get('#cd-payload').textContent);
const click = s => get(s).click();
const scope = v => `[data-key=${v}]`;
function set(s, value, type = 'input') { const el = get(s); el.value = value; el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
function flush(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } }

assert.deepEqual(errors, [], 'first render succeeds');
assert.equal(d.querySelectorAll('.viz-carousel > [data-variant]').length, 4);
assert.equal(d.querySelectorAll('[id]').length, new Set([...d.querySelectorAll('[id]')].map(el => el.id)).size);
const input = `${scope('A')} [data-setting=statusPort]`;
set(input, '45001'); get(input).focus(); flush(500);
assert.equal(state().saved.ports.direct, '45001');
assert.equal(d.activeElement, get(input), 'successful save preserves input node and focus');
for (const v of ['B', 'C', 'D']) assert.equal(get(`${scope(v)} [data-setting=statusPort]`).value, '45001');
assert.equal(get('.cd-toast').hidden, false); flush(4000); assert.equal(get('.cd-toast').hidden, true);
set(input, '2'); flush(500); assert.equal(state().saved.ports.direct, '45001'); assert.equal(state().invalid, true);
set(input, '4455'); assert.equal(state().invalid, true);
set(input, '45002'); flush(500); assert.equal(state().saved.ports.direct, '45002');
click(`${scope('A')} [data-action="network:lan"]`);
assert.equal(state().settings.active, 'direct', 'view selection must not change active network');
assert.equal(get(`${scope('A')} [data-direct]`).hidden, true);
set(input, '3101'); flush(500); assert.equal(state().saved.ports.lan, '3101');
click(`${scope('A')} [data-action="network:direct"]`); assert.equal(get(input).value, '45002');

click(`${scope('A')} [data-action="mode-auto"]`); flush(500);
assert.equal(get(`${scope('A')} [data-manual]`).hidden, true);
click(`${scope('A')} [data-action="mode-manual"]`); flush(500);
set(`${scope('A')} [data-setting="address:phone:0"]`, '203.0.113.99'); flush(500);
assert.equal(state().confirmed.phone, false, 'editing candidate invalidates manual confirmation');
click(`${scope('A')} [data-action="confirm:phone"]`); assert.equal(state().confirmed.phone, true);
click(`${scope('A')} [data-action="add:A"]`); flush(500);
assert.equal(state().settings.endpoints.tcp.length, 2);
for (const v of ['A', 'B', 'C', 'D']) assert.equal(get(`${scope(v)} [data-setting="family:tcp:1"]`).value, 'ipv6');
click(`${scope('A')} [data-action="remove:tcp:1"]`); flush(500); assert.equal(state().settings.endpoints.tcp.length, 1);

set('#cd-scenario', 'udp-error', 'change');
assert.equal(get(`${scope('A')} [data-status="phone:listener"]`).textContent, '準備失敗');
assert.equal(get(`${scope('A')} [data-status="spare:listener"]`).textContent, '準備済み');
assert.equal(get(`${scope('A')} [data-status="tcp:listener"]`).textContent, '準備済み');
click(`${scope('A')} [data-action=retry]`); assert.equal(state().busy, true); flush(700);
assert.equal(state().scenario, 'udp-error', 'retry does not invent a successful connection');
set('#cd-scenario', 'ready', 'change');
assert.equal(get(`${scope('A')} [data-status="tcp:external"]`).textContent, '未確認');
set('#cd-scenario', 'save-error', 'change'); set(input, '45003'); flush(500);
assert.equal(state().settings.ports.direct, '45003'); assert.equal(state().saved.ports.direct, '45002');
assert.match(state().error, /保存できません/);
assert.equal(get(`${scope('A')} [data-confirm-button=tcp]`).disabled, true);
set('#cd-scenario', 'ready', 'change'); set(input, '45004'); flush(500); assert.equal(state().saved.ports.direct, '45004');
for (const scenario of ['receiving', 'unsupported', 'residual', 'empty']) { set('#cd-scenario', scenario, 'change'); assert.equal(state().scenario, scenario); }
assert.equal(get(`${scope('A')} [data-status-row=phone]`).hidden, true);
set('#cd-scenario', 'ready', 'change');
click(`${scope('B')} [data-action="tab:B:pc"]`); assert.equal(get('[data-tab-panel="B:pc"]').hidden, false);
click(`${scope('B')} [data-action="tab:B:router"]`); assert.equal(get('[data-tab-panel="B:router"]').hidden, false);
click(`${scope('C')} [data-action="tab:C:pc"]`); assert.equal(get('[data-tab-panel="C:pc"]').hidden, false);
assert.equal(get(`${scope('A')} [data-key]`).disabled, true);
click(`${scope('A')} [data-action=active]`); flush(500); assert.equal(state().settings.active, null);
assert.equal(get(`${scope('A')} [data-key]`).disabled, false);
click(`${scope('A')} [data-key]`); assert.equal(get(`${scope('A')} dialog`).open, true);
assert.equal(state().keyGeneration, 1, 'confirmation is required');
click(`${scope('A')} [data-action=accept-dialog]`); assert.equal(state().keyGeneration, 2);

assert.deepEqual(errors, []);
assert.doesNotMatch(fragment, /\bfetch\s*\(|new\s+(?:XMLHttpRequest|WebSocket)|localStorage|sessionStorage/u);
const script = fragment.match(/<script>([\s\S]*?)<\/script>/u)[1];
const result = await new ESLint().lintText(script, { filePath: 'prototypes/connection-details-ui-throwaway/inline.mjs' });
assert.equal(result[0].errorCount, 0, JSON.stringify(result[0].messages));
process.stdout.write('PASS: 4 variants; retained inputs and active network; autosave, error, local candidates, isolated statuses, confirmation, focus, notification lifetime; inline script lint.\n');
dom.window.close();
