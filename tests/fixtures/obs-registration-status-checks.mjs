import assert from 'node:assert/strict';

export async function verifyObsRegistrationStatus({ evaluate, resize, capture }) {
  const ready = async condition => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await evaluate(condition)) return;
      await evaluate('new Promise(resolve => setTimeout(resolve, 70))');
    }
    throw new Error('OBS registration did not reach ' + condition);
  };
  const measure = `(() => {
    const dialog = document.getElementById('obs-source-registration-dialog');
    const body = dialog.querySelector('.obs-registration-body');
    return { boxes: [...dialog.querySelectorAll('.obs-registration-source-value,.obs-registration-status,[data-action=register]')].map(node => {
      const r = node.getBoundingClientRect(); return [r.x,r.y,r.width,r.height];
    }), scroll: body.scrollTop, height: body.scrollHeight, overflow: body.scrollWidth > body.clientWidth };
  })()`;
  await evaluate("document.querySelector('.management-nav [data-page=settings]').click(); document.getElementById('settings-urls').click()");
  for (const [width, height] of [[320, 760], [560, 760], [760, 560]]) {
    await resize(width, height);
    assert.equal(await evaluate("document.querySelector('.obs-registration-recovery-slot:not([hidden])')===null"), true, 'no empty recovery region');
    await evaluate(`obsRegistrationHarness.update({removedFromScene:false,contextRevision:${width},registration:{busy:false,lastOperation:null,unfinishedOperations:[]}}); document.getElementById('obs-registration-entry-comments').click()`);
    await ready("document.querySelector('[data-action=register]')?.getAttribute('aria-disabled') === 'false'");
    await evaluate("document.querySelector('[data-action=register]').click()");
    await ready('obsRegistrationHarness.pending()');
    await evaluate("obsRegistrationHarness.complete('succeeded')");
    await ready("document.querySelector('.obs-registration-status').textContent.includes('登録設定を確認済み')");
    await evaluate("document.querySelector('#obs-source-registration-dialog [aria-label=閉じる]').click(); document.getElementById('obs-registration-entry-comments').click()");
    await ready("document.querySelector('.obs-registration-status').textContent.includes('このシーンに追加済み')");
    assert.equal(await evaluate("document.querySelector('[data-action=register]').textContent"), '登録を再確認');
    assert.equal(await evaluate("document.querySelector('.obs-registration-status').textContent.includes('登録設定を確認済み')"), false);
    const additions = await evaluate('obsRegistrationHarness.additions()');
    const before = await evaluate(measure);
    assert.equal(before.overflow, false);
    if (capture) await capture(`obs-registered-${width}.png`);
    await evaluate(`obsRegistrationHarness.update({removedFromScene:true,contextRevision:${width + 1}})`);
    await ready("document.querySelector('.obs-registration-status').textContent.includes('既存ソースをこのシーンに追加できます')");
    assert.equal(await evaluate("document.querySelector('[data-action=register]').textContent"), 'OBSに追加');
    assert.deepEqual(await evaluate(measure), before, `${width}: membership update preserves layout and scroll`);
    assert.equal(await evaluate('obsRegistrationHarness.additions()'), additions, 'read-only refresh never registers');
    await evaluate(`document.querySelector('.obs-registration-manual summary').click();
      window.dialogCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(url){window.dialogCopies.push(url);return new Promise((resolve,reject)=>{window.finishDialogCopy=resolve;window.failDialogCopy=()=>reject(new Error('clipboard unavailable'));});}}});
      document.querySelector('.obs-registration-copy').focus();`);
    const beforeCopy = await evaluate(measure);
    for (const finish of ['finishDialogCopy', 'failDialogCopy']) {
      await evaluate("document.querySelector('.obs-registration-copy').click(); document.querySelector('.obs-registration-copy').click()");
      assert.equal(await evaluate("document.querySelector('.obs-registration-copy').getAttribute('aria-busy')"), 'true');
      assert.deepEqual(await evaluate(measure), beforeCopy, `${width}: pending URL copy preserves layout`);
      await evaluate(`window.${finish}()`);
      await ready("document.querySelector('.obs-registration-copy').getAttribute('aria-busy')==='false'");
      assert.deepEqual(await evaluate(measure), beforeCopy, `${width}: URL copy result preserves layout`);
      assert.equal(await evaluate("document.activeElement===document.querySelector('.obs-registration-copy')"), true, 'URL copy preserves focus');
    }
    assert.deepEqual(await evaluate('window.dialogCopies'), Array(2).fill('http://127.0.0.1:3000/overlay/comments'), 'URL copied once per action');
    assert.equal(await evaluate('obsRegistrationHarness.additions()'), additions, 'URL copy never registers');
    await evaluate("document.querySelector('#obs-source-registration-dialog [aria-label=閉じる]').click()");
    assert.equal(await evaluate('document.activeElement.id'), 'obs-registration-entry-comments');
    await evaluate(`obsRegistrationHarness.update({recoveries:[{key:'visibility-check',target:{kind:'overlay',overlay:'comments'},title:'コメント',message:'登録状態を確認してください。'}]}); document.querySelector('.obs-registration-recovery-slot:not([hidden]) button').focus()`);
    assert.equal(await evaluate("document.querySelector('.obs-registration-recovery-slot:not([hidden])').getBoundingClientRect().height>0"), true, 'warning region is available');
    assert.equal(await evaluate("document.activeElement===document.querySelector('.obs-registration-recovery-slot:not([hidden]) button')"), true, 'warning control receives focus');
    await evaluate('obsRegistrationHarness.update({recoveries:[]})');
    assert.equal(await evaluate("document.querySelector('.obs-registration-recovery-slot:not([hidden])')===null"), true, 'resolved recovery removes region');
    assert.equal(await evaluate('document.activeElement.id'), 'editor-heading', 'resolved focused warning returns to editor heading');
  }
  return 3;
}
