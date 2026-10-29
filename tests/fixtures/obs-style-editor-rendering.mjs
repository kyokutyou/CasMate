import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

app.disableHardwareAcceleration();
app.setPath('userData', process.argv[3]);
app.whenReady().then(async () => {
  const editor = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { backgroundThrottling: false, spellcheck: false } });
  const actual = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, spellcheck: false } });
  editor.webContents.on('console-message', (event) => { if (event.level === 'error') console.error(event.message); });
  const requests = [];
  editor.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/u.test(details.url)) requests.push(details.url);
    callback({ cancel: /^https?:/u.test(details.url) });
  });
  const metrics = `(doc) => [...doc.querySelectorAll('main, .overlay-comment, .comment-meta, .source-badge, strong, .comment-body, .emote, .speech-recognition-overlay-text')].map(element => {
    const rect = element.getBoundingClientRect(), s = doc.defaultView.getComputedStyle(element);
    return { tag:element.className || element.tagName, text:element.textContent, x:rect.x,y:rect.y,width:rect.width,height:rect.height,
      display:s.display,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,line:s.lineHeight,color:s.color,background:s.backgroundColor,
      padding:s.padding,border:s.border,radius:s.borderRadius,gap:s.gap,align:s.textAlign,shadow:s.textShadow,stroke:s.webkitTextStroke,
      whiteSpace:s.whiteSpace,wrap:s.overflowWrap };
  })`;
  async function settle() {
    await editor.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  }
  try {
    await editor.loadFile(process.argv[2]); await settle();
    const cases = JSON.parse(await readFile(join(process.argv[3], 'cases.json'), 'utf8'));
    for (const item of cases) {
      const preview = item.document.previews[item.target];
      actual.setContentSize(preview.width, preview.height);
      await actual.loadFile(item.path);
      await editor.webContents.executeJavaScript(`(() => {
        document.getElementById('tab-${item.target}').click();
        const transfer = new DataTransfer(); transfer.items.add(new File([${JSON.stringify(JSON.stringify(item.document))}], 'sample.json', {type:'application/json'}));
        const input = document.querySelector('input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
      })()`);
      await settle();
      assert.match(await editor.webContents.executeJavaScript('document.querySelector(".editor-status").textContent'), /読み込みました/u);
      const expected = await actual.webContents.executeJavaScript(`(${metrics})(document)`);
      const result = await editor.webContents.executeJavaScript(`(${metrics})(document.querySelector('iframe').contentDocument)`);
      assert.deepEqual(result, expected, `${item.name}: geometry and computed styles must match`);
      assert.equal(await editor.webContents.executeJavaScript('!!window.__injected || !!document.querySelector("iframe").contentWindow.__injected'), false);
      assert.equal(await editor.webContents.executeJavaScript('document.querySelector("iframe").contentDocument.querySelector("script") !== null'), false);
      if (item.name === 'shadow') assert.match(await editor.webContents.executeJavaScript('document.querySelector(".editor-preview-warning").textContent'), /影・縁取りが切れる/u);
    }
    await editor.webContents.executeJavaScript(`(() => {
      const input = [...document.querySelectorAll('#panel-comments input[type=text]')].find(element => element.labels?.[0]?.textContent === '文字サイズ');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'201');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`); await settle();
    assert.equal(await editor.webContents.executeJavaScript('getComputedStyle(document.querySelector("iframe").contentDocument.querySelector("main")).fontSize'), '32px');
    assert.equal(requests.length, 0, 'network requests');
    if (process.env.CASMATE_STYLE_SCREENSHOT) {
      await writeFile(process.env.CASMATE_STYLE_SCREENSHOT, (await editor.webContents.capturePage()).toPNG());
    }
    console.log('PASS: standalone preview equals live overlay (7 cases), no network');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { editor.destroy(); actual.destroy(); app.quit(); }
});
