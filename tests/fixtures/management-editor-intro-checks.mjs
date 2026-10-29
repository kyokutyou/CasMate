import assert from 'node:assert/strict';

export async function verifyManagementEditorIntros({ evaluate, resize, capture, setZoom, resizeMinimum, pressKey }) {
  const initial = await evaluate('boardManagementHarness.snapshot()');
  const initialTrace = await evaluate('boardManagementHarness.trace().length');
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,20))');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  await click('[data-page="settings"]');
  const entries = await evaluate("[...document.querySelectorAll('.management-categories .management-entry')].map(node=>node.id)");
  const expectedEntries = await evaluate("JSON.parse(document.getElementById('fixture-editor-ids').textContent)");
  assert.deepEqual([...entries].sort(), [...expectedEntries].sort(), 'every current management editor has an entry');
  let count = 0;
  const check = async label => {
    const result = await evaluate(`(() => {
      const box=document.querySelector('.editor-introduction'),p=box.querySelector('p'),body=document.querySelector('.management-body');
      const rect=box.getBoundingClientRect(),text=p.getBoundingClientRect();
      return {paragraphs:box.querySelectorAll('p').length,strong:box.querySelectorAll('strong').length,
        short:p.textContent.length>0&&p.textContent.length<=48,
        fits:Math.ceil(text.width)>=p.scrollWidth&&text.left>=rect.left&&text.right<=rect.right,
        overflow:document.documentElement.scrollWidth>innerWidth||body.scrollWidth>body.clientWidth,
        back:document.querySelector('.editor-heading-row .back-button').textContent};
    })()`);
    if (result.overflow) {
      if (capture) await capture('intro-overflow.png');
      const outside=await evaluate(`[...document.querySelectorAll('.management-body *')].filter(node=>node.checkVisibility()&&node.getBoundingClientRect().right>innerWidth).map(node=>({tag:node.tagName,class:node.className,text:node.textContent.slice(0,70),right:node.getBoundingClientRect().right})).slice(0,12)`);
      assert.fail(label+' horizontal overflow: '+JSON.stringify(outside));
    }
    assert.deepEqual(result,{paragraphs:1,strong:0,short:true,fits:true,overflow:false,back:'←'},label);
    count++;
  };
  for (const theme of ['ocean','pearl']) for (const size of ['small','medium','large']) {
    await evaluate(`(() => { const snapshot=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...snapshot.settings,application:{...snapshot.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:${JSON.stringify(size)}}}}); })()`);
    for (const [width,height] of [[1200,820],[760,560],[560,760],[480,760],[420,760],[320,760]]) {
      await resize(width,height);
      for (const entry of entries) {
        await click('#'+entry); await check(`${theme}/${size}/${width}/${entry}`);
        if (capture && theme==='ocean' && size==='medium' && [760,320].includes(width) && ['settings-sources','settings-speechRecognition','settings-commentFilter','settings-character'].includes(entry)) await capture(`intro-${entry}-${width}.png`);
        await click('.editor-heading-row .back-button');
        assert.equal(await evaluate('document.activeElement.id'),entry,'return focus');
      }
    }
  }
  if (setZoom) await setZoom(1.5);
  if (resizeMinimum) await resizeMinimum(); else await resize(203,215);
  for (const entry of entries) {
    await click('#'+entry); await check('minimum/zoom/'+entry);
    await pressKey('Tab');
    assert.equal(await evaluate('Boolean(document.activeElement)&&!document.activeElement.closest("[hidden]")'),true,'keyboard focus stays in visible content');
    await click('.editor-heading-row .back-button');
  }
  assert.equal(await evaluate('boardManagementHarness.trace().length'),initialTrace,'editor navigation has no operation side effects');
  if (setZoom) await setZoom(1);
  await evaluate(`boardManagementHarness.updateSnapshot(${JSON.stringify(initial)})`);
  return count;
}
