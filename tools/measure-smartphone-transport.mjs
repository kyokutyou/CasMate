// Opt-in LAN fixture for SmartphoneTransportDeviceTest. Uses synthetic data only.
// node tools/measure-smartphone-transport.mjs baseline|current <PC LAN IPv4>
// Baseline build: tmp/transport-baseline/{dist,dist-electron}; current: pnpm build.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const [mode, address] = process.argv.slice(2);
if (!['baseline', 'current'].includes(mode) || !address) throw new Error('Specify baseline|current and a local LAN IPv4.');
const root = path.resolve(mode === 'baseline' ? 'tmp/transport-baseline' : '.');
const require = createRequire(import.meta.url);
const load = file => require(path.join(root, 'dist-electron', file));
const { MobilePublicationServerManager, privateIpv4Addresses } = load('main/server/mobile-lan-server.js');
if (!privateIpv4Addresses().includes(address)) throw new Error('Address must belong to this PC on a private LAN.');
const { AppState } = load('main/core/app-state.js');
const { createDefaultSettings } = load('main/core/settings.js');
const settings = createDefaultSettings();
settings.mobileSpeech.lanEnabled = true;
settings.commentSpeech.enabled = true;
settings.commentSpeech.voice = { speakerUuid: 'synthetic', styleId: 1 };
fs.mkdirSync('tmp/transport-measurements', { recursive: true });
const toneFile = path.resolve('tmp/transport-measurements/tone.m4a');
execFileSync(path.resolve('resources/ffmpeg/ffmpeg.exe'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'sine=frequency=440:duration=0.25', '-ac', '1', '-ar', '24000', '-c:a', 'aac', '-b:a', '32k', toneFile], { windowsHide: true });
const audio = fs.readFileSync(toneFile);
const focusToneFile = path.resolve('tmp/transport-measurements/focus-tone.m4a');
execFileSync(path.resolve('resources/ffmpeg/ffmpeg.exe'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'sine=frequency=440:duration=3', '-ac', '1', '-ar', '24000', '-c:a', 'aac', '-b:a', '32k', focusToneFile], { windowsHide: true });
const focusAudio = fs.readFileSync(focusToneFile);
const starts = new Map(); const samples = {}; const phases = {};
const connections = new Set(); const requests = {};
const totals = () => ({ requests: { ...requests }, receivedBytes: [...connections].reduce((sum, s) => sum + s.bytesRead, 0),
  sentBytes: [...connections].reduce((sum, s) => sum + s.bytesWritten, 0), sockets: connections.size });
const observe = server => {
  server.on('connection', socket => connections.add(socket));
  server.on('request', request => { const route = request.url.split('?')[0]; requests[route] = (requests[route] ?? 0) + 1; });
  server.on('upgrade', () => { requests.upgrade = (requests.upgrade ?? 0) + 1; });
};
let manager; let activeAudio;
const state = new AppState(settings, {
  speechSynthesizer: { prepare: async () => {}, listVoices: async () => [{ speakerUuid: 'synthetic', name: 'Synthetic', styles: [{ id: 1, name: 'Test' }] }], synthesize: async () => Buffer.alloc(1) },
  audioTranscoder: { available: () => true, transcode: async wav => wav[0] === 2 ? focusAudio : audio },
  onMobileAudioReady: (id, item) => { if (activeAudio) starts.set(activeAudio, performance.now()); manager.sendAudioReady(id, item); },
  onMobileAudioDiscard: (id, item) => manager.discardAudio?.(id, item),
});
if (mode === 'current') {
  const network = { address, commentsUrl: `http://${address}:13000/comments`, registrationReady: true,
    invitationRevision: 1, videoReady: false, obsReady: true, warning: null };
  state.setSmartphoneState({ available: true, settings: { activeNetwork: 'lan', statusPorts: { lan: 13001, tailscale: 13001 } },
    networks: { lan: network, tailscale: { ...network, address: null, commentsUrl: null, registrationReady: false, obsReady: false } },
    devices: [], warning: null });
}
await state.listSpeechVoices();
const comment = (id, text) => ({ externalId: String(id), source: 'twitch', authorName: 'Transport test',
  content: [{ type: 'text', text }], initialHistory: true });
