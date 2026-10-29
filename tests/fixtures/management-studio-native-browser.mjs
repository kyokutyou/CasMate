import { verifyCommentSpeechGuidance } from './comment-speech-guidance-checks.mjs';
import { verifyUiClarity } from './ui-clarity-checks.mjs';
import { verifyCommentSourceSave } from './comment-source-save-checks.mjs';
import { verifyCompactFeedback } from './compact-feedback-checks.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { verifyManagementStudio } from './management-studio-checks.mjs';
import { verifyManagementCommentScroll } from './management-comment-scroll-checks.mjs';
import { verifyObsRegistrationStatus } from './obs-registration-status-checks.mjs';
import { verifyObsSourceCards } from './obs-source-cards-checks.mjs';
import { verifySmartphoneHub } from './smartphone-browser-checks.mjs';
import { verifyApplicationSettings } from './application-settings-checks.mjs';
import { verifyCommentFilter } from './comment-filter-checks.mjs';
import { verifyAiSettings } from './ai-settings-checks.mjs';
import { verifySpeechRecognitionApply } from './speech-recognition-apply-checks.mjs';
import { verifyManagementLive } from './management-live-checks.mjs';
import { verifyManagementPageHeadings } from './management-page-heading-checks.mjs';
import { verifyManagementEditorIntros } from './management-editor-intro-checks.mjs';
import { verifyInitialSetupObs } from './initial-setup-obs-checks.mjs';
import { verifyInitialSetupEntry } from './initial-setup-entry-checks.mjs';
import { verifyInitialSetupFlow } from './initial-setup-flow-checks.mjs';
import { verifyInitialSetupCreative } from './initial-setup-creative-checks.mjs';
import { verifyInitialSetupDevices } from './initial-setup-device-checks.mjs';
import { verifyObsDesign } from './obs-design-checks.mjs';

