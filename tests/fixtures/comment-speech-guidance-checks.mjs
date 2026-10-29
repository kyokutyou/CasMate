import assert from 'node:assert/strict';

export async function verifyCommentSpeechGuidance({evaluate:run,resize,capture,setZoom,resizeMinimum}) {
  const evaluate=async code=>{try{return await run(code);}catch(error){throw new Error(`Speech guidance evaluation failed: ${code}`,{cause:error});}};
  const settle=()=>evaluate('new Promise(resolve=>setTimeout(resolve,80))');
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settle();};
  await click('#home-commentSpeech');
  let checks=0;
  for(const theme of ['ocean','pearl'])for(const size of ['medium','large']) {
    await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:${JSON.stringify(size)}}}});})()`);
    for(const [width,height] of [[1200,820],[760,560],[560,760],[480,760],[320,760],[203,360]]) {
      const nativeMinimum=width===203&&Boolean(setZoom&&resizeMinimum);
      if(nativeMinimum) {
        // Electron's outer minimum cannot provide a 203px content width.
        // Exercise its real minimum at 150%; browsers retain exact 203px coverage.
        await setZoom(1.5);await resizeMinimum();
      } else await resize(width,height);
      await settle();
      for(const engineStatus of ['disabled','preparing','unavailable','ready']) {
        await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({commentSpeech:{...s.commentSpeech,engineStatus:${JSON.stringify(engineStatus)}}});})()`);await settle();
        await click('.speech-runtime button.secondary');
        const focused=await evaluate(`(() => {const h=document.activeElement,b=document.querySelector('.management-body').getBoundingClientRect(),r=h.getBoundingClientRect();return {text:h.textContent,top:r.top,bottom:r.bottom,bodyTop:b.top,bodyBottom:b.bottom}})()`);
        assert.equal(focused.text==='VOICEVOX'&&focused.top>=focused.bodyTop&&focused.bottom<=focused.bodyBottom,true,`settings link focuses and reveals engine controls: ${JSON.stringify(focused)}`);
        const geometry=await evaluate(`(() => {const p=document.querySelector('.speech-preview-button'),g=document.getElementById(p.getAttribute('aria-describedby')),card=document.querySelector('.comment-speech-panel'),b=document.querySelector('.management-body'),r=g.getBoundingClientRect();return {reason:g.textContent,reasonHeight:r.height,buttonWidth:p.getBoundingClientRect().width,buttonTop:p.getBoundingClientRect().top,buttonLeft:p.getBoundingClientRect().left,followingTop:document.querySelector('.speech-lower-sections').getBoundingClientRect().top,overflow:b.scrollWidth>b.clientWidth||card.scrollWidth>card.clientWidth}})()`);
        assert.equal(geometry.overflow,false,`${theme}/${size}/${width}/${engineStatus}: no horizontal overflow`);
        assert.ok(geometry.reason.length>0,'preview has an accessible reason');
        const guidanceFit=await evaluate(`(() => {const g=document.querySelector('.speech-preview-guidance');return {height:g.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(g).lineHeight),fits:g.scrollHeight<=g.clientHeight+1}})()`);
        assert.equal(guidanceFit.fits,true,'preview guidance is readable without internal scrolling');
        if(width>=760&&size==='medium')assert.equal(guidanceFit.height<=guidanceFit.lineHeight+1,true,'normal-width preview guidance has no three-line blank reservation');
        assert.equal(await evaluate(`(() => {const b=document.querySelector('.speech-engine-select'),t=document.getElementById(b.getAttribute('aria-describedby')),c=t.querySelector('code');return c.textContent==='vv-engine / run.exe'&&Number(getComputedStyle(c).fontWeight)>=700&&t.getBoundingClientRect().bottom<=b.getBoundingClientRect().top&&t.textContent.includes('VOICEVOX.exeは選択しません。')})()`),true,'file target is emphasized before its action and linked to it');
        assert.equal(await evaluate(`document.querySelector('.speech-fields').closest('section').contains([...document.querySelectorAll('button')].find(b=>b.textContent==='話者一覧を更新'))`),true,'voice refresh is beside voice controls');
        const engineBefore=await evaluate(`(() => {const g=document.querySelector('.speech-engine-guidance'),b=document.querySelector('.speech-engine-select');return [g.getBoundingClientRect().height,b.getBoundingClientRect().top,b.getBoundingClientRect().height]})()`);
        if(width===760&&size==='medium')assert.equal(await evaluate(`(() => {const g=document.querySelector('.speech-engine-guidance');return g.getBoundingClientRect().height<=parseFloat(getComputedStyle(g).lineHeight)+1})()`),true,'short engine guidance has no multi-line blank reservation');
        const debugBefore=await evaluate(`[...document.querySelectorAll('.comment-speech-panel .speech-runtime,.speech-fields,.speech-mixer,.speech-preview-sample,.speech-lower-sections,.speech-engine-state,.speech-preview-guidance')].map(n=>({text:n.className,top:n.getBoundingClientRect().top,height:n.getBoundingClientRect().height,scroll:document.querySelector('.management-body').scrollTop}))`);
        const before=geometry;
        await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({commentSpeech:{...s.commentSpeech,engineStatus:'preparing'}});})()`);await settle();
        const after=await evaluate(`(() => {const p=document.querySelector('.speech-preview-button'),g=document.getElementById(p.getAttribute('aria-describedby'));return {height:g.getBoundingClientRect().height,width:p.getBoundingClientRect().width,top:p.getBoundingClientRect().top,left:p.getBoundingClientRect().left,followingTop:document.querySelector('.speech-lower-sections').getBoundingClientRect().top}})()`);
        assert.equal(after.height,before.reasonHeight,'reason area keeps its height');
        assert.equal(after.width,before.buttonWidth,'preview button keeps its width');
        assert.deepEqual(await evaluate(`(() => {const g=document.querySelector('.speech-engine-guidance'),b=document.querySelector('.speech-engine-select');return [g.getBoundingClientRect().height,b.getBoundingClientRect().top,b.getBoundingClientRect().height]})()`),engineBefore,'engine guidance keeps the file selection button in position');
        assert.deepEqual([after.top,after.left,after.followingTop],[before.buttonTop,before.buttonLeft,before.followingTop],`reason changes keep button and following controls in position: ${theme}/${size}/${width}/${engineStatus}; before=${JSON.stringify(debugBefore)}; after=${JSON.stringify(await evaluate(`[...document.querySelectorAll('.comment-speech-panel .speech-runtime,.speech-fields,.speech-mixer,.speech-preview-sample,.speech-lower-sections,.speech-engine-state,.speech-preview-guidance')].map(n=>({text:n.className,top:n.getBoundingClientRect().top,height:n.getBoundingClientRect().height,scroll:document.querySelector('.management-body').scrollTop}))`))}`);
        checks++;
      }
      if(capture&&size==='medium'&&[760,320].includes(width)) {
        await evaluate(`document.querySelector('.speech-preview-button').scrollIntoView({block:'center'})`);await settle();
        await capture(`speech-guidance-${theme}-${width}.png`);
        await evaluate(`document.querySelector('.speech-engine-overview').scrollIntoView({block:'start'})`);await settle();
        await capture(`voicevox-overview-${theme}-${width}.png`);
        await evaluate(`document.querySelector('.speech-engine-select').scrollIntoView({block:'center'})`);await settle();
        await capture(`voicevox-settings-${theme}-${width}.png`);
      }
      if(nativeMinimum)await setZoom(1);
    }
  }
  assert.equal(await evaluate('boardManagementHarness.trace().length'),0,'guidance navigation does not save or start the engine');
  await resize(760,560);
  await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({commentSpeech:{...s.commentSpeech,engineStatus:'disabled'}});})()`);await settle();
  await evaluate(`document.querySelector('.speech-engine-select').focus();document.querySelector('.speech-engine-select').scrollIntoView({block:'center'})`);await settle();
  const measure=()=>evaluate(`(() => {const r=document.querySelector('.speech-engine-select').getBoundingClientRect();return [r.x,r.y,r.width,r.height,document.querySelector('.management-body').scrollTop]})()`);
  const idle=await measure();
  await evaluate('boardManagementHarness.holdNextMutation()');await click('.speech-engine-select');
  assert.deepEqual(await measure(),idle,'opening file dialog keeps the control and scroll position');
  await evaluate('boardManagementHarness.releaseMutation()');await settle();
  assert.deepEqual(await measure(),idle,'cancelled selection keeps control and scroll position');
  assert.equal(await evaluate(`document.querySelector('.toast-region').textContent.includes('起動ファイルを指定しました')`),false,'cancellation has no success toast');
  assert.equal(await evaluate('boardManagementHarness.trace().length'),1,'only the explicit file dialog request is sent');checks++;
  await click('.editor-heading-row .back-button');
  assert.equal(await evaluate('document.activeElement.id'),'home-commentSpeech','return to the original home entry');
  return checks;
}
