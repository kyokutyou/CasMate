import { randomUUID, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TLSSocket } from 'node:tls';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import { DirectCommentAssets } from '../src/main/smartphone/direct-assets';
import { createDirectIdentity, validateDirectIdentity } from '../src/main/smartphone/direct-identity';
import { listenDirect, type DirectServerOptions } from '../src/main/smartphone/direct-server';
import { EnrollmentError } from '../src/main/smartphone/smartphone-enrollment';

const finishes: (() => Promise<void>)[] = [];
const tls = vi.hoisted(() => ({ certificates: [] as X509Certificate[] }));
vi.mock('node:https', async original => {
  const actual = await original<typeof import('node:https')>();
  return { ...actual, createServer: (...args: Parameters<typeof actual.createServer>) => {
    const server = actual.createServer(...args);
    server.on('secureConnection', socket => { const certificate = socket.getX509Certificate(); if (certificate) tls.certificates.push(certificate); }); return server;
  } };
});
afterEach(async () => { for (const finish of finishes.splice(0)) await finish(); tls.certificates.length = 0; vi.restoreAllMocks(); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-direct-server-'));
  await mkdir(join(directory, 'direct-mobile', 'assets'), { recursive: true }); await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'direct-mobile', 'direct-mobile.html'), '<!doctype html><script src="/assets/comments.js"></script>');
  await writeFile(join(directory, 'direct-mobile', 'assets', 'comments.js'), '/* comments only */');
  await writeFile(join(directory, 'assets', 'management.js'), '/* private management */');
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('No test port'); const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const pcId = randomUUID(); const identity = createDirectIdentity(pcId); const state = new AppState(createDefaultSettings());
  const obs = new ObsControlController({ store: { load: async () => null, save: async () => undefined } }); await obs.start();
  let authorized = true; const disconnected = vi.fn(); const connected = vi.fn(() => disconnected); const assets = new DirectCommentAssets();
  const controller: DirectServerOptions['controller'] = { authenticateDirectInvitation: token => token === 'Bearer invite',
    enroll: vi.fn(async () => { throw new EnrollmentError(503, 'PREPARATION_FAILED', 'prepare'); }),
    authenticateControl: vi.fn<DirectServerOptions['controller']['authenticateControl']>(() => null), registrationTokenCurrent: () => false, registrationUpdateCurrent: () => false,
    updatedRegistration: async () => { throw new Error('not registered'); },
    touchReport: () => undefined, releaseReport: () => undefined, feedback: () => null, acceptReport: () => false };
  const host = '8.8.8.8:3001';
  const listener = await listenDirect({ identity, address: '127.0.0.1', port, staticDirectory: directory, state, obs, controller, assets,
    hosts: () => [host], read: token => authorized && token === 'Bearer read' ? 'device' : null, connected, failed: () => undefined });
  finishes.push(async () => { await listener.close(); await obs.stop(); await state.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const fetch = (path: string, headers: Record<string, string> = { 'X-CasMate-Read': 'Bearer read' }, method = 'GET') =>
    new Promise<{ status: number; body: string; certificate?: string }>((resolve, reject) => {
      // The local test deliberately exercises a self-signed HTTPS listener. Production Android verifies the QR SPKI.
      const req = request({ hostname: '127.0.0.1', port, path, method, headers: { Host: host, ...headers }, rejectUnauthorized: false,
        agent: false, signal: AbortSignal.timeout(3000) }, res => {
        const certificate = res.socket instanceof TLSSocket ? res.socket.getPeerCertificate().raw?.toString('base64') : undefined;
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk))); res.once('error', reject);
        res.once('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), certificate }));
      }); req.once('error', reject); req.end();
    });
  return { fetch, port, host, identity, pcId, listener, assets, controller, connected, disconnected, revoke: () => { authorized = false; } };
}