const directory = await mkdtemp(join(tmpdir(), 'casmate-board-native-'));
const profile = join(directory, 'profile');
const browser = spawn(resolve(process.argv[2]), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-sync', '--disable-extensions', '--disable-component-update',
  '--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication', 'about:blank',
], { cwd: directory, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let spawnError;
browser.on('error', error => { spawnError = error; });
browser.stderr.resume();
let socket;
let session;
let id = 0;
const pending = new Map();
const requests = [];
const exceptions = [];
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (spawnError) throw spawnError; if (await check()) return; await delay(100); }
  throw new Error('Timed out: ' + label);
}
function command(method, params = {}, sessionId = session) {
  const requestId = ++id;
  return new Promise((resolveCommand, rejectCommand) => {
    const timer = setTimeout(() => { pending.delete(requestId); rejectCommand(new Error('CDP timed out: ' + method)); }, 15000);
    pending.set(requestId, { resolve: resolveCommand, reject: rejectCommand, timer });
    socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const settle = () => evaluate(`new Promise((resolve,reject) => {
  const timer=setTimeout(() => reject(new Error('Native browser did not render two frames')),3000);
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
})`);
const resize = async (width, height) => {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await settle();
  assert.deepEqual(await evaluate('({ width:innerWidth, height:innerHeight })'), { width, height }, 'native browser viewport applied');
};
try {
  let port;
  await until(async () => { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); return true; } catch { return false; } }, 'native browser debugger');
  socket = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);
  await new Promise((resolveOpen, rejectOpen) => { socket.once('open', resolveOpen); socket.once('error', rejectOpen); });
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    const request = pending.get(message.id);
    if (request) { clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); }
    if (message.sessionId === session && message.method === 'Network.requestWillBeSent' && /^https?:/i.test(message.params.request.url)) requests.push(message.params.request.url);
    if (message.sessionId === session && message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId: session } = await command('Target.attachToTarget', { targetId, flatten: true }, null));
  await Promise.all([command('Page.enable'), command('Runtime.enable'), command('Network.enable')]);
  await command('Page.navigate', { url: pathToFileURL(resolve(process.argv[3])).href });
  if (process.argv.includes('--startup-error-only')) {
    const { verifyStartupError } = await import('./startup-error-checks.mjs');
    const checks = await verifyStartupError({ evaluate, resize, capture: async name => { const directory = resolve(process.argv[4]); await mkdir(directory, { recursive: true }); const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(directory, 'chrome-' + name), Buffer.from(data, 'base64')); } });
    assert.deepEqual(requests, []); assert.deepEqual(exceptions, []);
    console.log(`PASS: ${checks} startup error scenarios; zero HTTP(S) requests`);
  } else if (process.argv.includes('--ui-clarity-only')) {
    const checks=await verifyUiClarity({evaluate,resize,capture:async name=>{const directory=resolve(process.argv[4]);await mkdir(directory,{recursive:true});const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(directory,'chrome-'+name),Buffer.from(data,'base64'));}});
    assert.deepEqual(requests,[]);assert.deepEqual(exceptions,[]);
    console.log(`PASS: ${checks} UI clarity scenarios; zero HTTP(S) requests`);
  } else if (process.argv.includes('--initial-setup-flow-only')) {
    await until(()=>evaluate('Boolean(window.boardManagementHarness)'),'initial setup flow fixture');
    await verifyInitialSetupFlow({evaluate,resize,press:async (name,shift=false)=>{const key=name==='Space'?' ':name,code=name==='Space'?'Space':name,keyCode={Tab:9,Enter:13,Space:32}[name];await command('Input.dispatchKeyEvent',{type:name==='Tab'?'rawKeyDown':'keyDown',key,code,text:name==='Enter'?'\r':name==='Space'?' ':undefined,windowsVirtualKeyCode:keyCode,modifiers:shift?8:0});await command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode,modifiers:shift?8:0});},capture:async name=>{const directory=resolve(process.argv[4]);await mkdir(directory,{recursive:true});const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(directory,'chrome-'+name),Buffer.from(data,'base64'));}});assert.deepEqual(requests,[]);assert.deepEqual(exceptions,[]);
    console.log('PASS: initial setup complete flow');
  } else if (process.argv.includes('--initial-setup-creative-only')) {
    await until(() => evaluate('Boolean(window.boardManagementHarness)'), 'initial setup creative fixture');
    const checks = await verifyInitialSetupCreative({ evaluate, resize, capture: async name => { const directory=resolve(process.argv[4]);await mkdir(directory,{recursive:true});const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(directory,'chrome-'+name),Buffer.from(data,'base64')); } });
    assert.deepEqual(requests, []); assert.deepEqual(exceptions, []);
    console.log(`PASS: ${checks} initial setup creative browser checks; zero HTTP(S) requests`);
  } else if (process.argv.includes('--initial-setup-devices-only')) {
    await until(() => evaluate('Boolean(window.boardManagementHarness)'), 'initial setup device fixture');
    const checks = await verifyInitialSetupDevices({ evaluate, resize, capture: async name => { const directory=resolve(process.argv[4]);await mkdir(directory,{recursive:true});const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(directory,'chrome-'+name),Buffer.from(data,'base64')); } });
    assert.deepEqual(requests, []); assert.deepEqual(exceptions, []);
    console.log(`PASS: ${checks} initial setup device browser checks; zero HTTP(S) requests`);
  } else if (process.argv.includes('--comment-filter-only')) {
    await until(() => evaluate('Boolean(window.boardManagementHarness)'), 'filter fixture');
    const count=await verifyCommentFilter({evaluate,resize,settle,pressKey:async key=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'char',text:'\r',unmodifiedText:'\r',key,windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:13});},capture:async name=>{const directory=resolve(process.argv[4]);await mkdir(directory,{recursive:true});const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(directory,'chrome-'+name),Buffer.from(data,'base64'));}});
    assert.deepEqual(requests,[]);assert.deepEqual(exceptions,[]);console.log(`PASS: ${count} comment filter checks`);
  } else if (process.argv.includes('--application-settings-only')) {
    await until(() => evaluate('Boolean(window.boardManagementHarness)'), 'application fixture');
    const count=await verifyApplicationSettings({evaluate,resize,settle,pressKey:async key=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'char',text:'\r',unmodifiedText:'\r',key,windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:13});},capture:async name=>{const directory=resolve(process.argv[4]);await mkdir(directory,{recursive:true});const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(directory,'chrome-'+name),Buffer.from(data,'base64'));}});
    assert.deepEqual(requests,[]);assert.deepEqual(exceptions,[]);console.log(`PASS: ${count} application settings checks`);
  } else if (process.argv.includes('--smartphone-hub-only')) {
    await until(() => evaluate('Boolean(window.smartphoneHarness)'), 'smartphone fixture');
    const checks = await verifySmartphoneHub({evaluate,resize,settle,
      capture: async name => { const directory=resolve(process.argv[4]);await mkdir(directory,{recursive:true});const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(directory,'chrome-'+name),Buffer.from(data,'base64')); }});
    assert.deepEqual(requests,[]);assert.deepEqual(exceptions,[]);
    console.log(`PASS: ${checks} smartphone hub browser checks; zero HTTP(S) requests`);
  } else if (process.argv.includes('--source-cards-only')) {
    await until(() => evaluate('Boolean(window.obsRegistrationHarness)'), 'OBS source cards fixture');
    const checks = await verifyObsSourceCards({ evaluate, resize,
      capture: async name => { const directory = resolve(process.argv[4]); await mkdir(directory, { recursive: true }); const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(directory, 'chrome-' + name), Buffer.from(data, 'base64')); } });
    assert.deepEqual(requests, []); assert.deepEqual(exceptions, []);
    console.log(`PASS: ${checks} OBS source cards checks; zero HTTP(S) requests`);
  } else if (process.argv.includes('--obs-design-only')) {
    await until(() => evaluate('Boolean(window.designHarness)'), 'OBS design fixture');
    const count = await verifyObsDesign({ evaluate, resize,
      clickSpinner: async point => { await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point}); },
      capture: process.argv[4] ? async name => { const directory = resolve(process.argv[4]); await mkdir(directory, { recursive: true }); const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(directory, 'chrome-' + name), Buffer.from(data, 'base64')); } : undefined });
    assert.deepEqual(requests, []); assert.deepEqual(exceptions, []);
    console.log(`PASS: ${count} OBS design native browser checks; zero HTTP(S) requests`);
  } else if (process.argv.includes('--compact-feedback-only')) {
    await until(() => evaluate('Boolean(window.boardManagementHarness)'), 'Dashboard fixture');
    const count = await verifyCompactFeedback({ evaluate,
      resize, settle,
      capture: async name => { const directory = resolve(process.argv[4]); await mkdir(directory, { recursive: true }); const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(directory, 'chrome-' + name), Buffer.from(data, 'base64')); },
    });
    assert.deepEqual(requests, []); assert.deepEqual(exceptions, []);
    console.log(`PASS: compact feedback ${count} layouts; zero HTTP(S) requests`);
  } else if (process.argv.includes('--source-save-only')) {
    await until(() => evaluate('Boolean(window.boardManagementHarness)'), 'Dashboard fixture');
    const count = await verifyCommentSourceSave({ evaluate,
      resize, settle,
      capture: async name => { const directory = resolve(process.argv[4]); await mkdir(directory, { recursive: true }); const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(directory, 'chrome-' + name), Buffer.from(data, 'base64')); },
    });
    assert.deepEqual(requests, []); assert.deepEqual(exceptions, []);
    console.log(`PASS: ${count} comment source save checks; zero HTTP(S) requests`);
  } else {
  const registrationOnly = process.argv.includes('--registration-status-only');
  const initialSetupOnly = process.argv.includes('--initial-setup-obs-only');
  await until(() => evaluate(registrationOnly ? 'Boolean(window.obsRegistrationHarness)' : 'Boolean(window.boardManagementHarness)'), 'Dashboard fixture');
  if (initialSetupOnly) await verifyInitialSetupEntry({ evaluate, resize, capture: process.argv[4] ? async name => {
    const { data } = await command('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
    await writeFile(join(resolve(process.argv[4]),'chrome-'+name),Buffer.from(data,'base64'));
  } : undefined });
  const aiOnly = process.argv.includes('--ai-settings-only');
  const recognitionOnly = process.argv.includes('--recognition-apply-only');
  const liveOnly = process.argv.includes('--live-only');
  const speechOnly = process.argv.includes('--comment-speech-only');
  const introsOnly = process.argv.includes('--editor-intros-only');
  const headingsOnly = process.argv.includes('--page-headings-only');
  const checks = initialSetupOnly || speechOnly || registrationOnly || aiOnly || recognitionOnly || liveOnly || headingsOnly || introsOnly ? await (initialSetupOnly ? verifyInitialSetupObs : speechOnly ? verifyCommentSpeechGuidance : introsOnly ? verifyManagementEditorIntros : headingsOnly ? verifyManagementPageHeadings : liveOnly ? verifyManagementLive : recognitionOnly ? verifySpeechRecognitionApply : aiOnly ? verifyAiSettings : verifyObsRegistrationStatus)({ evaluate,
    pressKey: async (key, shift = false) => { for (const type of ['keyDown','keyUp']) await command('Input.dispatchKeyEvent', { type, key, code:key, windowsVirtualKeyCode:({ Tab:9, Enter:13, Escape:27 })[key] ?? 0, ...(key === 'Enter' && type === 'keyDown' ? { text:'\r' } : {}), modifiers:shift ? 8 : 0 }); },
    resize, settle,
    capture: process.argv[4] ? async name => {
      const captureDirectory = resolve(process.argv[4]); await mkdir(captureDirectory, { recursive: true });
      const { data } = await command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      await writeFile(join(captureDirectory, 'chrome-' + name), Buffer.from(data, 'base64'));
    } : undefined,
  }) : process.argv.includes('--comment-scroll-only') ? await verifyManagementCommentScroll({ evaluate,
    resize, settle,
    wheel: (x, y, deltaY) => command('Input.dispatchMouseEvent', { type:'mouseWheel',x,y,deltaY,deltaX:0 }),
  }) : await verifyManagementStudio({ evaluate, browser: true,
    pressRight: async () => {
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    },
    resize, settle,
    capture: process.argv[4] ? async name => {
      const captureDirectory = resolve(process.argv[4]);
      await mkdir(captureDirectory, { recursive: true });
      const { data } = await command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      await writeFile(join(captureDirectory, 'chrome-' + name), Buffer.from(data, 'base64'));
    } : undefined });
  assert.deepEqual(requests, [], 'zero HTTP(S) requests');
  assert.deepEqual(exceptions, [], 'zero runtime exceptions');
  const version = await command('Browser.getVersion', {}, null);
  console.log(`PASS: ${checks} ${speechOnly ? 'comment speech guidance' : headingsOnly ? 'page heading' : liveOnly ? 'live workspace' : recognitionOnly ? 'recognition apply' : aiOnly ? 'AI settings' : registrationOnly ? 'OBS registration status' : process.argv.includes('--comment-scroll-only') ? 'comment wheel scroll' : 'studio native browser'} checks; ${version.product}; zero HTTP(S) requests`);
  }
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await command('Browser.close', {}, null); } catch { /* Closing can precede the reply. */ } }
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP closing')); }
  pending.clear(); socket?.close();
  if (browser.exitCode === null) browser.kill();
  await Promise.race([new Promise(resolveExit => browser.once('exit', resolveExit)), delay(3000)]);
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('casmate-board-native-')) {
    console.error('Unexpected browser fixture directory'); process.exitCode = 1;
  } else await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
