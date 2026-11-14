// Explicit, opt-in live acceptance check. Not executed by the normal test runner.
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const repo = process.argv[2], directory = process.argv[3], output = process.argv[4];
app.on('window-all-closed', () => undefined);
app.disableHardwareAcceleration(); app.setPath('userData', join(directory, 'profile'));
const require = createRequire(import.meta.url);
const { safeStorage } = require('electron');
const { PollController } = require(join(repo, 'dist-electron/main/poll/poll-controller.js'));
const { PollStore } = require(join(repo, 'dist-electron/main/poll/poll-store.js'));
const { PollPublicServer } = require(join(repo, 'dist-electron/main/poll/poll-public-server.js'));
const { PollPublication } = require(join(repo, 'dist-electron/main/poll/poll-publication.js'));
const { SrvUsTunnel } = require(join(repo, 'dist-electron/main/poll/srv-us-tunnel.js'));
const { configureSystemCa } = require(join(repo, 'dist-electron/main/system-ca.js'));
configureSystemCa(); app.whenReady().then(async () => {
const polls = new PollController(new PollStore(join(directory, 'polls.json')));
await polls.initialize();
const publication = new PollPublication(polls, new PollPublicServer(polls, join(repo, 'dist/listener-poll')), new SrvUsTunnel(join(directory, 'connection'), safeStorage));
const windows = [];
const wait = async (predicate, message, timeout = 15_000) => { const deadline = Date.now() + timeout; while (!await predicate()) { if (Date.now() > deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 75)); } };
const evaluate = (window, code) => window.webContents.executeJavaScript(code, true);
const browser = partition => { const window = new BrowserWindow({ show: false, width: 440, height: 850, useContentSize: true, webPreferences: { partition, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); windows.push(window); return window; };
let result = { passed: false };
try {
  await publication.start();
  await wait(() => { const status = publication.view(); if (status.status === 'error') throw new Error(status.message); return status.status === 'online'; }, 'Live endpoint never became online', 45_000);
  const url = publication.view().url;
  await polls.draft({ question: '次の配信で楽しみたいのは？', options: ['ゲーム', '雑談'], durationMinutes: 5 }); await polls.start();
  const a = browser('poll-live-a'), b = browser('poll-live-b');
  const errors = [];
  for (const window of [a,b]) window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await Promise.all([a.loadURL(url), b.loadURL(url)]);
  const ready = window => evaluate(window, "Boolean(document.querySelector('.poll-options button')) && !document.querySelector('.poll-options button').disabled");
  await wait(async () => await ready(a) && await ready(b), 'Listener controls did not become ready');
  await evaluate(a, "document.querySelectorAll('.poll-options button')[0].click()"); await wait(() => polls.view().current.counts[0] === 1, 'First vote was not accepted');
  await evaluate(b, "document.querySelectorAll('.poll-options button')[0].click()"); await wait(() => polls.view().current.counts[0] === 2, 'Second independent vote was not accepted');
  await wait(() => ready(a), 'A did not complete reconciliation');
  await evaluate(a, "document.querySelectorAll('.poll-options button')[1].click()"); await wait(() => polls.view().current.counts[1] === 1, 'Vote change was not accepted');
  const secondTab = browser('poll-live-a'); await secondTab.loadURL(url); await wait(() => ready(secondTab), 'Shared-cookie tab not ready');
  assert.equal(await evaluate(secondTab, "document.querySelectorAll('.poll-options button')[1].getAttribute('aria-pressed')"), 'true');
  for (const window of windows) assert.equal(await evaluate(window, "fetch('/api/state').then(r=>r.json()).then(s=>Object.hasOwn(s.state.poll,'counts'))"), false);
  await polls.reveal(true);
  await wait(async () => (await Promise.all(windows.map(window => evaluate(window, "document.querySelector('.poll-total').textContent")))).every(text => text === '合計 2票'), 'All browser results did not converge');
  assert.deepEqual(polls.view().current.counts, [1,1]);
  assert.equal(await evaluate(a, 'document.documentElement.scrollWidth>innerWidth'), false);
  await evaluate(a, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'srv-us-listener.png'), (await a.webContents.capturePage()).toPNG());
  await publication.stop(); assert.equal(polls.view().current.closeReason, 'publicationStopped');
  await publication.start(); await wait(() => publication.view().status === 'online', 'Republished endpoint not ready', 45_000);
  assert.equal(publication.view().url, url, 'Stored SSH identity should keep the public URL');
  await a.loadURL(url); await wait(() => evaluate(a, "document.querySelector('.poll-badge')?.textContent==='受付終了'"), 'Closed poll was not restored');
  await publication.stop();
  const persisted = JSON.parse(await readFile(join(directory, 'polls.json'), 'utf8'));
  assert.deepEqual(persisted.ballots, {}); assert.deepEqual(persisted.history[0].counts, [1,1]);
  assert.equal((await readdir(join(directory, 'connection'))).filter(name => name.startsWith('run-')).length, 0);
  assert.equal((await readFile(join(directory, 'connection/identity.encrypted'))).includes(Buffer.from('PRIVATE KEY')), false);
  assert.ok((await readFile(join(directory, 'connection/known_hosts'), 'utf8')).includes('srv.us'));
  assert.deepEqual(errors, []);
  result = { passed: true, independentVoters: 2, browserTabs: 3, counts: [1,1], hiddenResultsChecked: true, sharedCookieChecked: true, stableUrlChecked: true, anonymousRecordsRemoved: true, runtimeKeysRemoved: true, hostTrust: 'TOFU', date: new Date().toISOString() };
  console.log('PASS: real srv.us, two independent browser sessions, shared-cookie tab, vote change, visibility, stable URL and cleanup');
} catch (error) { result = { passed: false, error: String(error) }; console.error(error); }
finally {
  await publication.stop(); await polls.shutdown();
  for (const window of windows) window.destroy();
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2));
  app.exit(result.passed ? 0 : 1);
}

});
