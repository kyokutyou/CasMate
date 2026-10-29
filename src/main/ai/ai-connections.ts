import { buildAiPrompt } from './ai-context';
import { imageStatus, type AiCapture, type AiGenerationEvent, type AiImageStatus, type AiVisualSource } from '../../shared/ai-visual';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultAiSettings, validateAiSettings, type AiMemory, type AiPersona, type AiSettings, type AiView } from '../../shared/ai-listener';
import type { CommentSource } from '../../shared/types';
import { emptyAiSecrets, type AiPersistence, type AiSecrets, type AiToken } from './ai-store';
import { createBoardWriteAdapter, BoardWriteFailure } from '../board/board-write-adapter';
import { normalizeBoardInput, normalizeTwitchInput } from '../sources/source-inputs';
import { emptyAiApiUsage, type AiApiUsage } from '../../shared/ai-usage';
import { aiSkipMessage, parseAiReply, type AiGenerationResult } from './ai-reply';

export class AiServiceError extends Error {
  constructor(readonly kind: 'temporary' | 'attention' | 'rejected' | 'unknown', message: string) { super(message); }
}
export interface AiGateway {
  apiUsage?(): AiApiUsage;
  observeUsage?(listener: () => void): () => void;
  hasKey(): boolean; account(source: CommentSource): string | null;
  observeGeneration?(listener: (event: AiGenerationEvent) => void): () => void;
  generate(settings: AiSettings, persona: AiPersona, memory: AiMemory[], greeting: boolean, signal: AbortSignal, requestId?: string): Promise<AiGenerationResult>;
  post(source: CommentSource, target: string, text: string, settings: AiSettings, signal: AbortSignal, beforeSend: () => Promise<void>): Promise<string | undefined>;
}
export class AiConnections implements AiGateway {
  private readonly usage = emptyAiApiUsage();
  private readonly usageObservers = new Set<() => void>();
  apiUsage(): AiApiUsage { return structuredClone(this.usage); }
  observeUsage(listener: () => void) { this.usageObservers.add(listener); return () => { this.usageObservers.delete(listener); }; }
  private notifyUsage() { for (const observer of this.usageObservers) { try { observer(); } catch { /* Usage display cannot change generation. */ } } }
  private recordUsage(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const data = value as Record<string, unknown>;
    for (const [key, field] of [['input', 'promptTokenCount'], ['output', 'candidatesTokenCount'], ['total', 'totalTokenCount']] as const) {
      const count = data[field];
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(this.usage[key].tokens + count)) continue;
      this.usage[key].tokens += count; this.usage[key].responses++;
    }
  }
  private observers = new Set<(event: AiGenerationEvent) => void>();
  private lastImage: AiImageStatus = { reason: 'まだ生成していません。', durationMs: 0 };
  imageStatus() { return structuredClone(this.lastImage); }
  invalidateVisual() {
    this.lastImage = { reason: '設定または稼働状態が変わりました。次の生成を待っています。', durationMs: 0 };
    for (const observer of this.observers) observer({ id: '', stage: 'capture', status: 'cancelled', capture: { reason: this.lastImage.reason, durationMs: 0 }, apiDurationMs: 0, message: '表示を破棄しました。' });
  }
  observeGeneration(listener: (event: AiGenerationEvent) => void) { this.observers.add(listener); return () => { this.observers.delete(listener); }; }
  private secrets: AiSecrets = emptyAiSecrets();
  initialSetupFingerprint(): string {
    const s = this.secrets;
    return createHash('sha256').update(JSON.stringify([s.key, s.youtubeClient, s.twitchClientId, s.youtube?.accountId, s.twitch?.accountId])).digest('hex');
  }
  private auth: AbortController | null = null;
  private revision = 0;
  private refreshes = new Map<string, Promise<AiToken>>();
  private secretQueue = Promise.resolve();
  private protectionFailed = false;
  private twitchValidationFailed = false;
  private validatedAccess = '';
  private validations = new Map<string, Promise<void>>();
  private validationTimer?: ReturnType<typeof setInterval>;
  private save(update: (current: AiSecrets) => AiSecrets, valid = () => true) {
    const operation = this.secretQueue.then(async () => {
      const previous = structuredClone(this.secrets);
      const next = update(structuredClone(this.secrets));
      try {
        await this.store.saveSecrets(next);
        if (!valid()) { await this.store.saveSecrets(previous); return; }
        this.secrets = next; this.protectionFailed = false;
      }
      catch (e) { this.protectionFailed = true; this.changed(null, '資格情報を暗号化保存できません。保存環境を確認して再設定してください。'); throw e; }
    });
    this.secretQueue = operation.catch(() => undefined); return operation;
  }
  constructor(private readonly store: Pick<AiPersistence, 'loadSecrets' | 'saveSecrets' | 'logPrompt'>, private readonly openExternal: (url: string) => Promise<void>,
    private readonly changed: (authorization: AiView['authorization'], message?: string) => void,
    private readonly fetcher: typeof fetch = fetch,
    private readonly pause = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }),
    private readonly capture?: (source: AiVisualSource | null, signal: AbortSignal) => Promise<AiCapture>) {}
  async initialize() {
    this.secrets = await this.store.loadSecrets();
    const validate = async () => {
      if (!this.secrets.twitch) return;
      try { this.validatedAccess = ''; await this.access('twitch', AbortSignal.timeout(15000)); this.twitchValidationFailed = false; this.changed(null); }
      catch { this.twitchValidationFailed = true; this.changed(null, 'Twitchの認証を確認できません。再認証してください。'); }
    };
    void validate(); this.validationTimer = setInterval(() => { void validate(); }, 3600000); this.validationTimer.unref?.();
  }
  hasKey() { return !this.protectionFailed && Boolean(this.secrets.key); }
  account(source: CommentSource) { return source === 'shitaraba' ? 'したらば' : source === 'jpnkn' ? 'jpnkn' : source === 'twitch' && this.twitchValidationFailed ? null : this.secrets[source]?.accountName ?? null; }
  async shutdown() { this.revision++; clearInterval(this.validationTimer); this.cancelAuthorization(); await this.secretQueue; }
  cancelAuthorization() { this.auth?.abort(); this.auth = null; this.changed(null); }
  async configure(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('接続設定を確認してください。');
    const input = value as Record<string, unknown>;
    this.cancelAuthorization(); this.revision++;
    await this.save(next => {
    if (typeof input.key === 'string') next.key = input.key.trim();
    if (typeof input.twitchClientId === 'string') { next.twitchClientId = input.twitchClientId.trim(); delete next.twitch; }
    if (typeof input.youtubeJson === 'string' && input.youtubeJson.trim()) {
      try { const json = JSON.parse(input.youtubeJson) as { installed?: { client_id?: string; client_secret?: string } };
        if (!json.installed?.client_id || typeof json.installed.client_secret !== 'string') throw new Error();
        next.youtubeClient = { id: json.installed.client_id, secret: json.installed.client_secret }; delete next.youtube;
      } catch { throw new Error('YouTubeのDesktopクライアントJSONを確認してください。'); }
    }
      return next;
    }); this.changed(null);
  }
  async unlink(source: 'youtube' | 'twitch') {
    this.cancelAuthorization(); this.revision++; const token = this.secrets[source];
    await this.save(next => { delete next[source]; return next; });
    this.changed(null);
    if (token) {
      try { const url = source === 'youtube' ? 'https://oauth2.googleapis.com/revoke' : 'https://id.twitch.tv/oauth2/revoke';
        const body = new URLSearchParams({ token: token.access, ...(source === 'twitch' ? { client_id: this.secrets.twitchClientId } : {}) });
        const r = await this.fetcher(url, { method: 'POST', body, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error();
      } catch { this.changed(null, 'ローカル連携は解除しました。公式サイトでも接続済みアプリを確認してください。'); }
    }
  }
  begin(source: 'youtube' | 'twitch') {
    this.cancelAuthorization(); const controller = new AbortController(); this.auth = controller; const revision = ++this.revision;
    void (source === 'youtube' ? this.youtube(controller.signal) : this.twitch(controller.signal)).then(async token => {
      if (controller.signal.aborted || revision !== this.revision) return;
      await this.save(next => { if (controller.signal.aborted || revision !== this.revision) throw new Error('認証を中止しました。'); return { ...next, [source]: token }; }, () => !controller.signal.aborted && revision === this.revision);
      if (!controller.signal.aborted && revision === this.revision) { if (source === 'twitch') this.twitchValidationFailed = false; this.changed(null); }
    }).catch(() => { if (!controller.signal.aborted) this.changed(null, '認証を完了できませんでした。登録情報・許可・有効期限を確認して再連携してください。'); });
  }
  private async json(url: string, init: RequestInit = {}, observe?: (data: unknown) => void): Promise<Record<string, unknown>> {
    const response = await this.fetcher(url, init);
    if (!response.ok && new URL(url).origin === 'https://generativelanguage.googleapis.com') {
      // Only use recognised error categories. Raw messages may echo credentials or conversation text.
      const payload = await response.json().catch(() => null) as { error?: { details?: Array<{ reason?: string }> } } | null;
      observe?.(payload);
      const details = payload?.error?.details;
      const invalidKey = Array.isArray(details) && details.some(d => d?.reason === 'API_KEY_INVALID' || d?.reason === 'API_KEY_EXPIRED');
      let reason: string;
      if (invalidKey) reason = 'APIキーが無効または期限切れです。Google AI Studioでキーを確認し、保存し直してください。';
      else if (response.status === 429) reason = '利用枠・リクエスト制限に達しました。Google AI Studioでこのプロジェクトとモデルの利用上限・使用量を確認してください。待機時間を延ばすだけでは解消しない制限もあります。';
      else if (response.status === 401) reason = 'APIキーの認証に失敗しました。Google AI Studioのキーを確認して保存し直してください。';
      else if (response.status === 403) reason = 'アクセスが拒否されました。APIキーの制限・プロジェクトの権限・APIの利用可否を確認してください。';
      else if (response.status === 404) reason = '指定モデルを利用できません。モデル名と提供状況を確認してください。自動で別モデルへ切り替えません。';
      else if (response.status === 400) reason = '生成リクエストが拒否されました。モデル設定・APIキー・プロジェクトの利用条件を確認してください。';
      else reason = '文章生成サービスでエラーが発生しました。時間を置いて接続状態を確認してください。';
      const kind = response.status >= 500 || response.status === 408 ? 'temporary' : 'attention';
      throw new AiServiceError(kind, `Gemini（HTTP ${response.status}）：${reason}`);
    }
    if (!response.ok) throw new AiServiceError(response.status === 429 || response.status === 401 || response.status === 403 || response.status === 404 ? 'attention' : 'temporary', '外部サービスの利用制限・認証・接続を確認してください。');
    const data = await response.json() as Record<string, unknown>;
    observe?.(data);
    return data;
  }
  private async tokenResponse(url: string, body: URLSearchParams, signal: AbortSignal): Promise<AiToken> {
    const data = await this.json(url, { method: 'POST', body, signal });
    if (typeof data.access_token !== 'string') throw new Error('認証応答が正しくありません。');
    return { access: data.access_token, refresh: typeof data.refresh_token === 'string' ? data.refresh_token : '', expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000, accountId: '', accountName: '' };
  }
  private async identify(source: 'youtube' | 'twitch', token: AiToken, signal: AbortSignal) {
    const url = source === 'youtube' ? 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true' : 'https://api.twitch.tv/helix/users';
    const data = await this.json(url, { headers: this.headers(source, token), signal });
    const entries = (source === 'youtube' ? data.items : data.data) as Array<{ id: string; display_name?: string; snippet?: { title?: string } }>;
    if (!entries?.[0]?.id) throw new Error('投稿アカウントを確認できません。');
    return { ...token, accountId: entries[0].id, accountName: entries[0].display_name ?? entries[0].snippet?.title ?? entries[0].id };
  }
  private headers(source: 'youtube' | 'twitch', token: AiToken) { return { Authorization: `Bearer ${token.access}`, ...(source === 'twitch' ? { 'Client-Id': this.secrets.twitchClientId } : {}) }; }
  private async youtube(cancel: AbortSignal): Promise<AiToken> {
    const client = this.secrets.youtubeClient; if (!client) throw new Error('Desktop JSONが必要です。');
    const signal = AbortSignal.any([cancel, AbortSignal.timeout(300000)]);
    const state = randomBytes(24).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
    let resolveCode!: (code: string) => void; let rejectCode!: (e: Error) => void;
    const codePromise = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
    void codePromise.catch(() => undefined);
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback' || u.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid authorization response'); return; }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('きゃすメイトへ戻ってください。');
      const code = u.searchParams.get('code'); if (code) resolveCode(code); else rejectCode(new Error('認証が拒否されました。'));
    });
    const abort = () => { rejectCode(new Error('認証を中止しました。')); server.close(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address(); if (!address || typeof address === 'string') throw new Error();
      const redirect = `http://127.0.0.1:${address.port}/callback`;
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: client.id, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.force-ssl', access_type: 'offline', prompt: 'consent', state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
      this.changed({ source: 'youtube', url }); await this.openExternal(url);
      const code = await codePromise;
      return this.identify('youtube', await this.tokenResponse('https://oauth2.googleapis.com/token', new URLSearchParams({ client_id: client.id, client_secret: client.secret, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }), signal), signal);
    } finally { signal.removeEventListener('abort', abort); server.close(); }
  }
  private async twitch(cancel: AbortSignal): Promise<AiToken> {
    const id = this.secrets.twitchClientId; if (!id) throw new Error('Client IDが必要です。');
    const info = await this.json('https://id.twitch.tv/oauth2/device', { method: 'POST', body: new URLSearchParams({ client_id: id, scopes: 'user:write:chat' }), signal: AbortSignal.any([cancel, AbortSignal.timeout(15000)]) });
    const signal = AbortSignal.any([cancel, AbortSignal.timeout(Number(info.expires_in) * 1000)]);
    const url = String(info.verification_uri); const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['www.twitch.tv', 'id.twitch.tv'].includes(parsed.hostname)) throw new Error();
    this.changed({ source: 'twitch', code: String(info.user_code), url, expiresAt: Date.now() + Number(info.expires_in) * 1000 }); await this.openExternal(url);
    let interval = Math.max(5, Number(info.interval) || 5);
    while (!signal.aborted) {
      await this.pause(interval * 1000, signal);
      const response = await this.fetcher('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: id, scopes: 'user:write:chat', device_code: String(info.device_code), grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }), signal });
      const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; message?: string; error?: string };
      if (response.ok && data.access_token) return this.identify('twitch', { access: data.access_token, refresh: data.refresh_token ?? '', expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000, accountId: '', accountName: '' }, signal);
      const message = data.message ?? data.error ?? '';
      if (message.includes('slow_down')) interval += 5;
      else if (!message.includes('authorization_pending')) throw new Error('認証が拒否されました。');
    }
    throw new Error('認証期限が切れました。');
  }
  private async access(source: 'youtube' | 'twitch', signal: AbortSignal): Promise<AiToken> {
    const token = this.secrets[source]; if (!token) throw new AiServiceError('attention', '投稿用アカウントを連携してください。');
    if (token.expiresAt > Date.now() + 60000) { if (source === 'twitch') await this.validateTwitch(token, signal); return token; }
    if (!token.refresh) throw new AiServiceError('attention', '投稿アカウントを再認証してください。');
    let pending = this.refreshes.get(source);
    if (!pending) {
      const revision = this.revision;
      pending = (async () => {
        const client = this.secrets.youtubeClient;
        const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh, client_id: source === 'youtube' ? client!.id : this.secrets.twitchClientId, ...(source === 'youtube' ? { client_secret: client!.secret } : {}) });
        const updated = await this.tokenResponse(source === 'youtube' ? 'https://oauth2.googleapis.com/token' : 'https://id.twitch.tv/oauth2/token', body, signal);
        const result = { ...updated, refresh: updated.refresh || token.refresh, accountId: token.accountId, accountName: token.accountName };
        if (revision !== this.revision) throw new Error('連携が変更されました。');
        await this.save(next => { if (revision !== this.revision) throw new Error('連携が変更されました。'); return { ...next, [source]: result }; }, () => revision === this.revision);
        if (revision !== this.revision) throw new Error('連携が変更されました。'); return result;
      })().finally(() => this.refreshes.delete(source)); this.refreshes.set(source, pending);
    }
    const updated = await pending; if (source === 'twitch') await this.validateTwitch(updated, signal); return updated;
  }
  private async validateTwitch(token: AiToken, signal: AbortSignal) {
    if (this.validatedAccess === token.access) return;
    let pending = this.validations.get(token.access);
    if (!pending) {
      pending = (async () => {
        const data = await this.json('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token.access}` }, signal });
        if (data.client_id !== this.secrets.twitchClientId || data.user_id !== token.accountId || !Array.isArray(data.scopes) || !data.scopes.includes('user:write:chat')) throw new AiServiceError('attention', 'Twitchを再認証してください。');
        this.validatedAccess = token.access;
      })().finally(() => this.validations.delete(token.access));
      this.validations.set(token.access, pending);
    }
    await pending;
  }
  async generate(settings: AiSettings, persona: AiPersona, memory: AiMemory[], greeting: boolean, signal: AbortSignal, requestId?: string, transient = false): Promise<AiGenerationResult> {
    const id = requestId ?? randomUUID(); let apiStarted = 0;
    let capture: AiCapture = { reason: '画像添付はオフです。', durationMs: 0 };
    const emit = (stage: AiGenerationEvent['stage'], status: AiGenerationEvent['status'], message: string, text?: string) => {
      for (const observer of this.observers) { try { observer({ id, stage, status, capture, apiDurationMs: apiStarted ? Date.now() - apiStarted : 0, message, ...(transient && text !== undefined ? { text } : {}) }); } catch { /* Observers cannot change generation. */ } }
    };
    try {
    signal.throwIfAborted(); emit('capture', 'working', '画像入力を準備しています。');
    if (settings.visual?.enabled) capture = this.capture ? await this.capture(settings.visual.source, signal) : { reason: '画像取得を利用できません。', durationMs: 0 };
    signal.throwIfAborted(); if (!transient) this.lastImage = imageStatus(capture);
    const { body, logBody, stats, replyTargets } = buildAiPrompt(settings, persona, memory, greeting, new Date(), capture.image);
    signal.throwIfAborted();
    if (settings.debugPromptLog && !transient) {
      const logged = settings.visual?.enabled ? JSON.stringify({ ...JSON.parse(logBody), imageAttachment: imageStatus(capture) }) : logBody;
      try { await this.store.logPrompt(id, settings.model, logged, stats); }
      catch { throw new AiServiceError('attention', 'プロンプトのデバッグログを保存できません。保存先を確認して再開してください。'); }
    }
    signal.throwIfAborted();
    apiStarted = Date.now(); emit('api', 'working', 'Geminiへ送信しています。');
    const text = await this.generateText(settings.model, body, signal);
    const result = text ? parseAiReply(text, replyTargets.allowed, greeting) : '';
    emit('api', 'succeeded', typeof result === 'string' ? 'Geminiの応答を受信しました。' : aiSkipMessage(result), typeof result === 'string' ? result : undefined);
    return result;
    } catch (error) {
      emit(apiStarted ? 'api' : 'capture', signal.aborted ? 'cancelled' : 'failed', signal.aborted ? '処理を取り消しました。' : error instanceof AiServiceError ? error.message : '画像取得またはGemini通信に失敗しました。');
      throw error;
    }
  }
  async testApi(model: string, signal: AbortSignal): Promise<void> {
    if (!this.hasKey()) throw new AiServiceError('attention', 'Gemini APIキーを保存してからテストしてください。');
    const validated = validateAiSettings({ ...defaultAiSettings(), model });
    const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'APIの応答確認です。OKとだけ返答してください。' }] }],
      generationConfig: { maxOutputTokens: 256 } });
    const text = await this.generateText(validated.model, body, signal);
    if (!text) throw new AiServiceError('rejected', 'Geminiから文章応答を確認できませんでした。モデルと利用条件を確認してください。');
  }
  private async generateText(model: string, body: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    this.usage.requests++; this.usage.pending++; this.notifyUsage();
    try {
    const data = await this.json(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.secrets.key },
      signal: requestSignal, body,
    }, data => this.recordUsage(data && typeof data === 'object' ? (data as Record<string, unknown>).usageMetadata : undefined));
    signal.throwIfAborted();
    const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> | undefined;
    return candidates?.[0]?.content?.parts?.map(p => p.thought !== true && typeof p.text === 'string' ? p.text : '').join('').trim() ?? '';
    } finally { this.usage.pending--; this.notifyUsage(); }
  }
  async post(source: CommentSource, target: string, text: string, settings: AiSettings, signal: AbortSignal, beforeSend: () => Promise<void>): Promise<string | undefined> {
    if (source === 'shitaraba' || source === 'jpnkn') {
      const label = source === 'shitaraba' ? 'したらば' : 'jpnkn';
      try {
        const currentThread = normalizeBoardInput(target);
        if (currentThread.service !== source) throw new AiServiceError('rejected', '掲示板のサービスと投稿先が一致しません。');
        const writer = createBoardWriteAdapter({ fetch: async (input, init) => {
          if (init?.method === 'POST') { signal.throwIfAborted(); await beforeSend(); return this.fetcher(input, { ...init, signal: AbortSignal.timeout(15000) }); }
          return this.fetcher(input, { ...init, signal });
        } });
        await writer.postAiComment({ currentThread, message: text, authorName: source === 'shitaraba' ? settings.shitarabaName : settings.jpnknName, email: source === 'shitaraba' ? settings.shitarabaEmail : settings.jpnknEmail }); return undefined;
      } catch (e) {
        // Preflight failures contain only fixed local messages, never the remote response or generated text.
        if (e instanceof AiServiceError) throw e;
        if (e instanceof BoardWriteFailure && e.kind === 'preflight') throw new AiServiceError('rejected', e.message);
        if (e instanceof BoardWriteFailure && e.kind === 'browserRequired') throw new AiServiceError('rejected', `${label}はブラウザで認証を確認してください。アプリから自動再送しません。`);
        throw new AiServiceError(e instanceof BoardWriteFailure && e.kind !== 'uncertain' ? 'rejected' : 'unknown', `${label}の投稿結果を確認してください。`);
      }
    }
    const token = await this.access(source, signal); let url: string; let payload: unknown;
    if (source === 'youtube') {
      const videos = await this.json(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(target)}`, { headers: this.headers(source, token), signal });
      const liveChatId = (videos.items as Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>)?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!liveChatId) throw new AiServiceError('rejected', 'YouTubeの投稿先チャットを確認できません。');
      url = 'https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet'; payload = { snippet: { liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } };
    } else {
      const user = await this.json(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(normalizeTwitchInput(target))}`, { headers: this.headers(source, token), signal });
      const id = (user.data as Array<{ id: string }>)?.[0]?.id; if (!id) throw new AiServiceError('rejected', 'Twitchの投稿先を確認できません。');
      url = 'https://api.twitch.tv/helix/chat/messages'; payload = { broadcaster_id: id, sender_id: token.accountId, message: text };
    }
    signal.throwIfAborted(); await beforeSend();
    try {
      const response = await this.fetcher(url, { method: 'POST', headers: { ...this.headers(source, token), 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new AiServiceError(response.status < 500 ? 'rejected' : 'unknown', '投稿が拒否されたか結果を確認できません。');
      const data = await response.json() as { id?: string; data?: Array<{ message_id: string; is_sent: boolean }> };
      if (source === 'youtube' && data.id) return data.id;
      if (source === 'twitch' && data.data?.[0]?.is_sent) return data.data[0].message_id;
      throw new AiServiceError('rejected', '投稿が受け付けられませんでした。');
    } catch (e) { if (e instanceof AiServiceError) throw e; throw new AiServiceError('unknown', '投稿結果が不明です。サービス上で確認してください。'); }
  }
}
