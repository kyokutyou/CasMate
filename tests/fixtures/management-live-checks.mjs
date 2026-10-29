import assert from 'node:assert/strict';

export async function verifyManagementLive({ evaluate: run, resize, capture, pressKey, setZoom, resizeMinimum }) {
  const evaluate = async code => {
    try { return await run(code); }
    catch (error) { throw new Error(`Live workspace evaluation failed: ${code.slice(0, 220)}`, { cause: error }); }
  };
  const settle = () => evaluate('new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}))})');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const initial = await evaluate('boardManagementHarness.snapshot()');
  const initialTrace = await evaluate('boardManagementHarness.trace().length');
  if(setZoom)await setZoom(1);
  const positions = () => evaluate(`(() => [...document.querySelectorAll('.studio-live-operations,.studio-live-operations [role="switch"],.studio-live-connections,.studio-comment-feed,.studio-live-auto-scroll,.studio-comment-feed>.studio-footer-links,#live-comment-window,.studio-live-transcript,.studio-live-utilities')].map(node=>{
    const box=node.getBoundingClientRect();return [box.x,box.y,box.width,box.height];}))()`);
  let checks = 0;
  for (const theme of ['ocean', 'pearl']) for (const textSize of ['small', 'medium', 'large']) {
    for (const [width, height] of [[1200,820],[760,560],[560,760],[480,760],[420,760],[320,760]]) {
      await resize(width, height);
      await evaluate(`(() => { const initial=${JSON.stringify(initial)}; boardManagementHarness.updateSnapshot({...initial,
        settingsRevision:boardManagementHarness.snapshot().settingsRevision+1,
        settings:{...initial.settings,application:{...initial.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:${JSON.stringify(textSize)}}}});
        document.querySelector('[data-page="live"]').click(); })()`);
      await settle();
      const label = `${theme}/${textSize}/${width}x${height}`;
      const metrics = await evaluate(`(() => {
        const body=document.querySelector('.management-body'), list=document.querySelector('.studio-comment-stream'), controls=[...document.querySelectorAll('.studio-live-operations article')];
        const box=body.getBoundingClientRect();return {
          overflow:document.documentElement.scrollWidth>innerWidth||body.scrollWidth>body.clientWidth,
          order:controls.map(node=>node.dataset.operation),
          controlsVisible:controls.every(node=>{const r=node.getBoundingClientRect();return r.top>=box.top&&r.bottom<=box.bottom}),
          listVisible:list.clientHeight>0, headingHidden:document.querySelector('.management-page-heading').getBoundingClientRect().height<=1,
        }; })()`);
      assert.equal(metrics.overflow, false, label + ' horizontal overflow');
      assert.deepEqual(metrics.order, ['commentSpeech','speechRecognition','aiListener'], label + ' operation order');
      assert.equal(metrics.listVisible, true, label + ' usable comment viewport');
      assert.equal(metrics.headingHidden, true, label + ' compact live heading');
      if (textSize === 'medium' && width >= 760) {
        const line=await evaluate(`(() => {const label=document.querySelector('#live-connections-summary>span'),value=document.querySelector('#live-connections-summary strong>span'),a=label.getBoundingClientRect(),b=value.getBoundingClientRect();return {sameLine:Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<1,singleLine:b.height<=parseFloat(getComputedStyle(value).lineHeight)+1};})()`);
        assert.deepEqual(line,{sameLine:true,singleLine:true},label+' connection label and count share one line');
      }
      if (textSize === 'medium') assert.equal(metrics.controlsVisible, true, label + ' operations stay in view');
      const windowMetrics = await evaluate(`(() => {const button=document.getElementById('live-comment-window'),box=button.getBoundingClientRect(),header=button.closest('.home-section-heading').getBoundingClientRect();return {order:[...button.parentElement.children].map(n=>n.id),inside:box.left>=header.left&&box.right<=header.right,iconOnly:getComputedStyle(button.querySelector('.studio-live-window-label')).display==='none',pressed:button.getAttribute('aria-pressed')}})()`);
      const narrowViewport = await evaluate('matchMedia("(max-width:420px)").matches');
      assert.deepEqual(windowMetrics, {order:['','live-comment-window','live-list-settings'],inside:true,iconOnly:narrowViewport,pressed:String(initial.settings.application.commentListWindowVisible)}, label + ' independent window entry');
      const followLabels=()=>evaluate(`({button:document.querySelector('.studio-live-auto-scroll').getAttribute('aria-label'),footer:document.querySelector('.studio-live-follow-state>span').textContent,preview:document.querySelector('.studio-live-transcript').getAttribute('aria-label')})`);
      assert.deepEqual(await followLabels(),{button:'自動スクロール ON',footer:'自動スクロール ON',preview:'音声認識プレビュー'},label+' active labels');
      const followingBounds=await positions();
      await click('.studio-live-auto-scroll');
      assert.deepEqual(await followLabels(),{button:'自動スクロール OFF',footer:'読み返し中・自動スクロール OFF',preview:'音声認識プレビュー'},label+' paused labels');
      assert.deepEqual(await positions(),followingBounds,label+' toggling follow keeps control positions');
      await evaluate(`(() => { const snapshot=boardManagementHarness.snapshot(),latest=Math.max(...snapshot.comments.map(comment=>comment.sequence));
        const comments=Array.from({length:12},(_,index)=>({...snapshot.comments.at(-1),id:'new-'+index,sequence:latest+index+1,initialHistory:false}));
        boardManagementHarness.updateSnapshot({comments:[...snapshot.comments,...comments]}); })()`);
      await settle();
      assert.equal(await evaluate('document.querySelector(".studio-live-follow-state>span").textContent'),'読み返し中・自動スクロール OFF　新着12件',label+' paused arrivals are visible');
      assert.deepEqual(await positions(),followingBounds,label+' new arrivals keep control positions');
      if (capture && textSize === 'medium' && [760,320].includes(width)) await capture(`live-unread-${theme}-${width}.png`);
      await click('.studio-live-auto-scroll');
      assert.equal(await evaluate('document.querySelector(".studio-live-follow-state>span").textContent'),'自動スクロール ON',label+' following clears arrivals');
      assert.deepEqual(await positions(),followingBounds,label+' enabling follow keeps control positions');
      checks++;
      await evaluate('document.getElementById("live-connections-summary").focus()');
      const before = await positions();
      await evaluate(`(() => { const snapshot=boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({
        settings:{...snapshot.settings,application:{...snapshot.settings.application,commentListWindowVisible:!snapshot.settings.application.commentListWindowVisible}},
        sourceStatuses:{...snapshot.sourceStatuses,twitch:{...snapshot.sourceStatuses.twitch,state:'error',message:'接続先とネットワークを確認してください。'.repeat(30)}},
        commentSpeech:{...snapshot.commentSpeech,engineStatus:'preparing'},
        aiListener:{...snapshot.aiListener,requested:false,status:'attention',message:'投稿先の連携を確認してください。'.repeat(30)},
        speechRecognition:{...snapshot.speechRecognition,previewActive:true,status:'recognizing',previewHistory:[{id:'live-preview',sessionId:'test',sequence:1,text:'長い認識結果の確認です。'.repeat(50),recognizedAt:new Date(0).toISOString(),audioDurationMilliseconds:100,recognitionDurationMilliseconds:100}]},
        obsControl:{...snapshot.obsControl,stream:'unknown',error:'OBS接続の詳細を確認してください。'.repeat(30)},
        smartphone:{...snapshot.smartphone,warning:'スマホの接続設定を確認してください。'.repeat(30)} }); })()`);
      await settle();
      assert.deepEqual(await positions(), before, label + ' state updates do not move operations');
      assert.equal(await evaluate('document.querySelector("#live-connections-summary strong>span").textContent'),`${initial.sourceStatuses.youtube.state==='connected'?1:0}件接続中・要確認`,label+' connection count has no unused-slot denominator');
      assert.equal(await evaluate(`(() => {const node=document.querySelector('#live-connections-summary strong'),box=node.getBoundingClientRect(),parent=node.closest('button').getBoundingClientRect();return Math.ceil(box.width)>=node.scrollWidth&&box.left>=parent.left&&box.right<=parent.right})()`),true,label+' connection summary fits without truncation');
      assert.equal(await evaluate('document.getElementById("live-comment-window").getAttribute("aria-pressed")'), String(!initial.settings.application.commentListWindowVisible), label + ' external window changes update selection');
      assert.equal(await evaluate('document.activeElement.id'), 'live-connections-summary', label + ' no focus stealing');
      assert.equal(await evaluate('Boolean(document.querySelector(".management-activities"))'), false, label + ' preview has no duplicate activity banner');
      checks++;
      if (capture && textSize === 'medium' && [760,560,320].includes(width)) await capture(`live-${theme}-${width}.png`);
    }
  }
  await resize(760,560);
  await evaluate(`boardManagementHarness.updateSnapshot(${JSON.stringify(initial)}); document.querySelector('[data-page="live"]').click()`);
  await settle();
  for (const [entry, editor] of [['live-connections-summary','live-source-youtube'],['live-obs-settings','live-obs-editor'],['live-smartphone-settings','live-smartphone-editor'],['live-windows','live-window-list-settings']]) {
    await click('#' + entry);
    assert.equal(await evaluate('document.querySelector(".studio-live-dialog").open'), true, entry + ' opens detail');
    await evaluate(`(() => {const dialog=document.querySelector('.studio-live-dialog'), buttons=[...dialog.querySelectorAll('button:not(:disabled),[tabindex="0"]')];buttons.at(-1).focus()})()`);
    await pressKey('Tab'); await settle();
    assert.equal(await evaluate('document.activeElement===document.querySelector(".studio-live-dialog-heading button")'), true, entry + ' Tab wraps inside dialog');
    await pressKey('Tab', true); await settle();
    assert.equal(await evaluate('document.querySelector(".studio-live-dialog").contains(document.activeElement)'), true, entry + ' Shift+Tab stays in dialog');
    await pressKey('Escape'); await settle();
    assert.equal(await evaluate('document.activeElement.id'), entry, entry + ' restores focus after Escape');
    await click('#' + entry); await click('#' + editor);
    assert.equal(await evaluate('document.querySelector(".studio-live-dialog").open'), false, entry + ' detail closes on edit');
    await click('.editor-heading-row .back-button');
    assert.equal(await evaluate('document.activeElement.id'), entry, entry + ' settings return to stable entry');
    checks++;
  }
  assert.equal(await evaluate('boardManagementHarness.trace().length'), initialTrace, 'opening and editing details has no operation side effects');
  const before = await positions();
  await evaluate(`boardManagementHarness.failNextSave('保存できません。保存先を確認して再保存してください。'.repeat(15)); boardManagementHarness.holdNextSave();
    document.querySelector('.studio-live-operations [aria-label="コメント読み上げ"]').focus(); document.activeElement.click()`);
  await settle();
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'コメント読み上げ', 'busy operation retains focus');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-disabled")'), 'true', 'busy operation is unavailable');
  await evaluate('document.activeElement.click(); boardManagementHarness.releaseSave()'); await settle(); await settle();
  assert.deepEqual(await positions(), before, 'save failure does not move live workspace');
  assert.equal(await evaluate('boardManagementHarness.trace().filter(item=>item.kind==="save").length'), 1, 'pending operation cannot be repeated');
  await click('.studio-live-operations [aria-label="コメント読み上げ"]'); await settle();
  assert.deepEqual(await positions(), before, 'success toast does not move live workspace');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'コメント読み上げ', 'async completion retains focus');
  checks += 2;
  if (capture) await capture('live-adopted-760.png');
  for (const [entry, selector, mutation] of [
    ['live-connections-summary', '.studio-live-dialog [role="switch"]', false],
    ['live-windows', '.studio-live-dialog .window-control button', true],
  ]) for (const fail of [false, true]) {
    await click('#' + entry);
    const expected = await evaluate(`(() => {const node=document.querySelector(${JSON.stringify(selector)});node.focus();const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
    const count = await evaluate(`boardManagementHarness.trace().filter(item=>item.kind===${JSON.stringify(mutation ? 'mutate' : 'save')}).length`);
    await evaluate(mutation ? `boardManagementHarness.holdNextMutation(${fail ? JSON.stringify('ウィンドウ操作に失敗しました。') : 'undefined'});document.activeElement.click()`
      : `boardManagementHarness.holdNextSave();${fail ? "boardManagementHarness.failNextSave('接続設定の保存に失敗しました。');" : ''}document.activeElement.click()`);
    await settle();
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true, entry + ' pending retains focus');
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-disabled")'), 'true', entry + ' pending is unavailable');
    await evaluate(`document.activeElement.click();boardManagementHarness.${mutation ? 'releaseMutation' : 'releaseSave'}()`); await settle(); await settle();
    assert.equal(await evaluate(`boardManagementHarness.trace().filter(item=>item.kind===${JSON.stringify(mutation ? 'mutate' : 'save')}).length`), count+1, entry + ' prevents repeated requests');
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true, entry + ' completion retains focus');
    assert.deepEqual(await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`), expected, entry + ' completion retains position');
    await pressKey('Escape'); await settle();
    checks++;
  }
  const windowSelector = '#live-comment-window';
  await evaluate(`(() => {const list=document.querySelector('.studio-comment-stream');list.scrollTop=100;list.dispatchEvent(new Event('scroll',{bubbles:true}))})()`); await settle();
  const reading = await evaluate(`({top:document.querySelector('.studio-comment-stream').scrollTop,follow:document.querySelector('.studio-live-feed-actions>button').getAttribute('aria-pressed')})`);
  for (const fail of [false,true]) {
    const visible = await evaluate('boardManagementHarness.snapshot().settings.application.commentListWindowVisible');
    const count = await evaluate('boardManagementHarness.trace().filter(item=>item.path==="/api/windows/comment-list/toggle").length');
    const bounds = await positions();
    await evaluate(`boardManagementHarness.holdNextMutation(${fail ? JSON.stringify('独立窓を開けませんでした。') : 'undefined'});document.getElementById('live-comment-window').focus();document.activeElement.click()`); await settle();
    assert.equal(await evaluate('document.activeElement.id'), 'live-comment-window', 'header window pending retains focus');
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-disabled")'), 'true', 'header window pending is unavailable');
    await click(windowSelector);
    await evaluate('boardManagementHarness.releaseMutation()'); await settle(); await settle();
    assert.equal(await evaluate('boardManagementHarness.trace().filter(item=>item.path==="/api/windows/comment-list/toggle").length'), count+1, 'header window prevents repeated requests');
    assert.equal(await evaluate('document.getElementById("live-comment-window").getAttribute("aria-pressed")'), String(fail ? visible : !visible), 'header window reflects actual result');
    assert.equal(await evaluate('document.activeElement.id'), 'live-comment-window', 'header window completion retains focus');
    assert.deepEqual(await positions(),bounds,'header window completion retains dimensions');
    assert.deepEqual(await evaluate(`({top:document.querySelector('.studio-comment-stream').scrollTop,follow:document.querySelector('.studio-live-feed-actions>button').getAttribute('aria-pressed')})`),reading,'header window preserves readback');
    checks++;
  }
  const retryWasVisible = await evaluate('boardManagementHarness.snapshot().settings.application.commentListWindowVisible');
  await click(windowSelector); await settle();
  assert.equal(await evaluate('document.getElementById("live-comment-window").getAttribute("aria-pressed")'), String(!retryWasVisible), 'header window can retry after failure');
  if(capture)await capture('live-window-header-760.png');
  if(setZoom)await setZoom(1.5);
  if(resizeMinimum)await resizeMinimum();else await resize(203,215);
  await evaluate(`(() => {const snapshot=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:snapshot.settingsRevision+1,settings:{...snapshot.settings,application:{...snapshot.settings.application,managementTextSize:'large'}}})})()`);await settle();
  const minimum = await evaluate(`(() => {const body=document.querySelector('.management-body'),bounds=body.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth||body.scrollWidth>body.clientWidth,controls:[...document.querySelectorAll('.studio-live-feed-actions>button')].every(node=>{const r=node.getBoundingClientRect();return r.left>=bounds.left&&r.right<=bounds.right})}})()`);
  assert.deepEqual(minimum,{overflow:false,controls:true},'independent window header at native minimum and 150% zoom');
  const minimumBounds=await positions();await click('.studio-live-auto-scroll');
  assert.deepEqual(await positions(),minimumBounds,'long ON/OFF labels keep their size at native minimum and zoom');
  if(capture)await capture('live-window-header-minimum.png');
  if(setZoom)await setZoom(1);
  checks++;
  return checks;
}
