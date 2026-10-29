import assert from 'node:assert/strict';

export async function verifyInitialSetupReadyColors({ evaluate, resize, capture }) {
  const original = await evaluate('boardManagementHarness.snapshot()');
  const settle = () => evaluate('new Promise(resolve => setTimeout(resolve,60))');
  const themes = ['graphite', 'midnight', 'ocean', 'burgundy', 'pearl', 'ivory', 'sakura', 'lavender'];
  for (const theme of themes) for (const width of [1040, 320]) {
    await resize(width, 820);
    await evaluate(`new Promise((resolve,reject) => {let attempts=0;const check=()=>{if(innerWidth===${width}) resolve();else if(++attempts>=40) reject(new Error('resize did not settle'));else setTimeout(check,25);};check();})`);
    await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,position:'sources',selected:['sources'],warning:null},settings:{...s.settings,application:{...s.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:'large'}},sourceStatuses:{...s.sourceStatuses,youtube:{...s.sourceStatuses.youtube,state:'stopped',message:null}}});})()`);
    await settle();
    await evaluate("document.querySelector('#setup-next').focus({preventScroll:true})");
    const measure = () => evaluate("(() => {const a=document.querySelector('.setup-review'),b=document.querySelector('.management-body'),r=a.getBoundingClientRect();return {rect:[r.x,r.y,r.width,r.height],height:b.scrollHeight,scroll:b.scrollTop,focus:document.activeElement.id};})()");
    const before = await measure();
    assert.equal(await evaluate("document.querySelector('.setup-review').dataset.ready"), 'false');
    await evaluate("(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({sourceStatuses:{...s.sourceStatuses,youtube:{...s.sourceStatuses.youtube,state:'connected'}}});})()");
    await settle();
    assert.deepEqual(await measure(), before, 'success color keeps geometry/focus '+theme+'/'+width);
    const result = await evaluate("(() => {const a=document.querySelector('.setup-review'),v=a.querySelector('.setup-review-state strong'),style=getComputedStyle(a),root=document.querySelector('.management-shell'),probe=document.createElement('span');probe.style.display='none';probe.style.color=getComputedStyle(root).getPropertyValue('--studio-success');probe.style.backgroundColor=getComputedStyle(root).getPropertyValue('--studio-success-surface');root.append(probe);const expected=getComputedStyle(probe);const result={ready:a.dataset.ready,border:style.borderTopColor===expected.color,background:style.backgroundColor===expected.backgroundColor,value:getComputedStyle(v).color===expected.color,check:getComputedStyle(v,'::after').visibility,overflow:document.documentElement.scrollWidth>innerWidth+1};probe.remove();return result;})()");
    assert.deepEqual(result,{ready:'true',border:true,background:true,value:true,check:'visible',overflow:false},theme+'/'+width);
    if(capture && ['ocean','pearl'].includes(theme)) await capture(`setup-ready-${theme}-${width}.png`);
    await evaluate("(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({sourceStatuses:{...s.sourceStatuses,youtube:{...s.sourceStatuses.youtube,state:'stopped'}}});})()");await settle();
    assert.equal(await evaluate("document.querySelector('.setup-review').dataset.ready"),'false','disconnect removes success '+theme+'/'+width);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.setup-review-state strong'),'::after').visibility"),'hidden');
    assert.deepEqual(await measure(),before,'disconnect retains geometry/focus '+theme+'/'+width);
  }
  await evaluate(`boardManagementHarness.updateSnapshot(${JSON.stringify(original)})`); await settle();
}
