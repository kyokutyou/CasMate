import assert from 'node:assert/strict';

export async function verifyObsDesign({ evaluate, resize, capture, pressKey, clickSpinner, requestClose, resetCloseWarning }) {
  // Keep the real 500ms autosave debounce; wait for its visible result instead
  // of sleeping after every layout, scroll, retry and save operation.
  const settle = () => evaluate(`new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('OBS design did not finish saving or rendering')),5000);
    const frame=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const p=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden])');
      const busy=p?.querySelector('.design-save-status')?.textContent.includes('保存待ち・保存中')
        || p?.querySelector('.saved-design-status > span')?.textContent.includes('更新中')
        || p?.querySelector('.design-font-status button')?.getAttribute('aria-disabled')==='true';
      const animating=document.getAnimations().some(a=>a.playState==='running' && Number.isFinite(a.effect?.getComputedTiming().endTime));
      if(!busy&&!animating){clearTimeout(timer);resolve();return;}
      frame();
    }));frame();
  })`);
  const input = (label, value) => evaluate(`(() => {const p=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden])');const e=[...p.querySelectorAll('input,select')].find(e=>e.getAttribute("aria-label")===${JSON.stringify(label)}||[...e.labels??[]].some(l=>l.textContent===${JSON.stringify(label)}));if(!e)throw Error('Missing '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  const tab = async name => {
    await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-editor-tabs button[id$="-${name}"]').click()`);
    await settle();
  };
  let count = 0;
  for (const theme of ['ocean', 'pearl']) for (const width of [320, 560, 760, 761, 1200]) {
    await resize(width, 820);
    await evaluate(`designHarness.update({managementTheme:${JSON.stringify(theme)},managementTextSize:'large'})`);
    await settle();
    await tab('adjust');
    await evaluate('scrollTo(0,0)');
    const compact = await evaluate(`(() => {const p=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden])');const g=p.querySelectorAll('.design-adjust-group');const pair=g[0].querySelector('.control-pair');return {groups:[...g].map(e=>e.getAttribute('aria-label')),headingColor:getComputedStyle(g[0].querySelector('h3')).color,lineHeight:p.querySelectorAll('input[type=text]').length,columns:getComputedStyle(pair).gridTemplateColumns.split(' ').length,width:p.querySelector('.design-adjust-panel').clientWidth,clipped:[...p.querySelectorAll('.design-adjust-panel input[type=text],.design-adjust-panel input[type=number],.design-adjust-panel select')].filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>({label:e.getAttribute('aria-label')||e.labels?.[0]?.textContent||e.id,value:e.value,width:e.clientWidth,scroll:e.scrollWidth}))};})()`);
    assert.deepEqual(compact.groups,['文字','背景','余白・形']);assert.deepEqual(compact.clipped,[],'compact inputs fit: '+JSON.stringify(compact));
    assert.equal(compact.columns,compact.width<=350?1:2);
    if(width===320||width===1200) {
      await evaluate("(()=>{const a=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .advanced-controls');a.open=true;a.scrollIntoView({block:'start'});})()");await settle();
      const detail=await evaluate(`(()=>{const p=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden])'),a=p.querySelector('.advanced-controls'),groups=[...a.querySelectorAll('.effect-fields')];return {columns:groups.map(e=>e.children[1].getBoundingClientRect().left>e.children[0].getBoundingClientRect().left+1?2:1),padding:getComputedStyle(a.querySelector('.details-body')).paddingLeft,numberTypes:[...a.querySelectorAll('.numeric-inputs input:not([type=range])')].map(e=>e.type),clipped:[...a.querySelectorAll('.numeric-inputs input:not([type=range]),.color-input input[type=text]')].filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.labels?.[0]?.textContent||e.getAttribute('aria-label')),wide:groups.flatMap(e=>[...e.querySelectorAll(':scope > .control-pair,:scope > .effect-wide')].map(c=>Math.abs(c.getBoundingClientRect().width-e.getBoundingClientRect().width)<1))};})()`);
      assert.ok(detail.columns.every(n=>n===(compact.width<=350?1:2)),'expanded effect fields follow the compact grid: '+JSON.stringify({detail,width:compact.width}));
      assert.equal(detail.padding,'0px');assert.ok(detail.numberTypes.every(type=>type==='number'));assert.deepEqual(detail.clipped,[]);assert.ok(detail.wide.every(Boolean));
      if(capture){await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .advanced-controls').scrollIntoView({block:'start'})");await settle();await capture(`obs-details-${theme}-${width}.png`);}
      await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .advanced-controls').open=false;scrollTo(0,0)");await settle();
    }
    if(capture&&(width===320||width===1200)){
      await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-adjust-panel').scrollIntoView({block:'start'})");await settle();await capture(`obs-adjust-${theme}-${width}.png`);await evaluate('scrollTo(0,0)');await settle();
    }
    const layout = await evaluate(`(() => {const p=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden])');const a=p.querySelector('.preview-column').getBoundingClientRect(),b=p.querySelector('.design-column').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,a:{x:a.x,y:a.y,right:a.right,bottom:a.bottom},b:{x:b.x,y:b.y,right:b.right},font:parseFloat(getComputedStyle(document.querySelector('.obs-design-page')).fontSize),color:getComputedStyle(document.querySelector('.obs-design-page')).color,labelColor:getComputedStyle(p.querySelector('.select-control label')).color,labelSize:getComputedStyle(p.querySelector('.select-control label')).fontSize,preview:!!p.querySelector('iframe').contentDocument.querySelector('main')};})()`);
    assert.ok(layout.scroll <= layout.width + 1, `horizontal overflow at ${theme}/${width}: ${JSON.stringify(layout)}`);
    assert.ok(layout.preview); assert.equal(layout.font, 18);
    if (width > 900) assert.ok(layout.a.y <= 260, `compact header keeps preview near the top: ${layout.a.y}; `+await evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.editor-header,.design-help,.editor-navigation,.design-editing-fields > [role=tabpanel]:not([hidden]) .design-toolbar'),e=>({name:e.className,box:e.getBoundingClientRect().toJSON(),margin:getComputedStyle(e).margin,padding:getComputedStyle(e).padding})))`));
    const geometry = () => evaluate(`Array.from(document.querySelectorAll('.editor-header, .editor-navigation, .design-editing-fields > [role=tabpanel]:not([hidden]) .design-toolbar, .design-editing-fields > [role=tabpanel]:not([hidden]) .editor-layout'),element=>{const r=element.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})`);
    const beforeNotice = await geometry();
    await input('文字サイズ', String(48 + count));
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.match(await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-save-status').textContent`), /保存待ち・保存中/u);
    assert.deepEqual(await geometry(), beforeNotice, 'pending save keeps the header and controls in place');
    await settle();
    assert.deepEqual(await geometry(), beforeNotice, 'pending and success notice keep the header and controls in place');
    const toast = await evaluate(`(()=>{const h=document.querySelector('.editor-header h1').getBoundingClientRect(),t=document.querySelector('.design-notifications .banner').getBoundingClientRect();return {left:t.left,right:t.right,top:t.top,bottom:t.bottom,headingRight:h.right,headingBottom:h.bottom}})()`);
    assert.ok(toast.left >= toast.headingRight - 1 && toast.right <= layout.width + 1, 'toast fits beside the title: '+JSON.stringify({width,toast}));
    await evaluate(`designHarness.fail('保存できませんでした。接続状態を確認して再保存してください。'.repeat(20))`);
    await input('文字サイズ', String(80 + count)); await settle();
    assert.deepEqual(await geometry(), beforeNotice, 'long failure keeps the header and controls in place');
    const errorBox = await evaluate(`(()=>{const e=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-save-status>span');e.scrollTop=e.scrollHeight;return {scroll:e.scrollTop,overflow:e.scrollHeight>e.clientHeight,text:e.textContent}})()`);
    assert.ok(errorBox.overflow && errorBox.scroll > 0 && errorBox.text.includes('再保存'), 'long failure remains readable inside the status area');
    await evaluate(`(()=>{const b=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-save-status button');b.focus();b.click();})()`);await settle();
    assert.equal(await evaluate('document.activeElement.textContent'), '再保存', 'autosave retry success keeps focus');
    if (requestClose) {
      await input('文字サイズ', ''); await requestClose();
      assert.match(await evaluate(`document.querySelector('.design-close-status').textContent`), /未保存/u);
      assert.deepEqual(await geometry(), beforeNotice, 'close warning keeps the header and controls in place');
      await input('文字サイズ', String(80 + count)); await resetCloseWarning();
    }
    if (width === 320 || width === 1200) {
      const fontScrollBefore = await evaluate('scrollY');
      await evaluate(`(()=>{fontHarness.hold();fontHarness.fail();const b=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-font-status button');b.scrollIntoView({block:'center'});b.focus();b.click();})()`);
      await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
      assert.equal(await evaluate(`document.activeElement.textContent`), '一覧を再取得', 'font reload progress keeps focus');
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-disabled')`), 'true');
      await evaluate('fontHarness.release()');await settle();
      assert.equal(await evaluate(`document.activeElement.textContent`), '一覧を再取得', 'font reload failure keeps focus');
      await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-font-status button').click()`);await settle();
      assert.equal(await evaluate(`document.activeElement.textContent`), '一覧を再取得', 'font reload success keeps focus');
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-disabled')`), 'false');
      await evaluate(`scrollTo(0,${fontScrollBefore})`);
    }
    const copyScrollBefore = await evaluate('scrollY');
    await evaluate(`(()=>{const b=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .save-current-design');b.scrollIntoView({block:'center'});b.focus();})()`);
    const savedGeometry = () => evaluate(`Array.from(document.querySelectorAll('.design-editing-fields > [role=tabpanel]:not([hidden]) .save-current-design,.design-editing-fields > [role=tabpanel]:not([hidden]) .saved-design-status,.design-editing-fields > [role=tabpanel]:not([hidden]) .preset-buttons'),e=>{const r=e.getBoundingClientRect();return [r.x,r.width?r.y+scrollY:0,r.width,r.height].map(n=>Math.round(n*100)/100)})`);
    const beforeCopy = await savedGeometry();
    await evaluate(`(()=>{designHarness.hold();designHarness.fail('保存できませんでした。再試行してください。'.repeat(20));document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .save-current-design').click();})()`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.match(await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .saved-design-status').textContent`), /更新中/u);
    assert.deepEqual(await savedGeometry(), beforeCopy, 'copy progress keeps controls in place');
    assert.equal(await evaluate(`document.activeElement.className`), 'save-current-design', 'copy progress keeps focus');
    if (requestClose) { await requestClose();assert.match(await evaluate(`document.querySelector('.design-close-status').textContent`), /未保存/u);await resetCloseWarning(); }
    await evaluate('designHarness.release()');await settle();
    assert.deepEqual(await savedGeometry(), beforeCopy, 'copy failure keeps controls in place');
    assert.equal(await evaluate(`(()=>{const e=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .saved-design-status>span');e.scrollTop=e.scrollHeight;return e.scrollTop>0})()`), true, 'copy error can be read in full');
    await evaluate(`(()=>{designHarness.hold();designHarness.fail();const b=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .saved-design-status button');b.focus();b.click();})()`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.equal(await evaluate(`document.activeElement.textContent`), '再試行', 'retry progress keeps focus');
    assert.deepEqual(await savedGeometry(), beforeCopy, 'retry progress keeps controls in place');
    await evaluate('designHarness.release()');await settle();
    assert.equal(await evaluate(`document.activeElement.textContent`), '再試行', 'repeated failure keeps focus');
    await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .saved-design-status button').click()`);await settle();
    assert.equal(await evaluate(`document.activeElement.className`), 'save-current-design', 'successful retry returns focus before hiding retry');
    await tab('saved');await settle();
    const savedCopy = await evaluate(`designHarness.snapshot().settings.application.obsSavedDesigns.comments.items[0]`);
    assert.ok(savedCopy?.design);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .saved-design-item .preset-thumbnail').shadowRoot.querySelector('main')).fontSize`), `${savedCopy.design.style.fontSize}px`);
    assert.equal(await evaluate(`(()=>{const r=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .saved-design-item .preset-thumbnail').shadowRoot,c=r.querySelector('.overlay-comment,.speech-recognition-overlay-text');return r.querySelector('.preset-surface').clientHeight>=Math.max(c.offsetHeight,c.scrollHeight)+32})()`), true, 'large saved design fits the thumbnail canvas');
    if (capture && width === 1200) await capture(`obs-saved-design-${theme}.png`);
    await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .saved-design-delete').click()`);await settle();
    assert.equal(await evaluate(`designHarness.snapshot().settings.application.obsSavedDesigns.comments.items.length`), 0);
    assert.equal(await evaluate(`document.activeElement.className`), 'save-current-design', 'delete returns focus to save');
    const afterDelete = await savedGeometry();
    for (let row=0;row<beforeCopy.length;row++) for(let column=0;column<4;column++) assert.ok(Math.abs(afterDelete[row][column]-beforeCopy[row][column])<0.1, 'delete returns to the original compact layout within subpixel rounding');
    await tab('adjust');
    await evaluate(`scrollTo(0,${copyScrollBefore})`);
    await evaluate(`document.querySelector('.design-help summary').click()`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.design-css-note')).display !== 'none' && document.querySelector('.design-help').open`), true);
    await evaluate(`document.querySelector('.design-help summary').click()`);
    assert.deepEqual(await geometry(), beforeNotice, 'explicit help can be closed without changing the compact layout');
    assert.equal(layout.color, theme === 'ocean' ? 'rgb(240, 247, 250)' : 'rgb(26, 38, 56)', 'editor follows management theme');
    assert.equal(layout.labelColor, layout.color); assert.equal(compact.headingColor,layout.color,'group headings follow the management theme'); assert.equal(layout.labelSize, '18px');
    await tab('presets');
    const tabLayout = await evaluate(`(() => {const p=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden])');return {visible:[...p.querySelectorAll('.design-column [role=tabpanel]')].filter(e=>!e.hidden).length,tabs:[...p.querySelectorAll('.design-editor-tabs button')].map(e=>({text:e.textContent,width:e.getBoundingClientRect().width,fit:e.scrollWidth<=e.clientWidth+1})),saveVisible:p.querySelector('.save-current-design').getBoundingClientRect().height>0,adjustHidden:p.querySelector('.design-adjust-panel').getBoundingClientRect().height===0};})()`);
    assert.equal(tabLayout.visible,1);assert.equal(tabLayout.adjustHidden,true);assert.equal(tabLayout.saveVisible,true);
    for(const button of tabLayout.tabs) {assert.ok(button.width>0);assert.ok(button.fit,button.text);}
    const preset = await evaluate(`(() => {const s=getComputedStyle(document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .preset-buttons button'));return {color:s.color,background:s.backgroundColor};})()`);
    assert.equal(preset.color, layout.color); assert.equal(preset.background, theme === 'ocean' ? 'rgb(18, 32, 41)' : 'rgb(255, 255, 255)');
    const cards = await evaluate(`(() => {
      const group=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .preset-buttons');
      return {columns:getComputedStyle(group).gridTemplateColumns.split(' ').length,cards:[...group.querySelectorAll('.preset-card')].map(card=>{
        const button=card.querySelector('button'),sample=card.querySelector('.preset-thumbnail'),root=sample.shadowRoot,box=button.getBoundingClientRect();
        return {name:button.getAttribute('aria-label'),sample:!!root?.querySelector('main'),width:box.width,fit:button.scrollWidth<=button.clientWidth+1&&button.scrollHeight<=button.clientHeight+1,hidden:sample.getAttribute('aria-hidden'),inert:sample.inert};
      })};
    })()`);
    assert.equal(cards.cards.length,10);
    for (const card of cards.cards) { assert.ok(card.sample,card.name); assert.ok(card.fit,card.name); assert.ok(card.width>0); assert.equal(card.hidden,'true'); assert.equal(card.inert,true); }
    if(layout.width<=400)assert.equal(cards.columns,1);
    if (width > 900) assert.ok(layout.b.x >= layout.a.right); else assert.ok(layout.b.y >= layout.a.bottom);
    if (capture && width === 320) {
      await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-column').scrollIntoView({block:'start'})");
      await settle();
      await capture(`obs-design-tabs-${theme}-320.png`);
      await evaluate('scrollTo(0,0)');
      await settle();
    }
    if (capture) await capture(`obs-design-${theme}-${width}.png`);
    count++;
  }
  await tab('adjust');
  if(clickSpinner) {
    async function spin(label, direction) {
      await evaluate(`(()=>{const p=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden])');const e=[...p.querySelectorAll('input[type=number]')].find(e=>e.labels?.[0]?.textContent===${JSON.stringify(label)});e.scrollIntoView({block:'center'});e.focus();})()`);await settle();
      const point=await evaluate(`(()=>{const p=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden])');const e=[...p.querySelectorAll('input[type=number]')].find(e=>e.labels?.[0]?.textContent===${JSON.stringify(label)}),r=e.getBoundingClientRect();return {x:Math.round(r.right-14),y:Math.round(r.top+r.height*${direction==='up'?0.3:0.7})};})()`);
      await clickSpinner(point);await settle();
    }
    await input('文字サイズ','32');await settle();
    await spin('文字サイズ','up');
    assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.fontSize'),33,'native up button saves an increment');
    await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .history-buttons button').click()");await settle();
    assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.fontSize'),32,'native spinner edit can be undone');
    await evaluate("document.querySelectorAll('.design-editing-fields > [role=tabpanel]:not([hidden]) .history-buttons button')[1].click()");await settle();
    await spin('文字サイズ','down');
    assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.fontSize'),32,'native down button saves a decrement');
    await input('文字サイズ','8');await settle();await spin('文字サイズ','down');
    assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.fontSize'),8,'native button keeps the lower bound');
    await input('文字サイズ','200');await settle();await spin('文字サイズ','up');
    assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.fontSize'),200,'native button keeps the upper bound');
    await input('行間','1.5');await settle();await spin('行間','up');
    assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.lineHeight'),1.55,'native decimal step saves the field-specific increment');
    await evaluate("(()=>{const a=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .advanced-controls');a.open=true;for(const e of a.querySelectorAll('input[role=switch]'))if(!e.checked)e.click();})()");await settle();
    await input('枠線の太さ','1');await settle();await spin('枠線の太さ','up');
    assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.border.width'),2,'expanded border spinner saves the increment');
    await input('縁取りの太さ','2');await settle();await spin('縁取りの太さ','up');
    assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.outline.width'),2.5,'expanded outline spinner keeps its decimal step');
    await input('文字の影・左右のずれ','-3');await settle();await spin('文字の影・左右のずれ','down');
    assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.textShadow.x'),-4,'expanded shadow spinner handles negative values');
    await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .advanced-controls').open=false");
    await evaluate('scrollTo(0,0)');
  }

  const beforeColor = await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-adjust-group').getBoundingClientRect().height");
  await input('文字色 カラーコード','#bad');
  assert.equal(await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) input[aria-label=\"文字色 カラーコード\"]').getAttribute('aria-invalid')"),'true');
  assert.equal(await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-adjust-group').getBoundingClientRect().height"),beforeColor,'color input error keeps control positions');
  await input('文字色 カラーコード','#123456');await settle();
  assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.textColor'),'#123456');
  await input('文字サイズ', '48'); await settle();
  assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.fontSize'), 48);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".design-editing-fields > [role=tabpanel]:not([hidden]) iframe").contentDocument.querySelector("main")).fontSize'), '48px');
  await evaluate('designHarness.fail()'); await input('文字サイズ', '50'); await settle();
  const status = await evaluate(`(() => {const p=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden])');return {text:p.querySelector('.design-save-status').textContent,before:p.querySelector('.design-column').getBoundingClientRect().top};})()`);
  assert.match(status.text, /保存できませんでした/u);
  await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-save-status button').click()`); await settle();
  assert.equal(await evaluate('designHarness.snapshot().settings.commentOverlay.design.style.fontSize'), 50);
  assert.equal(await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .design-column').getBoundingClientRect().top`), status.before, 'save feedback must not move controls');
  await input('文字サイズ', '');
  assert.equal(await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) input[aria-invalid=true]').value`), '');
  await input('文字サイズ', '50'); await settle();
  await evaluate('document.getElementById("design-tab-speech").click()'); await input('上下の位置', 'center'); await settle();
  assert.equal(await evaluate('designHarness.snapshot().settings.speechRecognitionOverlay.design.style.vertical'), 'center');
  await evaluate('document.getElementById("design-tab-comments").click()');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".design-editing-fields > [role=tabpanel]:not([hidden]) iframe").contentDocument.querySelector("main")).fontSize'), '50px');
  for(const target of ['comments','speech']) {
    await evaluate(`document.getElementById('design-tab-${target}').click()`);await settle();
    await tab('adjust');
    await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .advanced-controls').open=true");
    const targetDetails=await evaluate("(()=>{const a=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .advanced-controls');return {columns:[...a.querySelectorAll('.effect-fields')].map(e=>e.children[1].getBoundingClientRect().left>e.children[0].getBoundingClientRect().left+1?2:1),numbers:[...a.querySelectorAll('.numeric-inputs input:not([type=range])')].map(e=>e.type)};})()");
    assert.ok(targetDetails.columns.every(n=>n===2),'both targets use two columns at normal width');assert.ok(targetDetails.numbers.every(type=>type==='number'));
    if(capture){await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .advanced-controls').scrollIntoView({block:'start'})");await settle();await capture(`obs-details-${target}.png`);}
    await evaluate("document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .advanced-controls').open=false");
    await tab('presets');
    const names=await evaluate(`Array.from(document.querySelectorAll('.design-editing-fields > [role=tabpanel]:not([hidden]) .preset-buttons button'),node=>node.getAttribute('aria-label'))`);
    assert.deepEqual(names,['標準','明るいカード','背景なし','ダークカード','くっきり縁取り','パステル','ネオン','レトロ端末','和風','高視認性']);
    const styles=await evaluate(`Array.from(document.querySelectorAll('.design-editing-fields > [role=tabpanel]:not([hidden]) .preset-thumbnail'),node=>{const root=node.shadowRoot,main=root.querySelector('main'),box=root.querySelector('.overlay-comment,.speech-recognition-overlay-text'),text=root.querySelector('.comment-body,.speech-recognition-overlay-text'),m=getComputedStyle(main),b=getComputedStyle(box),t=getComputedStyle(text);return JSON.stringify([m.fontFamily,m.fontSize,m.fontWeight,t.color,b.backgroundColor,b.border,b.borderRadius,t.textShadow,t.webkitTextStroke]);})`);
    assert.equal(new Set(styles).size,10,'each thumbnail keeps its own actual style: '+JSON.stringify(styles));
    const other=await evaluate(`JSON.stringify(designHarness.snapshot().settings.${target==='comments'?'speechRecognitionOverlay':'commentOverlay'})`);
    for(const id of ['standard','light','transparent','dark','outlined','pastel','neon','terminal','japanese','highContrast']) {
      await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .preset-card[data-preset="${id}"] button').click()`);await settle();
      const applied=await evaluate(`designHarness.snapshot().settings.${target==='comments'?'commentOverlay':'speechRecognitionOverlay'}.design`);
      assert.ok(applied?.style);
      assert.equal(await evaluate(`JSON.stringify(designHarness.snapshot().settings.${target==='comments'?'speechRecognitionOverlay':'commentOverlay'})`),other,'preset does not change the other target');
    }
    if(capture) {
      await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .preset-buttons').scrollIntoView({block:'start'})`);await settle();
      await capture(`obs-design-presets-${target}.png`);
      await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .preset-card:last-child').scrollIntoView({block:'end'})`);await settle();
      await capture(`obs-design-presets-${target}-bottom.png`);
    }
  }
  if(pressKey) {
    for(const [id,key] of [['outlined','Enter'],['transparent','Space']]) {
      await evaluate(`(()=>{const b=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .preset-card[data-preset="${id}"] button');b.scrollIntoView({block:'center'});b.focus();})()`);
      const geometry=()=>evaluate(`(()=>{const b=document.activeElement,r=b.getBoundingClientRect();return [b.getAttribute('aria-label'),r.x,r.y,r.width,r.height,scrollY]})()`);
      const before=await geometry();await pressKey(key);await settle();
      assert.deepEqual(await geometry(),before,'keyboard apply and success notice keep card position and focus');
      assert.equal(await evaluate('designHarness.snapshot().settings.speechRecognitionOverlay.design.style.outline.enabled'),id==='outlined');
    }
  }
  await tab('adjust');
  return count + 6;
}