it('専用HTTPSは用途別資格・公開Host・Originを検証し、コメント専用資産だけを公開する', async () => {
  const { fetch, controller } = await setup();
  expect((await fetch('/comments')).body).toContain('/assets/comments.js');
  expect((await fetch('/assets/comments.js')).body).toContain('comments only');
  expect((await fetch('/assets/management.js')).status).not.toBe(200);
  expect((await fetch('/api/bootstrap')).status).toBe(404); expect((await fetch('/overlay/comments')).status).toBe(404);
  expect((await fetch('/api/management/smartphone-adapters')).status).toBe(404);
  expect((await fetch('/api/management/smartphone-adapters', { 'X-CasMate-Management': 'secret' })).status).toBe(403);
  expect(JSON.parse((await fetch('/mobile/bootstrap')).body)).toMatchObject({ protocolVersion: 2, mobilePublished: true });
  expect((await fetch('/comments', { Authorization: 'Bearer invite' })).status).toBe(403);
  expect((await fetch('/comments', { 'X-CasMate-Obs': 'Bearer read' })).status).toBe(403);
  expect((await fetch('/comments', { 'X-CasMate-Read': 'Bearer read', 'X-CasMate-Speech': 'Bearer speech' })).status).toBe(403);
  expect((await fetch('/comments', { 'X-CasMate-Read': 'Bearer read', Origin: 'https://attacker.invalid' })).status).toBe(403);
  expect((await fetch('/comments', { 'X-CasMate-Read': 'Bearer read', Host: '9.9.9.9:3001' })).status).toBe(403);
  expect((await fetch('/smartphone/enroll', { 'X-CasMate-Read': 'Bearer read' }, 'POST')).status).toBe(403);
  expect((await fetch('/smartphone/enroll', { Authorization: 'Bearer invite' }, 'POST')).status).toBe(503);
  expect(controller.enroll).toHaveBeenCalledExactlyOnceWith('direct', 'Bearer invite', undefined, 2);
  expect((await fetch('/smartphone/enroll', { Authorization: 'Bearer invite', 'X-CasMate-Control-Version': '3' }, 'POST')).status).toBe(503);
  expect(controller.enroll).toHaveBeenLastCalledWith('direct', 'Bearer invite', undefined, 3);
  expect((await fetch('/smartphone/enroll', { Authorization: 'Bearer invite', 'X-CasMate-Control-Version': '99' }, 'POST')).status).toBe(400);
  expect((await fetch('/smartphone/enroll', { Authorization: 'Bearer invite', 'X-CasMate-Speech': 'Bearer speech' }, 'POST')).status).toBe(403);
});

it('専用WSSも明示ヘッダーで版3を選択し、認識資格を制御だけへ渡す', async () => {
  const { controller, port, host } = await setup();
  const update = { registrationId: randomUUID(), revision: 1, token: 'a'.repeat(64) };
  const speech = { registrationId: randomUUID(), revision: 1, token: 'b'.repeat(64) };
  vi.mocked(controller.authenticateControl).mockImplementation((_network, _obs, _outdoor, registration, speechToken, version = 2) =>
    registration === `Bearer ${update.token}` ? { deviceId: 'device', obs: null, video: false, protocolVersion: version, update,
      speechRecognition: speechToken === `Bearer ${speech.token}` ? speech : null } : null);
  const headers = { Host: host, 'X-CasMate-Registration': `Bearer ${update.token}`, 'X-CasMate-Speech': `Bearer ${speech.token}`, 'X-CasMate-Control-Version': '3' };
  const ws = new WebSocket(`wss://127.0.0.1:${port}/smartphone/ws`, { rejectUnauthorized: false, agent: false, headers });
  const hello = once(ws, 'message'); await once(ws, 'open');
  expect(JSON.parse(String((await hello)[0]))).toMatchObject({ type: 'control.hello', payload: { protocolVersion: 3 } });
  expect(controller.authenticateControl).toHaveBeenCalledWith('direct', undefined, undefined, headers['X-CasMate-Registration'], headers['X-CasMate-Speech'], 3);
  const closed = once(ws, 'close'); ws.close(); await closed;
  const read = new WebSocket(`wss://127.0.0.1:${port}/mobile/ws`, { rejectUnauthorized: false, agent: false,
    headers: { Host: host, 'X-CasMate-Read': 'Bearer read', 'X-CasMate-Speech': `Bearer ${speech.token}` } });
  const rejected = await new Promise<Error>(resolve => read.once('error', resolve)); expect(rejected.message).toContain('403');
});

