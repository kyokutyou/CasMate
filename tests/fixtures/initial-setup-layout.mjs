import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { verifyInitialSetupObs } from './initial-setup-obs-checks.mjs';
import { verifyInitialSetupEntry } from './initial-setup-entry-checks.mjs';
app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1040, height: 820, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.setMenuBarVisibility(false);
  const evaluate = code => window.webContents.executeJavaScript(code);
  const settle = () => new Promise(resolve => setTimeout(resolve, 35));
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const update = values => evaluate(`(() => { const s=boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,...${JSON.stringify(values)}}}); })()`);
  const scan = async label => {
    const result = await evaluate(`(() => { const body=document.querySelector('.management-body'); const nodes=[...document.querySelectorAll('.initial-setup input,.initial-setup button,.initial-setup label,.settings-card input,.settings-card button,.settings-card select')].filter(n=>n.checkVisibility());
      return {overflow:body.scrollWidth>body.clientWidth+1 || document.documentElement.scrollWidth>innerWidth+1, clipped:nodes.filter(n=>{const r=n.getBoundingClientRect();return r.left<0 || r.right>innerWidth+1;}).map(n=>n.textContent||n.getAttribute('aria-label')), heading:document.querySelector('#setup-heading')?.textContent}; })()`);
    assert.equal(result.overflow, false, label + ' horizontal overflow'); assert.deepEqual(result.clipped, [], label + ' clipped controls'); assert.ok(result.heading, label + ' heading');
  };
  const capture = async name => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise(resolve => setTimeout(resolve, 150));
    await writeFile(join(process.argv[4], name), (await window.webContents.capturePage()).toPNG());
  };
  try {
    await window.loadFile(process.argv[2]);
    window.webContents.focus();
    await verifyInitialSetupObs({ evaluate, resize: async (width,height) => { window.setContentSize(width,height); }, capture });
    await verifyInitialSetupEntry({ evaluate, resize: async (width,height) => { window.setContentSize(width,height); }, capture });
    await click('[data-page=settings]'); await click('#settings-application'); await click('#application-initial-setup'); await settle();
    const beforeMinimum = await evaluate('boardManagementHarness.snapshot().initialSetup');
    window.setMinimumSize(320,360); window.setSize(320,360);
    for(const zoom of [1,1.25]) {
      window.webContents.setZoomFactor(zoom);
      await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTextSize:'large'}}});})()");
      for(const position of ['welcome','features','summary']) {
        await update({position,selected:['sources','commentSpeech','commentOverlay']}); await settle(); await scan(`minimum outer/${zoom}/${position}`);
        const size=await evaluate("(()=>{const b=document.querySelector('.management-body').getBoundingClientRect(),f=document.querySelector('.setup-footer').getBoundingClientRect();return {body:b.height,footer:f.bottom,fits:f.bottom<=innerHeight+1,noOverlap:b.bottom<=f.top+1}})()");
        assert.ok(size.body>=40,`minimum window keeps a scroll area: ${JSON.stringify(size)}`);
        assert.equal(size.fits,true); assert.equal(size.noOverlap,true);
        if(position==='features') await capture(`setup-entry-minimum-${zoom}.png`);
      }
    }
    window.webContents.setZoomFactor(1); window.setSize(1040,820); await update(beforeMinimum); await settle();
    assert.equal(await evaluate("document.getElementById('home-initial-setup')"),null,'home has no setup entry');
    const openApplication = async () => { await click('[data-page=settings]'); await click('#settings-application'); await settle(); };
    await openApplication();
    for (const [width,size] of [[1040,'small'],[760,'medium'],[560,'large'],[340,'large']]) {
      window.setSize(width,820);
      await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTextSize:${JSON.stringify(size)}}}});})()`);
      await evaluate("document.getElementById('application-initial-setup').scrollIntoView({block:'center'})"); await settle();
      const entry=await evaluate(`(() => {const b=document.getElementById('application-initial-setup');const r=b.getBoundingClientRect();return {last:b.closest('section')===document.querySelector('.application-settings-panel .app-footer-grid > section:last-child'),visible:b.checkVisibility(),fits:r.left>=0&&r.right<=innerWidth};})()`);
      assert.deepEqual(entry,{last:true,visible:true,fits:true},'application setup entry at '+width);
      if (width===560) await capture('application-entry-560.png');
    }
    window.setSize(1040,820); await evaluate("document.getElementById('application-initial-setup').focus()");
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
    window.webContents.sendInputEvent({type:'char',keyCode:'\r'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'}); await settle();
    assert.equal(await evaluate('document.activeElement.id'),'setup-heading','entry focuses setup heading');
    await click('.setup-title-row button'); await settle();
    assert.equal(await evaluate('document.activeElement.id'),'page-heading','interruption focuses home heading');
    assert.match(await evaluate("document.querySelector('.toast-region').textContent"),/設定 → アプリ設定/,'interruption guides resumption');
    await capture('interrupted-home.png');
    await openApplication(); await click('#application-initial-setup'); await settle();
    await click('[data-page=settings]'); await settle();
    assert.equal(await evaluate('document.activeElement.id'),'page-heading','same-page interruption focuses settings heading');
    await click('#settings-application'); await click('#application-initial-setup'); await settle();
    for (const theme of ['graphite','midnight','ocean','burgundy','pearl','ivory','sakura','lavender']) {
      await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTheme:${JSON.stringify(theme)}}}});})()`);
      await scan(theme);
    }
    for (const [width,size] of [[1040,'small'],[760,'medium'],[560,'large'],[340,'large']]) {
      window.setSize(width,820);
      await evaluate(`(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTextSize:${JSON.stringify(size)},managementTheme:'ocean'}}});})()`);
      for (const position of ['welcome','features','sources','commentSpeech','smartphone','speechRecognition','obsControl','aiListener','textEffects','character','obsDisplay','summary']) {
        await update({position}); await settle(); await scan(`${width}/${size}/${position}`);
        assert.equal(await evaluate("document.querySelector('.initial-setup[data-setup-position]').dataset.setupPosition"), position, 'actual displayed step');
        if(position==='aiListener'){
          await evaluate("document.querySelector('#ai-panel-connections input[type=password]').focus({preventScroll:true})");
          const geometry=()=>evaluate("(()=>{const e=document.querySelector('#ai-panel-connections input[type=password]'),b=document.querySelector('.management-body'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,scroll:b.scrollTop,height:b.scrollHeight,focus:document.activeElement===e}})()");
          const before=await geometry();
          await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({aiListener:{...s.aiListener,authorization:{source:'twitch',url:'https://example.com/authorize',code:'ABCD',expiresAt:1893456000000}}})})()");await settle();
          assert.deepEqual(await geometry(),before,'AI setup authorization preserves controls');
          await evaluate("document.querySelector('.setup-ai-status .ai-authorization a').focus({preventScroll:true});(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({aiListener:{...s.aiListener,authorization:null}})})()");await settle();
          assert.equal(await evaluate("document.activeElement===document.querySelector('.setup-ai-status')"),true,'AI setup completed authorization retains focus');
        }
      }
      if (width===560) { await update({position:'features'}); await capture('features-560.png'); }
    }
    window.setSize(760,820); window.webContents.setZoomFactor(1.5); await update({position:'features'}); await settle(); await scan('zoom'); window.webContents.setZoomFactor(1);
    await update({position:'obsDisplay'}); await settle();
    await evaluate(`(() => {const b=document.querySelector('.setup-confirm');b.scrollIntoView({block:'center'});b.focus();boardManagementHarness.holdNextMutation();})()`);
    const measure = () => evaluate(`(() => {const body=document.querySelector('.management-body');const rect=n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]};return {button:rect(document.querySelector('.setup-confirm')),next:rect(document.querySelector('.setup-footer-actions')),height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement.className};})()`);
    const before=await measure(); await click('.setup-confirm'); await settle(); assert.deepEqual(await measure(),before,'processing retains geometry and focus');
    const pendingTrace = await evaluate('boardManagementHarness.trace().length');
    await click('.setup-confirm'); await settle();
    assert.equal(await evaluate('boardManagementHarness.trace().length'), pendingTrace, 'pending confirmation cannot run twice');
    await evaluate('boardManagementHarness.releaseMutation()'); await settle(); assert.deepEqual(await measure(),before,'confirmation retains geometry and focus');
    await evaluate(`boardManagementHarness.holdNextMutation('進行記録を保存できませんでした。'.repeat(12))`); await click('.setup-confirm'); await settle();
    await evaluate('boardManagementHarness.releaseMutation()'); await settle(); assert.deepEqual(await measure(),before,'failure retains geometry and focus');
    await update({position:'aiListener'}); await settle();
    const saveKey = () => evaluate(`[...document.querySelectorAll('.ai-settings button')].find(button=>button.textContent==='APIキーを保存').click()`);
    const enterKey = () => evaluate(`(() => {const input=document.querySelector('.ai-settings input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'setup-test-key');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true});document.querySelector('.setup-footer').scrollIntoView({block:'center'});})()`);
    for (const error of [undefined,'AIの保存を完了できませんでした。']) {
      await enterKey(); await settle();
      await evaluate(`boardManagementHarness.holdNextMutation(${JSON.stringify(error)})`);
      const geometry=await measure(); await saveKey(); await settle();
      assert.equal(await evaluate("document.querySelector('.setup-footer-actions button:last-child').getAttribute('aria-disabled')==='true'"),true,'AI save blocks next');
      assert.deepEqual(await measure(),geometry,'AI save retains geometry and focus');
      await evaluate('boardManagementHarness.releaseMutation()'); await settle();
      assert.deepEqual(await measure(),geometry,'AI save result retains geometry and focus');
      assert.equal(await evaluate("document.querySelector('.setup-footer-actions button:last-child').getAttribute('aria-disabled')==='true'"),Boolean(error),'AI save result controls progression');
    }
    await update({position:'features',selected:['sources']}); await settle();
    await evaluate("document.getElementById('setup-feature-sources').focus()");
    await click('.setup-footer-actions button:last-child'); await settle();
    const mouse = async button => { await evaluate(`window.dispatchEvent(new MouseEvent('mouseup',{button:${button},bubbles:true}))`); await settle(); };
    await mouse(3);
    assert.equal(await evaluate('document.activeElement.id'),'setup-feature-sources','recreated feature input regains focus');
    for (const [id,error] of [['setup-feature-commentSpeech',undefined],['setup-phone-use-speech','保存できませんでした。']]) {
      await update({position:'features',selected:['sources','smartphone'],smartphoneUses:['comments']}); await settle();
      await evaluate(`document.getElementById(${JSON.stringify(id)}).focus();boardManagementHarness.holdNextMutation(${JSON.stringify(error)})`);
      await click('#'+id); await settle();
      assert.equal(await evaluate('document.activeElement.id'),id,'selection save retains focus');
      const count=await evaluate('boardManagementHarness.trace().length'); await click('#'+id); await settle();
      assert.equal(await evaluate('boardManagementHarness.trace().length'),count,'pending selection cannot run twice');
      await evaluate('boardManagementHarness.releaseMutation()'); await settle();
      assert.equal(await evaluate('document.activeElement.id'),id,'selection result retains focus');
    }
    await update({position:'obsDisplay',selected:['commentOverlay']}); await settle();
    await click('#setup-manual-comments'); await settle();
    await click('#setup-detail'); await settle(); await click('.editor-heading .back-button'); await settle();
    assert.equal(await evaluate("document.getElementById('setup-manual-comments').parentElement.open"),true,'manual disclosure survives details');
    await update({position:'aiListener',selected:['aiListener']}); await settle();
    await evaluate("(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({aiListener:{...s.aiListener,services:Object.fromEntries(Object.entries(s.aiListener.services).map(([id,value])=>[id,{...value,message:'接続を確認してください'}]))}});})()");

    assert.equal(await evaluate("[...document.querySelectorAll('.ai-settings button')].filter(b=>/再開/.test(b.textContent)).length"),0,'setup excludes all resume operations even with service errors');
    await click('#setup-detail'); await settle(); await click('#ai-tab-visual'); await settle();
    await evaluate("document.querySelector('#ai-panel-visual select').focus()");
    await mouse(3);
    assert.equal(await evaluate("!!document.querySelector('.setup-ai-step[data-ai-step=personas]')"),true,'setup persona step retained');
    await mouse(4);
    assert.equal(await evaluate("document.getElementById('ai-tab-visual').getAttribute('aria-selected')"),'true','detail visual tab retained');
    assert.equal(await evaluate("document.activeElement===document.querySelector('#ai-panel-visual select')"),true,'visual input focus survives refresh');
    await click('.editor-heading .back-button'); await settle();
    await update({position:'summary',selected:[]}); await settle();
    assert.match(await evaluate("document.querySelector('.setup-empty-result').textContent"),/設定 → アプリ設定/,'empty result resumes from application settings');
    await evaluate('boardManagementHarness.holdNextMutation()'); await click('.setup-footer-actions button:last-child'); await settle();
    await click('[data-page=live]'); await evaluate('boardManagementHarness.releaseMutation()'); await settle();
    assert.equal(await evaluate("document.getElementById('page-heading').textContent"),'コメントと、いつもの操作','late finish does not overwrite navigation');
    assert.equal(await evaluate('document.activeElement.id'),'page-heading','late finish preserves focus');
    await openApplication(); await click('#application-initial-setup'); await settle();
    await update({position:'sources',selected:['sources']}); await capture('sources-760.png');
    console.log('PASS: initial setup layouts and notification geometry');
  } catch(error) { console.error(error); process.exitCode=1; }
  finally { window.destroy(); app.quit(); }
});
