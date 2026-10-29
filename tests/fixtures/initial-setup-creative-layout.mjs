import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { verifyInitialSetupCreative } from './initial-setup-creative-checks.mjs';
app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show:false, width:1040, height:820, webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
  window.setMenuBarVisibility(false);
  const evaluate = code => window.webContents.executeJavaScript(code);
  try {
    await window.loadFile(process.argv[2]); window.webContents.focus();
    const count = await verifyInitialSetupCreative({ evaluate, resize: async (width,height) => { window.setContentSize(width,height); await new Promise(resolve=>setTimeout(resolve,150)); }, capture: async name => { await window.webContents.capturePage();await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');await new Promise(resolve=>setTimeout(resolve,150));await writeFile(join(process.argv[4],name),(await window.webContents.capturePage()).toPNG()); } });
    window.setMinimumSize(320,360);window.setSize(320,360);
    for (const zoom of [1,1.25]) {
      window.webContents.setZoomFactor(zoom); await new Promise(resolve=>setTimeout(resolve,150));
      for (const position of ['aiListener','textEffects','character']) {
        await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({initialSetup:{...s.initialSetup,position:${JSON.stringify(position)}}});})()`);
        const layout=await evaluate("(()=>{const b=document.querySelector('.management-body').getBoundingClientRect(),f=document.querySelector('.setup-footer').getBoundingClientRect();return {body:b.height,fits:f.bottom<=innerHeight+1,noOverlap:b.bottom<=f.top+1,overflow:document.documentElement.scrollWidth>innerWidth+1};})()");
        assert.ok(layout.body>=40,JSON.stringify({zoom,position,layout}));assert.equal(layout.fits,true);assert.equal(layout.noOverlap,true);assert.equal(layout.overflow,false);
      }
    }
    console.log(`PASS: ${count} initial setup creative layouts and update geometry; minimum/zoom`);
  } catch(error) { console.error(error);process.exitCode=1; }
  finally { window.destroy();app.quit(); }
});
