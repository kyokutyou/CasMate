import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1040, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.setMenuBarVisibility(false);
  const evaluate = code => window.webContents.executeJavaScript(code);
  try {
    await window.loadFile(process.argv[2]);
    const failures = [];
    for (const width of [1040, 760, 320]) {
      window.setContentSize(width, 900);
      for (const theme of ['graphite', 'midnight', 'ocean', 'burgundy', 'pearl', 'ivory', 'sakura', 'lavender']) for (const size of ['small', 'medium', 'large']) for (const checked of [false, true]) for (const pending of [false, true]) {
        await evaluate(`checkboxHarness.render(${JSON.stringify(theme)},${JSON.stringify(size)},${checked},${pending})`);
        const items = await evaluate('checkboxHarness.misaligned()');
        for (const item of items) failures.push({ viewport: width, theme, size, checked, pending, ...item });
      }
      if (width === 1040 || width === 320) {
        await evaluate(`checkboxHarness.render('ocean',${JSON.stringify(width === 1040 ? 'medium' : 'large')},true,false);document.querySelector('.setup-personal-check').scrollIntoView({block:'start'})`);
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await writeFile(join(process.argv[4], `checkboxes-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
    }
    window.webContents.setZoomFactor(1.25);
    await evaluate("checkboxHarness.render('ocean','large',true,true)");
    assert.deepEqual(await evaluate('checkboxHarness.misaligned()'), [], 'zoomed checkboxes align');
    assert.deepEqual(failures, [], 'checkboxes must align with the first label line and center the check mark');
    console.log('PASS: setup checkbox alignment');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window.destroy(); app.quit(); }
});
