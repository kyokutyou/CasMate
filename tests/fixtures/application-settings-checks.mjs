import assert from 'node:assert/strict';

export async function verifyApplicationSettings({ evaluate, resize, settle, capture, pressKey }) {
  await evaluate("document.getElementById('home-application').click()");await settle();
  assert.equal(await evaluate("document.querySelector('.app-connection-details').open"),false);
  let count=0;
  for(const theme of ['ocean','pearl']) for(const size of ['small','medium','large']) for(const width of [320,420,560,760,1024]) {
    await resize(width,760);
    // Native resize delivery and font layout can lag behind a fixed delay when
    // another renderer is busy. Measure only after the requested viewport paints.
    await evaluate(`new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Application settings viewport did not settle: '+innerWidth+'x'+innerHeight)),3000);
      const check=()=>{
        if(innerWidth!==${width}||innerHeight!==760){requestAnimationFrame(check);return;}
        document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();})));
      };
      check();
    })`);
    await evaluate(`(()=>{const v=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:v.settingsRevision+1,settings:{...v.settings,application:{...v.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:${JSON.stringify(size)}}}})})()`);await settle();
    const metrics=await evaluate(`(()=>{const panel=document.querySelector('.application-settings-panel');const cards=[...panel.querySelector('.app-theme-group').querySelectorAll('.app-theme-choice')].map(e=>e.getBoundingClientRect());return {
      overflow:document.querySelector('.management-body').scrollWidth>document.querySelector('.management-body').clientWidth,
      clipped:[...panel.querySelectorAll('h3,h4,p,label,button,summary')].filter(e=>e.checkVisibility()).some(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1),
      radios:[...panel.querySelectorAll('input[type=radio]')].filter(e=>e.checkVisibility()).length,
      columns:cards.filter(c=>Math.abs(c.top-cards[0].top)<1).length};})()`);
    assert.deepEqual(metrics,{overflow:false,clipped:false,radios:11,columns:width>720?4:2},`${theme} ${size} ${width} settings fit`);
    if(capture&&size==='medium'&&[320,1024].includes(width))await capture(`application-${theme}-${width}.png`);
    if([320,1024].includes(width)) {
    const geometry=()=>evaluate(`(()=>{const b=document.querySelector('.management-body');return {boxes:[...document.querySelectorAll('.application-settings-panel section,.application-settings-panel input,.app-connection-details summary')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}),height:b.scrollHeight,top:b.scrollTop}})()`);
    const before=await geometry();
    await evaluate("boardManagementHarness.failNextSave('保存できません。設定の保存先を確認して、もう一度保存してください。');document.querySelector('.app-theme-choice input[value=ivory]').click()");await settle();
    assert.deepEqual(await geometry(),before,'appearance error keeps geometry');
    assert.equal(await evaluate("document.querySelector('.app-connection-details').open"),false,'save failures do not open connection settings');
    await evaluate("document.querySelector('.app-settings-feedback button').click()");await settle();
    assert.deepEqual(await geometry(),before,'appearance retry keeps geometry');
    }
    count++;
  }
  await evaluate("document.querySelector('.app-connection-details summary').focus({preventScroll:true})");
  if(pressKey){await pressKey('Enter');await settle();}else await evaluate("document.querySelector('.app-connection-details summary').click()");
  assert.equal(await evaluate("document.querySelector('.app-connection-details').open"),true,'connection settings open with explicit action');
  await evaluate("(()=>{const input=document.querySelector('.app-port-row input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'80');input.dispatchEvent(new Event('input',{bubbles:true}))})()");await settle();
  assert.equal(await evaluate("document.querySelector('.app-port-row input').getAttribute('aria-invalid')"),'true');
  await evaluate("document.querySelector('.editor-heading-row .back-button').click();document.getElementById('home-application').click()");await settle();
  assert.equal(await evaluate("document.querySelector('.app-connection-details').open"),true,'connection disclosure survives navigation');
  assert.equal(await evaluate("document.querySelector('.app-port-row input').value"),'80','invalid draft survives navigation');
  await evaluate("document.querySelector('.app-update-details summary').click()");
  assert.equal(await evaluate("document.querySelector('.app-update-details').open"),true);
  return count;
}
