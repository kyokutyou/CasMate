import assert from 'node:assert/strict';

export async function verifyInitialSetupEntry({ evaluate, resize, capture }) {
  const original = await evaluate('boardManagementHarness.snapshot()');
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,50))');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const update = async values => { await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,...${JSON.stringify(values)}}});})()`); await settle(); };
  await click('[data-page=settings]'); await click('#settings-application'); await click('#application-initial-setup');
  let checks = 0;
  const scan = async label => {
    const result = await evaluate(`(()=>{const body=document.querySelector('.management-body'),footer=document.querySelector('.setup-footer'),b=body.getBoundingClientRect(),f=footer.getBoundingClientRect();return {overflow:body.scrollWidth>body.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,footerOutside:!body.contains(footer),overlap:b.bottom>f.top+1,footerFits:f.bottom<=innerHeight+1,usable:b.height>=50,clipped:[...document.querySelectorAll('.initial-setup button,.initial-setup input,.setup-feature')].filter(n=>n.checkVisibility()).filter(n=>{const r=n.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(n=>n.id)}})()`);
    assert.deepEqual(result,{overflow:false,footerOutside:true,overlap:false,footerFits:true,usable:true,clipped:[]},label);
    checks++;
  };
  await update({selected:['sources','commentSpeech','commentOverlay'],warning:undefined});
  for (const theme of ['graphite','midnight','ocean','burgundy','pearl','ivory','sakura','lavender']) {
    await resize(1040,760);
    await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:'medium'}}});})()`);
    for(const position of ['welcome','features','summary']) { await update({position}); await scan(theme+'/'+position); }
  }
  for(const [width,height] of [[1040,760],[761,760],[760,560],[560,760],[480,760],[420,760],[320,760]]) for(const size of ['small','medium','large']) {
    await resize(width,height);
    await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTheme:'ocean',managementTextSize:${JSON.stringify(size)}}}});})()`);
    for(const position of ['welcome','features','summary']) {
      await update({position}); await scan(`${width}/${height}/${size}/${position}`);
      if(capture && size==='medium' && [1040,320].includes(width)) await capture(`setup-entry-${position}-${width}.png`);
    }
  }
  await resize(1040,800); await update({position:'features',selected:['sources','commentOverlay']});
  await evaluate("document.getElementById('setup-feature-commentSpeech').focus();boardManagementHarness.holdNextMutation()");
  const geometry = () => evaluate("(()=>{const body=document.querySelector('.management-body'),r=n=>{const b=n.getBoundingClientRect();return [b.x,b.y,b.width,b.height]};return {input:r(document.getElementById('setup-feature-commentSpeech')),footer:r(document.querySelector('.setup-footer')),scroll:body.scrollTop,height:body.scrollHeight,focus:document.activeElement.id}})()");
  const before = await geometry();
  await click('#setup-feature-commentSpeech'); assert.deepEqual(await geometry(),before,'pending selection preserves controls');
  await evaluate('boardManagementHarness.releaseMutation()'); await settle();
  assert.equal(await evaluate('document.activeElement.id'),'setup-feature-commentSpeech');
  await update({position:'summary',selected:['sources','commentSpeech'],deferred:[],confirmations:{}});
  await evaluate("document.getElementById('setup-result-sources').focus({preventScroll:true})");
  const summaryGeometry = () => evaluate("(()=>{const body=document.querySelector('.management-body'),r=n=>{const b=n.getBoundingClientRect();return [b.x,b.y,b.width,b.height]};return {source:r(document.getElementById('setup-result-sources')),speech:r(document.getElementById('setup-result-commentSpeech')),priority:r(document.getElementById('setup-priority')),footer:r(document.querySelector('.setup-footer')),scroll:body.scrollTop,height:body.scrollHeight,focus:document.activeElement.id}})()");
  const summaryBefore = await summaryGeometry();
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({sourceStatuses:{...s.sourceStatuses,youtube:{...s.sourceStatuses.youtube,state:'error',message:'長い接続エラー'.repeat(100)}},commentSpeech:{...s.commentSpeech,warning:'長い音声エラー'.repeat(100)}})})()"); await settle();
  assert.deepEqual(await summaryGeometry(),summaryBefore,'runtime updates preserve result controls and focus');
  await click('#setup-priority');
  assert.equal(await evaluate('document.activeElement.id'),'setup-heading','result action focuses actual setup screen');
  await update({position:'features',selected:['sources']});
  await click('#setup-skip-selection');
  assert.equal(await evaluate('boardManagementHarness.snapshot().initialSetup.position'),'summary');
  assert.deepEqual(await evaluate('boardManagementHarness.snapshot().initialSetup.selected'),[]);
  assert.match(await evaluate("document.querySelector('.setup-empty-result').textContent"),/設定 → アプリ設定/);
  await click('#setup-reselect');
  assert.equal(await evaluate('boardManagementHarness.snapshot().initialSetup.position'),'features');
  await click('[data-page=home]'); await evaluate(`boardManagementHarness.updateSnapshot(${JSON.stringify(original)})`);
  await verifyInitialSetupEntryUpdates({evaluate,resize});
  return checks;
}

