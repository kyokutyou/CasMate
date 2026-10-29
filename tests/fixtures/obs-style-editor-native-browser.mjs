import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

// A real Chrome/Edge process, isolated from every normal browser profile.
// Usage: node this-file.mjs <browser.exe> <standalone.html> [wide.png] [narrow.png]
const browserPath = resolve(process.argv[2]);
const htmlPath = resolve(process.argv[3]);
const directory = await mkdtemp(join(tmpdir(), 'casmate-obs-style-native-'));
const profile = join(directory, 'profile');
const downloads = join(directory, 'downloads');
await mkdir(downloads);
const browser = spawn(browserPath, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-sync', '--disable-extensions', '--disable-component-update',
  '--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication',
  '--window-size=1280,900', 'about:blank',
], { cwd: directory, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserErrors = '';
browser.stderr.setEncoding('utf8');
browser.stderr.on('data', (chunk) => { browserErrors = (browserErrors + chunk).slice(-6000); });
let spawnError;
browser.on('error', (error) => { spawnError = error; });
let socket;
let nextId = 1;
const pending = new Map();
const requests = [];
const exceptions = [];
let session;

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
async function until(check, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
function command(method, params = {}, sessionId = session) {
  const id = nextId++;
  return new Promise((resolveCommand, rejectCommand) => {
    const timer = setTimeout(() => { pending.delete(id); rejectCommand(new Error(`CDP timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function settle() {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
const invoke = (method, ...args) => evaluate(`globalThis.__obsNative.${method}(${args.map((argument) => JSON.stringify(argument)).join(',')})`);
async function upload(path) {
  const { root } = await command('DOM.getDocument');
  const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });
  await command('DOM.setFileInputFiles', { nodeId, files: [path] });
  await until(() => evaluate('document.querySelector(".editor-status").dataset.kind !== "busy"'), 'settings read');
  await settle();
}
async function waitDownload(filename) {
  await until(async () => (await readdir(downloads)).includes(filename), filename);
  return readFile(join(downloads, filename), 'utf8');
}
async function screenshot(path, width, height) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await settle();
  assert.equal((await invoke('metrics')).overflow, false, `default ${width}px layout has no horizontal overflow`);
  assert.equal(await evaluate(`(() => {
    const groups = document.querySelectorAll('.output-purpose');
    return groups.length === 2 && [...document.querySelectorAll('.output-buttons button')].every(button => {
      const range = document.createRange(); range.selectNodeContents(button);
      const text = range.getBoundingClientRect(), box = button.getBoundingClientRect();
      return text.left >= box.left && text.right <= box.right && text.top >= box.top && text.bottom <= box.bottom;
    });
  })()`), true, `${width}px output groups and button labels fit`);
  if (path) {
    const outputPath = resolve(path);
    await mkdir(dirname(outputPath), { recursive: true });
    const { data } = await command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    await writeFile(outputPath, Buffer.from(data, 'base64'));
  }
}

try {
  let debugLines;
  await until(async () => {
    try { debugLines = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); return true; } catch { return false; }
  }, 'native browser debugger');
  socket = new WebSocket(`ws://127.0.0.1:${debugLines[0]}${debugLines[1]}`);
  await new Promise((resolveOpen, rejectOpen) => { socket.once('open', resolveOpen); socket.once('error', rejectOpen); });
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.id) {
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timer); pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
      }
    }
    if (message.sessionId === session && message.method === 'Network.requestWillBeSent' && /^https?:/i.test(message.params.request.url)) requests.push(message.params.request.url);
    if (message.sessionId === session && message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId: session } = await command('Target.attachToTarget', { targetId, flatten: true }, null));
  await Promise.all([command('Page.enable'), command('Runtime.enable'), command('Network.enable')]);
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true }, null);
  await command('Page.navigate', { url: pathToFileURL(htmlPath).href });
  await until(() => evaluate('Boolean(document.querySelector("iframe")?.contentDocument?.querySelector(".overlay-comments"))'), 'file:// editor and iframe');
  await evaluate(`(${function installHelpers() {
    function visible(element) { return !element.closest('[hidden]'); }
    function control(label) {
      const labels = [...document.querySelectorAll('label')].filter(visible);
      const linked = labels.find((element) => element.htmlFor && element.textContent.trim() === label);
      if (linked) return document.getElementById(linked.htmlFor);
      const nested = labels.find((element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() === label));
      const input = nested?.querySelector('input, textarea, select');
      if (!input) throw new Error(`Missing control: ${label}`);
      return input;
    }
    function button(name) {
      const element = [...document.querySelectorAll('button')].filter(visible).find((item) => item.getAttribute('aria-label') === name || item.textContent.trim().startsWith(name));
      if (!element) throw new Error(`Missing button: ${name}`);
      element.click();
    }
    function value(label, text) {
      const element = control(label);
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function metrics() {
      const frame = document.querySelector('iframe');
      const doc = frame.contentDocument;
      const main = doc.querySelector('main');
      const card = doc.querySelector('.overlay-comment, .speech-recognition-overlay-text');
      return {
        font: doc.defaultView.getComputedStyle(main).fontSize,
        background: doc.defaultView.getComputedStyle(card).backgroundColor,
        text: main.textContent, comments: doc.querySelectorAll('.overlay-comment').length,
        status: document.querySelector('.editor-status').textContent,
        statusKind: document.querySelector('.editor-status').dataset.kind,
        css: document.querySelector('textarea[aria-label="生成されたOBS用CSS"]').value,
        scripts: doc.querySelectorAll('script').length,
        externalImages: [...doc.querySelectorAll('img')].filter((image) => !image.src.startsWith('data:')).length,
        executed: Boolean(globalThis.__obsAttack || doc.defaultView.__obsAttack),
        overflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      };
    }
    globalThis.__obsNative = { control, button, value, metrics };
  }.toString()})()`);
  const browserVersion = await command('Browser.getVersion', {}, null);
  const initial = await invoke('metrics');
  assert.equal(initial.font, '32px');
  assert.equal(initial.comments, 3);
  await screenshot(process.argv[4], 1440, 1000);
  await screenshot(process.argv[5], 320, 1000);
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await settle();
  await invoke('value', '文字サイズ', '55'); await settle();
  assert.equal((await invoke('metrics')).font, '55px');
  await evaluate('document.querySelector("#panel-comments input[type=range]").focus()');
  for (let index = 0; index < 3; index++) await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, autoRepeat: index > 0 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await settle();
  assert.equal((await invoke('metrics')).font, '58px');
  await invoke('button', '取り消し'); await settle();
  assert.equal((await invoke('metrics')).font, '55px', 'slider keyboard gesture is one undo');
  await invoke('button', 'やり直し'); await settle();
  assert.equal((await invoke('metrics')).font, '58px');
  await invoke('button', '取り消し'); await settle();
  await invoke('value', '文字サイズ', ''); await settle();
  assert.equal((await invoke('metrics')).font, '55px', 'empty numeric draft preserves design');
  assert.equal(await evaluate('globalThis.__obsNative.control("文字サイズ").value'), '');
  await invoke('button', '明るいカード'); await settle();
  assert.equal((await invoke('metrics')).background, 'rgba(255, 255, 255, 0.95)');
  await invoke('button', '取り消し'); await settle();
  assert.equal((await invoke('metrics')).font, '55px');
  await evaluate('document.getElementById("tab-speech").click()'); await settle();
  assert.equal((await invoke('metrics')).font, '40px');
  await invoke('value', '文字サイズ', '60'); await settle();
  await evaluate('document.getElementById("tab-comments").click()'); await settle();
  assert.equal((await invoke('metrics')).font, '55px', 'tab designs retained');
  await invoke('button', 'OBS用CSSを保存');
  const savedCss = await waitDownload('casmate-comments.css');
  assert.ok(savedCss.includes('--cm-size: 55px;'));
  await invoke('button', '再編集用設定を保存');
  const saved = JSON.parse(await waitDownload('casmate-obs-style-settings.json'));
  assert.equal(saved.designs.comments.fontSize, 55);
  assert.equal(saved.designs.speech.fontSize, 60);
  const imported = structuredClone(saved);
  imported.designs.comments.fontSize = 72;
  imported.designs.speech.fontSize = 77;
  imported.designs.comments.fontFamily = 'name"; } body { background: url(https://example.invalid/font) } /*\\\n</style><script>window.__obsAttack=1</script> $& $` $\'';
  imported.previews.comments.text = '</style><script>window.__obsAttack=1</script><img src="https://example.invalid/image">\n引用符 " と改行';
  imported.previews.comments.author = '</strong><script>window.__obsAttack=1</script>';
  const importedPath = join(directory, 'imported.json');
  await writeFile(importedPath, JSON.stringify(imported));
  await upload(importedPath);
  const hostile = await invoke('metrics');
  assert.equal(hostile.font, '72px');
  assert.ok(hostile.text.includes(imported.previews.comments.text));
  assert.equal(hostile.scripts, 0); assert.equal(hostile.externalImages, 0); assert.equal(hostile.executed, false);
  assert.ok(hostile.css.includes('\\3c /style\\3e '));
  await evaluate('document.getElementById("tab-speech").click()'); await settle();
  assert.equal((await invoke('metrics')).font, '77px');
  await evaluate('document.getElementById("tab-comments").click()'); await settle();
  await invoke('button', '取り消し'); await settle();
  assert.equal((await invoke('metrics')).font, '55px', 'whole settings load is one undo');
  await invoke('button', 'やり直し'); await settle();
  assert.equal((await invoke('metrics')).font, '72px');
  const invalidPath = join(directory, 'invalid.json');
  await writeFile(invalidPath, JSON.stringify({ ...saved, formatVersion: 2 }));
  const buttonPosition = () => evaluate('JSON.stringify(document.querySelector(".output-buttons").getBoundingClientRect().toJSON())');
  const beforeRead = await buttonPosition();
  await upload(invalidPath);
  assert.equal((await invoke('metrics')).font, '72px', 'unsupported settings preserve design');
  assert.equal((await invoke('metrics')).statusKind, 'error');
  assert.equal(await buttonPosition(), beforeRead, 'read result preserves toolbar location');
  const beforeCopy = await buttonPosition();
  await invoke('button', 'OBS用CSSをコピー');
  await until(async () => { const result = await invoke('metrics'); return result.status.includes('コピーしました') || result.status.includes('コピーできません'); }, 'clipboard result');
  assert.equal(await buttonPosition(), beforeCopy, 'copy result preserves toolbar location');
  const copy = await invoke('metrics');
  if (copy.status.includes('コピーできません')) {
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".manual-copy-content")).visibility'), 'visible');
    await invoke('button', 'CSSをすべて選択');
    assert.equal(await evaluate('document.activeElement.selectionEnd - document.activeElement.selectionStart'), copy.css.length);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false });
  await settle();
  assert.equal((await invoke('metrics')).overflow, false, '320px layout has no horizontal overflow');
  await delay(200);
  assert.deepEqual(requests, [], 'app and imported samples make zero HTTP(S) requests');
  assert.deepEqual(exceptions, [], 'no runtime exceptions');
  console.log(JSON.stringify({ result: 'PASS', browser: basename(browserPath), version: browserVersion.product, file: htmlPath,
    checks: ['iframe', 'numeric-draft', 'slider-undo-redo', 'presets', 'tabs', 'CSS-download', 'JSON-download-upload', 'atomic-invalid-load', 'clipboard-or-fallback', '320px-layout', 'hostile-font-text', 'zero-network'],
    clipboard: copy.status.includes('コピーしました') ? 'success' : 'manual-fallback', httpRequests: requests.length }));
} catch (error) {
  console.error(error);
  if (browserErrors) console.error(browserErrors);
  process.exitCode = 1;
} finally {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP closing')); }
  pending.clear();
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command('Browser.close', {}, null); } catch { /* The browser closes before answering on some versions. */ }
  }
  socket?.close();
  if (browser.exitCode === null) browser.kill();
  await Promise.race([new Promise((resolveExit) => browser.once('exit', resolveExit)), delay(3000)]);
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-obs-style-native-')) {
    console.error('Unexpected native-browser fixture directory'); process.exitCode = 1;
  } else await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
