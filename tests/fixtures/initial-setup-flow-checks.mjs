import assert from 'node:assert/strict';
import { verifyInitialSetupSpeech } from './initial-setup-speech-checks.mjs';
import { verifyInitialSetupRecovery } from './initial-setup-recovery-checks.mjs';

export async function verifyInitialSetupFlow({ evaluate, resize, capture, press }) {
  const settle=()=>evaluate('new Promise(resolve=>setTimeout(resolve,70))');
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settle();};
  const update=async value=>{await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,...${JSON.stringify(value)}}});})()`);await settle();};
  const open=async()=>{await click('[data-page=settings]');await click('#settings-application');await click('#application-initial-setup');};
  await open();await resize(1040,820);
  const selected=['sources','commentSpeech','commentOverlay','smartphone','speechRecognition','aiListener','textEffects','character'];
  const steps=['sources','commentSpeech','smartphone','speechRecognition','obsControl','aiListener','textEffects','character','obsDisplay'];
  if (press) for (const width of [1040,320]) {
    await resize(width,820);
    for (const [index,position] of ['welcome','features',...steps,'summary'].entries()) {
      await update({position,selected,smartphoneUses:['comments'],warning:null});
      await evaluate("document.querySelector('#setup-heading').focus({preventScroll:true})");
      await press('Tab');await settle();
      assert.equal(await evaluate("(()=>{const n=document.activeElement,r=n.getBoundingClientRect();return n.matches('button,input,select,a,summary')&&r.width>0&&r.height>0&&!n.closest('[hidden]');})()"),true,'Tab reaches a visible control '+position+'/'+width);
      await press('Tab',true);await settle();
      assert.equal(await evaluate("(()=>{const n=document.activeElement,r=n.getBoundingClientRect();return n.matches('button,input,select,a,summary')&&r.width>0&&r.height>0&&!n.closest('[hidden]');})()"),true,'Shift+Tab reaches a visible control '+position+'/'+width);
      const target=position==='summary'?'#setup-back':'#setup-next';
      await evaluate(`document.querySelector(${JSON.stringify(target)}).focus({preventScroll:true})`);
      await press(index%2?'Space':'Enter');await settle();
      const expected=position==='summary'?'features':['welcome','features',...steps,'summary'][index+1];
      assert.equal(await evaluate("document.querySelector('.initial-setup[data-setup-position]').dataset.setupPosition"),expected,'keyboard navigation '+position+'/'+width);
      assert.equal(await evaluate('document.activeElement.id'),'setup-heading','keyboard move restores heading '+position+'/'+width);
    }
  }
  await resize(1040,820);
  for(const action of ['next','back','defer','finish']){
    await update({selected:['sources'],position:action==='finish'?'summary':'sources',warning:null});
    const selector=action==='defer'?'#setup-defer-sources':'#setup-'+action;
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
    const measure=()=>evaluate(`(()=>{const b=document.querySelector('.management-body'),n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect();return{rect:[r.x,r.y,r.width,r.height],scroll:b.scrollTop,height:b.scrollHeight,focus:document.activeElement===n};})()`);
    const before=await measure();const trace=await evaluate('boardManagementHarness.trace().length');
    await evaluate("boardManagementHarness.holdNextMutation('進行記録を保存できませんでした。')");await click(selector);await click(selector);
    assert.equal(await evaluate('boardManagementHarness.trace().length'),trace+1,'duplicate '+action);
    assert.deepEqual(await measure(),before,'pending '+action+' keeps geometry/focus');
    await evaluate('boardManagementHarness.releaseMutation()');await settle();
    assert.deepEqual(await measure(),before,'failed '+action+' keeps geometry/focus');
    await click(selector);
    if(action==='finish'){assert.equal(await evaluate("!!document.querySelector('.initial-setup[data-setup-position]')"),false);await open();}
  }
  await update({position:'welcome',selected,smartphoneUses:['comments'],deferred:[],confirmations:{}});
  const traceStart=await evaluate('boardManagementHarness.trace().length');
  await click('#setup-next');await click('#setup-next');
  for(const step of steps){assert.equal(await evaluate("document.querySelector('.initial-setup[data-setup-position]').dataset.setupPosition"),step);await evaluate(`document.querySelector('#setup-defer-${step}').focus({preventScroll:true})`);await click('#setup-defer-'+step);assert.equal(await evaluate('document.activeElement.id'),'setup-heading','defer advances focus '+step);}
  assert.equal(await evaluate("document.querySelector('.initial-setup[data-setup-position]').dataset.setupPosition"),'summary');
  assert.deepEqual(await evaluate('boardManagementHarness.snapshot().initialSetup.deferred'),steps);
  await click('#setup-finish');await open();
  assert.equal(await evaluate("document.querySelector('.initial-setup[data-setup-position]').dataset.setupPosition"),'summary','reopens summary');
  assert.equal(await evaluate(`boardManagementHarness.trace().slice(${traceStart}).every(item=>item.path==='/api/management/initial-setup')`),true,'walking steps never starts/saves a feature');
  await verifyInitialSetupSpeech({evaluate,resize,capture});
  for(const width of [1040,320]){
    await resize(width,760);
    for(const [feature,position] of [['commentSpeech','commentSpeech'],['textEffects','textEffects'],['commentOverlay','obsDisplay'],['smartphone','smartphone']]){
      await update({selected:[feature],smartphoneUses:['comments'],position});
      assert.equal(await evaluate("document.querySelector('.management-body').scrollWidth<=document.querySelector('.management-body').clientWidth+1"),true,'single feature fits '+width+'/'+feature);
      await click('#setup-topic-sources');assert.equal(await evaluate("document.querySelector('.initial-setup[data-setup-position]').dataset.setupPosition"),'sources');
      await click('#setup-topic-'+(position==='obsDisplay'?'obsControl':position));if(position==='obsDisplay')await click('#setup-next');assert.equal(await evaluate("document.querySelector('.initial-setup[data-setup-position]').dataset.setupPosition"),position);
      if(capture&&feature==='commentOverlay')await capture('flow-comment-prerequisite-'+width+'.png');
    }
  }
  await update({position:'speechRecognition',selected:['aiListener']});
  assert.equal(await evaluate("document.querySelector('.setup-recognition-note').textContent.includes('字幕が必要になったら')"),true);
  for(const feature of ['textEffects','character']){
    await update({position:'obsDisplay',selected:[feature]});await click('#setup-detail');
    assert.equal(await evaluate("document.querySelector('#editor-heading').textContent"),feature==='textEffects'?'コメント文字演出':'キャラクター');
    await click('.editor-heading .back-button');assert.equal(await evaluate('document.activeElement.id'),'setup-detail');
  }
  await update({position:'sources',selected:['sources'],warning:'進行記録を確認できません。'});
  await evaluate("document.querySelector('#setup-reload').focus({preventScroll:true})");await click('#setup-reload');
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),'進行記録の状態','reload success retains a safe focus');
  await update({position:'welcome',selected:['character'],warning:'進行記録を確認できません。'});
  await evaluate("boardManagementHarness.holdNextMutation();document.querySelector('#setup-reload').focus({preventScroll:true})");
  await click('#setup-reload');
  await update({position:'character'});
  await evaluate('boardManagementHarness.releaseMutation()');await settle();
  assert.equal(await evaluate('document.activeElement.id'),'setup-heading','reload to another step restores heading focus');
  await update({position:'smartphone',selected:['smartphone'],smartphoneUses:[]});
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({smartphone:{...s.smartphone,available:true,settings:{...s.smartphone.settings,activeNetwork:'lan'}}});})()");await settle();
  await evaluate("(()=>{const n=document.querySelector('.setup-phone-network select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,'lan');n.dispatchEvent(new Event('change',{bubbles:true}));})()");await settle();
  assert.equal(await evaluate("document.querySelector('.setup-phone-preparation').getAttribute('aria-disabled')"),'false','empty uses allow stopping an active route');
  await click('.setup-phone-preparation');
  assert.deepEqual(await evaluate('boardManagementHarness.trace().at(-1).body'),{activeNetwork:null},'empty uses stop the active route');
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({smartphone:{...s.smartphone,settings:{...s.smartphone.settings,activeNetwork:null}}});})()");await settle();
  const stopped=await evaluate('boardManagementHarness.trace().length');await click('.setup-phone-preparation');
  assert.equal(await evaluate('boardManagementHarness.trace().length'),stopped,'empty uses still prevent starting a route');
  await verifyInitialSetupRecovery({evaluate,resize});
}
