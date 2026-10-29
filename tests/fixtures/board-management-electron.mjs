import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyBoardManagement } from './board-management-checks.mjs';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'electron-profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 760, height: 560,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const requests = [];
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/i.test(details.url)) requests.push(details.url);
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  try {
    await window.loadFile(process.argv[2]);
    window.webContents.focus();
    const evaluate = code => window.webContents.executeJavaScript(code);
    const captureDirectory = process.argv[4];
    const checks = await verifyBoardManagement({ evaluate,
      resize: async (width, height) => {
        if (process.argv.includes('--deferred-resize')) {
          setTimeout(() => window.setContentSize(width, height), 250);
          return;
        }
        window.setContentSize(width, height); await new Promise(resolve => setTimeout(resolve, 100));
      },
      capture: captureDirectory ? async name => {
        await mkdir(captureDirectory, { recursive: true });
        // Geometry updates synchronously; allow the compositor to present it before capture.
        await new Promise(resolve => setTimeout(resolve, 100));
        await writeFile(join(captureDirectory, name), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
      } : undefined,
    });
    assert.deepEqual(requests, [], 'zero HTTP(S) requests');
    console.log(`PASS: ${checks} board management Electron checks; zero HTTP(S) requests`); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
