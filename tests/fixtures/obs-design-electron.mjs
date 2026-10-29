import assert from 'node:assert/strict';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyObsDesign } from './obs-design-checks.mjs';

app.setPath('userData', join(process.argv[3], 'user-data'));
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
const directory = process.argv[3];
const server = createServer(async (request, response) => {
  const file = request.url.startsWith('/obs/design') ? 'index.html' : request.url.split('/').at(-1);
  try { response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html'); response.end(await readFile(join(directory, file))); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let editor;
try {
  const { createNativeObsDesignWindow } = await import(pathToFileURL(join(directory, 'window.mjs')).href);
  const { ObsDesignWindowController } = await import(pathToFileURL(join(directory, 'controller.mjs')).href);
  let saved;
  const controller = new ObsDesignWindowController({ create: target => {
    editor = createNativeObsDesignWindow({ baseUrl: `http://127.0.0.1:${server.address().port}`, bounds: { width: 1200, height: 820 }, preload: join(directory, 'preload.cjs') }, target);
    editor.webContents.setBackgroundThrottling(false);
    return editor;
  }, saveBounds: async bounds => { saved = bounds; } });
  ipcMain.on('casmate:obs-design-close-ready', event => { if (event.sender === editor.webContents) void controller.closeReady(); });
  ipcMain.on('casmate:obs-design-ready', event => { if (event.sender === editor.webContents) editor.notifyTarget(); });
  await controller.show('comments');
  const evaluate = async code => { try { return await editor.webContents.executeJavaScript(code); } catch (error) { throw new Error(`OBS design evaluation failed: ${code}`, {cause:error}); } };
  async function until(check) { const end = Date.now() + 10000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Timed out'); }
  await until(() => evaluate('!!window.designHarness && !!window.casmateObsDesign && !!document.querySelector("iframe")?.contentDocument?.querySelector("main")'));
  const capture = async name => { if (process.argv[4]) { await mkdir(process.argv[4], { recursive: true }); await writeFile(join(process.argv[4], name), (await editor.webContents.capturePage()).toPNG()); } };
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await capture('obs-design-compact-header.png');
  const count = await verifyObsDesign({ evaluate, resize: async (width, height) => { editor.setContentSize(width, height); }, capture,
    clickSpinner: async point => { editor.webContents.focus(); editor.webContents.sendInputEvent({type:'mouseMove',...point});editor.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});editor.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point}); },
    requestClose: async () => { editor.close();await new Promise(resolve=>setTimeout(resolve,100)); },
    resetCloseWarning: async () => { editor.notifyTarget();await new Promise(resolve=>setTimeout(resolve,100)); },
    pressKey: async key => { editor.webContents.focus(); editor.webContents.sendInputEvent({type:'keyDown',keyCode:key});editor.webContents.sendInputEvent({type:'char',keyCode:key==='Enter'?'\r':' '});editor.webContents.sendInputEvent({type:'keyUp',keyCode:key}); } });
  editor.minimize(); await controller.show('speech');
  await until(() => evaluate('document.getElementById("design-tab-speech").getAttribute("aria-selected")==="true"'));
  assert.equal(BrowserWindow.getAllWindows().length, 1); assert.equal(editor.isMinimized(), false);
  assert.deepEqual(editor.getMinimumSize(), [560, 520]);
  const speechSize = await evaluate(`document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) input[aria-label="文字サイズ"]')?.value ?? [...document.querySelectorAll('.design-editing-fields > [role=tabpanel]:not([hidden]) input')].find(e=>e.labels?.[0]?.textContent==='文字サイズ').value`);
  await evaluate(`(() => {const e=[...document.querySelectorAll('.design-editing-fields > [role=tabpanel]:not([hidden]) input')].find(e=>e.labels?.[0]?.textContent==='文字サイズ');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const beforeCloseMessage = await evaluate(`(()=>{const r=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .editor-layout').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
  editor.close(); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(editor.isVisible(), true); assert.match(await evaluate('document.querySelector(".design-close-status").textContent'), /未保存/u);
  assert.deepEqual(await evaluate(`(()=>{const r=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) .editor-layout').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`), beforeCloseMessage, 'close guard does not move the editor');
  await evaluate(`(() => {const e=document.querySelector('.design-editing-fields > [role=tabpanel]:not([hidden]) input[aria-invalid=true]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(speechSize)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  editor.maximize(); await new Promise(resolve => setTimeout(resolve, 100));
  const normal = editor.getNormalBounds(); editor.close();
  await until(async () => !editor.isVisible()); assert.equal(saved.maximized, true); assert.equal(saved.width, normal.width); assert.equal(saved.height, normal.height);
  await controller.show('comments'); assert.equal(editor.isVisible(), true);
  await controller.prepareForShutdown();
  editor = createNativeObsDesignWindow({ baseUrl: `http://127.0.0.1:${server.address().port}`, bounds: saved, preload: join(directory, 'preload.cjs') }, 'comments');
  editor.show();
  await until(async () => editor.isMaximized() && await evaluate('!!window.designHarness'));
  assert.ok(Math.abs(editor.getNormalBounds().width - normal.width) <= 1);
  assert.ok(Math.abs(editor.getNormalBounds().height - normal.height) <= 1);
  console.log(`PASS: ${count} OBS design layout and input checks; native singleton, preload, restore, close guard and normal bounds`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { editor?.destroy(); server.closeAllConnections(); server.close(); app.quit(); }
});
