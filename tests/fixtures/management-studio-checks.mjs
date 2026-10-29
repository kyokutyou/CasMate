import assert from 'node:assert/strict';

async function verifySettingsCategories(evaluate, width) {
  const cards = await evaluate(`(() => [...document.querySelectorAll('.management-categories .management-category')].map(card => {
    const box = card.getBoundingClientRect();
    return { name: card.querySelector('h2').textContent, count: card.querySelectorAll('.management-entry').length,
      x: box.x, y: box.y, height: box.height };
  }))()`);
  assert.deepEqual(cards.map(card => [card.name, card.count]), [
    ['コメント', 3], ['音声・AI', 3], ['表示・演出', 3], ['OBS', 4], ['スマホ連携', 1], ['アプリ', 1],
  ], `${width}: six settings categories`);
  assert.ok(Math.max(cards[4].height, cards[5].height) < Math.min(...cards.slice(0, 4).map(card => card.height)) * .75,
    `${width}: single-entry cards remain compact`);
  if (width > 600) {
    for (const index of [0, 2, 4]) {
      assert.equal(cards[index].y, cards[index + 1].y, `${width}: paired category tops`);
      assert.equal(cards[index].height, cards[index + 1].height, `${width}: paired category heights`);
      assert.ok(cards[index].x < cards[index + 1].x, `${width}: category reading order`);
    }
  } else {
    for (let index = 1; index < cards.length; index++) {
      assert.equal(cards[index].x, cards[0].x, `${width}: one category column`);
      assert.ok(cards[index].y > cards[index - 1].y, `${width}: category reading order`);
    }
  }
}

// Measure rendered foregrounds against the actual ancestor surfaces, including help text.
// Feature-owned OBS/comment previews and disabled controls have separate appearance contracts.
function contrastFailures() {
  const rgba = value => {
    const channels = value.match(/[\d.]+/g).map(Number);
    // color-mix(in srgb, ...) serializes as color(srgb ...), with 0..1 RGB channels.
    return value.startsWith('color(srgb ') ? channels.map((channel, index) => index < 3 ? channel * 255 : channel) : channels;
  };
  const luminance = color => color.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const failures = [];
  for (const node of document.querySelectorAll('.management-shell *')) {
    if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || node.closest('.obs-urls-preview,.overlay-preview,.list-preview,.effect-preview,.effect-test-stage,.effects-glyph,.studio-comment-stream') || node.matches(':disabled,option')) continue;
    const text = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim() || (node.matches('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file]):not([type=range]),textarea,select') ? node.value : '');
    if (!text) continue;
    const layers = []; let opaque = false; let disabled = false;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (Number(style.opacity) < 1) { disabled = true; break; }
      const color = rgba(style.backgroundColor);
      layers.push(color);
      if ((color[3] ?? 1) === 1) { opaque = true; break; }
    }
    if (disabled || !opaque) continue;
    let background = layers.pop();
    for (const color of layers.reverse()) { const alpha = color[3] ?? 1; background = color.slice(0,3).map((value,index) => value * alpha + background[index] * (1-alpha)); }
    const foreground = rgba(getComputedStyle(node).color);
    const a = luminance(foreground), b = luminance(background);
    const ratio = (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    if (ratio < 4.5) failures.push({ selector: node.className || node.tagName, text: text.slice(0,60), ratio: Math.round(ratio*100)/100, foreground, background });
  }
  return failures;
}