export async function verifyInitialSetupEntryUpdates({evaluate,resize}) {
  const original=await evaluate('boardManagementHarness.snapshot()');
  const settle=()=>evaluate('new Promise(resolve=>setTimeout(resolve,50))');
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settle();};
  await click('[data-page=settings]');await click('#settings-application');await click('#application-initial-setup');
  const update=async values=>{await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,...${JSON.stringify(values)}}});})()`);await settle();};
  for(const width of [1040,320]) {
    await resize(width,760);
    await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTextSize:'large'}}});})()");
    await update({position:'summary',selected:['sources'],confirmations:{},deferred:[]});
    await evaluate("document.getElementById('setup-priority').focus({preventScroll:true})");
    await settle();
    const geometry=()=>evaluate("(()=>{const b=document.querySelector('.management-body'),rect=n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]};return {priority:rect(document.getElementById('setup-priority')),panel:rect(document.querySelector('.setup-next-panel')),row:rect(document.querySelector('.setup-result-row')),source:rect(document.getElementById('setup-result-sources')),footer:rect(document.querySelector('.setup-footer')),height:b.scrollHeight,scroll:b.scrollTop,focus:document.activeElement.id}})()");
    const before=await geometry();
    const fingerprints=await evaluate('boardManagementHarness.snapshot().initialSetup.fingerprints');
    await update({confirmations:{sources:fingerprints.sources}});
    assert.deepEqual(await geometry(),before,'external confirmation preserves action, rows, scrolling and focus at '+width);
    await click('#setup-priority');
    assert.equal(await evaluate('boardManagementHarness.snapshot().initialSetup.position'),'sources','focused action still opens its original target');
    await update({position:'summary',selected:['sources'],confirmations:{sources:fingerprints.sources}});
    await evaluate("document.getElementById('setup-result-sources').focus({preventScroll:true})");
    const complete=await geometry();
    await update({confirmations:{}});
    assert.deepEqual(await geometry(),complete,'invalidated confirmation preserves controls at '+width);
  }
  await resize(1440,900);await update({position:'welcome'});
  const wide=await evaluate("(()=>{const n=document.querySelector('.initial-setup[data-setup-position]'),b=document.querySelector('.management-body');return {width:Math.round(n.getBoundingClientRect().width),viewport:innerWidth,padding:getComputedStyle(b).paddingInline,classes:document.querySelector('.management-shell').className}})()");
  assert.equal(wide.padding,'26px','wide entry keeps the C sample margins');
  if(wide.viewport>=1152)assert.equal(wide.width,1100,'wide entry matches the C sample content width: '+JSON.stringify(wide));
  await click('[data-page=home]');await evaluate(`boardManagementHarness.updateSnapshot(${JSON.stringify(original)})`);
}
