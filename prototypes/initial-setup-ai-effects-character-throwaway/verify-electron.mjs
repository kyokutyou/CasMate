import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
app.disableHardwareAcceleration();
app.setPath('userData',join(process.argv[2],'profile'));
app.whenReady().then(async () => {
 const window = new BrowserWindow({show:false,width:1040,height:800,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 window.setMenuBarVisibility(false);
 window.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
 const external = [];
 window.webContents.session.webRequest.onBeforeRequest((details,callback) => {const denied = /^https?:/.test(details.url) && !details.url.startsWith('http://127.0.0.1:5234/'); if(denied)external.push(details.url);callback({cancel:denied});});
 const evaluate = code => window.webContents.executeJavaScript(code,true);
 const settle = () => new Promise(resolve => setTimeout(resolve,120));
 const clickText = async text => {await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(n=>n.checkVisibility()&&n.textContent===${JSON.stringify(text)});if(!button||button.disabled)throw Error('Unavailable button: '+${JSON.stringify(text)});button.click();})()`);await settle();};
 const change = async (selector,value) => {await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event(n.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await settle();};
 const open = async (variant,screen) => {await window.loadURL(`http://127.0.0.1:5234/?variant=${variant}&screen=${screen}`);await settle();assert.ok(await evaluate('!!document.querySelector("h1")'));};
 const capture = async name => {await settle();await writeFile(join(process.argv[2],name+'.png'),(await window.webContents.capturePage()).toPNG());};
 try {
  let layouts=0;
  for(const width of [1040,760,560,420,320])for(const variant of ['A','B','C'])for(const screen of ['ai','effects','character']){
   window.setContentSize(width,800);await settle();await open(variant,screen);
   const layout=await evaluate(`(()=>{const main=document.querySelector('.page-scroll'),r=n=>n.getBoundingClientRect(),a=r(document.querySelector('.action-bar')),c=r(document.querySelector('.comparison'));return {overflow:document.documentElement.scrollWidth>innerWidth+1||main.scrollWidth>main.clientWidth+1,clipped:[...document.querySelectorAll('button,input,select')].filter(n=>n.checkVisibility()&&!n.closest('dialog')).filter(n=>r(n).left<0||r(n).right>innerWidth+1).map(n=>n.textContent),overlap:r(main).bottom>a.top+1||a.bottom>c.top+1,usable:r(main).height>80,footer:c.bottom<=innerHeight+1};})()`);
   assert.deepEqual(layout,{overflow:false,clipped:[],overlap:false,usable:true,footer:true},`${width}/${variant}/${screen}`);
   if(width===1040||width===320)await capture(`${variant}-${screen}-${width}`);
   await clickText('ライト');assert.equal(await evaluate('document.querySelector(".prototype").dataset.theme'),'light');layouts++;
  }
  window.setContentSize(1040,800);await settle();
  for(const variant of ['A','B','C']){console.log('Flow '+variant);
   const stage=async index=>{if(variant==='A')return;await evaluate(`document.querySelectorAll('${variant==='B'?'.wizard-nav':'.readiness-nav'} button')[${index}].click()`);await settle();};
   const check=async()=>{await evaluate(`document.querySelector('.personal input:not(:disabled)').click()`);await settle();};
   const state=async()=>{await clickText('状態を見る');const value=await evaluate('JSON.parse(document.querySelector("dialog pre").textContent)');await evaluate('document.querySelector("dialog .dialog-heading button").click()');await settle();return value;};
   await open(variant,'ai');await clickText('ダミーキーで準備する');await stage(1);await change('input:not([readonly])','みなと');await clickText('話し方を保存');await stage(2);await check();
   // Scope the persona selector: A has two selects; B/C use the second field select.
   if(!(await state()).ai.assigned){await evaluate(`(()=>{const n=[...document.querySelectorAll('select')].find(n=>[...n.options].some(o=>o.value==='saved'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,'saved');n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();}
   await clickText('投稿用アカウントの準備を見る');await clickText('連携済みの状態を見る');await stage(3);await clickText('API接続確認の見本を見る');await evaluate(`document.querySelectorAll('.personal input')[${variant==='A'?1:0}].click()`);await settle();assert.equal((await state()).ai.confirmed,true);
   await clickText('次へ →');await stage(0);await clickText('ルールを保存（見本）');await stage(1);assert.ok(await evaluate('document.querySelector("main").textContent.includes("3個")'));await stage(2);await clickText('テスト再生の見本を見る');await clickText('見本を再生');assert.equal((await state()).falling,true);await stage(3);await evaluate(`document.querySelectorAll('.personal input')[1].click()`);await settle();assert.equal((await state()).fx.confirmed,true);await clickText('次へ →');
   await stage(0);await clickText('閉口画像を選ぶ（見本）');await clickText('同じ大きさの見本画像を選ぶ');await stage(3);await evaluate("[...document.querySelectorAll('main .personal input')].at(-1).click()");await settle();assert.equal((await state()).character.confirmed,true,'One image is enough');await stage(1);await clickText('開口画像を選ぶ（見本）');await clickText('同じ大きさの見本画像を選ぶ');await clickText('開口画像を選ぶ（見本）');await clickText('大きさが違う画像のエラーを見る');assert.equal((await state()).character.open,true,'Invalid image preserves prior valid image');await stage(2);await clickText('口パクを試す（この見本のみ・2秒）');assert.equal((await state()).mouth,true);await new Promise(resolve=>setTimeout(resolve,2100));assert.equal((await state()).mouth,false);await capture(`${variant}-character-prepared`);
  }
  assert.deepEqual(external,[]);console.log(`PASS: ${layouts} responsive layouts, both themes, 9 setup flows, invalid image preservation, 2-second mouth test, no external requests.`);
  window.destroy();app.quit();
 }catch(error){console.error(error);app.exit(1);}
});