async function verifyManagementThemes({ evaluate, resize, capture, pressRight }, settle, click) {
  const failures = [];
  for (const theme of ['graphite', 'midnight', 'ocean', 'burgundy', 'pearl', 'ivory', 'sakura', 'lavender']) {
    await resize(760, 760);
    await click('.management-nav [data-page="settings"]'); await click('#settings-application');
    await click(`.app-theme-choice input[value="${theme}"]`);
    assert.equal(await evaluate('document.querySelector(".management-shell").dataset.managementTheme'), theme);
    assert.equal(await evaluate('boardManagementHarness.snapshot().settings.application.managementTheme'), theme);
    const scan = async location => { const found = await evaluate(`(${contrastFailures.toString()})()`); if (found.length) failures.push({ theme, location, found }); };
    await scan('application');
    if (capture) await capture(`theme-${theme}-760.png`);
    await click('.editor-heading-row .back-button');
    const entries = await evaluate("[...document.querySelectorAll('.management-categories .management-entry')].map(entry => entry.id)");
    for (const id of entries) {
      await click(`#${id}`); await scan(id);
      if (id === 'settings-character') {
        const appearance = await evaluate(`(() => {
          const input = [...document.querySelectorAll('.management-shell .check input[type=checkbox]')].find(node=>node.checkVisibility());
          const original = input.checked;
          const sample = checked => { input.checked=checked; const rail=getComputedStyle(input).backgroundColor; const thumb=getComputedStyle(input,'::after').backgroundColor; return {rail,thumb}; };
          const off=sample(false), on=sample(true); input.checked=original; return {off,on};
        })()`);
        assert.notEqual(appearance.off.rail, appearance.on.rail, `${theme}: ON/OFF rail colors`);
        assert.notEqual(appearance.off.thumb, appearance.on.thumb, `${theme}: ON/OFF thumb colors`);
        const on = appearance.on.thumb.match(/[\d.]+/g).map(Number);
        assert.ok(on[1] > on[0] && on[1] > on[2], `${theme}: enabled thumb remains green`);
        assert.notEqual(appearance.on.rail, appearance.on.thumb, `${theme}: visible enabled thumb`);
      }
      await click('.editor-heading-row .back-button');
    }
    for (const page of ['home', 'live', 'settings']) { await click(`.management-nav [data-page="${page}"]`); await scan(page); }
    await click('#management-warning-entry'); await scan('warnings'); await click('.management-warning-heading button');
    await click('.management-nav [data-page="home"]'); await click('.pc-status-button'); await scan('pc-dialog'); await click('.pc-dialog-heading button');
    await click('.management-nav [data-page="settings"]'); await click('#settings-urls');
    await scan('obs-source-selection');
    await click('.editor-heading-row .back-button');
    await click('#settings-application'); await resize(320, 760); await settle();
    const metrics = await evaluate(`(() => { const panel = document.querySelector('.application-settings-panel'); return { overflow: document.documentElement.scrollWidth > innerWidth || panel.scrollWidth > panel.clientWidth, radios: [...panel.querySelectorAll('input[type=radio]')].filter(node => node.checkVisibility()).length }; })()`);
    assert.equal(metrics.overflow, false, `${theme}: narrow application settings`); assert.equal(metrics.radios, 11);
    if (capture && ['ocean','pearl'].includes(theme)) await capture(`theme-${theme}-320.png`);
  }
  const positions = () => evaluate(`(() => { const panel = document.querySelector('.application-settings-panel'); return [...panel.querySelectorAll('section,input')].map(node=>{const box=node.getBoundingClientRect();return {x:box.x,y:box.y,w:box.width,h:box.height};}); })()`);
  const before = await positions();
  await evaluate('boardManagementHarness.failNextSave("設定ファイルを保存できません。保存先を確認して再保存してください。")');
  await click('.app-theme-choice input[value="ocean"]');
  assert.equal(await evaluate('document.querySelector(".management-shell").dataset.managementTheme'), 'ocean');
  assert.equal(await evaluate('boardManagementHarness.snapshot().settings.application.managementTheme'), 'lavender', 'failed save preserves backend settings');
  assert.deepEqual(await positions(), before, 'error and retry leave all section/input positions unchanged');
  const errors = await evaluate(`(${contrastFailures.toString()})()`); if (errors.length) failures.push({ theme:'ocean',location:'save-error',found:errors });
  await click('.app-settings-feedback button');
  assert.equal(await evaluate('boardManagementHarness.snapshot().settings.application.managementTheme'), 'ocean');
  assert.deepEqual(await positions(), before, 'toast and completed save leave operation positions unchanged');
  assert.equal(failures.length, 0, `theme contrast failures: ${JSON.stringify(failures)}`);

  await evaluate('document.querySelector(".app-theme-choice input[value=ocean]").scrollIntoView({block:"center"}); document.querySelector(".app-theme-choice input[value=ocean]").focus({preventScroll:true}); boardManagementHarness.holdNextSave()');
  const keyboardPositions = await positions();
  const saves = await evaluate('boardManagementHarness.trace().filter(item => item.kind === "save").length');
  await pressRight(); await settle();
  assert.equal(await evaluate('document.activeElement.value'), 'burgundy', 'selected radio retains focus during save');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-disabled")'), 'true');
  assert.equal(await evaluate('document.querySelector(".app-theme-choice input:checked").value'), 'burgundy');
  await pressRight(); await settle();
  await click('.app-theme-choice input[value=pearl]');
  assert.equal(await evaluate('document.activeElement.value'), 'burgundy', 'repeat arrow stays blocked during save');
  assert.equal(await evaluate('document.querySelector(".app-theme-choice input:checked").value'), 'burgundy', 'busy radio rejects click');
  assert.equal(await evaluate('boardManagementHarness.trace().filter(item => item.kind === "save").length'), saves + 1);
  await evaluate('boardManagementHarness.releaseSave()'); await settle();
  assert.equal(await evaluate('document.activeElement.value'), 'burgundy', 'completion keeps keyboard focus');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-disabled")'), 'false');
  assert.deepEqual(await positions(), keyboardPositions, 'pending and completed save keep operation positions');
  await pressRight(); await settle();
  assert.equal(await evaluate('document.activeElement.value'), 'pearl', 'next arrow continues native radio navigation');
  assert.equal(await evaluate('boardManagementHarness.snapshot().settings.application.managementTheme'), 'pearl');
  await click('.app-theme-choice input[value=ocean]');
  return 1;
}

