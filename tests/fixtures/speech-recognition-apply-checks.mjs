import assert from 'node:assert/strict';

export async function verifySpeechRecognitionApply({ evaluate, resize, capture, setZoom, resizeMinimum, pressKey, settle }) {
  settle ??= () => evaluate(`new Promise((resolve,reject) => {
    const timer=setTimeout(() => reject(new Error('Recognition layout did not render two frames')),3000);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  })`);
  await evaluate(`document.querySelector('.management-nav [data-page=settings]').click()`);
  await settle();
  await evaluate("document.getElementById('settings-speechRecognition').click()");
  await settle();
  assert.equal(await evaluate("[...document.querySelectorAll('.management-body summary')].some(node=>['モデル情報・ライセンス','OBSへの表示・関連機能'].includes(node.textContent.trim()))"),false,'removed recognition disclosures are absent');
  assert.equal(await evaluate("Boolean(document.querySelector('.recognition-url,#recognition-obs-display,#recognition-appearance,#recognition-obs-control'))"),false,'removed recognition links leave no empty elements');
  if (pressKey) {
    await evaluate("document.querySelector('.recognition-recovery summary').focus()");
    await pressKey('Enter'); await settle();
    assert.equal(await evaluate("document.querySelector('.recognition-recovery').open"), true, 'recovery opens with keyboard');
    await pressKey('Enter'); await settle();
    assert.equal(await evaluate("document.querySelector('.recognition-recovery').open"), false, 'recovery closes with keyboard');
  }
  const measure = `(() => { const panel=document.querySelector('.recognition-apply'), body=document.querySelector('.management-body');
    return {boxes:[...panel.querySelectorAll('button,.recognition-apply-state')].map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),
      height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement===panel.lastElementChild,overflow:body.scrollWidth>body.clientWidth}; })()`;
  const runtimeMeasure = `(() => { const body=document.querySelector('.management-body');
    return {boxes:[...document.querySelectorAll('.recognition-master,.recognition-master [role=switch],.recognition-model,.recognition-model-actions button,.recognition-apply,.recognition-preview-heading,.recognition-preview-heading button,.recognition-input-use,.recognition-input-name,.recognition-input-help,.recognition-preview-state,.recognition-state-heading,.recognition-state-message,.recognition-latest,.recognition-recovery summary,.recognition-recovery button')].filter(node=>node.checkVisibility()).map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),
      height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement?.className,overflow:body.scrollWidth>body.clientWidth}; })()`;
  const buttonTextFits = `(() => [...document.querySelectorAll('.speech-recognition-panel button')].filter(button=>button.checkVisibility()).every(button=>{
    const r=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button);
    return [...range.getClientRects()].every(t=>t.left>=r.left-.1&&t.right<=r.right+.1&&t.top>=r.top-.1&&t.bottom<=r.bottom+.1);
  }))()`;
  let checks = 0;
  for (const theme of ['ocean', 'pearl']) for (const size of ['small', 'medium', 'large']) for (const width of [1200,760,560,480,320]) {
    const label = `${theme}/${size}/${width}`;
    await resize(width, width === 760 ? 560 : 760);
    assert.equal(await evaluate('innerWidth'), width, `${label}: resize completed`);
    await evaluate(`(() => { const snapshot=boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({settings:{...snapshot.settings,speechRecognition:{...snapshot.settings.speechRecognition,inputSource:'microphone',microphoneId:'mic-a'},application:{...snapshot.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:${JSON.stringify(size)}}},speechRecognition:{...snapshot.speechRecognition,settingsRevision:undefined,modelStatus:'ready',status:'disabled',previewActive:false,warning:null,sessionId:null,previewHistory:[],microphones:[{id:'mic-a',name:'配信用マイク'},{id:'mic-b',name:'確認用マイク'}]}}); })()`);
    await settle();
    await evaluate("document.querySelector('.management-body').scrollTop=0");
    if (size==='medium' && width===760) {
      const compact = await evaluate("(()=>{const body=document.querySelector('.management-body'),preview=document.querySelector('.recognition-preview-heading').getBoundingClientRect();return {preview:preview.top+body.scrollTop,master:document.querySelector('.recognition-master').getBoundingClientRect().height,model:document.querySelector('.recognition-model').getBoundingClientRect().height};})()");
      assert.ok(compact.preview<=850, `${label}: compact preview begins within 850px (${compact.preview})`);
      assert.ok(compact.master<=165, `${label}: compact master section (${compact.master})`);
      assert.ok(compact.model<=80, `${label}: compact ready model (${compact.model})`);
    }
    if (capture && size==='medium' && [760,560,320].includes(width)) await capture(`recognition-compact-${theme}-${width}.png`);
    await evaluate("document.querySelector('.recognition-apply').scrollIntoView({block:'center'}); document.querySelector('.recognition-apply').lastElementChild.focus({preventScroll:true})");
    const before = await evaluate(measure);
    assert.equal(before.overflow, false, label);
    const textFits = await evaluate(`(() => [...document.querySelectorAll('.recognition-apply > button')].every(button=>{
      const r=button.getBoundingClientRect(),range=document.createRange(); range.selectNodeContents(button);
      return [...range.getClientRects()].every(t=>t.left>=r.left && t.right<=r.right && t.top>=r.top && t.bottom<=r.bottom);
    }))()`);
    assert.equal(textFits, true, `${label}: button labels stay inside their bounds`);
    await evaluate(`(() => { const node=document.querySelector('[aria-label="VAD閾値"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,node.value==='0.42'?'0.43':'0.42'); node.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await settle();
    assert.equal(await evaluate("document.querySelector('.recognition-apply-status').dataset.dirty"), 'true', label);
    assert.deepEqual(await evaluate(measure), before, `${label}: dirty status preserves positions`);
    const highlight = await evaluate(`(() => { const s=getComputedStyle(document.querySelector('.recognition-apply-status')); return {weight:Number(s.fontWeight),color:s.color,background:s.backgroundColor,border:s.borderLeftColor}; })()`);
    assert.ok(highlight.weight >= 700, `${label}: status is bold`);
    assert.notEqual(highlight.background, 'rgba(0, 0, 0, 0)', `${label}: warning has a background`);
    assert.equal(highlight.border, highlight.color, `${label}: warning has a colored left border`);
    if (capture && size === 'large' && [1200,320].includes(width)) await capture(`recognition-unapplied-${theme}-${width}.png`);
    await evaluate('boardManagementHarness.holdNextSave(); document.querySelector(".recognition-apply").lastElementChild.click()');
    await settle();
    assert.equal(await evaluate('document.querySelector(".recognition-apply").lastElementChild.textContent'), '適用中…');
    assert.deepEqual(await evaluate(measure), before, `${label}: applying preserves positions and focus`);
    await evaluate('boardManagementHarness.releaseSave()');
    await settle();
    assert.equal(await evaluate("document.querySelector('.recognition-apply-status').dataset.dirty"), 'false', label);
    assert.deepEqual(await evaluate(measure), before, `${label}: applied status and toast preserve positions`);
    await evaluate(`(() => { const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({
      settings:{...s.settings,speechRecognition:{...s.settings.speechRecognition,inputSource:'microphone',microphoneId:'mic-a'}},
      speechRecognition:{...s.speechRecognition,modelStatus:'ready',status:'listening',warning:null,previewActive:true,sessionId:'current',
        microphones:[{id:'mic-a',name:'配信用のマイク・長い入力名'.repeat(8)},{id:'mic-b',name:'確認用マイク'}],
        previewHistory:[{id:'result',sessionId:'current',sequence:1,recognizedAt:'2026-10-16T00:00:00Z',text:'前回の認識結果です。'.repeat(30),audioDurationMilliseconds:1000,recognitionDurationMilliseconds:120}]}});})()`);
    await settle();
    await evaluate("document.querySelector('.recognition-preview-state').scrollIntoView({block:'center'});document.querySelector('.recognition-preview-state').focus({preventScroll:true})");
    const stable = await evaluate(runtimeMeasure);
    assert.equal(stable.overflow, false, `${label}: long input name fits`);
    const stateLayout = await evaluate("(()=>{const n=document.querySelector('.recognition-preview-state');return {buttons:n.querySelectorAll('button').length,rows:getComputedStyle(n).gridTemplateRows.split(' ').length};})()");
    assert.deepEqual(stateLayout, {buttons:0,rows:2}, `${label}: removed navigation leaves no button or reserved row`);
    for (const enabled of [true,false]) {
      await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,speechRecognition:{...s.settings.speechRecognition,enabled:${enabled}}}});})()`); await settle();
      assert.equal(await evaluate("document.querySelector('.recognition-master h3').textContent"), '配信に使う');
      assert.equal(await evaluate("document.querySelector('.recognition-master [role=switch]').getAttribute('aria-checked')"), String(enabled));
      assert.deepEqual(await evaluate(runtimeMeasure), stable, `${label}: saved usage change preserves positions, scroll and focus`);
    }

    for (const [status,modelStatus] of [['disabled','missing'],['preparing','downloading'],['preparing','extracting'],['preparing','validating'],['listening','ready'],['speechDetected','ready'],['recognizing','ready'],['waitingForInput','ready'],['unavailable','ready'],['unavailable','failed']]) {
      await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({speechRecognition:{...s.speechRecognition,status:${JSON.stringify(status)},modelStatus:${JSON.stringify(modelStatus)},modelDownloadProgress:${modelStatus==='downloading'?'1':'null'},sessionId:${status==='waitingForInput'?'null':"'current'"},warning:${status==='unavailable'?JSON.stringify('マイクにアクセスできません。Windowsの権限と入力の接続を確認してください。'.repeat(12)):'null'}}});})()`);
      await settle();
      assert.deepEqual(await evaluate(runtimeMeasure), stable, `${label}/${status}/${modelStatus}: state and previous result preserve geometry, scroll and focus`);
      assert.equal(await evaluate('document.activeElement===document.querySelector(".recognition-preview-state")'), true, `${label}: status keeps focus`);
      assert.equal(await evaluate(buttonTextFits), true, `${label}/${status}/${modelStatus}: button text fits`);
      if (status==='waitingForInput') assert.equal(await evaluate("document.querySelector('.recognition-latest').textContent.includes('前の入力・セッションの認識結果')"), true);
    }
    if (size==='medium' && width===320) {
      await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({speechRecognition:{...s.speechRecognition,status:'unavailable',warning:'マイクを利用できません。Windowsの設定でマイクのアクセス許可を確認してください。'}});})()"); await settle();
      const reason = await evaluate("(()=>{const p=document.querySelector('.recognition-state-message');return {fits:p.scrollHeight<=p.clientHeight+1,text:p.textContent};})()");
      assert.equal(reason.fits, true, `${label}: usual microphone error is fully visible`);
      assert.equal(reason.text, 'マイクを利用できません。Windowsの設定でマイクのアクセス許可を確認してください。');
      assert.deepEqual(await evaluate(runtimeMeasure), stable, `${label}: cause-first error preserves geometry`);
      if(capture)await capture(`recognition-cause-first-${theme}-${width}.png`);
    }
    await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({speechRecognition:{...s.speechRecognition,modelStatus:'ready',status:'unavailable',previewActive:false,warning:null}});})()`);
    await settle();
    await evaluate("document.querySelector('.recognition-preview-heading button').focus({preventScroll:true})");
    const beforeInput = await evaluate(runtimeMeasure);
    await evaluate("(()=>{const input=document.querySelector('.recognition-microphone select');input.value='mic-b';input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await settle();
    assert.deepEqual(await evaluate(runtimeMeasure), beforeInput, `${label}: unapplied input preserves positions`);
    assert.equal(await evaluate("[...document.querySelectorAll('.recognition-input-use')].every(node=>node.textContent.includes('配信用のマイク')&&node.textContent.includes('入力の変更は未適用です'))"), true);
    await evaluate("document.querySelector('.recognition-preview-heading button').click()"); await settle();
    assert.equal(await evaluate("boardManagementHarness.trace().at(-1).path"), '/api/speech-recognition/preview/start');
    assert.deepEqual(await evaluate(runtimeMeasure), beforeInput, `${label}: preview request keeps draft and layout`);
    await evaluate("document.querySelector('.recognition-model-actions button').focus({preventScroll:true});boardManagementHarness.holdNextMutation()");
    const beforeRetry = await evaluate(runtimeMeasure);
    const retries = await evaluate("boardManagementHarness.trace().filter(t=>t.path==='/api/speech-recognition/retry').length");
    await evaluate("document.querySelector('.recognition-model-actions button').click();document.querySelector('.recognition-model-actions button').click()"); await settle();
    assert.equal(await evaluate("document.querySelector('.recognition-model-actions button').textContent"), '再試行中…');
    assert.deepEqual(await evaluate(runtimeMeasure), beforeRetry, `${label}: retry pending preserves focus and positions`);
    await evaluate('boardManagementHarness.releaseMutation()'); await settle();
    assert.deepEqual(await evaluate(runtimeMeasure), beforeRetry, `${label}: retry success preserves focus and positions`);
    assert.equal(await evaluate("boardManagementHarness.trace().filter(t=>t.path==='/api/speech-recognition/retry').length"), retries + 1);
    await evaluate("document.querySelector('.recognition-apply').lastElementChild.focus({preventScroll:true});boardManagementHarness.failNextSave('別の画面で設定が変更されました。','SPEECH_SETTINGS_CONFLICT')");
    const beforeConflict = await evaluate(runtimeMeasure);
    await evaluate("document.querySelector('.recognition-apply').lastElementChild.click()"); await settle();
    assert.deepEqual(await evaluate(runtimeMeasure), beforeConflict, `${label}: conflict preserves layout and focus`);
    assert.equal(await evaluate("document.querySelector('.recognition-recovery').open"), false, `${label}: conflict does not expand recovery`);
    assert.equal(await evaluate("document.querySelector('.recognition-recovery summary').textContent.includes('要確認')"), true);
    await evaluate("document.querySelector('.recognition-recovery summary').click()"); await settle();
    assert.equal(await evaluate(buttonTextFits), true, `${label}: recovery label fits`);
    await evaluate("document.querySelector('.recognition-recovery button').focus({preventScroll:true})");
    const beforeReload = await evaluate(runtimeMeasure);
    await evaluate("document.querySelector('.recognition-recovery button').click()"); await settle();
    assert.deepEqual(await evaluate(runtimeMeasure), beforeReload, `${label}: importing current input preserves layout and focus`);
    assert.equal(await evaluate("document.querySelector('.recognition-microphone select').value"), 'mic-a');
    if (size==='medium' && [760,320].includes(width)) {
      await evaluate("document.querySelector('.recognition-recovery summary').click()"); await settle();
      await evaluate("document.querySelector('.recognition-preview-heading button').focus({preventScroll:true});boardManagementHarness.holdNextMutation('認識を開始できません。入力を確認してください。')");
      const beforeFailure = await evaluate(runtimeMeasure);
      await evaluate("document.querySelector('.recognition-preview-heading button').click()"); await settle();
      assert.deepEqual(await evaluate(runtimeMeasure), beforeFailure, `${label}: preview pending preserves layout`);
      await evaluate('boardManagementHarness.releaseMutation()'); await settle();
      assert.deepEqual(await evaluate(runtimeMeasure), beforeFailure, `${label}: preview failure and notice preserve layout`);
      assert.equal(await evaluate("document.activeElement===document.querySelector('.recognition-preview-heading button')"), true);
      await evaluate("document.querySelector('.recognition-model-actions button').focus({preventScroll:true});boardManagementHarness.holdNextMutation('再試行できません。入力を確認してください。')");
      const beforeRetryFailure = await evaluate(runtimeMeasure);
      await evaluate("document.querySelector('.recognition-model-actions button').click()"); await settle();
      assert.deepEqual(await evaluate(runtimeMeasure), beforeRetryFailure, `${label}: retry failure pending preserves layout`);
      await evaluate('boardManagementHarness.releaseMutation()'); await settle();
      assert.deepEqual(await evaluate(runtimeMeasure), beforeRetryFailure, `${label}: retry failure preserves layout`);
      assert.equal(await evaluate("document.activeElement===document.querySelector('.recognition-model-actions button')"), true);
      assert.equal(await evaluate("document.querySelector('.recognition-microphone select').value"), 'mic-a');
      await evaluate("document.querySelector('.recognition-recovery summary').click()"); await settle();
    }
    if (capture && size==='medium' && [760,320].includes(width)) {
      await evaluate("document.querySelector('.recognition-master').scrollIntoView({block:'start'})"); await capture(`recognition-input-${theme}-${width}.png`);
      await evaluate("document.querySelector('.recognition-preview-heading').scrollIntoView({block:'start'})"); await capture(`recognition-runtime-${theme}-${width}.png`);
    }
    await evaluate("document.querySelector('.recognition-recovery summary').click();document.querySelector('.recognition-apply').lastElementChild.click()"); await settle();
    checks++;
  }
  if (setZoom && resizeMinimum) {
    for (const factor of [1,1.25,1.5]) {
      await setZoom(factor); await resizeMinimum(); await settle();
      assert.equal((await evaluate(runtimeMeasure)).overflow, false, `native minimum/zoom ${factor}: no horizontal overflow`);
      for (const selector of ['.recognition-master [role=switch]','.recognition-model-actions button','.recognition-preview-state','.recognition-preview-heading button']) {
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
        const box = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),b=document.querySelector('.management-body').getBoundingClientRect();return {top:r.top,bottom:r.bottom,bodyTop:b.top,bodyBottom:b.bottom};})()`);
        assert.ok(box.bottom>box.bodyTop&&box.top<box.bodyBottom, `native minimum/zoom ${factor}: ${selector} is reachable`);
      }
    }
    await setZoom(1); await resize(760,560); await settle();
  }
  await evaluate("document.querySelector('.editor-heading-row .back-button').click()");
  await settle();
  assert.equal(await evaluate('document.activeElement.id'), 'settings-speechRecognition');
  return checks;
}
