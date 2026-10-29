import { compatibilityPolicy } from '../../shared/compatibility-policy.generated';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { join } from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { AppState } from '../core/app-state';
import type { ObsControlController } from '../obs/obs-control-controller';
import type { MobileAudioReady } from '../speech/mobile-speech-controller';
import { mobileBootstrap, opaqueMobileId, projectMobileRealtimeEvent } from '../server/mobile-lan-server';
import { MobileReadSession } from '../server/mobile-read-session';
import { SmartphoneControlSession, rejectedControlHandshake, controlVersionHeader, type ControlOptions } from './smartphone-control-session';
import { EnrollmentError } from './smartphone-enrollment';
import type { SmartphoneController } from './smartphone-controller';
import { DirectCommentAssets } from './direct-assets';
import { DirectAdmission } from './direct-admission';
import type { DirectIdentity } from './direct-identity';

export interface DirectListener {
  close(): Promise<void>;
  updateIdentity(identity: DirectIdentity): void;
  sendAudioReady(clientId: string, audio: MobileAudioReady): void;
  discardAudio(clientId: string, audioId: string): void;
}
export interface DirectServerOptions {
  identity: DirectIdentity; address: string; port: number; staticDirectory: string;
  state: AppState; obs: ObsControlController;
  controller: ControlOptions['controller'] & Pick<SmartphoneController, 'enroll' | 'authenticateDirectInvitation'>;
  hosts: () => string[];
  read: (token?: string) => string | null;
  connected: (deviceId: string, protocol: 'tcp', host: string) => () => void;
  failed: () => void;
  assets?: DirectCommentAssets;
}

