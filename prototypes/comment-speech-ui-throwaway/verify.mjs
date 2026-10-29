// Bounded interaction checks for a throwaway prototype, not production tests.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';

const source = readFileSync(new URL('./fragment.html', import.meta.url), 'utf8');
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error));
const dom = new JSDOM(source, { runScripts: 'dangerously', url: 'http://localhost/fragment.html', virtualConsole });
const document = dom.window.document;
const get = selector => { const element = document.querySelector(selector); assert.ok(element, selector); return element; };
const click = selector => get(selector).click();
const state = () => JSON.parse(get('#cs-payload').textContent);
const change = (selector, value) => {
  const element = get(selector);
  element.value = value;
  element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

assert.equal(state().variant, 'D');
assert.equal(document.querySelectorAll('.cs-channel').length, 4);
assert.equal(document.querySelector('[data-open="d-content"]'), null);
assert.equal(get('#cs-readAuthor').closest('details'), null);
assert.equal(get('[data-action="engine"]').closest('details'), null);
const volume = get('#cs-volume');
volume.value = '1.3';
volume.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.equal(get('#cs-num-volume').value, '1.3');
click('#cs-readAuthor');
assert.equal(state().readAuthor, true);

for (const variant of ['A', 'B', 'C', 'D', 'E']) {
  click(`[data-variant="${variant}"]`);
  assert.equal(state().variant, variant);
  assert.match(get('h1').textContent, /コメント読み上げ/);
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
}
click('[data-variant="A"]');
change('#cs-speed', '1.4');
change('#cs-speaker', '四国めたん');
change('#cs-maxLength', '250');
click('[data-variant="B"]');
assert.equal(get('#cs-speed').value, '1.4');
assert.equal(get('#cs-speaker').value, '四国めたん');
click('[data-tab="content"]');
assert.equal(get('#cs-maxLength').value, '250');
change('#cs-maxLength', '600');
assert.equal(state().maxLength, 250);
assert.match(get('#cs-notice').textContent, /50〜500/);
click('[data-page="home"]');
click('[data-action="open-editor"]');
assert.equal(state().speed, 1.4);
assert.match(get('.cs-back').textContent, /ホームに戻る/);
change('#cs-scenario', 'off');
click('[data-tab="voice"]');
assert.equal(get('[data-action="preview"]').disabled, false);
click('[data-action="preview"]');
assert.equal(state().enabled, false);
assert.match(get('#cs-notice').textContent, /音は出ません/);
for (const scenario of ['starting', 'missing', 'voice', 'save-error']) {
  change('#cs-scenario', scenario);
  assert.ok(document.querySelector('.cs-alert:not([hidden])'));
  if (scenario === 'voice') assert.equal(get('[data-action="preview"]').disabled, true);
}
click('[data-action="retry"]');
assert.equal(state().saved, true);
click('[data-variant="E"]');
click('[data-step="1"]');
assert.ok(document.querySelector('#cs-speaker'));
click('[data-step="2"]');
assert.ok(document.querySelector('#cs-maxLength'));
assert.deepEqual(errors, []);
console.log('PASS: 5 variants, shared values, bounds, navigation, preview isolation, 6 scenarios, recovery, steps');
dom.window.close();
