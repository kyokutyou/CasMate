import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[2], 'profile'));
app.whenReady().then(async () => {
const window = new BrowserWindow({ show: false, width: 1040, height: 820, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
window.setMenuBarVisibility(false);
const evaluate = code => window.webContents.executeJavaScript(code);
const settle = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const wait = async condition => { for (let i=0;i<100;i++) { if (await evaluate(condition)) return; await new Promise(r=>setTimeout(r,30)); } throw new Error('Timed out: '+condition); };
const clickText = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.checkVisibility()&&b.textContent.trim()===${JSON.stringify(text)}); if(!b || b.disabled)throw Error('Unavailable button: '+${JSON.stringify(text)});b.click();})()`);
const clickSelector = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const capture = async name => { await settle(); await writeFile(join(process.argv[3], name+'.png'),(await window.webContents.capturePage()).toPNG()); };
try {
  let layouts=0;
  for (const width of [1040,760,560,320]) for (const variant of ['A','B','C']) for (const topic of ['comments','speech','obs']) {
    window.setContentSize(width,760);
    await window.loadURL(`http://127.0.0.1:5231/?variant=${variant}&topic=${topic}`); await settle();
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}/${variant}/${topic}: horizontal overflow`);
    assert.equal(await evaluate("(()=>{const a=document.querySelector('.action-bar').getBoundingClientRect(),c=document.querySelector('.comparison').getBoundingClientRect();return a.bottom<=c.top+1})()"),true,'footer overlap');
    await clickText('明色へ'); await settle();
    assert.equal(await evaluate("document.querySelector('.prototype').dataset.theme"),'light');
    await clickText('暗色へ');
    if(width===1040 || width===320)await capture(`${variant}-${topic}-${width}`);
    layouts++;
  }
  window.setContentSize(1040,800);
  await window.loadURL('http://127.0.0.1:5231/?variant=B&topic=comments');await settle();
  await clickText('次の手順へ →');await settle();await clickText('接続する');
  await wait("document.querySelector('.feedback')?.dataset.tone==='ready'");
  await clickText('次の手順へ →');await settle();
  assert.equal(await evaluate("document.querySelector('.confirmation input').disabled"),false);
  await clickSelector('.confirmation input');await settle();
  await clickSelector('.compare-main button[aria-pressed=false]');await settle();
  assert.equal(await evaluate("document.querySelector('input:not([type=checkbox])').value"),'@casmate_sample');
  await capture('A-comments-ready');
  await clickText('2読み上げ');await settle();
  await clickText('VOICEVOXの起動を確認する');await wait("document.querySelector('.feedback')?.dataset.tone==='ready'");
  await clickText('▷ この声を試聴する');await wait("document.querySelector('.feedback')?.textContent.includes('試聴の操作が完了')");
  assert.equal(await evaluate("document.querySelector('.confirmation input').disabled"),false);
  await clickSelector('.confirmation input');await settle();await capture('A-speech-ready');
  await clickText('3OBS表示');await settle();
  await clickText('OBSに接続する');await wait("document.querySelector('.feedback')?.dataset.tone==='ready'");
  await clickText('OBSに追加する…');await settle();
  assert.equal(await evaluate('document.querySelector("dialog").open'),true);
  await capture('obs-add-dialog');await clickText('このシーンに追加する');
  await wait('!document.querySelector("dialog").open');
  await clickText('テストコメントを表示する');await wait("document.querySelector('.feedback')?.textContent.includes('テストを送信')");
  await clickSelector('.confirmation input');await settle();await capture('A-obs-ready');
  await clickText('確認結果を見る →');await settle();
  assert.equal(await evaluate("[...document.querySelectorAll('.result strong')].every(n=>n.textContent.includes('本人確認済み'))"),true);
  // Failure and healthy waiting remain distinct; notification geometry stays stable.
  await window.loadURL('http://127.0.0.1:5231/?variant=A&topic=comments');await settle();
  await clickSelector('.comparison summary');await settle();
  const scenario = value => evaluate(`(()=>{const e=document.querySelector('.comparison select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await scenario('error');await clickSelector('.comparison summary');await clickText('接続する');await wait("document.querySelector('.feedback')?.dataset.tone==='error'");
  assert.equal(await evaluate("document.querySelector('.confirmation input').disabled"),true);
  await clickSelector('.comparison summary');await scenario('waiting');await clickSelector('.comparison summary');await clickText('もう一度接続する');
  await wait("document.querySelector('.feedback')?.dataset.tone==='waiting'");
  assert.equal(await evaluate("document.querySelector('.confirmation input').disabled"),false);
  await capture('A-comments-waiting');
  console.log(`PASS: ${layouts} layouts, both themes, three end-to-end simulated flows, failure, waiting, confirmation, modal, input retention`);
} catch(error) { console.error(error);process.exitCode=1; }
finally { window.destroy();app.exit(process.exitCode ?? 0); }
});
