import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Synthetic testsrc/sine only; no cameras, microphones, credentials, or user media are read.
const ip = Object.values(networkInterfaces()).flat().find(n => n?.family === 'IPv4' &&
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(n.address))?.address;
assert.ok(ip, 'A private LAN interface is required for native receiver integration');
const workerPath = resolve('resources/outdoor-worker/casmate-outdoor-worker.exe');
const ffmpeg = resolve('resources/ffmpeg/ffmpeg.exe');
const key = 'a'.repeat(32);
const session = '12345678-1234-4234-8234-123456789abc';
const children = new Set(); const sockets = new Set();
function child(executable, args) {
  const process = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(process); process.diagnostics = '';
  process.stderr.on('data', data => { process.diagnostics = (process.diagnostics + data.toString()).slice(-4096); });
  process.done = new Promise((resolve, reject) => { process.once('error', reject); process.once('exit', code => { children.delete(process); resolve(code); }); });
  return process;
}
async function port(address) {
  const socket = createSocket('udp4'); await new Promise(resolve => socket.bind(0, address, resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
async function until(test, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!test()) { assert.ok(Date.now() < end, message); await delay(25); }
}
async function receiver() {
  const ingress = await port(ip), output = await port('127.0.0.1');
  const process = child(workerPath, []); let buffer = ''; const samples = [];
  process.stdout.setEncoding('utf8'); process.stdout.on('data', data => {
    buffer += data; let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) { samples.push(JSON.parse(buffer.slice(0, boundary))); buffer = buffer.slice(boundary + 1); }
  });
  process.stdin.write(`1\t${ip}\t${ingress}\t${output}\t${key}\n`);
  await until(() => samples.some(s => s.state === 'listening'), 'native receiver did not listen');
  return { process, ingress, output, samples, latest: () => samples.at(-1) };
}
function producer(destination, generation = 1, seconds = 12, codec = 'libopenh264') {
  const url = `srt://${ip}:${destination}?mode=caller&latency=400000&pbkeylen=32&enforced_encryption=1&passphrase=${key}&streamid=${session}:${generation}`;
  return child(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', codec,
    ...(codec === 'libkvazaar' ? ['-kvazaar-params', 'preset=ultrafast:threads=2'] : []), '-b:v', '1200k', '-g', '30',
    '-c:a', 'aac', '-ac', '1', '-b:a', '64k', '-t', String(seconds), '-flush_packets', '1', '-f', 'mpegts', url]);
}
async function proxy(destination) {
  const socket = createSocket('udp4'); sockets.add(socket); let caller; let number = 0; let mode = 'normal'; let next = 0;
  socket.on('message', (message, peer) => {
    const incoming = peer.port !== destination;
    if (incoming) caller = peer;
    const target = incoming ? { address: ip, port: destination } : caller;
    if (!target || mode === 'offline') return;
    const data = incoming && !(message[0] & 128);
    if (mode === 'weak' && data && ++number % 17 === 0) return;
    const now = Date.now(); let wait = mode === 'weak' ? 30 : 0;
    if (mode === 'weak' && data) {
      next = Math.max(next, now) + message.length * 8 / 600; // 600 kbps, bounded 400 ms queue
      if (next - now > 400) { next -= message.length * 8 / 600; return; }
      wait += next - now;
    }
    setTimeout(() => { if (sockets.has(socket) && mode !== 'offline') socket.send(message, target.port, target.address); }, wait).unref();
  });
  await new Promise(resolve => socket.bind(0, ip, resolve));
  return { port: socket.address().port, set: value => { mode = value; next = 0; } };
}
try {
  const a = await receiver();
  const decoder = child(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i',
    `udp://127.0.0.1:${a.output}?localaddr=127.0.0.1&fifo_size=1024&overrun_nonfatal=1`,
    '-t', '4', '-progress', 'pipe:1', '-f', 'null', '-']);
  let frames = 0;
  decoder.stdout.on('data', data => { for (const match of data.toString().matchAll(/frame=(\d+)/gu)) frames = Number(match[1]); });
  const sending = producer(a.ingress);
  try {
    // FFmpeg groups multiple AAC frames into each PES; progress counts complete PES units.
    await until(() => a.latest()?.videoFrames > 30 && a.latest()?.audioFrames > 5, 'native receiver did not deliver video and audio');
  } catch (error) {
    console.error({ receiver: a.latest(), producer: sending.diagnostics, decoder: decoder.diagnostics });
    throw error;
  }
  assert.equal(a.latest().sessionId, session); assert.equal(a.latest().generation, 1);
  await until(() => frames >= 90, 'loopback video did not decode');
  const decoded = await Promise.race([decoder.done, delay(10000).then(() => 'timeout')]);
  assert.equal(decoded, 0, 'loopback H.264/AAC decode');
  sending.kill(); await sending.done;
  await until(() => a.latest()?.state === 'reconnecting', 'receiver did not detect disconnect');
  const b = await receiver();
  const hevcDecoder = child(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i',
    `udp://127.0.0.1:${b.output}?localaddr=127.0.0.1&fifo_size=1024&overrun_nonfatal=1`,
    '-t', '3', '-progress', 'pipe:1', '-f', 'null', '-']);
  let hevcFrames = 0;
  hevcDecoder.stdout.on('data', data => { for (const match of data.toString().matchAll(/frame=(\d+)/gu)) hevcFrames = Number(match[1]); });
  const other = producer(b.ingress, 1, 30, 'libkvazaar');
  const impaired = await proxy(a.ingress); let sender = producer(impaired.port, 2, 20);
  await until(() => a.latest()?.generation === 2 && a.latest()?.videoFrames > 20 && b.latest()?.videoFrames > 20, 'multiple receivers');
  impaired.set('weak'); await delay(2500);
  const lossObserved = a.latest().lostPackets + a.latest().droppedPackets;
  impaired.set('normal'); const before = a.latest().videoFrames;
  await until(() => a.latest()?.videoFrames > before + 15, 'recovery after bandwidth/loss/jitter', 5000);
  assert.ok(lossObserved > 0, 'impairment must reach real libsrt');
  await until(() => hevcFrames >= 60, 'loopback H.265 did not decode');
  assert.equal(await Promise.race([hevcDecoder.done, delay(10000).then(() => 'timeout')]), 0, 'loopback H.265/AAC decode');
  impaired.set('offline'); sender.kill(); await sender.done;
  await until(() => a.latest()?.state === 'reconnecting', 'offline detection');
  impaired.set('normal'); const restoredAt = Date.now(); sender = producer(impaired.port, 3, 10);
  await until(() => a.latest()?.generation === 3 && a.latest()?.videoFrames > 0 && a.latest()?.audioFrames > 0, 'fresh generation recovery', 5000);
  const recoveryMs = Date.now() - restoredAt;
  const otherBefore = b.latest().videoFrames; a.process.kill(); await a.process.done;
  await until(() => b.latest()?.videoFrames > otherBefore + 15, 'one worker crash must not stop another');
  b.process.stdin.end(); const stopped = await Promise.race([b.process.done, delay(2000).then(() => 'timeout')]);
  assert.equal(stopped, 0, 'parent pipe close must stop receiver');
  other.kill(); sender.kill();
  console.log(JSON.stringify({ nativeReceiver: 'PASS', h264AacDecodedFrames: frames, h265AacDecodedFrames: hevcFrames, lossObserved, recoveryMs,
    multiDeviceIsolation: true, stopOnParentExit: true, totalCameraToObsLatency: 'not measured' }));
} finally {
  for (const process of children) process.kill();
  for (const socket of sockets) { sockets.delete(socket); socket.close(); }
}