async function verifyManagementTextSizes({ evaluate, resize, capture, pressRight }, settle, click) {
  let count=0;
  const clippedGuidance = new Map();
  for (const [size,body,secondary,heading] of [['small',14,12,17],['medium',16,14,19],['large',18,16,21]]) {
    await resize(760,760); await click('.management-nav [data-page="settings"]'); await click('#settings-application');
    await click(`.app-text-size-choice input[value="${size}"]`);
    assert.equal(await evaluate('boardManagementHarness.snapshot().settings.application.managementTextSize'),size);
    for (const [width,height] of [[1200,820],[760,560],[560,760],[480,760],[420,760],[320,760]]) {
      await resize(width,height); await settle();
      for (const page of ['home','live','settings']) {
        await click(`.management-nav [data-page="${page}"]`);
        const result=await evaluate(`(() => {
          const shell=document.querySelector('.management-shell'), main=document.querySelector('.management-body');
          const font=node=>parseFloat(getComputedStyle(node).fontSize);
          const brand=document.querySelector('.management-brand').getBoundingClientRect();
          const header=document.querySelector('.management-header').getBoundingClientRect();
          const row=parseFloat(getComputedStyle(shell).getPropertyValue('--management-header-height'));
          return {overflow:document.documentElement.scrollWidth>innerWidth||main.scrollWidth>main.clientWidth,
            body:font(document.querySelector('.management-nav [data-page]')), title:font(document.getElementById('page-heading')),
            secondary:font(document.querySelector('.management-warning-count')),
            centered:Math.abs(brand.top+brand.height/2-header.top-row/2)<1,
            comments:document.querySelector('.studio-comment-stream .comment')?.style.fontSize};
        })()`);
        assert.equal(result.overflow,false,`${size}/${width}/${page}: overflow`);
        assert.equal(result.body,body); assert.equal(result.secondary,secondary); assert.equal(result.title,heading);
        assert.equal(result.centered,true,`${size}/${width}/${page}: brand centered`);
        if(page==='settings') {
          await verifySettingsCategories(evaluate, width);
          if(capture && width===1200) await capture(`settings-categories-${size}-1200.png`);
        }
        if (result.comments) assert.equal(result.comments,await evaluate('boardManagementHarness.snapshot().settings.commentList.fontSizePx+"px"'),'comment font is feature-owned');
        if(capture&&page==='home'&&width===1200)await capture(`readability-ocean-${size}-1200.png`);
        if(page==='home'){
          await click('.pc-status-button');
          assert.equal(await evaluate("parseFloat(getComputedStyle(document.querySelector('.pc-dialog-body h3')).fontSize)"),heading,'PC dialog section font scales');
          await click('.pc-dialog-heading button');
        }
        count++;
      }
      const entries=await evaluate("[...document.querySelectorAll('.management-categories .management-entry')].map(entry=>entry.id)");
      for(const id of entries){
        await click(`#${id}`);
        assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth||document.querySelector('.management-body').scrollWidth>document.querySelector('.management-body').clientWidth"),false,`${size}/${width}/${id}: overflow`);
        const clipped = await evaluate(`(() => [...document.querySelectorAll('.acquisition-message,.filter-save-state,.filter-sample-help,.overlay-input-help,.list-input-help,.next-input-help,.next-state-message,.oc-help,.oc-operation-text,.recognition-field-help,.recognition-apply-state,.recognition-preview-help,.effects-save-state,.effects-field-hint,.obs-urls-field-hint,.ai-service-status,.ai-visual-status,.sp-status,.sp-device-status')]
          .filter(node=>node.checkVisibility() && node.scrollHeight>node.clientHeight+1)
          .map(node=>({className:node.className,text:node.textContent,client:node.clientHeight,scroll:node.scrollHeight})))()`);
        for (const item of clipped) clippedGuidance.set(item.className,{size,width,id,...item});
        if(capture && size==='large' && width===320 && ['settings-sources','settings-commentFilter','settings-commentOverlay','settings-obsControl','settings-speechRecognition','settings-smartphone'].includes(id)) await capture(`guidance-${id}-320-large.png`);
        if(id==='settings-urls' && width===1200){
          assert.equal(await evaluate("document.querySelectorAll('.obs-urls-row').length"),4,'all source cards are present');
          assert.equal(await evaluate("document.querySelectorAll('.obs-urls-preview,.obs-urls-choices').length"),0,'card layout has no previews or selector');
        }
        await click('.editor-heading-row .back-button'); count++;
      }
    }
  }
  assert.deepEqual([...clippedGuidance.values()], [], 'ordinary guidance must fit without small scrollbars');
  await click('#settings-application');
  await evaluate('boardManagementHarness.failNextSave("文字サイズを保存できません。")');
  await click('.app-text-size-choice input[value="small"]');
  assert.equal(await evaluate('boardManagementHarness.snapshot().settings.application.managementTextSize'),'large');
  const positions=()=>evaluate("[...document.querySelectorAll('.application-settings-panel section,input')].map(node=>{const box=node.getBoundingClientRect();return {x:box.x,y:box.y,w:box.width,h:box.height}})");
  const failed=await positions();
  await click('button[aria-label="文字サイズを再保存"]');
  assert.deepEqual(await positions(),failed,'size retry and notification do not move controls');
  await evaluate('document.querySelector(".app-text-size-choice input[value=small]").scrollIntoView({block:"center"});document.querySelector(".app-text-size-choice input[value=small]").focus({preventScroll:true});boardManagementHarness.holdNextSave()');
  await pressRight(); await settle();
  assert.equal(await evaluate('document.activeElement.value'),'medium');
  const saves=await evaluate('boardManagementHarness.trace().filter(item=>item.kind==="save").length');
  await pressRight(); await settle(); await click('.app-theme-choice input[value=pearl]');
  assert.equal(await evaluate('document.querySelector(".app-text-size-choice input:checked").value'),'medium');
  assert.equal(await evaluate('boardManagementHarness.trace().filter(item=>item.kind==="save").length'),saves);
  await evaluate('boardManagementHarness.releaseSave()'); await settle();
  assert.equal(await evaluate('document.activeElement.value'),'medium');
  assert.equal(await evaluate('boardManagementHarness.snapshot().settings.application.managementTextSize'),'medium');
  return count+1;
}

