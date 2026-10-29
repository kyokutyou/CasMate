import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show:false, width:1200, height:820, webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
  window.setMenuBarVisibility(false);
  const requests = [];
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const placeholder = pathToFileURL(join(process.argv[3], 'placeholder.svg')).href;
    if (details.url.endsWith('/placeholder.svg') && details.url !== placeholder) { callback({ redirectURL: placeholder }); return; }
    if (/^https?:/i.test(details.url)) requests.push(details.url);
    callback({cancel:/^https?:/i.test(details.url)});
  });
  const evaluate = code => window.webContents.executeJavaScript(code);
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,80))');
  const capture = async name => {
    await window.webContents.capturePage(undefined,{stayHidden:true}); await settle();
    await writeFile(join(process.argv[4], name), (await window.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
  };
  try {
    await window.loadFile(process.argv[2]); await settle();
    for (const zoom of [1,1.25,1.5]) for (const [width,height] of [[1200,820],[760,760],[560,600],[320,600]]) {
      if (width===320 && zoom!==1) continue; // The native settings window has a 560px minimum.
      window.webContents.setZoomFactor(zoom); window.setContentSize(width,height);
      await window.webContents.capturePage(undefined,{stayHidden:true});
      await evaluate('scrollTo(0,0)'); await settle();
      const metrics = await evaluate(`(() => {const preview=document.querySelector('.character-settings-preview').getBoundingClientRect(),controls=document.querySelector('.character-settings-controls').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,wide:innerWidth>=720,side:controls.left>=preview.right,stack:controls.top>=preview.bottom}})()`);
      assert.equal(metrics.overflow,false,`${width}/${zoom} fits`);
      assert.equal(metrics.wide ? metrics.side : metrics.stack,true,`${width}/${zoom} layout`);
      assert.equal(await evaluate(`(() => {const choices=document.querySelector('.asset-controls').getBoundingClientRect(),removals=document.querySelector('.character-asset-removals').getBoundingClientRect();return removals.top>=choices.bottom+12&&[...document.querySelectorAll('.character-asset-removals button')].every(node=>{const b=node.getBoundingClientRect();return b.left>=removals.left&&b.right<=removals.right})})()`),true,`${width}/${zoom} removal actions are separated and fit`);
      assert.equal(await evaluate(`(() => {const stage=document.querySelector('.character-preview.large').getBoundingClientRect();return [...document.querySelectorAll('.character-preview.large img')].every(node=>{const b=node.getBoundingClientRect();return b.top>=stage.top&&b.bottom<=stage.bottom&&b.left>=stage.left&&b.right<=stage.right})})()`),true,`${width}/${zoom} preview image fits its stage`);
      if (metrics.wide) {
        await evaluate('scrollTo(0,document.documentElement.scrollHeight)'); await settle();
        assert.equal(await evaluate(`(() => {const box=document.querySelector('.character-settings-preview').getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight})()`),true,'preview stays visible while adjusting');
      }
      if (zoom===1) await capture(`character-${width}.png`);
    }
    window.webContents.setZoomFactor(1); window.setContentSize(760,760);
    await evaluate(`document.querySelector('.asset-controls').scrollIntoView({block:'start'})`); await settle();
    await capture('character-assets-760.png');
    await evaluate(`document.querySelector('[aria-label="上下移動"]').focus()`); await settle();
    const positions = () => evaluate(`JSON.stringify({scroll:scrollY,focus:document.activeElement.getAttribute('aria-label'),boxes:[...document.querySelectorAll('.character-settings-preview,.character-settings-notice,.character-motion-save,.motion-slider,input[type=range]')].map(node=>{const b=node.getBoundingClientRect();return [b.x,b.y,b.width,b.height]})})`);
    const change = async value => {
      await evaluate(`(() => {const slider=document.querySelector('[aria-label="上下移動"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,${value});slider.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await settle();
    };
    const commit = async () => { await evaluate(`document.querySelector('[aria-label="上下移動"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`); await settle(); };
    const status = () => evaluate(`document.querySelector('.character-motion-save').textContent`);
    const before = await positions();
    await evaluate('characterSettingsHarness.holdSave()');
    await change(1.2); assert.equal(await status(),'保存待ち'); assert.equal(await positions(),before,'pending does not move controls');
    await commit(); assert.equal(await status(),'保存中'); assert.equal(await positions(),before,'saving does not move controls');
    await evaluate('characterSettingsHarness.releaseSave()'); await settle();
    assert.equal(await status(),'保存済み'); assert.equal(await positions(),before,'saved does not move controls');
    await evaluate('characterSettingsHarness.holdSave()'); await change(1.8); await commit();
    await evaluate(`characterSettingsHarness.releaseSave('保存に失敗しました。'.repeat(60))`); await settle();
    assert.equal(await status(),'保存失敗'); assert.equal(await positions(),before,'long failure does not move controls or focus');
    await capture('character-save-failed.png');
    await change(1.4); await commit(); assert.equal(await status(),'保存済み');
    await evaluate('characterSettingsHarness.connection(false)'); await settle();
    assert.equal(await evaluate(`document.querySelector('[aria-label="接続状態"]').textContent`),'再接続中');
    assert.equal(await status(),'保存済み','connection is distinct from saving');
    const trace = await evaluate('characterSettingsHarness.trace()');
    await evaluate(`document.querySelector('.character-settings-preview button').click()`); await settle();
    assert.equal(await evaluate(`document.querySelector('.character-settings-preview button').textContent`),'口パクテスト中...');
    await evaluate('new Promise(resolve=>setTimeout(resolve,2050))');
    assert.deepEqual(await evaluate('characterSettingsHarness.trace()'),trace,'mouth test remains local');
    const beforeFailure = await positions();
    await evaluate(`document.querySelector('.character-preview.large img').dispatchEvent(new Event('error'))`); await settle();
    await evaluate(`document.querySelector('.character-settings-preview button').click()`); await settle();
    assert.equal(await evaluate(`(() => {const visible=[...document.querySelectorAll('.character-preview.large img')].find(img=>img.style.opacity==='1');return visible.src.endsWith('/placeholder.svg')&&visible.complete&&visible.naturalWidth>0})()`), true, 'closed asset failure keeps a loaded placeholder even during the local mouth test');
    assert.equal(await evaluate(`document.querySelector('.character-preview.large').getAnimations({subtree:true}).length`), 0, 'placeholder remains still');
    assert.equal(await positions(), beforeFailure, 'asset failure preserves controls and focus');
    await capture('character-fallback-760.png');
    assert.equal(requests.length,0);
    console.log('PASS: character settings layout, sticky preview, save states and local mouth test; zero HTTP(S)');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
