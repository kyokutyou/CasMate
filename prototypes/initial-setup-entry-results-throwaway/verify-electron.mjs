import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
app.disableHardwareAcceleration();
app.setPath('userData',join(process.argv[2],'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show:false, width:1040, height:820, webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
  window.setMenuBarVisibility(false);
  const errors = [], apiCalls = [];
  window.webContents.on('console-message',(_event,level,message) => { if(level===3)errors.push(message); });
  window.webContents.session.webRequest.onBeforeRequest((details,callback) => { if(new URL(details.url).pathname.startsWith('/api/')) { apiCalls.push(details.url);callback({cancel:true}); } else callback({}); });
  const evaluate = code => window.webContents.executeJavaScript(code);
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve, 60))');
  const click = async selector => { await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n || n.disabled || !n.checkVisibility())throw Error('Unavailable '+${JSON.stringify(selector)});n.click();})()`);await settle(); };
  const textClick = async text => { await evaluate(`(()=>{const n=[...document.querySelectorAll('button')].find(n=>n.checkVisibility()&&n.textContent.trim()===${JSON.stringify(text)});if(!n || n.disabled)throw Error('Unavailable '+${JSON.stringify(text)});n.click();})()`);await settle(); };
  const capture = async name => { await settle();await writeFile(join(process.argv[3],name+'.png'),(await window.webContents.capturePage()).toPNG()); };
  const open = async (variant,screen,example='mixed') => { await window.loadURL(`http://127.0.0.1:5232/?variant=${variant}&screen=${screen}&example=${example}`);await settle();assert.equal(await evaluate('!!document.querySelector("h1")'),true); };
  const state = async () => { await click('.state-button'); const value=await evaluate('JSON.parse(document.querySelector("dialog pre").textContent)');await click('dialog [aria-label="閉じる"]');return value; };
  const example = async value => { await click('.state-button');await evaluate(`(()=>{const n=document.querySelector('dialog select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();await click('dialog [aria-label="閉じる"]'); };
  try {
    let layouts=0;
    for(const width of [1040,760,560,320])for(const variant of ['A','B','C'])for(const screen of ['welcome','features','results']) {
      window.setContentSize(width,width===760?560:760);await open(variant,screen);
      const layout=await evaluate(`(()=>{const r=n=>n.getBoundingClientRect(),main=r(document.querySelector('.page-scroll')),action=r(document.querySelector('.action-bar')),compare=r(document.querySelector('.comparison'));return {overflow:document.documentElement.scrollWidth>innerWidth+1 || document.querySelector('.page-scroll').scrollWidth>document.querySelector('.page-scroll').clientWidth+1,clipped:[...document.querySelectorAll('button,input,select,.feature-choice')].filter(n=>n.checkVisibility()&&!n.closest('dialog')).filter(n=>{const b=r(n);return b.left<0||b.right>innerWidth+1}).map(n=>n.textContent||n.dataset.feature),overlap:main.bottom>action.top+1||action.bottom>compare.top+1,footer:compare.bottom<=innerHeight+1,usable:main.height>=60};})()`);
      assert.equal(layout.overflow,false,`${width}/${variant}/${screen}: horizontal overflow`);assert.deepEqual(layout.clipped,[],`${width}/${variant}/${screen}: clipped controls`);assert.equal(layout.overlap,false,'footer overlap');assert.equal(layout.footer,true,'comparison fits');assert.equal(layout.usable,true,'scroll area remains usable');
      await click('.theme');assert.equal(await evaluate('document.querySelector(".prototype").dataset.theme'),'light');await click('.theme');
      if(width===1040||width===320)await capture(`${variant}-${screen}-${width}`);
      layouts++;
    }
    window.setContentSize(1040,800);
    for(const variant of ['A','B','C']) {
      await open(variant,'welcome');await click('.next');
      assert.equal((await state()).selected.length,0,'selection starts empty');
      for(const id of ['sources','commentSpeech','commentOverlay'])await click(`[data-feature=${id}]`);
      if(variant==='B')await click('.next');
      await click('.next');assert.equal(await evaluate('document.querySelector("dialog").open'),true);
      await textClick('確認結果の見本を見る →');
      assert.equal((await state()).screen,'results');
      await click('[data-review=commentSpeech]');await textClick('確認結果へ戻る');
      assert.equal(await evaluate('document.activeElement.dataset.review'),'commentSpeech','return focus to result entry');
      await click('.next');assert.equal(await evaluate('document.querySelector(".prototype").dataset.finished'),'true');
    }
    await open('C','features');
    await click('[data-feature=commentOverlay]');await click('[data-feature=aiListener]');await click('[data-feature=smartphone]');
    await evaluate("document.querySelector('.phone-uses input').click()");await settle();
    assert.equal(await evaluate('document.querySelector(".next").disabled'),true,'phone requires a use');
    await evaluate("document.querySelectorAll('.phone-uses input')[2].click()");await settle();
    let model=await state();assert.equal(model.steps.filter(step=>step==='obsControl').length,1,'one common OBS prerequisite');assert.equal(model.steps.filter(step=>step==='sources').length,1,'one source prerequisite');
    await click('[data-variant-button=A]');model=await state();assert.deepEqual(model.selected,['commentOverlay','aiListener','smartphone'],'variant switch retains choices');
    await evaluate("document.querySelector('[data-feature=sources]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");await settle();assert.equal(await evaluate('document.querySelector(".prototype").dataset.variant'),'A','input arrows do not switch variants');
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");await settle();assert.equal(await evaluate('document.querySelector(".prototype").dataset.variant'),'B');
    await open('B','results','attention');assert.equal(await evaluate('document.querySelector("[data-priority]").dataset.priority'),'commentSpeech','attention has the primary action');await capture('B-results-attention');
    await example('ready');assert.equal(await evaluate("[...document.querySelectorAll('.record-badge')].every(n=>n.dataset.record==='confirmed')"),true);await capture('B-results-ready');
    await example('empty');assert.equal(await evaluate('!!document.querySelector(".empty-result")'),true);await capture('B-results-empty');
    await open('A','features');await click('.skip');assert.equal(await evaluate('!!document.querySelector(".empty-result")'),true);
    assert.deepEqual(errors,[],'no runtime errors');assert.deepEqual(apiCalls,[],'no product API calls');
    console.log(`PASS: ${layouts} layouts, both themes, three simulated flows, selection retention, dependencies, keyboard, result states, return focus, no API calls`);
  }catch(error){console.error(error);process.exitCode=1;}finally{window.destroy();app.exit(process.exitCode??0);}
});
