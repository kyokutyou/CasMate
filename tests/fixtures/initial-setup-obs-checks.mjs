import { verifyInitialSetupReadyColors } from './initial-setup-ready-checks.mjs';
import assert from 'node:assert/strict';

export async function verifyInitialSetupObs({ evaluate, resize, capture }) {
  const original = await evaluate('({initialSetup:boardManagementHarness.snapshot().initialSetup,obsControl:boardManagementHarness.snapshot().obsControl,sourceStatuses:boardManagementHarness.snapshot().sourceStatuses})');
  const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 60))');
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await click('[data-page=settings]'); await click('#settings-application'); await click('#application-initial-setup');
  await settle();
  await verifyInitialSetupReadyColors({ evaluate, resize, capture });
  const update = values => evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,...${JSON.stringify(values)}},obsControl:{...s.obsControl,enabled:false,connection:'disabled',error:null}});})()`);
  let checks = 0;
  for (const theme of ['ocean', 'pearl']) for (const width of [760, 320]) {
    await resize(width, 760);
    await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:'large'}}});})()`);
    await update({position:'obsControl',selected:['commentOverlay']}); await settle();
    assert.equal(await evaluate("document.querySelector('.obs-control-panel .oc-operation-action').checkVisibility()"),true,'initial OBS retry action is visible');
    assert.match(await evaluate("document.querySelector('.oc-connection-body>.oc-details').textContent"), /「WebSocketサーバーを有効にする」と「認証を有効にする」にチェックします。/);
    await click('.oc-connection-body>.oc-details>summary'); await settle();
    assert.equal(await evaluate("document.querySelector('.oc-connection-body>.oc-details').open"),true);
    assert.match(await evaluate("document.querySelector('.oc-connection-body>.oc-details').textContent"), /「適用」でOBS側の変更を保存/);
    if (capture) await capture(`setup-obs-guide-${theme}-${width}.png`);
    await click('.oc-connection-body>.oc-details>summary'); await settle();
    for (const [feature, overlay] of [['commentOverlay','comments'],['speechRecognition','speech'],['textEffects','effects'],['character','character']]) {
      await update({position:'obsDisplay',selected:[feature]}); await settle();
      await click('#setup-register-'+overlay); await settle();
      const state = await evaluate(`(() => {const d=document.getElementById('obs-source-registration-dialog'),r=d.getBoundingClientRect();return {open:d.open,modal:d.matches(':modal'),fits:r.left>=0&&r.right<=innerWidth,status:d.querySelector('[aria-label="OBS登録の状態"]').textContent};})()`);
      assert.equal(state.open,true); assert.equal(state.modal,true); assert.equal(state.fits,true); assert.match(state.status,/OBS連携がOFF/);
      if (capture && overlay==='comments') await capture(`setup-obs-dialog-${theme}-${width}.png`);
      await click('#obs-source-registration-dialog [aria-label="閉じる"]'); await settle();
      assert.equal(await evaluate('document.activeElement.id'),'setup-register-'+overlay);
      await click('#setup-register-'+overlay); await settle();
      await update({position:'obsControl'}); await settle();
      assert.equal(await evaluate("document.getElementById('obs-source-registration-dialog').open"),false);
      checks++;
    }
  }
  for (const width of [1040,760,560,320]) {
    await resize(width, width === 760 ? 560 : 760);
    await evaluate("(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTheme:'ocean',managementTextSize:'medium'}}});})()");
    for (const position of ['sources','commentSpeech','obsControl','obsDisplay']) {
      await update({ position, selected:['sources','commentSpeech','commentOverlay'] }); await settle();
      const layout = await evaluate(`(() => {const r=n=>n.getBoundingClientRect(), review=r(document.querySelector('.setup-review')),edit=r(document.querySelector('.management-editor-content')),body=r(document.querySelector('.management-body')),footer=r(document.querySelector('.setup-footer'));return {width:innerWidth,wide:review.left>=edit.right,narrow:review.bottom<=edit.top+1,overlap:body.bottom>footer.top+1,overflow:document.documentElement.scrollWidth>innerWidth+1,footer:footer.bottom<=innerHeight+1};})()`);
      assert.equal(layout.width>760?layout.wide:layout.narrow,true,'C layout at '+width+'/'+position);
      assert.equal(layout.overlap,false,'footer is outside the scroll body');assert.equal(layout.overflow,false,'no horizontal overflow');assert.equal(layout.footer,true,'footer fits viewport');
      const structure = await evaluate(`(() => {const left=document.querySelector('.management-editor-content'),right=document.querySelector('.setup-review'),check=document.querySelector('.setup-confirm');return {leftCheck:left.contains(check),rightCheck:right.contains(check),nav:!!document.querySelector('.setup-topic-nav'),numbers:[...left.querySelectorAll('.setup-number')].filter(n=>n.checkVisibility()).map(n=>n.textContent),obsConnection:document.querySelector('.obs-control-panel').checkVisibility()};})()`);
      assert.equal(structure.leftCheck,true,'personal confirmation belongs to final input step');assert.equal(structure.rightCheck,false,'review shows results only');assert.equal(structure.nav,true,'C topic navigation');
      if(position!=='obsControl')assert.deepEqual(structure.numbers,['1','2','3'],'C has three numbered cards at '+position);
      if(position==='obsDisplay')assert.equal(structure.obsConnection,false,'OBS display excludes the connection form');
      if(position==='obsControl') {
        await evaluate("document.querySelector('.setup-obs-connect').focus({preventScroll:true})");
        const measure=()=>evaluate("(()=>{const n=document.querySelector('.setup-obs-connect'),r=n.getBoundingClientRect(),b=document.querySelector('.management-body');return{rect:[r.x,r.y,r.width,r.height],scroll:b.scrollTop,height:b.scrollHeight,focus:document.activeElement===n};})()");
        const before=await measure();
        for(const [connection,label,guide] of [['disabled','連携オフ','接続情報'],['connecting','接続中','OBSとの接続を待っています'],['connected','接続済み','次はOBS上の表示を確認'],['unavailable','利用不可','認証を確認してください。']]) {
          await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({obsControl:{...s.obsControl,enabled:${connection!=='disabled'},connection:${JSON.stringify(connection)},error:${connection==='unavailable'?JSON.stringify('認証を確認してください。'.repeat(20)):'null'}}});})()`);await settle();
          assert.equal(await evaluate(`document.querySelector('.obs-control-panel .oc-live-top').textContent.includes(${JSON.stringify(label)})`),true,'OBS state is distinct '+connection+'/'+width);
          assert.equal(await evaluate(`document.querySelector('.setup-review-state').textContent.includes(${JSON.stringify(guide)})`),true,'OBS review shows the next action '+connection+'/'+width);
          assert.deepEqual(await evaluate("(()=>{const n=document.querySelector('.obs-control-panel .oc-operation-action');return {visible:n.checkVisibility(),disabled:n.getAttribute('aria-disabled'),label:n.textContent};})()"),{visible:true,disabled:String(connection!=='unavailable'),label:'OBS接続を再試行'},'retry is reachable only when needed '+connection+'/'+width);
          assert.deepEqual(await measure(),before,'OBS state update retains geometry/focus '+connection+'/'+width);
        }
        await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({obsControl:{...s.obsControl,enabled:false,connection:'disabled',error:null}});})()");await settle();
      }
      if(position==='obsDisplay') {
        const fields = await evaluate("(()=>{const mode=document.querySelector('.setup-mode-field').getBoundingClientRect(),font=document.querySelector('.comment-overlay-panel .card-details>.overlay-setting-section:nth-child(2)').getBoundingClientRect();return {sameRow:Math.abs(mode.top-font.top)<1,sideBySide:font.left>=mode.right,stacked:font.top>=mode.bottom-1};})()");
        assert.equal(width>430?fields.sameRow&&fields.sideBySide:fields.stacked,true,'C mode and font fields share a row except at narrow width');
        if(capture && width===1040) {
          const scroll = await evaluate("(()=>{const body=document.querySelector('.management-body'),panel=document.querySelector('.comment-overlay-panel'),before=body.scrollTop;body.scrollTop+=panel.getBoundingClientRect().top-body.getBoundingClientRect().top;return before;})()");
          await capture('setup-c-obsDisplay-settings-1040.png');
          await evaluate(`document.querySelector('.management-body').scrollTop=${scroll}`);
        }
      }
      if(capture)await capture(`setup-c-${position}-${width}.png`);
    }
    await update({position:'sources',selected:['sources']});await settle();
    const read = () => evaluate("document.getElementById('source-youtube').value");
    const before = await read();
    await evaluate("[...document.querySelectorAll('.setup-source-selector button')].find(b=>b.textContent==='Twitch').click()");await settle();
    assert.equal(await evaluate("document.getElementById('source-youtube').checkVisibility()"),false);
    await evaluate("[...document.querySelectorAll('.setup-source-selector button')].find(b=>b.textContent==='YouTube').click()");await settle();
    assert.equal(await read(),before,'service selection retains input');
    if (width===320) {
      await evaluate("(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTextSize:'large'}}});})()");await settle();
      const geometry = () => evaluate("(()=>{const e=document.querySelector('.setup-confirm'),b=document.querySelector('.management-body'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,scroll:b.scrollTop,height:b.scrollHeight}})()");
      const initial = await geometry();
      await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({sourceStatuses:{...s.sourceStatuses,youtube:{...s.sourceStatuses.youtube,state:'waiting'}}})})()");await settle();
      assert.deepEqual(await geometry(),initial,'three-line waiting status reserves space at 320px/large');
    }
  }
  await resize(1040,760);
  await update({position:'obsControl',selected:['commentOverlay']});await settle();
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({obsControl:{...s.obsControl,enabled:true,connection:'unavailable',error:'接続先を確認してください。'}});})()");await settle();
  const beforeRetry=await evaluate("boardManagementHarness.trace().filter(n=>n.path==='/api/obs-control/retry').length");
  await evaluate("(()=>{const n=document.querySelector('.obs-control-panel .oc-operation-action');n.focus();n.click();})()");await settle();
  assert.equal(await evaluate("boardManagementHarness.trace().filter(n=>n.path==='/api/obs-control/retry').length"),beforeRetry+1,'initial setup can retry without leaving the screen');
  assert.equal(await evaluate("document.activeElement===document.querySelector('.obs-control-panel .oc-operation-action')"),true,'retry completion preserves focus');
  await update({position:'obsControl',selected:['commentOverlay']});await settle();
  const inputSelector='.oc-grid input[aria-label="OBS WebSocketポート"]';
  await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(inputSelector)});n.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'4456');n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
  const beforeDetail=await evaluate("boardManagementHarness.trace().filter(n=>n.path==='/api/obs-control/configure').length");
  await evaluate("document.querySelector('#setup-detail').focus();document.querySelector('#setup-detail').click()");await settle();
  assert.equal(await evaluate("boardManagementHarness.trace().filter(n=>n.path==='/api/obs-control/configure').length"),beforeDetail,'detail navigation does not save OBS connection');
  await click('.editor-heading .back-button');await settle();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).value`),'4456','OBS draft survives detail navigation');
  await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(inputSelector)});n.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'4455');n.dispatchEvent(new Event('input',{bubbles:true}));n.blur();})()`);await settle();
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTextSize:'medium'}}})})()");
  await update({position:'sources',selected:['sources','commentSpeech','commentOverlay'],confirmations:{}});await settle();
  await click('#setup-source-states');await settle();
  assert.equal(await evaluate("document.querySelector('.setup-all-source-states').open"),true);
  await click('#setup-detail');await settle();await click('.editor-heading .back-button');await settle();
  assert.equal(await evaluate("document.querySelector('.setup-all-source-states').open"),true,'source status disclosure survives detail navigation');
  await click('#setup-source-states');await settle();
  await evaluate("document.querySelector('.management-body').scrollTop=0;document.querySelector('#setup-topic-commentSpeech').focus({preventScroll:true});boardManagementHarness.holdNextMutation('進行を保存できませんでした。')");
  const navGeometry = () => evaluate("(()=>{const n=document.querySelector('#setup-topic-commentSpeech'),r=n.getBoundingClientRect(),b=document.querySelector('.management-body');return {x:r.x,y:r.y,w:r.width,h:r.height,scroll:b.scrollTop,height:b.scrollHeight,focus:document.activeElement.id}})()");
  const navBefore = await navGeometry();
  await click('#setup-topic-commentSpeech');await settle();
  assert.equal(await evaluate("document.querySelector('#setup-topic-commentSpeech').disabled"),false,'pending topic navigation remains focusable');
  assert.deepEqual(await navGeometry(),navBefore,'pending navigation retains geometry and focus');
  const navTrace = await evaluate('boardManagementHarness.trace().length');
  await click('#setup-topic-commentSpeech');await settle();
  assert.equal(await evaluate('boardManagementHarness.trace().length'),navTrace,'pending navigation cannot run twice');
  await evaluate('boardManagementHarness.releaseMutation()');await settle();
  assert.deepEqual(await navGeometry(),navBefore,'failed navigation retains geometry and focus');
  assert.equal(await evaluate('boardManagementHarness.snapshot().initialSetup.position'),'sources');
  await click('#setup-topic-commentSpeech');await settle();
  assert.equal(await evaluate('boardManagementHarness.snapshot().initialSetup.position'),'commentSpeech');
  assert.equal(await evaluate('document.activeElement.id'),'setup-heading');
  await update({position:'obsDisplay',confirmations:{}});await settle();
  await click('#setup-confirm-obsDisplay');await settle();
  assert.equal(await evaluate("document.querySelector('#setup-confirm-obsDisplay').getAttribute('aria-checked')"),'true');
  await evaluate("document.querySelector('#setup-confirm-obsDisplay').focus({preventScroll:true});boardManagementHarness.holdNextMutation('確認記録を保存できませんでした。')");
  await click('#setup-confirm-obsDisplay');await settle();
  assert.equal(await evaluate("document.querySelector('#setup-confirm-obsDisplay').getAttribute('aria-checked')"),'true','pending unconfirm retains the saved record');
  await evaluate('boardManagementHarness.releaseMutation()');await settle();
  assert.equal(await evaluate("document.querySelector('#setup-confirm-obsDisplay').getAttribute('aria-checked')"),'true','failed unconfirm retains the saved record');
  assert.equal(await evaluate('document.activeElement.id'),'setup-confirm-obsDisplay');
  await click('#setup-confirm-obsDisplay');await settle();
  assert.equal(await evaluate("document.querySelector('#setup-confirm-obsDisplay').getAttribute('aria-checked')"),'false','unconfirm succeeds only after persistence');
  await click('[data-page=home]'); await settle();
  assert.equal(await evaluate("document.getElementById('page-heading').textContent"),'配信のホーム');
  await evaluate(`boardManagementHarness.updateSnapshot(${JSON.stringify(original)})`);
  return checks;
}
