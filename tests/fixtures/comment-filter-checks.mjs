import assert from 'node:assert/strict';

export async function verifyCommentFilter({evaluate,resize,settle,capture,pressKey}) {
  await evaluate("document.querySelector('.management-nav [data-page=settings]').click();document.getElementById('settings-commentFilter').click()");await settle();
  const update=async(theme,size,words=['ネタバレ','宣伝です'],art=false)=>{
    await evaluate(`(()=>{const v=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:v.settingsRevision+1,settings:{...v.settings,application:{...v.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:${JSON.stringify(size)}},commentFilter:{ngWords:${JSON.stringify(words)},asciiArtEnabled:${art}}}})})()`);await settle();
  };
  const geometry=()=>evaluate(`(()=>{const b=document.querySelector('.management-body');return {boxes:[...document.querySelectorAll('.comment-filter-panel button,.comment-filter-panel textarea,.comment-filter-panel input,.filter-result,.filter-test-details')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}),height:b.scrollHeight,top:b.scrollTop,focus:document.activeElement.id}})()`);
  const sample=async index=>{await evaluate(`document.querySelectorAll('.filter-samples button')[${index}].click()`);await settle()};
  let count=0;
  for(const theme of ['ocean','pearl'])for(const size of ['small','medium','large'])for(const width of [320,420,560,680,760,1024]){
    await resize(width,width===760?560:760);await update(theme,size);
    await sample(0);
    const layout=await evaluate(`(()=>{const panel=document.querySelector('.comment-filter-panel');const a=panel.querySelector('.filter-editors').getBoundingClientRect(),b=panel.querySelector('.filter-tester').getBoundingClientRect();return {
      overflow:document.querySelector('.management-body').scrollWidth>document.querySelector('.management-body').clientWidth,
      sideBySide:Math.abs(a.top-b.top)<1,
      clipped:[...panel.querySelectorAll('h3,label,summary,button,.filter-help')].filter(e=>e.checkVisibility()).some(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1),
      resultHeight:panel.querySelector('.filter-result').getBoundingClientRect().height};})()`);
    assert.deepEqual(layout,{overflow:false,sideBySide:width>680,clipped:false,resultHeight:112},`${theme} ${size} ${width} filter fits`);
    if([320,1024].includes(width)){
      await evaluate("document.querySelector('.filter-tester input').focus({preventScroll:true})");
      const trace=await evaluate('boardManagementHarness.trace().length');const before=await geometry();
      await sample(1);assert.equal(await evaluate("document.querySelector('.filter-result').dataset.state"),'blocked');
      assert.deepEqual(await geometry(),before,'NG result preserves geometry and focus');
      await sample(2);assert.equal(await evaluate("document.querySelector('.filter-result').dataset.state"),'allowed');
      await update(theme,size,['ネタバレ','宣伝です'],true);
      assert.equal(await evaluate("document.querySelector('.filter-result').dataset.state"),'blocked');
      assert.deepEqual(await geometry(),before,'art result preserves geometry');
      await update(theme,size,[],true);
      assert.equal(await evaluate("document.querySelectorAll('.filter-samples button')[1].disabled"),true);
      assert.deepEqual(await geometry(),before,'empty NG list preserves operation position');
      assert.equal(await evaluate('boardManagementHarness.trace().length'),trace,'tester never sends requests or saves');
    }
    if(capture&&size==='medium'&&[320,1024].includes(width)){
      await update(theme,size);await sample(1);await evaluate("document.querySelector('.filter-columns').scrollIntoView({block:'start'})");await settle();await capture(`filter-${theme}-${width}.png`);
    }
    count++;
  }
  await evaluate("document.querySelector('.filter-rules summary').focus()");
  if(pressKey){await pressKey('Enter');await settle()}else await evaluate("document.querySelector('.filter-rules summary').click()");
  assert.equal(await evaluate("document.querySelector('.filter-rules').open"),true);
  await evaluate("document.querySelector('.filter-test-details summary').click()");
  const inputs=await evaluate("[document.querySelector('.filter-tester input').value,document.querySelector('.filter-tester textarea').value]");
  await evaluate("document.querySelector('.editor-heading-row .back-button').click();document.getElementById('settings-commentFilter').click()");await settle();
  assert.equal(await evaluate("document.querySelector('.filter-rules').open&&document.querySelector('.filter-test-details').open"),true,'both details survive navigation');
  assert.deepEqual(await evaluate("[document.querySelector('.filter-tester input').value,document.querySelector('.filter-tester textarea').value]"),inputs,'tester survives navigation');
  await evaluate("boardManagementHarness.failNextSave('保存先を確認してください。'.repeat(30));(()=>{const e=document.querySelector('.ng-word-editor');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'未保存の語');e.dispatchEvent(new Event('input',{bubbles:true}))})()");
  const before=await geometry();
  await evaluate("new Promise(resolve=>setTimeout(resolve,600))");await settle();
  assert.equal(await evaluate("document.querySelector('.filter-save-state').textContent.includes('保存できませんでした。')"),true);
  assert.deepEqual(await geometry(),before,'long save failure preserves layout');
  return count;
}
