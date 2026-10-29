import assert from 'node:assert/strict';

export async function verifyCompactFeedback({ evaluate, resize, capture }) {
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,20))');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const initial = await evaluate('boardManagementHarness.snapshot()');
  await click('[data-page=settings]');
  const entries = await evaluate("[...document.querySelectorAll('.management-categories .management-entry')].map(node=>node.id)");
  let checked = 0;
  for (const size of ['medium', 'large']) for (const width of [1000, 560, 320]) {
    await resize(width, 760);
    await evaluate(`boardManagementHarness.updateSnapshot({settings:{...boardManagementHarness.snapshot().settings,application:{...boardManagementHarness.snapshot().settings.application,managementTextSize:${JSON.stringify(size)}}}})`);
    for (const entry of entries) {
      await click('[data-page=settings]'); await click('#' + entry);
      await evaluate("document.querySelectorAll('.management-body details').forEach(node=>{if(node.checkVisibility())node.open=true})"); await settle();
      const results = await evaluate(`(() => [...document.querySelectorAll('.compact-feedback')].filter(node=>node.checkVisibility()).map(node=>({
        name:node.className,text:node.textContent.trim(),height:node.clientHeight,
        fits:node.scrollHeight<=node.clientHeight+1&&node.scrollWidth<=node.clientWidth+1
      })))()`);
      for (const result of results) {
        assert.equal(result.fits, true, `${entry}/${width}/${size}: ${JSON.stringify(result)}`);
        assert.ok(result.height > 0);
        checked++;
      }
      if(entry==='settings-textEffects') {
        assert.equal(await evaluate("document.querySelector('#effects-appearance').closest('details')===null"),true,'common effects settings are not collapsible');
        assert.equal(await evaluate("[...document.querySelectorAll('.effects-common input')].every(node=>node.checkVisibility())"),true,'all common effect inputs remain visible');
        assert.equal(await evaluate("document.querySelector('.text-effects-panel').textContent.includes('変更は自動保存されます。')"),false,'removed autosave notice');
        const effectsLayout=()=>evaluate(`(() => {const body=document.querySelector('.management-body');return {
          rects:[...document.querySelectorAll('.text-effects-panel button,.text-effects-panel input,.effects-enable-help')].map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}),
          height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement===document.querySelector('.effects-common input')};})()`);
        await evaluate("document.querySelector('.effects-common input').focus({preventScroll:true})");
        const normalEffects=await effectsLayout();
        const originalEffects=await evaluate("document.querySelector('.effects-common input').value");
        await evaluate("(()=>{const node=document.querySelector('.effects-common input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'201');node.dispatchEvent(new Event('input',{bubbles:true}));})()");await settle();
        assert.deepEqual(await effectsLayout(),normalEffects,'effects validation preserves controls and page geometry');
        assert.equal(await evaluate("document.querySelector('.effects-enable-help').textContent.includes('要確認：')"),true,'effects error remains discoverable');
        await evaluate(`(()=>{const node=document.querySelector('.effects-common input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(originalEffects)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
        if(capture && width===1000 && size==='medium') await capture('text-effects-common-always-visible.png');
      }
      if (entry === 'settings-commentOverlay' && width === 1000) {
        const height = await evaluate("document.querySelector('.overlay-input-help').getBoundingClientRect().height");
        assert.ok(height < 90, `compact numeric hint: ${height}`);
        if (capture) await capture(`compact-overlay-${size}.png`);
      }
      if (entry === 'settings-speechRecognitionOverlay') {
        const panel='.speech-recognition-overlay-panel';
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel)}).querySelectorAll('dialog,[role=switch]').length`),0,'no speech overlay preview or display toggle');
        const original=await evaluate('boardManagementHarness.snapshot().settings');
        for(const theme of ['ocean','pearl']) {
          await evaluate(`(()=>{const value=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:value.settingsRevision+1,settings:{...value.settings,application:{...value.settings.application,managementTheme:${JSON.stringify(theme)}}}});})()`);await settle();
          const selector=panel+' input[max="60"]';
          await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
          const geometry=()=>evaluate(`(()=>{const body=document.querySelector('.management-body');return {boxes:[...document.querySelectorAll('${panel} input,${panel} select,${panel} button,${panel} .overlay-setting-section')].map(node=>{const r=node.getBoundingClientRect();return[r.x,r.y,r.width,r.height]}),height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement.id,overflow:body.scrollWidth>body.clientWidth};})()`);
          const normal=await geometry(); assert.equal(normal.overflow,false);
          const value=await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
          await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'61');node.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
          assert.deepEqual(await geometry(),normal,`${width}/${size}/${theme}: speech overlay validation keeps positions`);
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-invalid')`),'true');
          await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
          if(capture) await capture(`speech-overlay-${theme}-${size}-${width}.png`);
        }
        await evaluate(`(()=>{const value=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:value.settingsRevision+1,settings:${JSON.stringify(original)}});})()`);await settle();
      }
      if(entry==='settings-commentOverlay') {
        assert.equal(await evaluate("document.querySelector('.comment-overlay-panel').textContent.includes('OBSで見え方を確認')||!!document.querySelector('.comment-overlay-panel dialog,.overlay-check-section,.overlay-guide')"),false,'removed OBS preview and URL section');
        const original=await evaluate('boardManagementHarness.snapshot().settings');
        const timingLayout=()=>evaluate(`(()=>{const body=document.querySelector('.management-body');return {
          boxes:[...document.querySelectorAll('.overlay-timing-rows,.overlay-timing-row,.overlay-timing-row input,.overlay-setting-section')].map(node=>{const r=node.getBoundingClientRect();return[r.x,r.y,r.width,r.height]}),
          height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement.getAttribute('aria-label')};})()`);
        for(const theme of ['ocean','pearl']) {
          await evaluate(`(()=>{const value=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:value.settingsRevision+1,settings:{...value.settings,
            application:{...value.settings.application,managementTheme:${JSON.stringify(theme)}},commentSpeech:{...value.settings.commentSpeech,enabled:false}}});})()`);await settle();
          await evaluate("document.querySelector('.overlay-mode-choices button[aria-label=\"1件ずつ\"]').focus({preventScroll:true})");
          const normalTiming=await timingLayout();
          for(const on of [true,false]) {
            await evaluate(`(()=>{const value=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:value.settingsRevision+1,settings:{...value.settings,commentSpeech:{...value.settings.commentSpeech,enabled:${on}}}});})()`);await settle();
            assert.deepEqual(await timingLayout(),normalTiming,`${width}/${size}/${theme}: reading state preserves timing geometry`);
            const timing=await evaluate(`(()=>{const rows=[...document.querySelectorAll('.overlay-timing-row')],group=document.querySelector('.overlay-timing-rows'),body=document.querySelector('.management-body');
              const boxes=rows.map(node=>node.getBoundingClientRect());const fallback=document.querySelector('.overlay-timing-fallback');
              return {active:rows.map(node=>node.dataset.active),badge:rows.filter(node=>node.querySelector('.overlay-timing-active').textContent==='適用中').length,
                disabled:rows[1].querySelector('input').disabled,stacked:boxes[1].top>=boxes[0].bottom-1,
                fallback:!!fallback,overflow:body.scrollWidth>body.clientWidth,
                fits:[...group.querySelectorAll('h4,.overlay-timing-active,.overlay-timing-main')].every(node=>node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1),
                marks:rows.every(node=>node.querySelector('.overlay-timing-mark').getAttribute('aria-hidden')==='true')&&getComputedStyle(rows[0].querySelector('.overlay-timing-mark')).backgroundColor!==getComputedStyle(rows[1].querySelector('.overlay-timing-mark')).backgroundColor,
                sameBackground:getComputedStyle(rows[0]).backgroundColor===getComputedStyle(rows[1]).backgroundColor,
                aligned:Math.abs(rows[0].querySelector('.overlay-timing-main').getBoundingClientRect().left-rows[1].querySelector('input').getBoundingClientRect().left)<1,
                inline:${width}!==1000||(()=>{const input=rows[1].querySelector('input').getBoundingClientRect(),hint=rows[1].querySelector('.overlay-input-help').getBoundingClientRect();return hint.left>input.right&&hint.top<input.bottom&&hint.bottom>input.top})(),
                lines:parseFloat(getComputedStyle(rows[0]).borderTopWidth)===0&&getComputedStyle(rows[1]).borderTopStyle==='dashed'&&rows.every(node=>parseFloat(getComputedStyle(node).borderRadius)===0),
                compact:${width}!==1000||group.getBoundingClientRect().height<200};})()`);
            assert.deepEqual(timing,{active:[String(on),String(!on)],badge:1,disabled:false,stacked:true,fallback:false,overflow:false,fits:true,marks:true,sameBackground:true,aligned:true,inline:true,lines:true,compact:true},`${width}/${size}/${theme}: timing rows`);
          }
        }
        await evaluate(`(()=>{const value=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:value.settingsRevision+1,settings:${JSON.stringify(original)}});})()`);await settle();
        const beforeInvalid=await timingLayout();
        const originalSeconds=await evaluate("document.querySelector('.overlay-single-number-line input').value");
        await evaluate("(()=>{const node=document.querySelector('.overlay-single-number-line input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'61');node.dispatchEvent(new Event('input',{bubbles:true}));})()");await settle();
        assert.deepEqual(await timingLayout(),beforeInvalid,`${width}/${size}: inline duration validation preserves geometry`);
        assert.equal(await evaluate("document.querySelector('.overlay-single-number-line input').getAttribute('aria-invalid')"),'true');
        await evaluate(`(()=>{const node=document.querySelector('.overlay-single-number-line input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(originalSeconds)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
      }
    }
  }
  const measure = `(() => {const body=document.querySelector('.management-body');return {
    boxes:[...document.querySelectorAll('.management-body input,.management-body button,.management-body .compact-feedback')].filter(n=>n.checkVisibility()).map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}),
    height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement.id};})()`;
  await click('[data-page=settings]'); await click('#settings-commentOverlay');
  await evaluate("document.querySelector('.overlay-single-number-line input').focus({preventScroll:true});document.querySelector('.management-body').scrollTop=100");
  const normal = await evaluate(measure);
  await evaluate("(()=>{const input=document.querySelector('.overlay-single-number-line input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'61');input.dispatchEvent(new Event('input',{bubbles:true}))})()"); await settle();
  assert.deepEqual(await evaluate(measure), normal, 'numeric validation preserves positions');
  assert.equal(await evaluate("document.querySelector('.overlay-single-number-line input').getAttribute('aria-invalid')"), 'true');
  await click('[data-page=settings]'); await click('#settings-sources');
  await evaluate("document.querySelector('#source-youtube').focus({preventScroll:true});document.querySelector('.management-body').scrollTop=40");
  const stopped = await evaluate(measure);
  await evaluate("boardManagementHarness.updateSnapshot({sourceStatuses:{...boardManagementHarness.snapshot().sourceStatuses,youtube:{...boardManagementHarness.snapshot().sourceStatuses.youtube,state:'error',message:'接続先を確認してください。'.repeat(100)}}})"); await settle();
  assert.deepEqual(await evaluate(measure), stopped, 'long service error preserves positions');
  assert.equal(await evaluate("(()=>{const node=document.querySelector('#source-message-youtube');node.scrollTop=node.scrollHeight;return node.scrollTop>0})()"), true, 'long error can be scrolled');
  if (capture) await capture('compact-long-error.png');
  await evaluate(`boardManagementHarness.updateSnapshot(${JSON.stringify(initial)})`);
  return checked;
}
