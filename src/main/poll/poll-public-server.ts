import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { PollController, PollError } from './poll-controller';

export function pollEvents(polls: PollController, response: Response): () => void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  let pending: ReturnType<typeof setTimeout> | undefined;
  const send = () => { pending = undefined; if (!response.destroyed && !response.write(`data: ${JSON.stringify(polls.publicView())}\n\n`)) response.destroy(); };
  const unsubscribe = polls.subscribe(() => { pending ??= setTimeout(send, 250); });
  const heartbeat = setInterval(() => { if (!response.destroyed && !response.write(': heartbeat\n\n')) response.destroy(); }, 15_000);
  const cleanup = () => { clearTimeout(pending); clearInterval(heartbeat); unsubscribe(); };
  response.once('close', cleanup); send();
  return () => { cleanup(); response.end(); };
}
export interface PollPublicOptions {
  polls: PollController; host(): string | null; online(): boolean; nonce: string;
  assets?: Map<string, { body: Buffer; type: string }>;
}
export function createPollPublicApplication(options: PollPublicOptions) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', false);
  const secret = randomBytes(32), participants = new Map<string, { at: number; count: number }>();
  let window = Date.now(), requests = 0, streams = 0;
  const sign = (id: string) => createHmac('sha256', secret).update(id).digest('hex');
  const identity = (request: Request) => {
    const cookie = request.headers.cookie?.match(/(?:^|;\s*)casmate_poll=([\da-f]{64})\.([\da-f]{64})(?:;|$)/u);
    return cookie && timingSafeEqual(Buffer.from(cookie[2], 'hex'), Buffer.from(sign(cookie[1]), 'hex')) ? cookie[1] : null;
  };
  const fail = (response: Response, status: number, code: string, message: string) => response.status(status).json({ error: { code, message } });
  app.use((request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
    const host = options.host();
    if (!host || request.headers.host !== host) { fail(response, 403, 'POLL_HOST_INVALID', '接続先を確認してください。'); return; }
    if (Date.now() - window >= 1000) { window = Date.now(); requests = 0; }
    if (++requests > 400) { response.set('Retry-After', '1'); fail(response, 429, 'POLL_RATE_LIMIT', '少し待ってから操作してください。'); return; }
    if (request.headers.origin && request.headers.origin !== `https://${host}`) { fail(response, 403, 'POLL_ORIGIN_INVALID', '投票ページから操作してください。'); return; }
    next();
  });
  app.get('/health', (_request, response) => { response.json({ nonce: options.nonce }); });
  app.use((request, response, next) => {
    if (!options.online() || !options.polls.isAvailable()) { fail(response, 503, 'POLL_OFFLINE', '投票ページは接続準備中です。再読み込みしてください。'); return; }
    next();
  });
  app.get('/', (_request, response) => { const asset = options.assets?.get('/'); if (!asset) { fail(response, 503, 'POLL_ASSETS_UNAVAILABLE', '投票ページの資産を準備できません。'); return; } response.type(asset.type).send(asset.body); });
  app.get(/^\/assets\/[\w.-]+\.(?:js|css)$/u, (request, response) => { const asset = options.assets?.get(request.path); if (!asset) { response.sendStatus(404); return; } response.type(asset.type).send(asset.body); });
  app.get('/api/state', (request, response) => {
    let id = identity(request); const cookieReady = !!id;
    if (!id) { id = randomBytes(32).toString('hex'); response.setHeader('Set-Cookie', `casmate_poll=${id}.${sign(id)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`); }
    response.json({ state: options.polls.publicView(), ballot: options.polls.ballot(id), cookieReady });
  });
  app.get('/api/events', (request, response) => {
    if (!identity(request)) { fail(response, 403, 'POLL_COOKIE_REQUIRED', 'Cookieを有効にして再読み込みしてください。'); return; }
    if (streams >= 128) { fail(response, 503, 'POLL_CONNECTION_LIMIT', '接続が混み合っています。'); return; }
    streams++; response.once('close', () => { streams--; }); pollEvents(options.polls, response);
  });
  app.post('/api/vote', express.json({ limit: '2kb', strict: true }), (request, response, next) => {
    if (request.headers.origin !== `https://${options.host()}`) { fail(response, 403, 'POLL_ORIGIN_INVALID', '投票ページから操作してください。'); return; }
    const id = identity(request);
    if (!id) { fail(response, 403, 'POLL_COOKIE_REQUIRED', 'Cookieを有効にして再読み込みしてください。'); return; }
    const now = Date.now(); let rate = participants.get(id);
    if (!rate || now - rate.at >= 1000) { rate = { at: now, count: 0 }; participants.set(id, rate); }
    if (++rate.count > 2) { response.set('Retry-After', '1'); fail(response, 429, 'POLL_RATE_LIMIT', '少し待ってから選び直してください。'); return; }
    if (participants.size > 4096) for (const [key, entry] of participants) if (now - entry.at >= 1000) participants.delete(key);
    if (participants.size > 4096) { participants.delete(id); fail(response, 503, 'POLL_BUSY', '投票が混み合っています。少し待ってください。'); return; }
    void options.polls.vote(id, request.body).then(result => response.json(result)).catch(next);
  });
  app.use((_request, response) => { response.sendStatus(404); });
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof PollError) { fail(response, error.status, error.code, error.message); return; }
    const status = (error as { status?: number })?.status;
    fail(response, status === 413 ? 413 : 400, 'POLL_REQUEST_INVALID', status === 413 ? '投票データが大きすぎます。' : '要求を確認できませんでした。');
  });
  return app;
}
export class PollPublicServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  host: string | null = null;
  online = false;
  readonly nonce = randomBytes(24).toString('hex');
  constructor(private readonly polls: PollController, private readonly directory: string) {}
  async start(): Promise<number> {
    const assets = new Map<string, { body: Buffer; type: string }>();
    assets.set('/', { body: await readFile(join(this.directory, 'listener-poll.html')), type: 'text/html' });
    for (const entry of await readdir(join(this.directory, 'assets'), { withFileTypes: true })) {
      if (entry.isFile() && /^[\w.-]+\.(?:js|css)$/u.test(entry.name)) assets.set(`/assets/${entry.name}`, { body: await readFile(join(this.directory, 'assets', entry.name)), type: entry.name.endsWith('.js') ? 'application/javascript' : 'text/css' });
    }
    const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 5000 }, createPollPublicApplication({ polls: this.polls, host: () => this.host, online: () => this.online, nonce: this.nonce, assets }));
    this.server = server;
    server.maxConnections = 256;
    server.on('connection', socket => { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    return (server.address() as { port: number }).port;
  }
  disconnect(): void { this.online = false; for (const socket of this.sockets) socket.destroy(); }
  async stop(): Promise<void> { this.disconnect(); const server = this.server; this.server = null; this.host = null; if (server) await new Promise<void>(resolve => server.close(() => resolve())); }
}
