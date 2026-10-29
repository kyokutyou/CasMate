import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  let requests = 0;
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const remote = /^https?:/.test(details.url);
    if (remote) requests++;
    callback({ cancel: remote });
  });
  try {
    await window.loadFile(process.argv[2]);
    const evaluate = code => window.webContents.executeJavaScript(code);
    for (const width of [1000, 560, 320]) {
      window.setContentSize(width, 760);
      for (const size of [16, 200]) {
        await evaluate(`(() => {
          const input = document.querySelector('input[type=number]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${size}');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await new Promise(resolve => setTimeout(resolve, 80));
        const actual = await evaluate(`(() => {
          const preview = document.querySelector('.list-preview-frame');
          const list = preview.querySelector('.list-comment-preview');
          return { visible: preview.checkVisibility() && !preview.closest('details'),
            count: list.querySelectorAll('article').length,
            size: getComputedStyle(list.querySelector('article')).fontSize,
            pageFits: document.documentElement.scrollWidth <= innerWidth,
            listFits: list.scrollWidth <= list.clientWidth,
            bounded: list.clientHeight <= 360,
            scrollable: list.scrollHeight > list.clientHeight };
        })()`);
        assert.equal(actual.visible, true);
        assert.equal(actual.count, 3);
        assert.equal(actual.size, `${size}px`);
        assert.equal(actual.pageFits, true, `${width}/${size}: page overflow`);
        assert.equal(actual.listFits, true, `${width}/${size}: text wrapping`);
        assert.equal(actual.bounded, true);
        if (size === 200) assert.equal(actual.scrollable, true);
        if (process.argv[4]) {
          await evaluate("document.querySelector('.list-preview-frame').scrollIntoView({block:'end'})");
          await new Promise(resolve => setTimeout(resolve, 80));
          await mkdir(process.argv[4], { recursive: true });
          await writeFile(join(process.argv[4], `preview-${width}-${size}.png`), (await window.webContents.capturePage()).toPNG());
        }
      }
    }
    assert.equal(requests, 0);
    console.log('PASS: 6 comment list preview layouts; zero external requests');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
