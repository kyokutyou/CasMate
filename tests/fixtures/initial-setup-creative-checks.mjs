import assert from 'node:assert/strict';

export async function verifyInitialSetupCreative({ evaluate, resize, capture, themes = ['graphite','midnight','ocean','burgundy','pearl','ivory','sakura','lavender'] }) {
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,50))');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  await click('[data-page=settings]');await click('#settings-application');await click('#application-initial-setup');
  let count = 0;
  for(const theme of themes)for(const [width,height,size] of [[1040,820,'medium'],[760,560,'medium'],[560,760,'large'],[480,700,'large'],[420,700,'large'],[320,700,'large']])for(const position of ['aiListener','textEffects','character']){
    await resize(width,height);
    await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,position:${JSON.stringify(position)},selected:['aiListener','textEffects','character']},settings:{...s.settings,application:{...s.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:${JSON.stringify(size)}}}});document.querySelector('.management-body').scrollTop=0;})()`);await settle();
    const layout=await evaluate(`(()=>{const b=document.querySelector('.management-body'),f=document.querySelector('.setup-footer'),r=n=>n.getBoundingClientRect(),review=document.querySelector('.setup-review'),content=document.querySelector('.management-editor-content'),controls=[...document.querySelectorAll('button,input,select,label')].filter(n=>n.checkVisibility()&&!n.closest('dialog'));return {overflow:document.documentElement.scrollWidth>innerWidth+1||b.scrollWidth>b.clientWidth+1,clipped:controls.filter(n=>r(n).left<0||r(n).right>innerWidth+1).map(n=>n.textContent),footer:r(b).bottom<=r(f).top+1&&r(f).bottom<=innerHeight+1,order:innerWidth<=760?r(review).top<r(content).top:r(review).left>r(content).left,cards:[...document.querySelectorAll('.management-editor-content .setup-step-card')].filter(n=>n.checkVisibility()).length,confirmation:!!document.querySelector('.setup-step-card:last-child .setup-personal-check'),outer:document.documentElement.scrollHeight<=innerHeight+1};})()`);
    assert.deepEqual(layout,{overflow:false,clipped:[],footer:true,order:true,cards:4,confirmation:true,outer:true},`${theme}/${width}/${position}`);
    if(capture&&theme==='ocean'&&(width===1040||width===320))await capture(`creative-${position}-${width}.png`);
    const selector=position==='aiListener'?'#ai-panel-connections input[type=password]':position==='textEffects'?'.setup-effects-fields select':'.setup-character [role=switch]';
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
    const measure=()=>evaluate(`(()=>{const b=document.querySelector('.management-body'),r=n=>{const q=n.getBoundingClientRect();return[q.x,q.y,q.width,q.height]};return{height:b.scrollHeight,scroll:b.scrollTop,control:r(document.querySelector(${JSON.stringify(selector)})),footer:r(document.querySelector('.setup-footer')),focus:document.activeElement===document.querySelector(${JSON.stringify(selector)})};})()`);
    const before=await measure();
    await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({aiListener:{...s.aiListener,message:'接続・設定を確認してください。'.repeat(20)},character:{...s.character,assetWarning:'画像が読み込めません。'.repeat(20)},initialSetup:{...s.initialSetup,warning:'進み具合を保存できませんでした。'.repeat(20)}});})()`);await settle();
    assert.deepEqual(await measure(),before,`${position}: long updates retain geometry and focus`);
    await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({aiListener:{...s.aiListener,message:'停止中'},character:{...s.character,assetWarning:null},initialSetup:{...s.initialSetup,warning:null}});})()`);await settle();
    assert.deepEqual(await measure(),before,`${position}: clearing updates retains geometry and focus`);count++;
  }
  assert.equal(await evaluate("boardManagementHarness.trace().filter(t=>/ai-listener\\/(start|resume)|text-effects\\/rules\\/.+\\/test|character\\/simple\\/motion/.test(t.path||'')).length"),0,'viewing does not start/send/save');
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,position:'textEffects'}});})()");await settle();
  await click('.setup-effects-fields .button-row button');
  const beforeDetails=await evaluate("document.querySelector('.setup-effects-fields input').value");
  await click('#setup-detail');await click('.editor-heading .back-button');
  assert.equal(await evaluate("document.querySelector('.setup-effects-fields input').value"),beforeDetails,'unsaved rule survives details');
  await click('.setup-effects-fields .button-row:last-child button:last-child');
  await evaluate("(()=>{const n=[...document.querySelectorAll('.text-effects-panel label')].find(n=>n.textContent==='説明用のコメント例').querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'ｗＷw');n.dispatchEvent(new Event('input',{bubbles:true}));})()");await settle();
  assert.equal(await evaluate("document.querySelector('.setup-creative-review').textContent.includes('説明用の反応数3個')"),true,'browser example uses normalized saved rule');
  assert.equal(await evaluate("document.querySelector('.text-effects-panel .setup-step-card:nth-child(3)>button')===null"),true,'OBS test is deferred until final display setup');
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,position:'aiListener'},aiListener:{...s.aiListener,hasKey:true}});})()");await settle();
  const settingsBefore=await evaluate('JSON.stringify(boardManagementHarness.snapshot().settings.aiListener)');
  await evaluate("(()=>{const n=document.querySelector('[aria-label=準備する参加先]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,'twitch');n.dispatchEvent(new Event('change',{bubbles:true}));})()");await settle();
  assert.equal(await evaluate('JSON.stringify(boardManagementHarness.snapshot().settings.aiListener)'),settingsBefore,'service selector does not change settings');
  await resize(1040,820);
  await evaluate("(()=>{const n=document.querySelector('#ai-panel-connections input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'test-key');n.dispatchEvent(new Event('input',{bubbles:true}));})()");await settle();
  const saveSelector='.ai-credential-row>button';
  const keyGeometry=()=>evaluate(`(()=>{const b=document.querySelector('.management-body'),n=document.querySelector(${JSON.stringify(saveSelector)}),r=n.getBoundingClientRect();return{rect:[r.x,r.y,r.width,r.height],height:b.scrollHeight,scroll:b.scrollTop,focus:document.activeElement===n};})()`);
  for(const failure of [undefined,'保存できませんでした。']){
    await evaluate("document.querySelector('.ai-credential-row>button').focus({preventScroll:true})");
    const geometry=await keyGeometry();
    await evaluate(`boardManagementHarness.holdNextMutation(${JSON.stringify(failure)})`);
    const before=await evaluate('boardManagementHarness.trace().length');await click(saveSelector);await click(saveSelector);
    assert.equal(await evaluate('boardManagementHarness.trace().length'),before+1,'key save prevents duplicate requests');
    assert.deepEqual(await keyGeometry(),geometry,'pending key save retains button geometry/focus');
    await evaluate('boardManagementHarness.releaseMutation()');await settle();
    assert.deepEqual(await keyGeometry(),geometry,'key save outcome retains geometry/focus');
    if(!failure){await evaluate("(()=>{const n=document.querySelector('#ai-panel-connections input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'retry-key');n.dispatchEvent(new Event('input',{bubbles:true}));})()");await settle();}
  }
  // Resolve the deliberately failed save before the API check.
  await click(saveSelector);
  await click('.ai-api-test-button');
  assert.equal(await evaluate("document.querySelector('[aria-label=通知]').textContent.includes('Gemini APIのテストに成功しました。')"),true,'explicit API test uses existing notification');
  await evaluate("(()=>{const s=boardManagementHarness.snapshot(),png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,position:'character'},settings:{...s.settings,character:{...s.settings.character,simple:{...s.settings.character.simple,closedAsset:png,openAsset:png}}}});})()");await settle();
  const traceBefore=await evaluate('boardManagementHarness.trace().length');
  await click('.setup-character .setup-step-card:nth-child(3)>button');
  assert.equal(await evaluate("document.querySelector('.setup-character [aria-busy=true]').textContent"),'口パク確認中…');
  await evaluate('new Promise(resolve=>setTimeout(resolve,2100))');
  assert.equal(await evaluate('boardManagementHarness.trace().length'),traceBefore,'mouth check has no API/OBS side effects');
  assert.equal(await evaluate('boardManagementHarness.snapshot().character.mouthShape'),'closed');
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,character:{...s.settings.character,simple:{...s.settings.character.simple,closedAsset:'data:image/png;base64,broken',openAsset:null}}}});})()");await settle();
  assert.equal(await evaluate("document.querySelector('.setup-asset-summary').textContent.includes('画像を読み込めません')"),true,'image failure is actionable, not an indefinite loading status');
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,position:'textEffects'},settings:{...s.settings,textEffects:{...s.settings.textEffects,rules:s.settings.textEffects.rules.map((r,i)=>i?r:{...r,color:'#66cc6600'})}}});})()");await settle();
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.setup-effects-example>div')).color"),'rgba(102, 204, 102, 0)','saved alpha is preserved');
  for(const width of [1040,320]){
    await resize(width,820);
    const preset='.setup-effects-fields>.button-row:first-child>button:first-child';
    const save='.setup-effects-fields>.button-row:last-child>button:first-child';
    const cancel='.setup-effects-fields>.button-row:last-child>button:last-child';
    const selection='.setup-effects-fields>label>select';
    await click(preset);
    await evaluate(`document.querySelector(${JSON.stringify(cancel)}).scrollIntoView({block:'center'});document.querySelector(${JSON.stringify(cancel)}).focus({preventScroll:true})`);
    await click(cancel);
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selection)})`),true,'cancel restores rule selection focus '+width);
    for(const elsewhere of [false,true]){
      await click(preset);
      await evaluate(`document.querySelector(${JSON.stringify(save)}).scrollIntoView({block:'center'});document.querySelector(${JSON.stringify(save)}).focus({preventScroll:true});boardManagementHarness.holdNextSave()`);
      if(!elsewhere)await evaluate("boardManagementHarness.failNextSave('ルールを保存できませんでした。')");
      await click(save);
      assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(save)})`),true,'pending rule save keeps origin focus');
      if(elsewhere)await evaluate("document.querySelector('.text-effects-panel .setup-step-card:nth-child(2) input').focus({preventScroll:true})");
      await evaluate('boardManagementHarness.releaseSave()');await settle();
      if(!elsewhere){
        assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(save)})`),true,'failed save retains origin for retry');
        await click(save);
      }
      assert.equal(await evaluate(elsewhere?"document.activeElement===document.querySelector('.text-effects-panel .setup-step-card:nth-child(2) input')":`document.activeElement===document.querySelector(${JSON.stringify(selection)})`),true,'save completion respects focus '+width+'/'+elsewhere);
    }
    const rulesBefore=await evaluate('JSON.stringify(boardManagementHarness.snapshot().settings.textEffects.rules)');
    await click(preset);
    await evaluate("boardManagementHarness.holdNextSave();boardManagementHarness.failNextSave('追加保存に失敗しました。')");
    await click(save);await evaluate('boardManagementHarness.releaseSave()');await settle();
    await evaluate(`document.querySelector(${JSON.stringify(cancel)}).focus({preventScroll:true});boardManagementHarness.holdNextSave();boardManagementHarness.failNextSave('取消保存に失敗しました。')`);
    await click(cancel);await click(cancel);await evaluate('boardManagementHarness.releaseSave()');await settle();
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(cancel)})`),true,'failed cancellation retains origin '+width);
    assert.equal(await evaluate("document.querySelector('.text-effects-panel .setup-creative-status').textContent.includes('取消保存に失敗しました。')"),true,'failed cancellation remains actionable '+width);
    await click(cancel);
    assert.equal(await evaluate('JSON.stringify(boardManagementHarness.snapshot().settings.textEffects.rules)'),rulesBefore,'cancel restores the saved rule list '+width);
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selection)})`),true,'repeated cancellation recovers focus '+width);
    assert.equal(await evaluate("document.querySelector('#setup-next').getAttribute('aria-disabled')"),'false','cancel clears shared unsaved state '+width);
  }
  return count;
}
