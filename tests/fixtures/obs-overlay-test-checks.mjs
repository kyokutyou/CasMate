import assert from 'node:assert/strict';

export async function verifyObsOverlayTest({ evaluate, selector, capture, name, setMessage }) {
  const root = JSON.stringify(selector);
  const wait = expression => evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+5000;const check=()=>{if(${expression})return requestAnimationFrame(()=>requestAnimationFrame(resolve));if(performance.now()>end)return reject(Error('OBS test controls did not settle'));requestAnimationFrame(check)};check()})`);
  await wait(`document.querySelector(${root}+' [data-action=test]')?.getAttribute('aria-disabled')==='false'`);
  await evaluate(`(()=>{const b=document.querySelector(${root}+' [data-action=test]');b.scrollIntoView({block:'center'});b.focus({preventScroll:true})})()`);
  const geometry = () => evaluate(`(()=>{const p=document.querySelector(${root}),b=p.querySelector('[data-action=test]'),s=p.querySelector('.obs-test-status'),r=b.getBoundingClientRect(),q=s.getBoundingClientRect(),body=document.querySelector('.management-body');return {button:[r.x,r.y,r.width,r.height],status:[q.x,q.y,q.width,q.height],height:document.documentElement.scrollHeight,scroll:scrollY,bodyHeight:body?.scrollHeight,bodyScroll:body?.scrollTop,focus:document.activeElement===b,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  const before = await geometry(); assert.equal(before.overflow,false);
  const reception = await evaluate(`document.querySelector(${root}+' [data-action=test]').textContent==='コメント受信テスト'`);
  await evaluate(`document.querySelector(${root}+' [data-action=test]').click()`);
  if (reception) {
    await wait(`document.querySelector(${root}+' [data-action=test]')?.textContent==='コメント受信テスト'&&document.querySelector(${root}+' [data-action=test]')?.getAttribute('aria-disabled')==='false'`);
    assert.deepEqual(await geometry(),before,`${name}: reception preserves controls, scroll and focus`);
    if(capture) await capture(`obs-test-${name}.png`);
    return;
  }
  await wait(`document.querySelector(${root}+' [data-action=test]')?.textContent==='テスト終了'`);
  assert.deepEqual(await geometry(),before, `${name}: start preserves controls, scroll and focus`);
  if (setMessage) {
    await setMessage('OBS表示テストの状態を確認してください。'.repeat(50));
    await wait(`document.querySelector(${root}+' .obs-test-status')?.textContent.length>500`);
    assert.deepEqual(await geometry(),before, `${name}: long status preserves controls, scroll and focus`);
    assert.equal(await evaluate(`(()=>{const e=document.querySelector(${root}+' .obs-test-status');e.scrollTop=e.scrollHeight;return e.scrollTop>0})()`),true,'long status can be read by scrolling');
  }
  if (capture) await capture(`obs-test-${name}.png`);
  await evaluate(`document.querySelector(${root}+' [data-action=test]').click()`);
  await wait(`document.querySelector(${root}+' [data-action=test]')?.textContent==='OBSテスト（5秒）'&&document.querySelector(${root}+' [data-action=test]')?.getAttribute('aria-disabled')==='false'`);
  assert.deepEqual(await geometry(),before, `${name}: stop preserves controls, scroll and focus`);
}
