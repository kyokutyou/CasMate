import assert from 'node:assert/strict';

export async function verifyAiSettings({ evaluate, resize, capture }) {
  const ready = async condition => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await evaluate(condition)) return;
      await evaluate('new Promise(resolve => setTimeout(resolve, 70))');
    }
    throw new Error('AI settings did not reach ' + condition);
  };
  await evaluate(`(() => { const state = boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({aiListener:{...state.aiListener,hasKey:true,requested:false}});
    document.querySelector('.management-nav [data-page=settings]').click(); })()`);
  await ready("document.getElementById('page-heading')?.textContent==='設定'");
  await evaluate("document.getElementById('settings-aiListener').click()");
  await ready("document.getElementById('editor-heading')?.textContent==='AIリスナー'");
  const measure = `(() => { const panel = document.querySelector('.ai-api-test'), body = document.querySelector('.management-body');
    return {boxes:[...panel.querySelectorAll('button,.ai-api-test-status')].map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),
      height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement===panel.querySelector('button'),overflow:body.scrollWidth>body.clientWidth}; })()`;
  for (const [width, height] of [[760, 560], [560, 760], [320, 760]]) {
    await resize(width, height);
    await evaluate("document.getElementById('ai-tab-connections').click()");
    await ready("!document.getElementById('ai-panel-connections').hidden");
    await evaluate(`document.querySelector('.ai-api-test-button').scrollIntoView({block:'center'}); document.querySelector('.ai-api-test-button').focus({preventScroll:true}); boardManagementHarness.holdNextSave()`);
    const before = await evaluate(measure); assert.equal(before.overflow, false);
    await evaluate("document.querySelector('.ai-api-test-button').click()");
    await ready("document.querySelector('.ai-api-test-button').getAttribute('aria-busy')==='true'");
    assert.deepEqual(await evaluate(measure), before, `${width}: API processing preserves layout/focus`);
    await evaluate('boardManagementHarness.releaseSave()');
    await ready("document.querySelector('.ai-api-test-status').textContent.includes('文章応答を確認しました')");
    assert.deepEqual(await evaluate(measure), before, `${width}: API success/toast preserves layout/focus`);
    if (capture) await capture(`ai-api-success-${width}.png`);
    await evaluate(`boardManagementHarness.holdNextSave(); boardManagementHarness.failNextApiTest('Gemini（HTTP 403）：APIキーの制限・プロジェクトの権限を確認してください。'.repeat(8)); document.querySelector('.ai-api-test-button').click()`);
    await ready("document.querySelector('.ai-api-test-button').getAttribute('aria-busy')==='true'");
    await evaluate('boardManagementHarness.releaseSave()');
    await ready("document.querySelector('.ai-api-test-status').textContent.includes('HTTP 403')");
    assert.deepEqual(await evaluate(measure), before, `${width}: long API error preserves layout/focus`);
  }
  await evaluate("document.querySelector('.ai-api-test-button').click()");
  await ready("document.querySelector('.ai-api-test-status').textContent.includes('文章応答を確認しました')");
  const progressMeasure = `(() => { const input = document.querySelector('#ai-panel-behavior input[type=number]');
    const body = document.querySelector('.management-body'); const progress = document.querySelector('.ai-runtime-progress');
    const box = node => { const r = node.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; };
    return {input:box(input),progress:box(progress),buttons:[...document.querySelector('.ai-runtime .button-row').children].map(box),
      height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement===input,overflow:body.scrollWidth>body.clientWidth}; })()`;
  let progressChecks = 0;
  for (const [width, height] of [[760, 560], [560, 760], [320, 760]]) {
    await resize(width, height);
    await evaluate("document.getElementById('ai-tab-behavior').click()");
    await ready("!document.getElementById('ai-panel-behavior').hidden && Boolean(document.querySelector('.ai-runtime-progress'))");
    await evaluate(`(() => { const state = boardManagementHarness.snapshot();
      boardManagementHarness.updateSnapshot({aiListener:{...state.aiListener,requested:true,status:'running',message:'会話を聞いています。',
        nextAt:Date.now()+30000,activity:{stage:'waiting',startedAt:Date.now(),lastDurationsMs:{}}}});
      const input=document.querySelector('#ai-panel-behavior input[type=number]'); input.scrollIntoView({block:'center'}); input.focus({preventScroll:true}); })()`);
    const before = await evaluate(progressMeasure); assert.equal(before.overflow, false, `${width}: runtime overflow`);
    for (const [stage, text] of [
      ['speaking','配信者の発話待ち'], ['recognizing','音声の認識待ち'], ['speech-gap','発話後の間'],
      ['new-speech','新しい発話待ち'], ['obs-check','OBSの配信状態'], ['image-preparation','画像入力'],
      ['generating','AIの発言を生成'], ['posting','コメントを投稿'], ['waiting','通常の発言待機'],
    ]) {
      await evaluate(`(() => { const state=boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({aiListener:{...state.aiListener,
        activity:{stage:${JSON.stringify(stage)},startedAt:Date.now(),lastDurationsMs:{'obs-check':12,'image-preparation':123,'generating':4567,'posting':89}}}}); })()`);
      await ready(`document.querySelector('.ai-runtime-stage').textContent.includes(${JSON.stringify(text)})`);
      assert.deepEqual(await evaluate(progressMeasure), before, `${width}: ${stage} preserves controls, scroll and focus`);
      progressChecks++;
      if (stage === 'generating' && capture) {
        // scrollIntoView may also move an outer container by one physical pixel
        // under Windows scaling; restore every scroll ancestor used by capture.
        const captureScroll = await evaluate("['html','body','.management-shell','.management-body'].map(selector=>{const e=document.querySelector(selector);return {selector,top:e.scrollTop,left:e.scrollLeft}})");
        await evaluate("document.querySelector('.ai-runtime-progress').scrollIntoView({block:'center'})");
        await capture(`ai-runtime-generating-${width}.png`);
        await evaluate(`(${JSON.stringify(captureScroll)}).forEach(({selector,top,left})=>{const e=document.querySelector(selector);e.scrollTop=top;e.scrollLeft=left;})`);
        assert.deepEqual(await evaluate(progressMeasure), before, `${width}: capture restores reading position`);
      }
    }
    await evaluate(`(() => { const state=boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({aiListener:{...state.aiListener,
      status:'paused',message:'音声認識を利用できません。入力とモデルを確認し、復旧してから再開してください。'.repeat(8),nextAt:null,
      activity:{stage:'idle',startedAt:null,lastDurationsMs:{}}}}); })()`);
    await ready("document.querySelector('.ai-runtime-message').textContent.includes('音声認識を利用できません')");
    assert.deepEqual(await evaluate(progressMeasure), before, `${width}: long pause reason preserves controls, scroll and focus`);
    progressChecks++;
  }
  await evaluate(`(() => { const state=boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({aiListener:{...state.aiListener,
    requested:false,status:'stopped',message:'停止中',nextAt:null,activity:{stage:'idle',startedAt:null,lastDurationsMs:{}}}}); })()`);
  let usageChecks = 0;
  const usageMeasure = `(() => { const input=document.querySelector('#ai-panel-behavior input[type=number]');
    const body=document.querySelector('.management-body'), usage=document.querySelector('.ai-usage');
    const box=node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
    return {input:box(input),usage:box(usage),height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement===input,overflow:body.scrollWidth>body.clientWidth}; })()`;
  for (const [width, height] of [[760,560],[560,760],[480,760],[420,760],[320,760]]) {
    await resize(width,height);
    await ready(`window.innerWidth===${width}`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await evaluate("document.getElementById('ai-tab-behavior').click()");
    await ready("!document.getElementById('ai-panel-behavior').hidden && Boolean(document.querySelector('.ai-usage'))");
    // Usage is now an explicit disclosure; hidden details can retain stale
    // layout across resizes and are not the visible UI this check evaluates.
    await evaluate("(()=>{const details=document.querySelector('.ai-usage').closest('details');if(details&&!details.open)details.querySelector('summary').click();})()");
    await ready("document.querySelector('.ai-usage').checkVisibility()");
    await evaluate(`(() => {const state=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({aiListener:{...state.aiListener,usage:undefined}});
      const input=document.querySelector('#ai-panel-behavior input[type=number]');input.scrollIntoView({block:'center'});input.focus({preventScroll:true});})()`);
    await ready("document.querySelector('.ai-usage').textContent.includes('入力未取得')");
    const before=await evaluate(usageMeasure);assert.equal(before.overflow,false);
    for (const value of [1,123456789012345]) {
      await evaluate(`(() => {const state=boardManagementHarness.snapshot(); const value=${value};boardManagementHarness.updateSnapshot({aiListener:{...state.aiListener,
        usage:{api:{requests:value,pending:value,input:{tokens:value,responses:value},output:{tokens:value,responses:value},total:{tokens:value,responses:value}},
          outcomes:{succeeded:value,skipped:value,cancelled:value,failed:value,unknown:value}}}});})()`);
      await ready(`document.querySelector('.ai-usage').textContent.includes(${JSON.stringify(value.toLocaleString('ja-JP'))})`);
      assert.deepEqual(await evaluate(usageMeasure),before,`${width}: usage update preserves input, scroll and focus`);
      usageChecks++;
    }
    if (capture && [760,320].includes(width)) {
      const captureScroll = await evaluate("['html','body','.management-shell','.management-body'].map(selector=>{const e=document.querySelector(selector);return {selector,top:e.scrollTop,left:e.scrollLeft}})");
      await evaluate("document.querySelector('.ai-usage').scrollIntoView({block:'center'})");
      await capture(`ai-usage-${width}.png`);
      await evaluate(`(${JSON.stringify(captureScroll)}).forEach(({selector,top,left})=>{const e=document.querySelector(selector);e.scrollTop=top;e.scrollLeft=left;})`);
    }
  }
  await evaluate("document.getElementById('ai-tab-visual').click()");
  await ready("[...document.querySelector('.ai-visual select').options].some(option=>option.textContent==='ゲーム画面') && document.querySelector('.ai-visual [role=switch]').getAttribute('aria-disabled')==='false'");
  await evaluate("document.querySelector('.ai-visual [role=switch]').click()");
  await ready("document.querySelector('.ai-visual-toggle-help').textContent.includes('未保存')");
  assert.equal(await evaluate('boardManagementHarness.snapshot().settings.aiListener.visual.enabled'), false, 'no source means no persisted ON');
  await evaluate("const select=document.querySelector('.ai-visual select'); select.value='配信\\ngame'; select.dispatchEvent(new Event('change',{bubbles:true}))");
  await ready('boardManagementHarness.snapshot().settings.aiListener.visual.enabled');
  assert.equal(await evaluate('boardManagementHarness.snapshot().settings.aiListener.visual.source.uuid'), 'game');
  assert.equal(await evaluate("boardManagementHarness.trace().some(item=>item.path?.includes('/capture')||item.path?.endsWith('/start'))"), false, 'selection never captures or starts AI');
  if (capture) await capture('ai-visual-enabled-320.png');
  await evaluate("document.querySelector('.editor-heading-row .back-button').click()");
  await ready("document.activeElement.id==='settings-aiListener'");
  assert.equal(await evaluate('document.activeElement.id'), 'settings-aiListener');
  return 4 + progressChecks + usageChecks;
}
