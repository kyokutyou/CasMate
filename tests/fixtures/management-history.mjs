import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const { installManagementHistory } = await import(pathToFileURL(join(process.argv[3], 'management-history.mjs')).href);
  const window = new BrowserWindow({ show: false, width: 760, height: 760,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: join(process.argv[3], 'preload.cjs') } });
  window.setMenuBarVisibility(false); installManagementHistory(window);
  window.webContents.on('preload-error', (_event, _path, error) => console.error('preload-error:',error.message));
  const evaluate = code => window.webContents.executeJavaScript(code);
  const settle = () => new Promise(resolve => setTimeout(resolve, 120));
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const fill = async (selector,value) => { await evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)});input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await settle(); };
  const history = async command => { let prevented=false; window.emit('app-command',{preventDefault(){prevented=true;}},command); assert.ok(prevented); await settle(); };
  const mouse = async button => {
    const handle=window.getNativeWindowHandle();
    await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./management-history-mouse.ps1',import.meta.url)), '-WindowHandle',String(handle.readBigUInt64LE()),'-Button',String(button)],{windowsHide:true});
    await settle();
  };
  const measure = () => evaluate(`(() => {const b=document.getElementById('application-settings-directory'),body=document.querySelector('.management-body'),r=b.getBoundingClientRect();return {rect:[r.x,r.y,r.width,r.height],height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement.id};})()`);
  try {
    await window.loadFile(process.argv[2]); await settle();
    assert.equal(await evaluate('typeof window.casmateNavigation?.subscribe'),'function','real sandboxed preload');
    await evaluate("document.getElementById('home-application').focus();document.querySelector('.management-body').scrollTop=100");
    const homeScroll=await evaluate("document.querySelector('.management-body').scrollTop");
    await click('#home-application'); await fill('.app-port-row input','');
    await evaluate("document.querySelector('.management-body').scrollTop=170");
    const editorScroll=await evaluate("document.querySelector('.management-body').scrollTop");
    await mouse(1);
    assert.equal(await evaluate('document.activeElement.id'),'home-application');
    assert.equal(await evaluate("document.querySelector('.management-body').scrollTop"),homeScroll);
    await mouse(2);
    assert.equal(await evaluate("document.querySelector('.app-port-row input').value"),'','draft retained');
    assert.equal(await evaluate("document.querySelector('.management-body').scrollTop"),editorScroll);
    assert.equal(await evaluate('boardManagementHarness.trace().filter(t=>t.kind==="save").length'),0,'history does not save');
    await evaluate("window.dispatchEvent(new MouseEvent('mouseup',{button:3,bubbles:true}))"); await settle();
    assert.equal(await evaluate("document.getElementById('page-heading').textContent"),'配信のホーム','DOM-only mouse input works with native bridge');
    await evaluate("window.dispatchEvent(new MouseEvent('mouseup',{button:4,bubbles:true}))"); await settle();
    assert.equal(await evaluate("document.querySelector('.app-port-row input').value"),'','DOM forward preserves draft');
    await history('browser-backward'); await click('[data-page=settings]'); await history('browser-forward');
    assert.equal(await evaluate("document.querySelector('#page-heading').textContent"),'設定','new branch discards forward');
    await history('browser-backward'); await click('#home-obsControl'); await click('.oc-connection-details>summary'); await fill('[aria-label="OBS WebSocketポート"]','4456');
    await history('browser-backward'); await history('browser-forward');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"OBS WebSocketポート\"]').value"),'4456','OBS draft retained');
    assert.equal(await evaluate('document.activeElement === document.querySelector(\'[aria-label="OBS WebSocketポート"]\')'),true,'idless OBS input focus restored');
    assert.equal(await evaluate('boardManagementHarness.trace().filter(t=>t.path==="/api/obs-control/configure").length'),0,'history blur does not apply OBS');
    await history('browser-backward');
    await click('#home-application');
    for (const error of ['保存先を開けませんでした。',undefined]) {
      await evaluate(`(() => {const b=document.getElementById('application-settings-directory');b.scrollIntoView({block:'center'});b.focus({preventScroll:true});boardManagementHarness.holdNextMutation(${JSON.stringify(error)});})()`);
      const before=await measure(); await click('#application-settings-directory'); await click('#application-settings-directory');
      assert.deepEqual(await measure(),before,'pending directory operation retains geometry and focus');
      await evaluate('boardManagementHarness.releaseMutation()'); await settle();
      assert.deepEqual(await measure(),before,'directory result retains geometry and focus');
    }
    assert.equal(await evaluate('boardManagementHarness.trace().filter(t=>t.path==="/api/application/settings-directory/open").length'),2,'one request per operation');
    for (const width of [760,560,320]) {
      window.setSize(width,760);
      await evaluate("(() => {const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTextSize:'large'}}});document.getElementById('application-settings-directory').scrollIntoView({block:'center'});})()"); await settle();
      assert.equal(await evaluate("(() => {const r=document.getElementById('application-settings-directory').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.querySelector('.management-body').scrollWidth<=document.querySelector('.management-body').clientWidth+1;})()"),true,'directory link fits '+width);
      if (width===560) await writeFile(join(process.argv[4],'application-directory-link-560.png'),(await window.webContents.capturePage()).toPNG());
    }
    console.log('PASS: native history, preserved drafts, directory link geometry');
  } catch(error) { console.error(error); process.exitCode=1; }
  finally { window.destroy(); app.quit(); }
});
