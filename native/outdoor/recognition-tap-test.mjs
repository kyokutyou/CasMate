import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Only generated sine audio and synthetic credentials; user media is never captured or saved.
const address = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' &&
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(value.address))?.address;
assert.ok(address, 'The native tap test needs a private LAN IPv4 interface');
const children = new Set(); const sockets = new Set();
const key = 'a'.repeat(32); const session = '12345678-1234-4234-8234-123456789abc';
function child(executable, args) {
  const process = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); children.add(process);
  process.stderr.resume();
  process.done = new Promise((resolve, reject) => { process.once('error', reject); process.once('exit', code => { children.delete(process); resolve(code); }); });
  return process;
}
async function listen(ip = '127.0.0.1') {
  const socket = createSocket('udp4'); sockets.add(socket);
  const packets = { count: 0, hashes: new Set() };
  socket.on('message', bytes => { packets.count++; if (packets.hashes.size < 100) packets.hashes.add(createHash('sha256').update(bytes).digest('hex')); });
  await new Promise(resolve => socket.bind(0, ip, resolve));
  return { socket, packets, port: socket.address().port };
}
async function unusedPort(ip) {
  const listener = await listen(ip); const value = listener.port; listener.socket.close(); sockets.delete(listener.socket); return value;
}
async function until(predicate, message, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < deadline, message); await delay(25); }
}
function produce(port, generation) {
  return child(resolve('resources/ffmpeg/ffmpeg.exe'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000', '-c:a', 'aac', '-ac', '1', '-b:a', '64k', '-t', '20', '-f', 'mpegts',
    `srt://${address}:${port}?mode=caller&latency=400000&pbkeylen=32&enforced_encryption=1&passphrase=${key}&streamid=${session}:${generation}`]);
}
try {
  const ingress = await unusedPort(address); const obs = await listen(); const first = await listen(); const second = await listen();
  const receiver = child(resolve('resources/outdoor-worker/casmate-outdoor-worker.exe'), []);
  let buffer = ''; let latest;
  receiver.stdout.setEncoding('utf8'); receiver.stdout.on('data', data => {
    buffer += data; let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) { latest = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1); }
  });
  receiver.stdin.write(`1\t${address}\t${ingress}\t${obs.port}\t${key}\n`);
  await until(() => latest?.state === 'listening', 'receiver did not start');
  let source = produce(ingress, 1);
  await until(() => latest?.state === 'receiving' && latest.connectionRevision === 1, 'first generation did not receive');
  receiver.stdin.write(`tap\t1\t${first.port}\t1\n`);
  await until(() => first.packets.count > 3, 'current acknowledgement did not forward audio');
  assert.ok([...first.packets.hashes].some(value => obs.packets.hashes.has(value)), 'tap payload must be the same received MPEG-TS as OBS');
  receiver.stdin.write(`tap\t1\t${second.port}\t1\n`);
  await until(() => second.packets.count > 1, 'tap did not switch while SRT remained connected');
  await delay(100); const firstStopped = first.packets.count; await delay(200);
  assert.equal(first.packets.count, firstStopped, 'removed tap kept receiving');
  assert.equal(latest.connectionRevision, 1, 'tap switch restarted SRT');
  const absent = await unusedPort('127.0.0.1'); receiver.stdin.write(`tap\t1\t${absent}\t1\n`);
  const beforeAbsent = obs.packets.count; await until(() => obs.packets.count > beforeAbsent + 3, 'an absent recognizer stopped OBS');
  receiver.stdin.write('tap\t1\t0\t0\n');
  source.kill(); await source.done; await until(() => latest?.state === 'reconnecting', 'disconnect did not produce an immediate boundary');
  const beforeNewGeneration = second.packets.count;
  source = produce(ingress, 2);
  await until(() => latest?.state === 'receiving' && latest.connectionRevision === 2, 'new generation did not receive');
  receiver.stdin.write(`tap\t1\t${second.port}\t1\n`);
  const obsBeforeStale = obs.packets.count; await until(() => obs.packets.count > obsBeforeStale + 3, 'OBS stalled after reconnect');
  assert.equal(second.packets.count, beforeNewGeneration, 'old acknowledgement attached to new generation');
  receiver.stdin.write(`tap\t1\t${second.port}\t2\n`);
  await until(() => second.packets.count > beforeNewGeneration + 3, 'fresh acknowledgement did not reattach');
  receiver.stdin.end(); assert.equal(await receiver.done, 0, 'receiver did not exit with its parent pipe');
  source.kill(); await source.done;
  console.log(JSON.stringify({ recognitionTap: 'PASS', payloadIdentity: true, switchWithoutSrtRestart: true,
    absentRecognizerDoesNotStopObs: true, staleGenerationRejected: true, freshGenerationResumes: true }));
} finally {
  for (const process of children) process.kill();
  for (const socket of sockets) socket.close();
}