it('同じPC鍵の証明書更新でWSSを維持し、読取資格失効とOFFでWSS・TLS未完了接続を閉じる', async () => {
  // Inspect the actual server handshake, independently of host antivirus TLS interception on the test client.
  const certificates = tls.certificates;
  const { fetch, port, host, identity, pcId, listener, connected, disconnected, revoke } = await setup();
  const ws = new WebSocket(`wss://127.0.0.1:${port}/mobile/ws`, { rejectUnauthorized: false, agent: false, headers: { Host: host, 'X-CasMate-Read': 'Bearer read' } });
  ws.on('error', () => undefined); await once(ws, 'open'); const closed = once(ws, 'close');
  const first = await fetch('/mobile/bootstrap'); const renewed = validateDirectIdentity(identity, pcId, Date.now() + 350 * 86400000);
  listener.updateIdentity(renewed); expect(connected).toHaveBeenCalledOnce(); expect(disconnected).not.toHaveBeenCalled();
  const second = await fetch('/mobile/bootstrap'); expect(second.certificate).not.toBe(first.certificate);
  expect(certificates[0].fingerprint256).toBe(new X509Certificate(identity.certificate).fingerprint256);
  expect(certificates.at(-1)!.fingerprint256).toBe(new X509Certificate(renewed.certificate).fingerprint256);
  expect(certificates.at(-1)!.publicKey.export({ type: 'spki', format: 'der' }).toString('hex')).toBe(new X509Certificate(identity.certificate).publicKey.export({ type: 'spki', format: 'der' }).toString('hex'));
  expect(() => listener.updateIdentity(createDirectIdentity(pcId))).toThrow('PC_KEY_CHANGED');
  revoke(); const [code] = await closed; expect(code).toBe(4403); expect(disconnected).toHaveBeenCalledOnce();
  const raw = connect(port, '127.0.0.1'); raw.on('error', () => undefined); await once(raw, 'connect'); const rawClosed = once(raw, 'close');
  await listener.close(); await rawClosed;
});

it('取得開始後に失効した資格へ非同期コメント資産を返さない', async () => {
  const { assets, fetch, revoke } = await setup(); let finish!: (value: { type: string; bytes: Buffer }) => void;
  const pending = new Promise<{ type: string; bytes: Buffer }>(resolve => { finish = resolve; });
  const get = vi.spyOn(assets, 'get').mockReturnValue(pending);
  const result = fetch(`/mobile/assets/${'a'.repeat(64)}`); const rejected = expect(result).rejects.toThrow();
  await vi.waitFor(() => expect(get).toHaveBeenCalledOnce()); revoke(); finish({ type: 'image/png', bytes: Buffer.from('private') }); await rejected;
});

it('読取資格失効でHTTPを閉じる際に待機中の画像取得も取り消す', async () => {
  const { assets, fetch, revoke } = await setup(); let signal!: AbortSignal;
  const get = vi.spyOn(assets, 'get').mockImplementation((_id, incoming) => {
    signal = incoming!;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const result = fetch(`/mobile/assets/${'b'.repeat(64)}`); const rejected = expect(result).rejects.toThrow();
  await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
  expect(signal.aborted).toBe(false); revoke(); await rejected;
  await vi.waitFor(() => expect(signal.aborted).toBe(true));
});
