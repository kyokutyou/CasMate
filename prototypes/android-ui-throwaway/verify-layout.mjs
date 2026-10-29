// Local browser rendering checks for throwaway UI; never starts the product.
import { app, BrowserWindow, nativeTheme } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 736, height: 1400, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  try {
    await mkdir(process.argv[4], { recursive: true });
    await window.loadFile(process.argv[2]);
    const evaluate = code => window.webContents.executeJavaScript(code);
    const geometry = [];
    for (const width of [320, 398, 736]) {
      window.setContentSize(width, 1600);
      await new Promise(resolve => setTimeout(resolve, 80));
      for (const id of ['A', 'B', 'C', 'D']) {
        await evaluate(`(() => { for (const section of document.querySelectorAll('[data-design]')) section.hidden=section.dataset.design!==${JSON.stringify(id)}; window.casmatePrototype.setScenario('running'); })()`);
        const bounds = await evaluate(`(() => { const phone=document.querySelector('[data-phone="${id}"]');const box=phone.getBoundingClientRect();return {width:innerWidth,phoneHeight:box.height,stageHeight:phone.closest('.cm-stage').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth,phoneOverflow:phone.scrollWidth>phone.clientWidth+1,smallButtons:[...phone.querySelectorAll('button')].filter(x=>x.checkVisibility()).filter(x=>x.getBoundingClientRect().height<47).map(x=>x.textContent)};})()`);
        assert.equal(bounds.overflow, false, `${width}/${id}: outer horizontal overflow`);
        assert.equal(bounds.phoneOverflow, false, `${width}/${id}: phone horizontal overflow`);
        assert.deepEqual(bounds.smallButtons, [], `${width}/${id}: at least 48px touch targets`);
        geometry.push({ id, ...bounds });
        if (width === 736) {
          await new Promise(resolve => setTimeout(resolve, 70));
          await writeFile(join(process.argv[4], `${id}.png`), (await window.webContents.capturePage()).toPNG());
        }
        for (const action of ['connection', 'settings', 'diagnostics']) {
          await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="${action}"]')?.click()`);
          const sheetOverflow=await evaluate(`(() => {const sheet=document.querySelector('[data-phone="${id}"] .cm-sheet');return Boolean(sheet&&sheet.scrollWidth>sheet.clientWidth+1);})()`);
          assert.equal(sheetOverflow, false, `${width}/${id}/${action}: sheet horizontal overflow`);
          await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="close"]')?.click()`);
        }
      }
    }
    assert.deepEqual(errors, []);
    nativeTheme.themeSource='dark';
    await evaluate("window.casmatePrototype.setScenario('running');document.querySelector('[data-design=A]').hidden=false;document.querySelector('[data-design=D]').hidden=true;");
    await new Promise(resolve => setTimeout(resolve, 80));
    await writeFile(join(process.argv[4], 'A-dark.png'), (await window.webContents.capturePage()).toPNG());
    await writeFile(join(process.argv[4], 'geometry.json'), JSON.stringify(geometry, null, 2));
    console.log(JSON.stringify(geometry));
    console.log('PASS: 4 designs at 320/398/736px; connection/settings/diagnostic sheets; renderer console.');
    window.destroy(); app.quit();
  } catch (error) { console.error(error); window.destroy(); app.exit(1); }
});
