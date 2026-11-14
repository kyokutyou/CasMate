import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Socket } from 'node:net';
import express, { type Response, type NextFunction, type Request } from 'express';
import { ReactionController, ReactionError } from './reaction-controller';

const previewMarker = '<meta name="casmate-preview">';

export interface ReactionPublicOptions { controller: ReactionController; host(): string | null; online(): boolean; nonce: string; assets: Map<string, { body: Buffer; type: string }>; monotonicNow?: () => number; shareProof?: (body: unknown) => boolean }
export function createReactionPublicApplication(options: ReactionPublicOptions) {
  const frameInstance = randomUUID();
  // Only fixed build styles and approved player origins enter the policy.
  const html = options.assets.get('/')?.body.toString('utf8') ?? '';
  const styleHashes = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gu)].map(match => "'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'");
  const policy = `default-src 'none'; script-src 'self'; style-src 'self' ${styleHashes.join(' ')}; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', false);
  const now = options.monotonicNow ?? (() => performance.now()), sessions = new Map<string, number>();
  let windowStart = now(), images = 0, requests = 0, reactions = 0;
  const fail = (res: Response, status: number, message: string) => res.status(status).json({ message });
  const publicationAvailable = () => options.online() && options.controller.isAvailable();
  const markFrameState = (res: Response, state: 'unavailable' | 'retired') => {
    res.set('X-CasMate-Frame-State', 'unavailable');
    if (state === 'retired') res.set('X-CasMate-Frame-Reason', 'retired');
    return res;
  };
  const missingJpegState = () => options.controller.frames.latestPublic() ? 'retired' : 'unavailable';
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': policy });
    const host = options.host();
    if (!host || req.headers.host !== host || req.headers.origin && req.headers.origin !== `https://${host}`) { fail(res, 403, '要求元を確認できません。'); return; }
    const at = now();
    if (at - windowStart >= 1000) { windowStart = at; images = 0; requests = 0; reactions = 0; }
    const image = req.method === 'GET' && (req.url === '/frame' || req.url.startsWith('/frame.jpg?'));
    if (image ? ++images > 512 : ++requests > 100) {
      const available = publicationAvailable();
      const frame = req.url === '/frame' && available ? options.controller.frames.publicMetadata() : null;
      if (req.url === '/frame' && !frame) markFrameState(res, 'unavailable');
      if (req.path === '/frame.jpg' && (!available || typeof req.query.id !== 'string' || !options.controller.frames.getPublic(req.query.id))) {
        markFrameState(res, available ? missingJpegState() : 'unavailable');
      }
      res.status(429).json({ message: '少し待ってください。', ...(frame ? { instance: frameInstance, generation: frame.generation } : {}) });
      return;
    }
    next();
  });
  app.get('/health', (_req, res) => { res.json({ nonce: options.nonce }); });
  app.use((req, res, next) => {
    if (publicationAvailable()) { next(); return; }
    if (req.path === '/frame' || req.path === '/frame.jpg') markFrameState(res, 'unavailable');
    fail(res, 503, '公開は接続準備中です。');
  });
  app.post('/share-link-proof', express.json({ limit: '1kb', strict: true }), (req, res) => {
    res.sendStatus(!req.headers.origin && options.shareProof?.(req.body) ? 204 : 404);
  });
  app.get('/', (req, res) => {
    const old = req.headers.cookie?.match(/(?:^|;\s*)casmate_reaction=([\da-f-]{36})(?:;|$)/u)?.[1];
    if (!old || !sessions.has(old)) {
      if (sessions.size >= 2048) { fail(res, 429, '参加上限に達しました。'); return; }
      const id = randomUUID(); sessions.set(id, -Infinity);
      res.setHeader('Set-Cookie', `casmate_reaction=${id}; Path=/; HttpOnly; Secure; SameSite=Strict`);
    }
    const asset = options.assets.get('/');
    if (!asset) { fail(res, 503, 'ページを準備できません。'); return; }
    res.set('Content-Security-Policy', `${policy}; frame-src https://player.twitch.tv https://www.youtube.com`);
    const preview = options.controller.listenerPreview();
    const player = {
      obs: null,
      twitch: { id: preview.twitchChannel, origin: 'https://player.twitch.tv' },
      youtube: { id: preview.youtubeVideoId, origin: 'https://www.youtube.com' },
    }[preview.mode];
    if (!player?.id) { res.type(asset.type).send(asset.body); return; }
    // The settings validator restricts both IDs to ASCII letters, digits and safe separators.
    const page = html.replace(previewMarker, `<meta name="casmate-preview" data-mode="${preview.mode}" data-id="${player.id}">`);

    res.type(asset.type).send(page);
  });
  app.get(/^\/assets\/[\w.-]+\.(?:js|css)$/u, (req, res) => { const asset = options.assets.get(req.path); if (!asset) { res.sendStatus(404); return; } res.type(asset.type).send(asset.body); });
  app.get('/preview', (_req,res) => {
    const preview = options.controller.listenerPreview();
    const id = preview.mode === 'twitch' ? preview.twitchChannel : preview.mode === 'youtube' ? preview.youtubeVideoId : '';
    res.json({mode:preview.mode,id});
  });
  app.get('/frame', (_req, res) => {
    const frame = options.controller.frames.publicMetadata();
    if (!frame) { fail(markFrameState(res, 'unavailable'), 503, options.controller.frames.message || '最新の画像を待っています。'); return; }
    res.json({ ...frame, instance: frameInstance });
  });
  app.get('/frame.jpg', (req, res) => {
    if (!/^\/frame\.jpg\?id=[\da-f-]{36}$/u.test(req.url)) { fail(res, 400, '画像を選択してください。'); return; }
    const frame = options.controller.frames.getPublic(String(req.query.id));
    if (!frame) { fail(markFrameState(res, missingJpegState()), 410, '画像が更新されました。'); return; }
    res.type('image/jpeg').send(frame.bytes);
  });
  app.post('/react', express.json({ limit: '1kb', strict: true }), (req, res) => {
    if (req.headers.origin !== `https://${options.host()}`) { fail(res, 403, 'リスナーページから操作してください。'); return; }
    const id = req.headers.cookie?.match(/(?:^|;\s*)casmate_reaction=([\da-f-]{36})(?:;|$)/u)?.[1];
    if (!id || !sessions.has(id)) { fail(res, 403, 'Cookieを有効にして再読み込みしてください。'); return; }
    const at = now();
    if (at - sessions.get(id)! < 800 || reactions >= 20) { fail(res, 429, '少し待ってから押してください。'); return; }
    sessions.set(id, at); reactions++;
    void options.controller.react(req.body).then(value => res.json(value)).catch(error => {
      if (!(error instanceof ReactionError)) { fail(res, 503, '送信結果を確認できません。'); return; }
      res.status(error.status).json({ message: error.message, ...(error.retiredFrame ? { code: 'FRAME_RETIRED', instance: frameInstance, ...error.retiredFrame } : {}) });
    });
  });
  app.use((_req, res) => { res.sendStatus(404); });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { fail(res, (error as { status?: number })?.status === 413 ? 413 : 400, '要求を確認してください。'); });
  return app;
}
export class ReactionPublicServer {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  host: string | null = null;
  private connected = false;
  readonly nonce = randomBytes(24).toString('hex');
  get online() { return this.connected; }
  set online(value: boolean) { this.connected = value; this.controller.setOnline(value); }
  constructor(private readonly controller: ReactionController, private readonly directory: string, private readonly shareProof?: (body: unknown) => boolean) {}
  async start(): Promise<number> {
    const assets = new Map<string, { body: Buffer; type: string }>();
    assets.set('/', { body: await readFile(join(this.directory, 'listener-reactions.html')), type: 'text/html' });
    for (const entry of await readdir(join(this.directory, 'assets'), { withFileTypes: true })) if (entry.isFile() && /^[\w.-]+\.(?:js|css)$/u.test(entry.name)) assets.set(`/assets/${entry.name}`, { body: await readFile(join(this.directory, 'assets', entry.name)), type: entry.name.endsWith('.js') ? 'application/javascript' : 'text/css' });
    const page = assets.get('/')!;
    const html = page.body.toString('utf8').replace(/<link\b[^>]*>/gu, tag => {
      if (!/\brel=["']stylesheet["']/u.test(tag)) return tag;
      const path = tag.match(/\bhref=["'](\/assets\/[\w.-]+\.css)["']/u)?.[1];
      const css = path ? assets.get(path)?.body.toString('utf8') : undefined;
      if (!css || /<\/style/iu.test(css)) throw new Error('リスナーページのデザインを準備できません。');
      return '<style>' + css + '</style>';
    });
    assets.set('/', { ...page, body: Buffer.from(html) });
    const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000, keepAliveTimeout: 5000 }, createReactionPublicApplication({ controller: this.controller, host: () => this.host, online: () => this.online, nonce: this.nonce, assets, shareProof: this.shareProof }));
    this.server = server; server.maxConnections = 128;
    server.on('connection', socket => { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('公開ポートを確認できません。'); return address.port;
  }
  disconnect() { this.online = false; }
  async stop() { this.disconnect(); const server = this.server; this.server = null; if (server) await new Promise<void>(resolve => { server.close(() => resolve()); for (const socket of this.sockets) socket.destroy(); }); this.host = null; }
}
