import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[2], 'profile'));
app.whenReady().then(async () => {
const window = new BrowserWindow({ show: false, width: 1040, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
const errors = [];
window.webContents.on('console-message', (_, details) => { if (details.level === 'error') errors.push(details.message); });
const evaluate = script => window.webContents.executeJavaScript(script, true);
const settle = () => new Promise(resolve => setTimeout(resolve, 100));
const click = async selector => { await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw Error('Unavailable '+${JSON.stringify(selector)});n.click();})()`); await settle(); };
const select = async (selector, value) => { await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('change',{bubbles:true}));})()`); await settle(); };
const open = async (variant, screen) => { await window.loadURL(`http://127.0.0.1:5233/?variant=${variant}&screen=${screen}`); await settle(); assert.ok(await evaluate('!!document.querySelector("h1")')); };
const capture = async name => { await settle(); await writeFile(join(process.argv[2], `${name}.png`), (await window.webContents.capturePage()).toPNG()); };
try {
  let layouts = 0;
  for (const width of [1040, 760, 560, 420, 320]) for (const variant of ['A', 'B', 'C']) for (const screen of ['phone', 'recognition']) {
    window.setContentSize(width, 800); await open(variant, screen);
    const layout = await evaluate(`(()=>{const main=document.querySelector('.page-scroll'),r=n=>n.getBoundingClientRect(),a=r(document.querySelector('.action-bar')),c=r(document.querySelector('.comparison'));return {overflow:document.documentElement.scrollWidth>innerWidth+1||main.scrollWidth>main.clientWidth+1,clipped:[...document.querySelectorAll('button,input,select')].filter(n=>n.checkVisibility()&&!n.closest('dialog')).filter(n=>r(n).left<0||r(n).right>innerWidth+1).map(n=>n.textContent),overlap:r(main).bottom>a.top+1||a.bottom>c.top+1,usable:r(main).height>80,footer:c.bottom<=innerHeight+1};})()`);
    assert.deepEqual(layout, { overflow: false, clipped: [], overlap: false, usable: true, footer: true }, `${width}/${variant}/${screen}`);
    if (width === 1040 || width === 320) await capture(`${variant}-${screen}-${width}`);
    await click('.theme'); assert.equal(await evaluate('document.querySelector(".prototype").dataset.theme'), 'light');
    if (width === 1040 && variant === 'C') await capture(`C-${screen}-light`);
    layouts++;
  }
  window.setContentSize(1040, 800);
  for (const variant of ['A', 'B', 'C']) {
    await open(variant, 'phone');
    const stage = async index => { if (variant === 'B') await click(`.wizard-nav button:nth-child(${index + 1})`); if (variant === 'C') await click(`.readiness-nav button:nth-child(${index + 1})`); };
    assert.equal(await evaluate('document.querySelector(".next").disabled'), true);
    await stage(1); await click('[data-action=prepare]');
    await stage(2); await click('[data-action=qr]'); await click('[data-action=register]');
    assert.equal(await evaluate('document.querySelector(".next").disabled'), true, 'Registration does not confirm connection');
    await stage(3); await click('[data-action=connect]'); await click('[data-action=phone-check]');
    await click('.next'); assert.equal(await evaluate('document.querySelector(".prototype").dataset.screen'), 'recognition');
    await stage(0); await click('[data-action=model]');
    await stage(1); await click('[data-action=apply]');
    await select('[data-field=input]', 'phone');
    await stage(2); assert.equal(await evaluate('document.querySelector("[data-action=preview]").disabled'), true, 'Changing input does not apply it');
    await stage(1); assert.equal(await evaluate('document.querySelector("[data-action=apply]").disabled'), true, 'Phone input needs audio sending');
    await click('[data-action=audio-send]'); await click('[data-action=apply]');
    await stage(2); await click('[data-action=preview]');
    assert.equal(await evaluate('document.querySelector(".transcript p").textContent'), '今日はよろしくお願いします。');
    await stage(3); assert.equal(await evaluate('document.querySelector("[data-action=enable]").checked'), false, 'Preview leaves auto recognition off');
    await click('[data-action=recognition-check]'); await capture(`${variant}-recognition-confirmed`);
    await click('.state-button'); const state = await evaluate('JSON.parse(document.querySelector("dialog pre").textContent)');
    assert.equal(state.phone.connected, true); assert.equal(state.recognition.checked, true); await click('dialog [aria-label="閉じる"]');
    await click('.next'); assert.equal(await evaluate('document.querySelector("dialog").open'), true); await click('dialog [aria-label="閉じる"]');
  }
  await open('A', 'recognition'); await click('[data-action=model]'); await click('[data-action=apply]');
  await evaluate("document.querySelector('[data-field=input]').focus()");
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
  assert.equal(await evaluate('document.querySelector(".prototype").dataset.variant'), 'A');
  await evaluate("document.activeElement.blur();window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))"); await settle();
  assert.equal(await evaluate('document.querySelector(".prototype").dataset.variant'), 'B');
  await click('.state-button'); await select('[data-field=scenario]', 'error'); await click('dialog [aria-label="閉じる"]');
  await click('.wizard-nav button:nth-child(3)'); assert.ok(await evaluate('document.querySelector(".warning").textContent.includes("マイク許可")')); await capture('B-input-error');
  assert.deepEqual(errors, []);
  console.log(`PASS: ${layouts} layouts, both themes, three complete flows, unapplied inputs, registration/connection separation, keyboard, state scenarios.`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { window.destroy(); app.quit(); }
});
