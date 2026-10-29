import assert from 'node:assert/strict';

export async function verifyInitialSetupSpeech({ evaluate, resize, capture }) {
  const settle=()=>evaluate('new Promise(resolve=>setTimeout(resolve,70))');
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settle();};
  const voices=[{speakerUuid:'one',name:'話者一',styles:[{id:1,name:'通常'},{id:2,name:'小声'}]},{speakerUuid:'two',name:'話者二',styles:[{id:7,name:'通常'},{id:8,name:'小声'}]}];
  for(const width of [1040,320]){
    await resize(width,820);
    await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,position:'commentSpeech',selected:['commentSpeech']},commentSpeech:{...s.commentSpeech,engineStatus:'disabled'},settings:{...s.settings,commentSpeech:{...s.settings.commentSpeech,enabled:false,voice:{speakerUuid:'one',styleId:1}}}});})()");await settle();
    const automatic='.setup-engine-check';
    await evaluate(`document.querySelector('${automatic}').scrollIntoView({block:'center'});document.querySelector('${automatic}').focus({preventScroll:true})`);
    const engineGeometry=()=>evaluate(`(()=>{const n=document.querySelector('${automatic}'),r=n.getBoundingClientRect(),b=document.querySelector('.management-body');return{rect:[r.x,r.y,r.width,r.height],height:b.scrollHeight,scroll:b.scrollTop,focus:document.activeElement===n,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    const engineBefore=await engineGeometry(),engineRequests=await evaluate('boardManagementHarness.voiceRequests()');
    await evaluate("boardManagementHarness.holdNextVoices('VOICEVOXが見つかりません。起動ファイルを指定してください。')");
    await click(automatic);await click(automatic);
    assert.equal(await evaluate('boardManagementHarness.voiceRequests()'),engineRequests+1,'automatic preparation cannot duplicate');
    assert.deepEqual(await engineGeometry(),engineBefore,'automatic preparation pending keeps geometry/focus '+width);
    await evaluate('boardManagementHarness.releaseVoices()');await settle();
    assert.deepEqual(await engineGeometry(),engineBefore,'automatic preparation failure keeps geometry/focus '+width);
    if(capture) {
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await capture('flow-speech-automatic-'+width+'.png');
    }
    const selector='.speech-voice-refresh';
    await evaluate(`document.querySelector('${selector}').scrollIntoView({block:'center'});document.querySelector('${selector}').focus({preventScroll:true})`);
    const measure=target=>evaluate(`(()=>{const b=document.querySelector('.management-body'),n=document.querySelector(${JSON.stringify(target)}),r=n.getBoundingClientRect(),m=document.querySelector('.speech-mixer').getBoundingClientRect();return{control:[r.x,r.y,r.width,r.height],mixer:[m.x,m.y,m.width,m.height],height:b.scrollHeight,scroll:b.scrollTop,focus:document.activeElement===n};})()`);
    const before=await measure(selector),requests=await evaluate('boardManagementHarness.voiceRequests()');
    await evaluate("boardManagementHarness.holdNextVoices('VOICEVOXを起動して、もう一度お試しください。'.repeat(20))");await click(selector);await click(selector);
    assert.equal(await evaluate('boardManagementHarness.voiceRequests()'),requests+1,'voice refresh cannot duplicate');
    assert.deepEqual(await measure(selector),before,'voice refresh pending keeps geometry/focus '+width);
    await evaluate('boardManagementHarness.releaseVoices()');await settle();
    assert.deepEqual(await measure(selector),before,'voice refresh failure keeps geometry/focus '+width);
    await evaluate('boardManagementHarness.holdNextVoices()');await click(selector);
    await evaluate(`boardManagementHarness.releaseVoices(${JSON.stringify(voices)})`);await settle();
    assert.deepEqual(await measure(selector),before,'voice refresh recovery keeps geometry/focus '+width);
    for(const [target,value] of [['.speech-fields select[aria-label="話者"]','two'],['.speech-fields select[aria-label="スタイル"]','8'],['.speech-runtime [role=switch]',null]]){
      await evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({block:'center'});document.querySelector(${JSON.stringify(target)}).focus({preventScroll:true});boardManagementHarness.holdNextSave()`);
      const savedBefore=await measure(target);
      const change=()=>value===null?click(target):evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(target)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await change();await settle();const saves=await evaluate("boardManagementHarness.trace().filter(t=>t.kind==='save').length");await change();await settle();
      assert.equal(await evaluate("boardManagementHarness.trace().filter(t=>t.kind==='save').length"),saves,'voice save cannot duplicate');
      assert.deepEqual(await measure(target),savedBefore,'voice save pending keeps geometry/focus '+width+'/'+target);
      await evaluate('boardManagementHarness.releaseSave()');await settle();
      assert.deepEqual(await measure(target),savedBefore,'voice save completion keeps geometry/focus '+width+'/'+target);
    }
    await click('.speech-engine-file summary');
    const file='.speech-engine-select';
    await evaluate(`document.querySelector('${file}').scrollIntoView({block:'center'});document.querySelector('${file}').focus({preventScroll:true});boardManagementHarness.holdNextMutation()`);
    const fileBefore=await measure(file),mutations=await evaluate('boardManagementHarness.trace().length');
    await click(file);await click(file);
    assert.equal(await evaluate('boardManagementHarness.trace().length'),mutations+1,'engine selection cannot duplicate');
    assert.deepEqual(await measure(file),fileBefore,'engine selection pending keeps geometry/focus '+width);
    await evaluate('boardManagementHarness.releaseMutation()');await settle();
    assert.deepEqual(await measure(file),fileBefore,'cancelled engine selection keeps geometry/focus '+width);
    if(capture){await evaluate("document.querySelector('.speech-fields').scrollIntoView({block:'start'})");await settle();await capture('flow-speech-controls-'+width+'.png');}
  }
}
