import assert from 'node:assert/strict';

export async function verifyCommentSourceSave({ evaluate, resize, capture }) {
  const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 100))');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const initial = await evaluate('boardManagementHarness.snapshot()');
  let checks = 0;
  for (const width of [320, 760]) for (const success of [true, false]) {
    await resize(width, 760);
    await evaluate(`(() => { const initial = ${JSON.stringify(initial)}; initial.settingsRevision = boardManagementHarness.snapshot().settingsRevision + 1; boardManagementHarness.updateSnapshot(initial); })()`);
    await click('.management-nav [data-page="settings"]');
    await click('#settings-sources');
    const start = await evaluate('boardManagementHarness.trace().length');
    await evaluate(`(() => { boardManagementHarness.holdNextSave(); const input = document.getElementById('source-youtube');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '@local_edit');
      input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await evaluate('new Promise(resolve => setTimeout(resolve, 600))');
    await click('.acquisition-source:nth-child(2) button[role="switch"]');
    assert.equal(await evaluate("document.getElementById('source-youtube').readOnly"), true);
    assert.equal(await evaluate(`boardManagementHarness.trace().slice(${start}).filter(t => t.kind === 'source').length`), 0);
    const positions = () => evaluate(`['source-youtube','source-twitch','source-shitaraba'].map(id => {const r=document.getElementById(id).getBoundingClientRect();return [r.x,r.y,r.width,r.height];})`);
    const busyPositions = await positions();
    await evaluate(`(() => { const snapshot = boardManagementHarness.snapshot(); snapshot.settingsRevision++;
      snapshot.settings.sources.shitaraba.threadUrl = 'https://bbs.jpnkn.com/test/read.cgi/board/123/';
      if (${success}) snapshot.settings.sources.youtube.target = '@local_edit';
      boardManagementHarness.updateSnapshot(snapshot);
      ${success ? '' : "boardManagementHarness.failNextSave('一時的な保存失敗');"}
      boardManagementHarness.releaseSave(); })()`);
    await evaluate('new Promise(resolve => setTimeout(resolve, 800))');
    const trace = await evaluate(`boardManagementHarness.trace().slice(${start})`);
    const saves = trace.filter(t => t.kind === 'save' && t.section === 'sources');
    assert.equal(saves.length, success ? 2 : 3, `width=${width}, success=${success}: no stale replay`);
    assert.equal(saves.at(-1).value.shitaraba.threadUrl, 'https://bbs.jpnkn.com/test/read.cgi/board/123/');
    assert.equal(saves.at(-1).value.youtube.target, '@local_edit');
    assert.equal(saves.at(-1).value.twitch.enabled, true);
    assert.deepEqual(trace.filter(t => t.kind === 'source').map(t => [t.source,t.action]), [['twitch','start']]);
    assert.equal(await evaluate("document.getElementById('source-youtube').value"), '@local_edit');
    assert.equal(await evaluate("document.getElementById('source-shitaraba').value"), 'https://bbs.jpnkn.com/test/read.cgi/board/123/');
    assert.deepEqual(await positions(), busyPositions, 'save, status and toast keep input positions');
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    if (capture) await capture(`source-save-${width}-${success}.png`);
    await click('.editor-heading-row .back-button');
    assert.equal(await evaluate('document.activeElement.id'), 'settings-sources');
    await click('#settings-sources');
    assert.equal(await evaluate("document.getElementById('source-youtube').value"), '@local_edit');
    checks += 12;
  }
  for (const width of [1000, 560, 320]) for (const size of ['medium', 'large']) for (const theme of ['ocean', 'pearl']) {
    await resize(width, 900);
    await evaluate(`(() => { const value=boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({settings:{...value.settings,
      application:{...value.settings.application,managementTextSize:${JSON.stringify(size)},managementTheme:${JSON.stringify(theme)}}}}); })()`);
    await click('.management-nav [data-page="settings"]'); await click('#settings-sources');
    const inspect = () => evaluate(`(() => {
      const body=document.querySelector('.management-body'),list=document.querySelector('.acquisition-list'),auto=document.querySelector('.acquisition-auto');
      const rect=element=>{const r=element.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
      const buttons=[...document.querySelectorAll('.acquisition-actions button')];
      return { boxes:buttons.map(rect),auto:rect(auto),height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement.getAttribute('aria-label'),
        fits:buttons.every(button=>{const text=document.createRange();text.selectNodeContents(button);const r=text.getBoundingClientRect(),b=button.getBoundingClientRect();
          return r.height<=parseFloat(getComputedStyle(button).lineHeight)+1 && r.left>=b.left && r.right<=b.right;}),
        footer:list.lastElementChild===auto && parseFloat(getComputedStyle(auto).borderTopWidth)>0,
        autoFits:[auto.querySelector('h3'),auto.querySelector('p')].every(el=>el.scrollWidth<=el.clientWidth+1),
        overflow:body.scrollWidth>body.clientWidth };
    })()`);
    await evaluate("document.querySelector('.acquisition-start-all').focus({preventScroll:true})");
    const normal=await inspect();
    assert.equal(normal.fits && normal.footer && normal.autoFits && !normal.overflow,true,`${width}/${size}/${theme}: buttons and grouped auto-connect fit ${JSON.stringify(normal)}`);
    for (const button of ['.acquisition-start-all', '.acquisition-stop-all']) {
      await evaluate(`document.querySelector(${JSON.stringify(button)}).focus({preventScroll:true})`);
      const before=await inspect();
      await evaluate('boardManagementHarness.holdNextMutation()');
      await click(button);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(button)}).getAttribute('aria-disabled')`),'true');
      const pending=await inspect();
      assert.deepEqual({boxes:pending.boxes,auto:pending.auto,height:pending.height,scroll:pending.scroll,focus:pending.focus},
        {boxes:before.boxes,auto:before.auto,height:before.height,scroll:before.scroll,focus:before.focus},`${width}/${size}/${theme}: busy button geometry`);
      assert.equal(pending.fits,true,'busy label stays on one line');
      await evaluate('boardManagementHarness.releaseMutation()'); await settle();
    }
    if(width===1000 && size==='medium' && theme==='ocean' && capture) await capture('source-controls-grouped.png');
  }
  return checks;
}