export async function verifyManagementStudio({ evaluate, resize, capture, pressRight }) {
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.management-nav [data-page]')].map(node => node.dataset.page)"), ['home', 'live', 'settings'], 'only the three supported pages remain');
  assert.equal(await evaluate("document.querySelector('.management-prepare')"), null, 'preparation page is removed');
  const settle = () => evaluate('new Promise(resolve => { const timer = setTimeout(resolve, 80); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); })); })');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const visible = () => evaluate(`(() => {
    const body = document.querySelector('.management-body');
    const targets = [...document.querySelectorAll('.management-header,.management-nav,.management-body')];
    return { overflow: document.documentElement.scrollWidth > innerWidth || body.scrollWidth > body.clientWidth,
      navBottom: targets[1].getBoundingClientRect().bottom, bodyTop: body.getBoundingClientRect().top,
      visible: [...document.querySelectorAll('.management-nav>button')].every(node => { const box = node.getBoundingClientRect(); return box.x >= 0 && box.right <= innerWidth && box.height > 0; }) };
  })()`);
  const initialTrace = await evaluate('boardManagementHarness.trace().length');
  let count = 0;
  for (const [width, height] of [[1200, 820], [760, 560], [560, 760], [480, 760], [420, 760], [320, 760]]) {
    await resize(width, height); await settle();
    for (const page of ['home', 'live', 'settings']) {
      await click(`.management-nav [data-page="${page}"]`);
      const metrics = await visible();
      assert.equal(metrics.overflow, false, `${width}/${page}: overflow`);
      assert.equal(metrics.visible, true, `${width}/${page}: navigation bounds`);
      assert.ok(metrics.navBottom <= metrics.bodyTop + .01, `${width}/${page}: nav overlap ${JSON.stringify(metrics)}`);
      assert.equal(await evaluate('document.activeElement.id'), 'page-heading');
      assert.equal(await evaluate("document.getElementById('page-heading').textContent"), { home: '配信のホーム', live: 'コメントと、いつもの操作', settings: '設定' }[page]);
      if (page === 'settings') await verifySettingsCategories(evaluate, width);
      if (capture && [1200, 320].includes(width)) await capture(`studio-${page}-${width}.png`);
      count++;
    }
    const entries = await evaluate("[...document.querySelectorAll('.management-categories .management-entry')].map(entry => entry.id)");
    assert.equal(entries.length, 15);
    for (const id of entries) {
      await click(`#${id}`);
      assert.equal(await evaluate('document.activeElement.id'), 'editor-heading', `${width}/${id}: heading focus`);
      assert.equal((await visible()).overflow, false, `${width}/${id}: editor overflow`);
      const controls = await evaluate(`(() => {
        const panel = [...document.querySelectorAll('.settings-card')].find(node => !node.hidden);
        return panel ? [...panel.querySelectorAll('input,select,textarea,button,summary')].filter(node => node.checkVisibility()).length : 0;
      })()`);
      assert.ok(controls > 0, `${width}/${id}: editing controls`);
      await click('.editor-heading-row .back-button');
      assert.equal(await evaluate('document.activeElement.id'), id, `${width}/${id}: return focus`);
      count++;
    }
  }
  assert.equal(await evaluate('boardManagementHarness.trace().length'), initialTrace, 'navigation has no operation side effects');
  await resize(560, 760);
  await click('.management-nav [data-page="home"]');
  await click('#home-source-youtube');
  assert.equal(await evaluate('document.activeElement.id'), 'source-youtube');
  await click('.editor-heading-row .back-button');
  assert.equal(await evaluate('document.activeElement.id'), 'home-source-youtube'); count++;
  await click('.management-nav [data-page="live"]');
  assert.ok(await evaluate("document.querySelector('.studio-comment-stream').textContent.includes('確認用コメント')"));
  await click('.studio-comment-feed [aria-pressed]');
  assert.equal(await evaluate("document.querySelector('.studio-comment-feed [aria-pressed]').getAttribute('aria-pressed')"), 'false');
  await click('#live-list-settings'); await click('.editor-heading-row .back-button');
  assert.equal(await evaluate('document.activeElement.id'), 'live-list-settings');
  assert.equal(await evaluate("document.querySelector('.studio-comment-feed [aria-pressed]').getAttribute('aria-pressed')"), 'false'); count++;
  await evaluate(`(() => { const snapshot = boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({settings: {...snapshot.settings, commentList: {...snapshot.settings.commentList, stackDirection: 'newestTop'}}}); })()`);
  await evaluate("(() => { const stream = document.querySelector('.studio-comment-stream'); stream.scrollTop = 250; stream.dispatchEvent(new Event('scroll', {bubbles:true})); })()"); await settle();
  assert.equal(await evaluate("document.querySelector('.studio-comment-feed [aria-pressed]').getAttribute('aria-pressed')"), 'false', 'reading back stops follow');
  const reading = await evaluate(`(() => {
    const stream = document.querySelector('.studio-comment-stream'); const top = stream.getBoundingClientRect().top;
    const row = [...stream.children].find(node => node.getBoundingClientRect().bottom > top);
    return {id: row.dataset.commentId, offset: row.getBoundingClientRect().top - top};
  })()`);
  const appendComment = () => evaluate(`(() => { const snapshot = boardManagementHarness.snapshot(); const last = snapshot.comments.at(-1); boardManagementHarness.updateSnapshot({comments: [...snapshot.comments, {...last, id: last.id + '-new', sequence: last.sequence + 1}]}); })()`);
  const readingOffset = () => evaluate(`(() => { const stream = document.querySelector('.studio-comment-stream'); const row = [...stream.children].find(node => node.dataset.commentId === ${JSON.stringify(reading.id)}); return row.getBoundingClientRect().top - stream.getBoundingClientRect().top; })()`);
  await appendComment(); await settle();
  const updatedOffset = await readingOffset();
  assert.ok(Math.abs(updatedOffset - reading.offset) < 1, `newestTop readback stays anchored when a comment arrives: ${JSON.stringify(reading)} -> ${updatedOffset}`);
  assert.equal(await evaluate("document.querySelector('.studio-comment-feed [aria-pressed]').getAttribute('aria-pressed')"), 'false'); count++;
  await click('.management-nav [data-page="home"]'); await appendComment();
  await click('.management-nav [data-page="live"]');
  assert.ok(Math.abs(await readingOffset() - reading.offset) < 1, 'readback anchor survives comments received on another page'); count++;
  await click('.studio-comment-feed [aria-pressed]');
  const pausedAtTop = await evaluate("document.querySelector('.studio-comment-stream').firstElementChild.dataset.commentId");
  await click('.studio-comment-feed [aria-pressed]');
  const pausedOffset = () => evaluate(`(() => { const stream = document.querySelector('.studio-comment-stream'); const row = [...stream.children].find(node => node.dataset.commentId === ${JSON.stringify(pausedAtTop)}); return row.getBoundingClientRect().top - stream.getBoundingClientRect().top; })()`);
  const initialPausedOffset = await pausedOffset();
  await appendComment(); await settle();
  assert.ok(Math.abs(await pausedOffset() - initialPausedOffset) < 1, 'explicitly pausing at newestTop keeps the same comment on arrival'); count++;
  await click('.management-nav [data-page="home"]'); await appendComment(); await click('.management-nav [data-page="live"]');
  assert.ok(Math.abs(await pausedOffset() - initialPausedOffset) < 1, 'explicitly pausing at newestTop keeps the same comment after navigation');
  assert.equal(await evaluate("document.querySelector('.studio-comment-feed [aria-pressed]').getAttribute('aria-pressed')"), 'false'); count++;
  await click('#live-speechRecognition');
  const input = await evaluate("[...document.querySelectorAll('.speech-recognition-panel input[type=number]')].find(node => node.checkVisibility())?.id");
  if (input) {
    await evaluate(`(() => { const node = document.getElementById(${JSON.stringify(input)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'123'); node.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await click('.editor-heading-row .back-button'); await click('#live-speechRecognition');
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(input)}).value`), '123');
  }
  assert.equal(await evaluate('boardManagementHarness.trace().length'), initialTrace, 'draft navigation has no operation side effects');
  count += await verifyManagementThemes({ evaluate, resize, capture, pressRight }, settle, click);
  count += await verifyManagementTextSizes({ evaluate, resize, capture, pressRight }, settle, click);
  await click('.management-nav [data-page="live"]');
  const historyMilliseconds = await evaluate(`(() => {
    const snapshot = boardManagementHarness.snapshot(); const template = snapshot.comments.at(-1); const started = performance.now();
    boardManagementHarness.updateSnapshot({comments: Array.from({length:10000},(_,index) => ({...template,id:'history-'+index,externalId:'history-'+index,sequence:index}))});
    return performance.now()-started;
  })()`);
  assert.equal(await evaluate("document.querySelector('.studio-comment-stream').childElementCount"), 10000, 'full history remains readable');
  assert.ok(historyMilliseconds < 8000, `10,000 comments render within the fixture budget (${Math.round(historyMilliseconds)}ms)`); count++;
  await evaluate("(() => { const stream = document.querySelector('.studio-comment-stream'); stream.scrollTop = stream.scrollHeight / 2; stream.dispatchEvent(new Event('scroll',{bubbles:true})); })()"); await settle();
  const historyAnchor = await evaluate(`(() => { const stream = document.querySelector('.studio-comment-stream'); const top = stream.getBoundingClientRect().top;
    const row = [...stream.children].find(node => node.getBoundingClientRect().bottom > top); return {id:row.dataset.commentId,offset:row.getBoundingClientRect().top-top}; })()`);
  await evaluate(`(() => { const snapshot = boardManagementHarness.snapshot(); const last = snapshot.comments.at(-1);
    boardManagementHarness.updateSnapshot({comments:[...snapshot.comments.slice(1),{...last,id:'history-new',sequence:last.sequence+1}]}); })()`); await settle();
  const retainedOffset = await evaluate(`(() => { const stream = document.querySelector('.studio-comment-stream'); const row = [...stream.children].find(node => node.dataset.commentId === ${JSON.stringify(historyAnchor.id)}); return row.getBoundingClientRect().top-stream.getBoundingClientRect().top; })()`);
  assert.equal(await evaluate("document.querySelector('.studio-comment-stream').childElementCount"), 10000);
  assert.ok(Math.abs(retainedOffset-historyAnchor.offset)<1, 'history limit eviction and a new comment keep the reading anchor'); count++;
  return count;
}
