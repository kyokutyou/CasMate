import assert from 'node:assert/strict';

export async function verifySmartphoneHub({ evaluate, resize, settle, capture }) {
  await evaluate("document.getElementById('home-smartphone').click()");
  const original = await evaluate('smartphoneHarness.snapshot()');
  await evaluate(`(() => {const v=smartphoneHarness.snapshot();v.view.devices.push({...structuredClone(v.view.devices[0]),id:'second-phone',name:'B'.repeat(64)});smartphoneHarness.update(v);})()`);
  const measure = `(() => {const body=document.querySelector('.management-body');return {boxes:[...document.querySelectorAll('.sp-qr-button,#sp-speech-settings,.sp-feature-states,.sp-device-obs button')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}),height:body.scrollHeight,top:body.scrollTop}})()`;
  let checks=0;
  for(const width of [320,760,1024]) for(const size of ['medium','large']) {
    await resize(width,760);
    await evaluate(`(() => {const shell=document.querySelector('.management-shell');for(const [key,value] of Object.entries(smartphoneHarness.textSizes[${JSON.stringify(size)}]))shell.style.setProperty(key,value);})()`);
    await settle();
    const metrics=await evaluate(`(() => {
      const cards=[...document.querySelectorAll('.sp-device')].map(e=>e.getBoundingClientRect());
      const states=[...document.querySelectorAll('.sp-feature-states>div')].map(e=>e.getBoundingClientRect());
      return {overflow:document.querySelector('.management-body').scrollWidth>document.querySelector('.management-body').clientWidth,
        order:[...document.querySelectorAll('.sp-network-choice strong')].map(e=>e.textContent),
        twoColumns:Math.abs(cards[0].top-cards[1].top)<1,
        statusRow:states.every(e=>Math.abs(e.top-states[0].top)<1),
        namesClosed:[...document.querySelectorAll('.sp-device-management')].every(e=>!e.open),
        speechOutside:document.getElementById('sp-speech-settings').closest('details')===null};
    })()`);
    assert.deepEqual(metrics,{overflow:false,order:['家庭内LAN','直接接続','Tailscale'],twoColumns:width>760,statusRow:width>760,namesClosed:true,speechOutside:true});
    const before=await evaluate(measure);
    await evaluate("(()=>{const v=smartphoneHarness.snapshot();v.view.settings.activeNetwork='direct';smartphoneHarness.update(v)})()");await settle();
    assert.deepEqual(await evaluate(measure),before,'active network notice preserves controls');
    assert.equal(await evaluate("document.querySelector('.sp-connection-state').dataset.attention"),'true');
    await evaluate("document.querySelector('.sp-active-network-link').click()");await settle();
    assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),'PC・スマホ直接接続');
    assert.equal(await evaluate('smartphoneHarness.pending()'),false,'display navigation does not save');
    await evaluate("document.querySelector('[aria-label=\"家庭内LANのネットワーク\"]').click();(()=>{const v=smartphoneHarness.snapshot();v.view.settings.activeNetwork='lan';smartphoneHarness.update(v)})()");await settle();
    if(capture&&size==='medium')await capture(`smartphone-hub-${width}.png`);
    await evaluate("document.querySelector('.sp-compact-settings').scrollIntoView({block:'start'})");await settle();
    const lower=await evaluate(`(()=>{
      const panel=document.querySelector('.sp-compact-settings');
      const url=panel.querySelector('.sp-url code')?.getBoundingClientRect();const copy=panel.querySelector('.sp-url button')?.getBoundingClientRect();
      return {closed:!panel.querySelector('.sp-advanced').open,
        visible:panel.querySelector('.sp-audio-quality input').getBoundingClientRect().height>0&&panel.querySelector('#sp-obs-settings').getBoundingClientRect().height>0,
        clipped:[...panel.querySelectorAll('p,h3,code,button')].filter(e=>e.checkVisibility()).some(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1),
        inline:Math.abs((url?.top??0)-(copy?.top??0))<30};
    })()`);
    assert.equal(lower.closed&&lower.visible&&!lower.clipped,true,'lower settings remain accessible without clipping');
    if(width===1024&&size==='medium')assert.equal(lower.inline,true,'URL and copy are on the same row');
    if(capture&&size==='medium')await capture(`smartphone-lower-${width}.png`);
    await evaluate("document.querySelector('.management-body').scrollTop=0");await settle();
    checks++;
  }
  await evaluate("document.querySelector('.sp-device-management summary').click();document.querySelector('.sp-device-management input').focus()");
  await evaluate("document.querySelector('.management-nav [data-page=settings]').click();document.getElementById('settings-smartphone').click()");await settle();
  assert.equal(await evaluate("document.querySelector('.sp-device-management').open"),true,'device management disclosure survives navigation');
  await evaluate("document.querySelector('.sp-obs-guide-entry').click()");await settle();
  assert.equal(await evaluate("document.getElementById('sp-obs-guide-dialog').open"),true);
  await evaluate("document.querySelector('.sp-obs-guide-heading button').click()");
  assert.equal(await evaluate("document.activeElement.classList.contains('sp-obs-guide-entry')"),true,'OBS guide returns focus');
  await resize(224,560);
  await evaluate("(()=>{const v=smartphoneHarness.snapshot();v.saveError='未保存';smartphoneHarness.update(v)})()");await settle();
  const textFits=await evaluate(`(()=>{const status=document.querySelector('.sp-connection-state');status.scrollTop=0;const text=status.querySelector('.sp-connection-hint>span');const range=document.createRange();range.setStart(text.firstChild,0);range.setEnd(text.firstChild,1);return range.getBoundingClientRect().top>=status.getBoundingClientRect().top;})()`);
  assert.equal(textFits,true,'large text warning keeps its first line reachable');
  await evaluate(`smartphoneHarness.update(${JSON.stringify(original)})`);
  return checks;
}
