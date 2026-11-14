import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

app.disableHardwareAcceleration(); app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
const window = new BrowserWindow({ show: false, width: 1200, height: 820, useContentSize: true, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
window.setMenuBarVisibility(false);
const evaluate = code => window.webContents.executeJavaScript(code, true);
const frames = () => evaluate("new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Two rendered frames timed out')),3000);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}));})");
const wait = async code => { const end = Date.now() + 5000; while (!await evaluate(code)) { if (Date.now() > end) throw new Error(`Timed out: ${code}; ${JSON.stringify(await evaluate('({width:innerWidth,height:innerHeight})'))}; native=${JSON.stringify(window.getContentSize())}`); await new Promise(resolve => setTimeout(resolve, 25)); } await frames(); };
const resize = async (width, height) => { window.setContentSize(width, height); await wait(`innerWidth===${width} && innerHeight===${height}`); };
const capture = async name => { if (!process.argv[4]) return; await mkdir(process.argv[4], { recursive: true }); await writeFile(join(process.argv[4], name), (await window.webContents.capturePage()).toPNG()); };
try {
  await window.loadURL(pathToFileURL(process.argv[2]).href);
  await evaluate("document.querySelector('[data-page=settings]').click();document.getElementById('settings-listenerPoll').click()");
  await wait("document.querySelector('.listener-poll-panel input[aria-label=\"リスナー用URL\"]').value.includes('srv.us')");
  let checks = 0;
  const focused = process.argv.includes('--feedback-only');
  for (const theme of focused ? ['ocean'] : ['ocean', 'midnight', 'graphite', 'burgundy', 'pearl', 'ivory', 'sakura', 'lavender']) for (const text of focused ? ['medium'] : ['small', 'medium', 'large']) for (const [width, height] of focused ? [[760,760]] : [[320,760],[560,760],[760,560],[1200,820]]) {
    await evaluate(`window.pollLayoutHarness.update(${JSON.stringify(theme)},${JSON.stringify(text)})`); await resize(width, height);
    const overflow = await evaluate(`(() => { const p=document.querySelector('.listener-poll-panel');return {page:document.documentElement.scrollWidth>innerWidth,panel:p.scrollWidth>p.clientWidth+1,controls:[...p.querySelectorAll('input,textarea,button,fieldset')].filter(n=>n.checkVisibility()).some(n=>n.getBoundingClientRect().right>innerWidth+1)};})()`);
    assert.deepEqual(overflow, { page: false, panel: false, controls: false }, `${theme}/${text}/${width}`); checks++; if(checks%12===0) console.log(`Layout checks ${checks}/96`);
    if (theme === 'ocean' && text === 'medium' && width === 1200) await capture('management-dark.png');
    if (theme === 'pearl' && text === 'large' && width === 320) await capture('management-light-mobile.png');
  }
  await resize(760,760); await evaluate("window.pollLayoutHarness.update('ocean','medium')"); await frames();
  await evaluate(`window.copyOutcome='success';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(){return new Promise((resolve,reject)=>{window.finishCopy=()=>window.copyOutcome==='success'?resolve():reject(new Error('failure'));});}}});window.copyButton=[...document.querySelectorAll('.listener-poll-panel button')].find(b=>b.textContent==='投票URLをコピー');window.copyButton.focus();document.querySelector('.management-body').scrollTop=90`);
  const geometry = `(() => {const p=document.querySelector('.listener-poll-panel'),body=document.querySelector('.management-body');return {controls:[...p.querySelectorAll('button,input,textarea')].map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}),height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement.textContent};})()`;
  for (const outcome of ['success','failure']) {
    await evaluate(`window.copyOutcome=${JSON.stringify(outcome)};window.pollLayoutHarness.clear()`); await frames();
    const before = await evaluate(geometry); await evaluate('window.copyButton.click()'); await frames(); assert.deepEqual(await evaluate(geometry), before, 'pending copy geometry');
    await evaluate('window.finishCopy()'); await frames(); assert.deepEqual(await evaluate(geometry), before, `${outcome} geometry`);
    await evaluate('window.pollLayoutHarness.clear()'); await frames(); assert.deepEqual(await evaluate(geometry), before, 'notice removal geometry');
  }
  await evaluate("window.pollLayoutHarness.mode('listener')"); await resize(320,760); await wait("document.querySelector('.poll-listener .poll-options button') && !document.querySelector('.poll-options button').disabled");
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false); await capture('listener-mobile.png');
  await evaluate("window.pollLayoutHarness.mode('overlay')"); await resize(960,600); await wait("Boolean(document.querySelector('.poll-overlay .poll-options'))");
  assert.equal(await evaluate('document.body.style.background'), 'transparent'); await capture('obs-poll.png');
  console.log(`PASS: ${checks} management layouts, copy pending/success/failure geometry, listener and OBS rendering`);
  window.destroy(); app.exit(0);
} catch (error) { console.error(error); if(process.argv[4]) { await mkdir(process.argv[4],{recursive:true}); await writeFile(join(process.argv[4],'failure.txt'),String(error.stack)); } window.destroy(); app.exit(1); }

});