for (let index = 0; index < 1000; index++) state.acceptComment(comment(`history-${index}`, `Synthetic history ${index}`));
manager = new MobilePublicationServerManager({ state, address, addresses: () => [address], port: 13000,
  staticDirectory: path.join(root, 'dist') });
const startMobile = async () => {
  await manager.start();
  if (!manager.servers.has(address)) throw new Error('Synthetic LAN listener did not start.');
  for (const entry of manager.servers.values()) observe(entry.http);
};
await startMobile();
const registration = JSON.parse(fs.readFileSync(mode === 'baseline' ? 'tests/fixtures/native-registration.json' : 'tests/fixtures/smartphone-registration-v12.json', 'utf8'));
delete registration.outdoor;
registration.comments.url = `http://${address}:13000/comments`;
const endpoint = { network: 'lan', address, port: 13001 };
if (mode === 'baseline') registration.obsControl.endpoints = [endpoint];
else {
  const { compatibilityPolicy } = load('shared/compatibility-policy.generated.js');
  registration.version = compatibilityPolicy.contracts.privateRegistration.current;
  registration.control = { protocolVersion: compatibilityPolicy.contracts.controlProtocol.current, url: `ws://${address}:13001/smartphone/ws` };
  registration.speechRecognition = { registrationId: '88888888-8888-4888-8888-888888888888', revision: 1, token: '8'.repeat(64) };
  registration.preparation.video = 'preparing';
}
let obsState = { enabled: true, androidEnabled: true, epoch: 'transport-benchmark', revision: 1,
  connection: 'connected', stream: 'stopped', busy: false, lastOperation: null };
