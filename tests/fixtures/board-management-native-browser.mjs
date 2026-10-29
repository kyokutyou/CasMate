import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { verifyBoardManagement } from './board-management-checks.mjs';

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
  await until(() => evaluate('Boolean(window.boardManagementHarness)'), 'Dashboard fixture');
  const checks = await verifyBoardManagement({ evaluate, browser: true,
    resize: (width, height) => command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }),
    capture: process.argv[4] ? async name => {
      const captureDirectory = resolve(process.argv[4]);
      await mkdir(captureDirectory, { recursive: true });
      const { data } = await command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      await writeFile(join(captureDirectory, 'chrome-' + name), Buffer.from(data, 'base64'));
    } : undefined });
  assert.deepEqual(requests, [], 'zero HTTP(S) requests');
  assert.deepEqual(exceptions, [], 'zero runtime exceptions');
  const version = await command('Browser.getVersion', {}, null);
  console.log(`PASS: ${checks} board management native browser checks; ${version.product}; zero HTTP(S) requests`);
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