/** Dedicated TLS boundary: no management, OBS WebSocket or arbitrary static file routes. */
export async function listenDirect(options: DirectServerOptions): Promise<DirectListener> {
  const app = express(); app.disable('x-powered-by');
  const publicDirectory = join(options.staticDirectory, 'direct-mobile');
  const assets = options.assets ?? new DirectCommentAssets();
  const admission = new DirectAdmission();
  const timers = new Set<NodeJS.Timeout>();
  const readers = new WeakMap<import('node:http').IncomingMessage, string>();
  const socketId = (socket: import('node:net').Socket) => `${socket.remoteAddress}:${socket.remotePort}`;
  const header = (headers: import('node:http').IncomingHttpHeaders, key: string) => headers[key] === undefined ? undefined : typeof headers[key] === 'string' ? headers[key] : '';
  const allowed = (request: import('node:http').IncomingMessage) => request.headers.origin === undefined &&
    request.socket.localAddress?.replace(/^::ffff:/u, '') === options.address && options.hosts().includes(request.headers.host ?? '');
  const readable = (req: express.Request, res: express.Response) => !res.destroyed &&
    options.read(header(req.headers, 'x-casmate-read')) === readers.get(req);
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!allowed(req)) { admission.failed(socketId(req.socket)); res.sendStatus(403); return; }
    if (req.method === 'POST' && req.originalUrl === '/smartphone/enroll' &&
      ['x-casmate-read', 'x-casmate-obs', 'x-casmate-outdoor', 'x-casmate-registration', 'x-casmate-speech'].every(key => req.headers[key] === undefined)) {
      if (!options.controller.authenticateDirectInvitation(req.headers.authorization)) { admission.failed(socketId(req.socket)); res.status(403).json({ code: 'INVITATION_EXPIRED', message: 'PCの共通QRを開き直してください。' }); return; }
      admission.authenticated(socketId(req.socket)); next(); return;
    }
    const reader = options.read(header(req.headers, 'x-casmate-read'));
    if (req.method !== 'GET' || ['authorization', 'x-casmate-obs', 'x-casmate-outdoor', 'x-casmate-registration', 'x-casmate-speech', 'x-casmate-control-version'].some(key => req.headers[key] !== undefined) ||
      !reader) { admission.failed(socketId(req.socket)); res.sendStatus(403); return; }
    admission.authenticated(socketId(req.socket));
    readers.set(req, reader);
    const timer = setInterval(() => { if (!readable(req, res)) res.destroy(); }, 250).unref(); timers.add(timer);
    const finished = () => { clearInterval(timer); timers.delete(timer); };
    res.once('finish', finished); res.once('close', finished);
    next();
  });
  app.post('/smartphone/enroll', express.json({ limit: 8192, strict: true }), async (req, res) => {
    try {
      const version = controlVersionHeader(req);
      if (version === null) throw new EnrollmentError(400, 'UNSUPPORTED_VERSION', 'PCとAndroidの対応版を確認してください。');
      const body = JSON.stringify({ registration: await options.controller.enroll('direct', req.headers.authorization, req.body, version) });
      if (Buffer.byteLength(body) > 16384) throw new Error('RESPONSE_SIZE'); res.type('json').send(body);
    } catch (error) {
      const enrollment = error instanceof EnrollmentError ? error : new EnrollmentError(503, 'PREPARATION_FAILED', '直接接続を準備できません。PCで接続状態を確認して、同じQRで再試行してください。');
      res.status(enrollment.status).json({ code: enrollment.code, message: enrollment.message });
    }
  });
  app.get('/mobile/bootstrap', (_req, res) => res.json({ protocolVersion: compatibilityPolicy.contracts.mobileProtocol.current, mobilePublished: true, audioAvailable: options.state.snapshot().mobileSpeech.audioAvailable }));
  app.get('/comments', async (req, res) => {
    if (!['/comments', '/comments?embedded=android'].includes(req.originalUrl)) { res.sendStatus(404); return; }
    try { const index = await readFile(join(publicDirectory, 'direct-mobile.html'), 'utf8');
      if (readable(req, res)) res.type('html').send(index); else res.destroy();
    } catch { res.sendStatus(503); }
  });
  app.get('/mobile/assets/:id', async (req, res) => {
    if (!/^[a-f0-9]{64}$/u.test(String(req.params.id)) || req.originalUrl.includes('?')) { res.sendStatus(404); return; }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    res.once('close', cancel);
    if (res.destroyed) cancel();
    try { const asset = await assets.get(String(req.params.id), abort.signal);
      if (!readable(req, res)) { res.destroy(); return; }
      if (asset) res.type(asset.type).send(asset.bytes); else res.sendStatus(404); }
    catch { if (!res.destroyed) res.sendStatus(503); }
    finally { res.off('close', cancel); }
  });
  app.use('/assets', (req, res, next) => {
    if (!/^\/[a-zA-Z0-9_.-]+\.(?:js|css|png|jpg|jpeg|webp|gif|svg|woff2?|ttf)$/u.test(req.url)) { res.sendStatus(404); return; }
    next();
  }, express.static(join(publicDirectory, 'assets'), { index: false, dotfiles: 'deny', fallthrough: false }));
  app.use((_req, res) => res.sendStatus(404));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(400));
  const server = createServer({ key: options.identity.privateKey, cert: options.identity.certificate, minVersion: 'TLSv1.2', handshakeTimeout: 5000 }, app);
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.maxConnections = 128;
  server.on('connection', socket => {
    const id = socketId(socket); admission.open(id, socket.remoteAddress ?? '', () => socket.destroy());
    socket.once('close', () => admission.closed(id));
  });
  server.on('secureConnection', socket => admission.secure(socketId(socket)));
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  const clients = new Map<string, MobileReadSession>();
  const control: ControlOptions = { controller: options.controller, obs: options.obs, state: options.state, network: 'direct', address: options.address, port: options.port };
  server.on('upgrade', (req, socket, head) => {
    const onError = () => socket.destroy(); socket.on('error', onError);
    const reject = () => { admission.failed(socketId(req.socket)); socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); };
    if (!allowed(req) || req.headers.authorization || sockets.clients.size >= 128) { reject(); return; }
    if (req.url === '/mobile/ws' && ['x-casmate-obs', 'x-casmate-outdoor', 'x-casmate-registration', 'x-casmate-speech', 'x-casmate-control-version'].every(key => req.headers[key] === undefined)) {
      const token = header(req.headers, 'x-casmate-read'); const id = options.read(token); if (!id) { reject(); return; }
      admission.authenticated(socketId(req.socket));
      sockets.handleUpgrade(req, socket, head, ws => {
        socket.off('error', onError); const clientId = randomUUID(); const disconnected = options.connected(id, 'tcp', req.headers.host!);
        const timer = setInterval(() => { if (options.read(token) !== id) ws.close(4403); }, 250).unref(); timers.add(timer);
        clients.set(clientId, new MobileReadSession(clientId, ws, options.state, () => {
          const payload = mobileBootstrap(options.state); return { revision: options.state.snapshotEvent().revision,
            payload: { ...payload, comments: payload.comments.map(c => assets.project(c)) } };
        }, () => { clearInterval(timer); timers.delete(timer); clients.delete(clientId); disconnected(); }));
      });
    } else if (req.url === '/smartphone/ws' && req.headers['x-casmate-read'] === undefined) {
      const version = controlVersionHeader(req);
      if (version === null) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
      const authenticate = () => options.controller.authenticateControl('direct', header(req.headers, 'x-casmate-obs'), header(req.headers, 'x-casmate-outdoor'), header(req.headers, 'x-casmate-registration'),
        header(req.headers, 'x-casmate-speech'), version);
      const principal = authenticate(); if (!principal) {
        admission.failed(socketId(req.socket));
        socket.end(rejectedControlHandshake(control, header(req.headers, 'x-casmate-registration'))); return;
      }
      admission.authenticated(socketId(req.socket));
      sockets.handleUpgrade(req, socket, head, ws => {
        socket.off('error', onError); const disconnected = options.connected(principal.deviceId, 'tcp', req.headers.host!);
        new SmartphoneControlSession(ws, control, principal, authenticate);
        ws.once('close', disconnected);
      });
    } else reject();
  });
  const unsubscribe = options.state.subscribe(event => {
    const projected = projectMobileRealtimeEvent(event, options.state); if (!projected) return;
    const result = projected.type === 'comment.received' ? { ...projected, payload: assets.project(projected.payload) } : projected;
    for (const client of clients.values()) client.event(result);
  });
  try { await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen({ host: options.address, port: options.port, ipv6Only: options.address.includes(':') }, () => { server.off('error', reject); resolve(); });
  }); } catch (error) { unsubscribe(); sockets.close(); server.close(); throw error; }
  server.on('error', options.failed);
  return {
    updateIdentity: identity => { if (identity.pcKey.fingerprint !== options.identity.pcKey.fingerprint) throw new Error('PC_KEY_CHANGED'); server.setSecureContext({ key: identity.privateKey, cert: identity.certificate, minVersion: 'TLSv1.2' }); },
    close: async () => { unsubscribe(); admission.close(); for (const timer of timers) clearInterval(timer); for (const ws of sockets.clients) ws.terminate(); sockets.close();
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
    sendAudioReady: (id, audio) => clients.get(id)?.audioReady({ ...audio, commentId: opaqueMobileId(audio.commentId) }),
    discardAudio: (id, audioId) => clients.get(id)?.discard(audioId),
  };
}
