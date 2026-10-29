import assert from 'node:assert/strict';

export async function verifyInitialSetupDevices({ evaluate, resize, capture, themes = ['graphite','midnight','ocean','burgundy','pearl','ivory','sakura','lavender'] }) {
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,50))');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  await click('[data-page=settings]'); await click('#settings-application'); await click('#application-initial-setup');
  assert.equal(await evaluate("document.querySelector('.setup-phone-use-editor').open"),false,'phone uses start as a summary');
  await click('#setup-phone-change-uses');
  await evaluate("document.querySelector('.setup-phone-uses input').focus({preventScroll:true});boardManagementHarness.holdNextMutation()");
  await click('.setup-phone-uses input');
  assert.equal(await evaluate("document.activeElement===document.querySelector('.setup-phone-uses input')"),true,'phone use save keeps focus');
  const pendingCount = await evaluate('boardManagementHarness.trace().length');
  await click('.setup-phone-uses input');
  assert.equal(await evaluate('boardManagementHarness.trace().length'),pendingCount,'pending use save cannot run twice');
  await evaluate('boardManagementHarness.releaseMutation()'); await settle();
  assert.equal(await evaluate("document.activeElement===document.querySelector('.setup-phone-uses input')"),true,'phone use save completion keeps focus');
  await click('.setup-phone-uses input');
  await click('#setup-phone-change-uses');
  await evaluate("(()=>{const s=document.querySelector('.setup-phone-network select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'tailscale');s.dispatchEvent(new Event('change',{bubbles:true}));})()"); await settle();
  assert.equal(await evaluate("document.querySelector('.setup-review').textContent.includes('確認中：Tailscale')"),true,'review follows the selected route');
  const prepareGeometry = () => evaluate("(()=>{const r=document.querySelector('.setup-phone-preparation').getBoundingClientRect(),b=document.querySelector('.management-body');return {rect:[r.x,r.y,r.width,r.height],height:b.scrollHeight,scroll:b.scrollTop,focus:document.activeElement===document.querySelector('.setup-phone-preparation')};})()");
  await evaluate("document.querySelector('.setup-phone-preparation').focus({preventScroll:true});boardManagementHarness.holdNextMutation()");
  const beforePrepare = await prepareGeometry(); await click('.setup-phone-preparation');
  assert.deepEqual(await prepareGeometry(),beforePrepare,'preparation pending keeps position and focus');
  const prepareCount = await evaluate('boardManagementHarness.trace().length'); await click('.setup-phone-preparation');
  assert.equal(await evaluate('boardManagementHarness.trace().length'),prepareCount,'pending preparation cannot run twice');
  assert.deepEqual(await evaluate('boardManagementHarness.trace().at(-1).body'),{activeNetwork:'tailscale'},'preparation uses the selected route');
  await evaluate('boardManagementHarness.releaseMutation()'); await settle();
  assert.deepEqual(await prepareGeometry(),beforePrepare,'preparation completion keeps position and focus');
  await evaluate("(()=>{const s=document.querySelector('.setup-phone-network select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'lan');s.dispatchEvent(new Event('change',{bubbles:true}));})()"); await settle();
  let count = 0;
  for (const theme of themes) for (const [width, height, size] of [[1040,820,'small'],[760,560,'medium'],[560,760,'medium'],[480,760,'large'],[420,760,'large'],[320,820,'large']]) for (const position of ['smartphone','speechRecognition']) {
    await resize(width, height);
    await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({speechRecognition:{...s.speechRecognition,previewActive:false,status:'disabled'},initialSetup:{...s.initialSetup,position:${JSON.stringify(position)},selected:['smartphone','speechRecognition'],smartphoneUses:['comments','speech','video']},settings:{...s.settings,application:{...s.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:${JSON.stringify(size)}}}});document.querySelector('.management-body').scrollTop=0;})()`);
    await settle();
    const layout = await evaluate(`(()=>{const b=document.querySelector('.management-body'),f=document.querySelector('.setup-footer'),r=n=>n.getBoundingClientRect(),review=document.querySelector('.setup-review'),content=document.querySelector(${JSON.stringify(position === 'smartphone' ? '.setup-phone-steps>.setup-step-card' : '.management-editor-content')}),controls=[...document.querySelectorAll('button,input,select')].filter(n=>n.checkVisibility()&&!n.closest('dialog'));return {overflow:document.documentElement.scrollWidth>innerWidth+1||b.scrollWidth>b.clientWidth+1,clipped:controls.filter(n=>r(n).left<0||r(n).right>innerWidth+1).map(n=>n.textContent),footer:r(b).bottom<=r(f).top+1&&r(f).bottom<=innerHeight+1,order:innerWidth<=760?r(review).top<r(content).top:r(review).left>r(content).left,cards:[...document.querySelectorAll(${JSON.stringify(position === 'smartphone' ? '.setup-phone-steps>.setup-step-card' : '.speech-recognition-panel>.card-details>.recognition-section')})].filter(n=>n.checkVisibility()).length};})()`);
    assert.deepEqual(layout, { overflow: false, clipped: [], footer: true, order: true, cards: position === 'smartphone' ? 3 : 4 }, `${theme}/${width}/${position}`);
    const outer = await evaluate("(()=>{const rect=n=>{const r=n.getBoundingClientRect();return [r.y,r.height,n.scrollHeight]};return {viewport:innerHeight,document:document.documentElement.scrollHeight,body:rect(document.body),root:rect(document.getElementById('root')),shell:rect(document.querySelector('.management-shell')),outside:[...document.querySelectorAll('*')].filter(n=>n.checkVisibility() && n.getBoundingClientRect().bottom>innerHeight+1 && ['fixed','absolute'].includes(getComputedStyle(n).position)).map(n=>[n.tagName,n.className,rect(n),getComputedStyle(n).position])};})()");
    assert.ok(outer.document<=outer.viewport+1,`${theme}/${width}/${position}: unexpected outer scrolling ${JSON.stringify(outer)}`);
    if (capture && theme === 'ocean' && (width === 1040 || width === 320)) {
      await capture(`device-${position}-${width}.png`);
      if(position==='smartphone'){
        for(const use of ['comments','audio','video']){
          await evaluate(`document.querySelector('#setup-phone-${use}-title').scrollIntoView({block:'start'})`);await settle();
          await capture(`device-guide-${use}-${width}.png`);
          const requests=await evaluate('boardManagementHarness.trace().length');
          await click(`#setup-phone-${use}-help summary`);
          assert.equal(await evaluate(`document.querySelector('#setup-phone-${use}-help').open`),true,'recovery guide opens '+use+'/'+width);
          assert.equal(await evaluate(`document.querySelector('#setup-phone-${use}-help summary').tabIndex`),0,'recovery guide is keyboard focusable '+use+'/'+width);
          const expanded=await evaluate("(()=>{const b=document.querySelector('.management-body');return {overflow:b.scrollWidth>b.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1};})()");
          assert.equal(expanded.overflow,false,'expanded recovery guide fits '+use+'/'+width);
          await evaluate(`document.querySelector('#setup-phone-${use}-help summary').scrollIntoView({block:'start'})`);await settle();
          await capture(`device-guide-${use}-expanded-${width}.png`);
          await click(`#setup-phone-${use}-help summary`);
          assert.equal(await evaluate(`document.querySelector('#setup-phone-${use}-help').open`),false,'recovery guide closes '+use+'/'+width);
          assert.equal(await evaluate('boardManagementHarness.trace().length'),requests,'guide disclosure does not change settings or start services');
        }
        assert.equal(await evaluate("document.querySelectorAll('.phone-receive-preview').length"),0,'no PC media preview');
        await evaluate("document.querySelector('.setup-phone-device-list').scrollIntoView({block:'start'})");await settle();
        await capture(`device-receive-data-${width}.png`);
        await evaluate("document.querySelector('.management-body').scrollTop=0");await settle();
      }
    }
    const control = position === 'smartphone' ? '.setup-phone-network select' : '.recognition-microphone select';
    await evaluate(`document.querySelector(${JSON.stringify(control)}).focus({preventScroll:true})`);
    const measure = () => evaluate(`(()=>{const b=document.querySelector('.management-body'),r=n=>{const q=n.getBoundingClientRect();return [q.x,q.y,q.width,q.height]};return {height:b.scrollHeight,scroll:b.scrollTop,control:r(document.querySelector(${JSON.stringify(control)})),footer:r(document.querySelector('.setup-footer')),focus:document.activeElement===document.querySelector(${JSON.stringify(control)})};})()`);
    const before = await measure();
    if (position === 'smartphone') {
      const original = await evaluate('boardManagementHarness.snapshot()');
      const overview = await evaluate("(()=>{const r=n=>n.getBoundingClientRect(),a=r(document.querySelector('.setup-phone-use-overview')),c=r(document.querySelector('.setup-phone-steps>.setup-step-card')),v=r(document.querySelector('.setup-review'));return {before:a.bottom<=Math.min(c.top,v.top)+1,fullWidth:Math.abs(a.width-(innerWidth>760?v.right-c.left:c.width))<=1};})()");
      assert.deepEqual(overview,{before:true,fullWidth:true},'uses span both columns before the steps '+theme+'/'+width);
      await evaluate("(()=>{boardManagementHarness.releaseVoices([{speakerUuid:'speaker',name:'テスト話者',styles:[{id:1,name:'通常'}]}]);const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({sourceStatuses:{...s.sourceStatuses,youtube:{...s.sourceStatuses.youtube,state:'connected'}},commentSpeech:{...s.commentSpeech,engineStatus:'ready'},settings:{...s.settings,commentSpeech:{...s.settings.commentSpeech,enabled:true,voice:{speakerUuid:'speaker',styleId:1}}}});})()"); await settle();
      assert.deepEqual(await measure(),before,'ready prerequisites keep geometry/focus '+theme+'/'+width);
      assert.equal(await evaluate("[...document.querySelectorAll('.setup-phone-prerequisite-action button')].some(n=>n.checkVisibility({visibilityProperty:true}))"),false,'ready prerequisites have no visible settings actions');
      if (capture && theme === 'ocean' && (width === 1040 || width === 320)) await capture(`device-prerequisites-ready-${width}.png`);
      await evaluate(`boardManagementHarness.updateSnapshot({sourceStatuses:${JSON.stringify(original.sourceStatuses)},commentSpeech:${JSON.stringify(original.commentSpeech)},settings:${JSON.stringify(original.settings)}})`); await settle();
      assert.deepEqual(await measure(),before,'missing prerequisites keep geometry/focus '+theme+'/'+width);
    }
    await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({smartphone:{...s.smartphone,warning:'接続の確認が必要です。'.repeat(25)},speechRecognition:{...s.speechRecognition,modelStatus:'failed',warning:'マイクの接続・Windowsのマイク許可を確認してください。'.repeat(25),status:'unavailable'},initialSetup:{...s.initialSetup,warning:'記録の保存に失敗しました。'.repeat(20)}});})()`); await settle();
    assert.deepEqual(await measure(), before, `${theme}/${width}/${position}: failure keeps geometry/focus`);
    await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({smartphone:{...s.smartphone,warning:null},speechRecognition:{...s.speechRecognition,warning:null,status:'listening',modelStatus:'ready',previewActive:${position === 'speechRecognition'},sessionId:'new',previewHistory:[{id:'r',sessionId:'new',text:'実際のテスト認識結果',recognizedAt:'2026-10-21T00:00:00Z',audioDurationMilliseconds:1000,recognitionDurationMilliseconds:200}]},initialSetup:{...s.initialSetup,warning:null}});})()`); await settle();
    assert.deepEqual(await measure(), before, `${theme}/${width}/${position}: recovery keeps geometry/focus`);
    if (position === 'speechRecognition') assert.equal(await evaluate("document.querySelector('.setup-recognition-result').textContent.includes('実際のテスト認識結果')"), true);
    count++;
  }
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({speechRecognition:{...s.speechRecognition,previewActive:false,status:'disabled'}});const input=document.querySelector('.recognition-microphone select'),option=document.createElement('option');option.value='new-microphone';option.textContent='別のマイク';input.append(option);Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'new-microphone');input.dispatchEvent(new Event('change',{bubbles:true}));})()"); await settle();
  const beforePreview = await evaluate('boardManagementHarness.trace().length'); await click('.recognition-preview-heading>button');
  assert.equal(await evaluate('boardManagementHarness.trace().length'),beforePreview,'unapplied input cannot start preview');
  await evaluate("document.querySelector('.recognition-apply>button').focus({preventScroll:true});boardManagementHarness.holdNextSave()");
  await click('.recognition-apply>button');
  assert.equal(await evaluate("document.activeElement===document.querySelector('.recognition-apply>button')"),true,'input apply keeps focus');
  await evaluate('boardManagementHarness.releaseSave()'); await settle();
  assert.equal(await evaluate('boardManagementHarness.snapshot().settings.speechRecognition.microphoneId'),'new-microphone','apply saves the explicit input');
  assert.equal(await evaluate("document.activeElement===document.querySelector('.recognition-apply>button')"),true,'input apply completion keeps focus');
  for(const width of [1040,320]){
    await resize(width,820);
    await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,position:'smartphone',smartphoneUses:['speech']},settings:{...s.settings,commentSpeech:{...s.settings.commentSpeech,enabled:true,voice:{speakerUuid:'speaker',styleId:1}}},mobileSpeech:{...s.mobileSpeech,audioAvailable:true,clientCount:1},smartphone:{...s.smartphone,settings:{...s.smartphone.settings,activeNetwork:'lan'}}});})()");await settle();
    const button='#setup-phone-speech-preview';
    await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({mobileSpeech:{...s.mobileSpeech,clientCount:0}});})()");await settle();
    const knownHelp=await evaluate("(()=>{const n=document.querySelector('#setup-phone-speech-preview-help');return {height:n.clientHeight,content:n.scrollHeight};})()");
    await evaluate(`document.querySelector(${JSON.stringify(button)}).scrollIntoView({block:'center'})`);await settle();
    if(capture)await capture(`device-preview-prerequisite-${width}.png`);
    assert.ok(knownHelp.content<=knownHelp.height+1,'known preview prerequisite is fully visible '+width+': '+JSON.stringify(knownHelp));
    await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({mobileSpeech:{...s.mobileSpeech,clientCount:1}});})()");await settle();
    await evaluate(`document.querySelector(${JSON.stringify(button)}).scrollIntoView({block:'center'});document.querySelector(${JSON.stringify(button)}).focus({preventScroll:true})`);
    const measure=()=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(button)}),r=n.getBoundingClientRect(),b=document.querySelector('.management-body');return{rect:[r.x,r.y,r.width,r.height],height:b.scrollHeight,scroll:b.scrollTop,focus:document.activeElement===n};})()`);
    const before=await measure(),requests=await evaluate('boardManagementHarness.trace().length');
    await evaluate("boardManagementHarness.holdNextMutation('試聴に失敗しました。'.repeat(30))");await click(button);await click(button);
    assert.equal(await evaluate('boardManagementHarness.trace().length'),requests+1,'preview prevents duplicate requests');
    assert.equal(await evaluate('boardManagementHarness.trace().at(-1).path'),'/api/speech/preview','reuse existing preview API');
    assert.deepEqual(await measure(),before,'preview pending keeps position/focus '+width);
    await evaluate('boardManagementHarness.releaseMutation()');await settle();
    assert.deepEqual(await measure(),before,'preview failure keeps position/focus '+width);
    await evaluate("(()=>{const n=document.querySelector('#setup-phone-speech-preview-help');n.scrollTop=n.scrollHeight;})()");
    await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({mobileSpeech:{...s.mobileSpeech,clientCount:0}});})()");await settle();
    const failedHelp=await evaluate("document.querySelector('#setup-phone-speech-preview-help').textContent");
    assert.ok(failedHelp.includes('ヘッドホンをON')&&failedHelp.includes('前回の試聴'),'changed prerequisite is visible with old error '+width);
    assert.equal(await evaluate("document.querySelector('#setup-phone-speech-preview-help').scrollTop"),0,'changed prerequisite starts visibly above the old error '+width);
    assert.deepEqual(await measure(),before,'error plus disabled reason keeps position/focus '+width);
    await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({mobileSpeech:{...s.mobileSpeech,clientCount:1}});})()");await settle();
    await click(button);
    assert.deepEqual(await measure(),before,'preview retry success keeps position/focus '+width);
    assert.equal(await evaluate("document.querySelector('[aria-label=通知]').textContent.includes('PCで試聴を再生しました。')"),true);
    if(capture)await capture(`device-preview-${width}.png`);
    await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({mobileSpeech:{...s.mobileSpeech,clientCount:0}});})()");await settle();
    const stopped=await evaluate('boardManagementHarness.trace().length');await click(button);
    assert.equal(await evaluate('boardManagementHarness.trace().length'),stopped,'no subscribers cannot preview');
    assert.equal(await evaluate("document.querySelector('#setup-phone-speech-preview-help').textContent.includes('ヘッドホンをON')"),true);
  }
  return count;
}