const obs = { view: () => obsState, cancelAndroid: () => {}, prepareAndroid: () => { throw new Error('Not available in benchmark'); } };
let control; let closeControl = () => {};
if (mode === 'baseline') {
  const { createObsControlHttpApplication } = load('main/server/obs-control-server.js');
  control = http.createServer(createObsControlHttpApplication({ controller: obs, endpoint,
    authenticate: value => value === `Bearer ${registration.obsControl.token}` ? registration.obsControl : null }));
} else {
  const { attachSmartphoneControlServer } = load('main/smartphone/smartphone-control-session.js');
  control = http.createServer((_request, response) => { response.writeHead(404).end(); });
  const bearer = value => value && `Bearer ${value.token}`;
  closeControl = attachSmartphoneControlServer(control, { state, obs, network: 'lan', address, port: 13001,
    controller: { authenticateControl: (network, obsToken, videoToken, updateToken, speechToken, protocolVersion) => {
      if (network !== 'lan' || ![2, 3].includes(protocolVersion) || updateToken !== bearer(registration.registrationUpdate) || videoToken !== undefined ||
        (obsToken !== undefined && obsToken !== bearer(registration.obsControl)) ||
        (speechToken !== undefined && (protocolVersion !== 3 || speechToken !== bearer(registration.speechRecognition)))) return null;
      return { deviceId: registration.deviceId, protocolVersion, video: false,
        obs: obsToken === undefined ? null : registration.obsControl, update: registration.registrationUpdate,
        speechRecognition: speechToken === undefined ? null : registration.speechRecognition };
    },
      registrationTokenCurrent: (network, token) => network === 'lan' && token === bearer(registration.registrationUpdate),
      registrationUpdateCurrent: (deviceId, network, credential) => deviceId === registration.deviceId && network === 'lan' &&
        credential.registrationId === registration.registrationUpdate.registrationId && credential.revision === registration.registrationUpdate.revision,
      updatedRegistration: (_deviceId, _network, _credential, protocolVersion) => {
        if (protocolVersion === 3) return registration;
        const legacy = { ...registration }; delete legacy.speechRecognition;
        return { ...legacy, version: 12, control: { ...legacy.control, protocolVersion: 2 } };
      },
      touchReport: () => {}, releaseReport: () => {}, feedback: () => null, acceptReport: () => false } });
}
observe(control);
await new Promise(resolve => control.listen(13001, address, resolve));
let phase; let phaseStart; let phaseTotals;
function finishPhase() {
  if (!phase) return;
  const after = totals();
  phases[phase] = { elapsedMs: performance.now() - phaseStart, receivedBytes: after.receivedBytes - phaseTotals.receivedBytes,
    sentBytes: after.sentBytes - phaseTotals.sentBytes, sockets: after.sockets - phaseTotals.sockets,
    requests: Object.fromEntries(Object.entries(after.requests).map(([key, value]) => [key, value - (phaseTotals.requests[key] ?? 0)]).filter(([, count]) => count)) };
  console.log(`Completed ${mode} ${phase}`);
}
const helper = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(request.url, 'http://fixture'); const kind = url.searchParams.get('kind'); const id = url.searchParams.get('id');
    const key = `${kind}:${id}`;
    if (url.pathname === '/registration') { response.end(JSON.stringify(registration)); return; }
    if (url.pathname === '/audio-state') {
      const value = state.mobileSpeech.snapshot();
      response.end(JSON.stringify({ clientCount: value.clientCount, queueLength: value.queueLength })); return;
    }
    if (url.pathname === '/phase') { finishPhase(); phase = url.searchParams.get('name'); phaseStart = performance.now(); phaseTotals = totals(); }
    else if (url.pathname === '/step') {
      starts.set(key, performance.now());
      if (kind === 'comments') { const marker = `transport-marker-${id}`; state.acceptComment(comment(`live-${id}`, marker)); response.end(JSON.stringify({ marker })); return; }
      if (kind === 'obs') { obsState = { ...obsState, revision: obsState.revision + 1, stream: obsState.stream === 'stopped' ? 'streaming' : 'stopped' };
        state.setObsControlState(obsState); response.end(JSON.stringify({ revision: obsState.revision })); return; }
      if (['audio', 'locked', 'background', 'focus'].includes(kind)) { activeAudio = key; const receiver = state.mobileSpeech.createPreviewReceiver();
        if (!receiver) throw new Error('Native audio subscription absent'); receiver(Buffer.from([kind === 'focus' ? 2 : 0])); }
      if (kind === 'missed') { state.mobileSpeech.acceptSystemAnnouncement(`missed-${id}`, 'Synthetic focus-loss announcement'); await state.mobileSpeech.whenSettled(); }
      if (kind === 'reconnect') { await manager.stop(); setTimeout(() => void startMobile(), 600); }
    } else if (url.pathname === '/ack') {
      const start = starts.get(key); if (start === undefined) throw new Error('No matching observation');
      (samples[kind] ??= []).push(performance.now() - start); starts.delete(key);
    } else if (url.pathname === '/finish') {
      finishPhase(); phase = null;
      const summaries = Object.fromEntries(Object.entries(samples).map(([key, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return [key, { count: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) }];
      }));
      fs.writeFileSync(`tmp/transport-measurements/${mode}.json`, JSON.stringify({ mode, history: 1000, toneBytes: audio.length, phases, totals: totals(), summaries, samples }, null, 2));
      console.log(JSON.stringify(summaries));
    } else { response.writeHead(404).end('{}'); return; }
    response.end('{}');
  } catch (error) { console.error(error.message); response.writeHead(500).end('{"error":"fixture-failed"}'); }
});
await new Promise(resolve => helper.listen(13002, address, resolve));
console.log(`Synthetic ${mode} fixture ready on ${address}:13000–13002; credentials omitted.`);
async function stop() { closeControl(); await manager.stop(); await state.shutdown(); control.close(); helper.close(); }
process.once('SIGINT', () => void stop().then(() => process.exit(0)));
