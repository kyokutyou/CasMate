import assert from 'node:assert/strict';

export async function verifyInitialSetupRecovery({ evaluate, resize }) {
  const settle=()=>evaluate('new Promise(resolve=>setTimeout(resolve,70))');
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settle();};
  const update=async value=>{await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,...${JSON.stringify(value)}}});})()`);await settle();};
  for(const width of [1040,320]){
    await resize(width,820);
    for(const [position,selected,target] of [
      ['sources',['aiListener'],'#setup-detail'],
      ['commentSpeech',['commentSpeech'],'#setup-detail'],
      ['speechRecognition',['speechRecognition'],'#setup-smartphone-input'],
      ['smartphone',['smartphone','speechRecognition'],'#setup-phone-speech-settings'],
      ['smartphone',['smartphone','speechRecognition'],'#setup-phone-comment-settings'],
    ]){
      await update({position,selected,smartphoneUses:['speech']});
      await evaluate('boardManagementHarness.holdNextMutation()');
      const count=await evaluate('boardManagementHarness.trace().length');
      await click('#setup-next');
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(target)}).getAttribute('aria-disabled')`),'true','detail link explains pending '+target);
      await click(target);
      assert.equal(await evaluate("document.querySelector('#editor-heading')===null"),true,'pending move cannot enter details '+target);
      assert.equal(await evaluate('boardManagementHarness.trace().length'),count+1,'pending detail has no side effects');
      await evaluate('boardManagementHarness.releaseMutation()');await settle();
      assert.notEqual(await evaluate("document.querySelector('.initial-setup[data-setup-position]').dataset.setupPosition"),position,'saved move still completes');
    }
    await update({position:'sources',selected:['aiListener']});await click('#setup-next');
    await click('#setup-detail');await click('.editor-heading .back-button');
    assert.equal(await evaluate("document.querySelector('.initial-setup[data-setup-position]').dataset.setupPosition"),'speechRecognition','details return to their actual originating step');
    assert.equal(await evaluate('document.activeElement.id'),'setup-detail');

  }
}
