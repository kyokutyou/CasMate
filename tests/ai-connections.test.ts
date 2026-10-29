import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { AiConnections, AiServiceError } from '../src/main/ai/ai-connections';
import { emptyAiSecrets, type AiSecrets } from '../src/main/ai/ai-store';
import { defaultAiSettings } from '../src/shared/ai-listener';
import iconv from 'iconv-lite';

const connections: AiConnections[] = [];
const persona = { id: 'p', name: '人格', personality: '', tone: '', firstPerson: '', topics: '', notes: '' };
function fixture(secrets = emptyAiSecrets(), open = async (_url: string) => undefined) {
  const store = { logPrompt: vi.fn(async (_id: string, _model: string, _body: string) => undefined), logPromptOutcome: vi.fn(async (_id: string, _reason: string) => undefined), loadSecrets: async () => structuredClone(secrets), saveSecrets: vi.fn(async (value: AiSecrets) => { Object.assign(secrets, structuredClone(value)); }) };
  const fetcher = vi.fn<typeof fetch>(); const changed = vi.fn();
  const pause = vi.fn(async (_ms: number, signal: AbortSignal) => { signal.throwIfAborted(); });
  const c = new AiConnections(store, open, changed, fetcher, pause); connections.push(c);
  return { c, fetcher, changed, store, secrets, pause };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const token = { access: 'access-secret', refresh: 'refresh-secret', expiresAt: Date.now() + 3600000, accountId: 'sender', accountName: '投稿用アカウント' };
afterEach(async () => { for (const c of connections.splice(0)) await c.shutdown(); vi.useRealTimers(); });
describe('AI外部接続境界（外部通信はモック）', () => {
  it('対象番号付きの生成判断を検証し、投稿用の本文だけを返す', async () => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), key: 'key' }); await c.initialize();
    fetcher.mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'reply', target: 1, text: '未開拓の右が気になる', reason: 'none' }) }] } }] }));
    const memory = [{ id: 'private-memory', at: '2026-10-15T00:00:00Z', role: 'streamer' as const, source: null, text: '左は行き止まりだった' }];
    expect(await c.generate(defaultAiSettings(), persona, memory, false, new AbortController().signal)).toBe('未開拓の右が気になる');
    expect(fetcher).toHaveBeenCalledOnce();
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request.generationConfig.responseMimeType).toBe('application/json');
    expect(request.generationConfig.responseSchema.required).toEqual(['action', 'target', 'text', 'reason']);
    expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain('private-memory');
  });
  it('思考パートを返答JSONやデバッグ本文へ混ぜず、分割された最終応答を読む', async () => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), key: 'key' }); await c.initialize();
    const events: unknown[] = []; c.observeGeneration(event => events.push(event));
    fetcher.mockResolvedValue(json({ candidates: [{ content: { parts: [
      { text: '非表示の思考', thought: true },
      { text: '{"action":"reply","target":0,' }, { text: '"text":"こんにちは","reason":"none"}', thought: false },
    ] } }] }));
    expect(await c.generate(defaultAiSettings(), persona, [], true, new AbortController().signal, 'request', true)).toBe('こんにちは');
    expect(JSON.stringify(events)).not.toContain('非表示の思考'); expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    ['explicit', JSON.stringify({ action: 'skip', target: 0, text: '', reason: 'unclear' }), 'unclear'],
    ['unknown-target', JSON.stringify({ action: 'reply', target: 99, text: '秘密本文', reason: 'none' }), 'invalid-response'],
    ['ai-target', JSON.stringify({ action: 'reply', target: 1, text: '秘密本文', reason: 'none' }), 'invalid-response'],
    ['old-format', '秘密本文', 'invalid-response'],
    ['broken-json', '{"text":"秘密本文"', 'invalid-response'],
  ])('%sは1回のAPI要求で安全に見送り、デバッグへ生応答を表示しない', async (_label, raw, reason) => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), key: 'key' }); await c.initialize();
    const events: unknown[] = []; c.observeGeneration(event => events.push(event));
    fetcher.mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: raw }] } }], usageMetadata: { totalTokenCount: 12 } }));
    const memory = [
      { id: 'a', at: '2026-10-15T00:00:00Z', role: 'ai' as const, source: 'youtube' as const, text: '前のAI発言' },
      { id: 's', at: '2026-10-15T00:00:01Z', role: 'streamer' as const, source: null, text: '配信者の発言' },
    ];
    expect(await c.generate(defaultAiSettings(), persona, memory, false, new AbortController().signal, 'request', true)).toEqual({ action: 'skip', reason });
    expect(fetcher).toHaveBeenCalledOnce(); expect(JSON.stringify(events)).not.toContain('秘密本文');
    expect(events.at(-1)).toMatchObject({ status: 'succeeded', message: expect.stringContaining('見送り') });
    expect(c.apiUsage()).toMatchObject({ requests: 1, pending: 0, total: { tokens: 12, responses: 1 } });
  });
  it('通常・APIテスト・開発テストの送信と報告トークンだけを起動中に集計する', async () => {
    const { c, fetcher, store } = fixture({ ...emptyAiSecrets(), key: 'secret-key' }); await c.initialize();
    const response = () => json({ candidates: [{ content: { parts: [{ text: '応答' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 17, thoughtsTokenCount: 5 } });
    fetcher.mockImplementation(async () => response());
    const observe = vi.fn(); const unsubscribe = c.observeUsage(observe);
    await c.generate(defaultAiSettings(), persona, [], true, new AbortController().signal);
    await c.testApi(defaultAiSettings().model, new AbortController().signal);
    await c.generate(defaultAiSettings(), persona, [], true, new AbortController().signal, 'debug', true);
    expect(c.apiUsage()).toEqual({ requests: 3, pending: 0, input: { tokens: 30, responses: 3 }, output: { tokens: 6, responses: 3 }, total: { tokens: 51, responses: 3 } });
    expect(observe).toHaveBeenCalled(); expect(store.logPrompt).not.toHaveBeenCalled();
    const copy = c.apiUsage(); copy.input.tokens = 999; expect(c.apiUsage().input.tokens).toBe(30);
    unsubscribe(); observe.mockClear();
    await c.testApi(defaultAiSettings().model, new AbortController().signal); expect(observe).not.toHaveBeenCalled();
  });
  it('部分的・欠落・不正な使用量を0で補完せず、失敗・送信前取消を区別する', async () => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), key: 'secret-key' }); await c.initialize();
    fetcher.mockResolvedValueOnce(json({ candidates: [], usageMetadata: { promptTokenCount: 0, candidatesTokenCount: -1, totalTokenCount: '10' } }))
      .mockResolvedValueOnce(json({ candidates: [], usageMetadata: { promptTokenCount: 1.5, candidatesTokenCount: Number.MAX_SAFE_INTEGER + 1, totalTokenCount: 20 } }))
      .mockRejectedValueOnce(new Error('network'));
    await c.generate(defaultAiSettings(), persona, [], false, new AbortController().signal);
    await c.generate(defaultAiSettings(), persona, [], false, new AbortController().signal);
    await expect(c.generate(defaultAiSettings(), persona, [], false, new AbortController().signal)).rejects.toThrow();
    const cancelled = new AbortController(); cancelled.abort();
    await expect(c.generate(defaultAiSettings(), persona, [], false, cancelled.signal)).rejects.toThrow();
    expect(c.apiUsage()).toEqual({ requests: 3, pending: 0, input: { tokens: 0, responses: 1 }, output: { tokens: 0, responses: 0 }, total: { tokens: 20, responses: 1 } });
  });
  it('並行送信と取消後の遅い応答も集計し、取消した生成文は返さない', async () => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), key: 'secret-key' }); await c.initialize();
    let finish!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(json({ candidates: [], usageMetadata: { totalTokenCount: 7 } }));
    const cancel = new AbortController();
    const generation = c.generate(defaultAiSettings(), persona, [], false, cancel.signal);
    const rejected = generation.catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(c.apiUsage()).toMatchObject({ requests: 1, pending: 1 });
    await c.generate(defaultAiSettings(), persona, [], false, new AbortController().signal);
    cancel.abort(); finish(json({ candidates: [], usageMetadata: { totalTokenCount: 9 } }));
    expect(await rejected).toBeInstanceOf(Error);
    expect(c.apiUsage()).toMatchObject({ requests: 2, pending: 0, total: { tokens: 16, responses: 2 } });
  });
  it.each([
    ['jpnkn', 'https://jbbs.shitaraba.net/bbs/read.cgi/game/1/2/'],
    ['shitaraba', 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791458242/'],
  ] as const)('%sと投稿URLのサービスが違う場合はフォーム取得前に止める', async (source, target) => {
    const { c, fetcher } = fixture(); await c.initialize(); const before = vi.fn(async () => undefined);
    await expect(c.post(source, target, '送らない本文', defaultAiSettings(), new AbortController().signal, before)).rejects.toThrow('サービスと投稿先が一致しません');
    expect(fetcher).not.toHaveBeenCalled(); expect(before).not.toHaveBeenCalled();
  });
  it('jpnkn専用の名前・メールとCP932本文を公開フォームへ送り、URLのhを除かない', async () => {
    const { c, fetcher } = fixture(); await c.initialize();
    const form = '<form method="post" action="/test/bbs.cgi"><input name="FROM"><input name="mail"><textarea name="MESSAGE"></textarea><input type="hidden" name="bbs" value="kyokutyou"><input type="hidden" name="key" value="1791458242"></form>';
    const response = (text: string) => new Response(new Uint8Array(iconv.encode(text, 'cp932')), { headers: { 'Content-Type': 'text/html; charset=Shift_JIS' } });
    fetcher.mockResolvedValueOnce(response(form)).mockResolvedValueOnce(response('<title>書きこみました</title>'));
    const settings = { ...defaultAiSettings(), jpnknName: 'jpnkn-AI', jpnknEmail: 'jpnkn-mail', shitarabaName: '別名', shitarabaEmail: '別メール' };
    const before = vi.fn(async () => undefined); const target = 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791458242/';
    await expect(c.post('jpnkn', target, 'あ http://example.test/', settings, new AbortController().signal, before)).resolves.toBeUndefined();
    expect(before).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(target); expect(fetcher.mock.calls[1][0]).toBe('https://bbs.jpnkn.com/test/bbs.cgi');
    const body = fetcher.mock.calls[1][1]?.body; expect(body).toBeInstanceOf(Uint8Array);
    if (!(body instanceof Uint8Array)) throw new Error('Expected byte form');
    const fields = new URLSearchParams(Buffer.from(body).toString('ascii'));
    expect(fields.get('FROM')).toBe('jpnkn-AI'); expect(fields.get('mail')).toBe('jpnkn-mail'); expect(fields.get('key')).toBe('1791458242');
    expect(Buffer.from(body).toString('ascii')).toContain('MESSAGE=%82%A0+http%3A%2F%2Fexample.test%2F');
    expect(fetcher.mock.calls[1][1]?.redirect).toBe('manual');
  });
  it.each(['form', 'response'] as const)('jpnknの%sで認証要求が出たらブラウザ案内の拒否とし、再送しない', async stage => {
    const { c, fetcher } = fixture(); await c.initialize();
    const form = '<form method="post" action="/test/bbs.cgi"><input name="FROM"><input name="mail"><textarea name="MESSAGE"></textarea><input type="hidden" name="bbs" value="kyokutyou"><input type="hidden" name="key" value="1791458242"></form>';
    const response = (html: string) => new Response(html, { headers: { 'Content-Type': 'text/html; charset=Shift_JIS' } });
    fetcher.mockResolvedValueOnce(response(stage === 'form' ? '<div class="cf-turnstile"></div>' : form));
    if (stage === 'response') fetcher.mockResolvedValueOnce(response('<div class="cf-turnstile"></div>'));
    const before = vi.fn(async () => undefined);
    await expect(c.post('jpnkn', 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791458242/', '本文', defaultAiSettings(), new AbortController().signal, before)).rejects.toMatchObject({ kind: 'rejected', message: expect.stringContaining('ブラウザ') });
    expect(fetcher).toHaveBeenCalledTimes(stage === 'form' ? 1 : 2); expect(before).toHaveBeenCalledTimes(stage === 'form' ? 0 : 1);
  });
  it('デバッグオン時だけ実際の送信本文を記録し、認証情報を渡さない', async () => {
    const { c, fetcher, store } = fixture({ ...emptyAiSecrets(), key: 'secret-key' }); await c.initialize();
    fetcher.mockImplementation(async () => json({ candidates: [] }));
    const settings = defaultAiSettings();
    await c.generate(settings, persona, [], true, new AbortController().signal);
    expect(store.logPrompt).not.toHaveBeenCalled();
    settings.debugPromptLog = true;
    await c.generate(settings, persona, [], true, new AbortController().signal);
    expect(store.logPrompt).toHaveBeenCalledExactlyOnceWith(expect.any(String), settings.model, fetcher.mock.calls[1][1]?.body, expect.objectContaining({ beforeCharacters: 0, afterCharacters: 0, selectedCount: 0 }));
    expect(store.logPrompt.mock.calls[0][2]).not.toContain('secret-key');
    expect(store.logPrompt.mock.calls[0][2]).not.toContain('x-goog-api-key');
    expect(JSON.parse(store.logPrompt.mock.calls[0][2]).systemInstruction.parts[0].text).toContain('目標20文字');
    store.logPrompt.mockRejectedValueOnce(new Error('private path'));
    await expect(c.generate(settings, persona, [], true, new AbortController().signal)).rejects.toMatchObject({ kind: 'attention', message: expect.stringContaining('デバッグログを保存できません') });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['encoding', 'したらばの文字コードで表せない文字'],
    ['fetch', 'したらばの公開フォームを取得できません'],
  ])('したらば投稿準備の%s失敗を本文なしで通知し、POSTしない', async (failure, reason) => {
    const { c, fetcher } = fixture(); await c.initialize();
    const form = '<form method="post" action="/bbs/write.cgi/game/1/2/" accept-charset="EUC-JP"><input name="NAME"><input name="MAIL"><textarea name="MESSAGE"></textarea></form>';
    fetcher.mockResolvedValue(new Response(form, { status: failure === 'fetch' ? 503 : 200 }));
    const before = vi.fn(async () => undefined);
    const operation = c.post('shitaraba', 'https://jbbs.shitaraba.net/bbs/read.cgi/game/1/2/', '秘密の本文😀', defaultAiSettings(), new AbortController().signal, before);
    await expect(operation).rejects.toThrow(reason);
    await expect(operation).rejects.not.toThrow('秘密の本文');
    expect(before).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    [429, {}, '利用枠・リクエスト制限'],
    [401, {}, 'APIキー'],
    [403, {}, '権限'],
    [404, {}, 'モデル'],
    [400, { details: [{ reason: 'API_KEY_INVALID' }] }, 'APIキーが無効'],
    [400, {}, '生成リクエスト'],
  ])('Gemini HTTP %sの原因を秘密情報なしで判別できる', async (status, error, expected) => {
    const { c, fetcher } = fixture(); await c.initialize();
    fetcher.mockResolvedValue(json({ error: { ...error, message: 'secret-key private-conversation https://private.example' } }, status));
    const operation = c.generate(defaultAiSettings(), persona, [], true, new AbortController().signal);
    await expect(operation).rejects.toMatchObject({ kind: 'attention', message: expect.stringContaining(`Gemini（HTTP ${status}）`) });
    await expect(operation).rejects.toThrow(expected);
    await expect(operation).rejects.not.toThrow('secret-key');
    await expect(operation).rejects.not.toThrow('private-conversation');
  });
  it('Twitch Public Device Codeの権限とポーリング間隔を守り、待機中は連携を成立させない', async () => {
    const open = vi.fn(async (_url: string) => undefined);
    const { c, fetcher, pause } = fixture({ ...emptyAiSecrets(), twitchClientId: 'client' }, open); await c.initialize();
    fetcher.mockResolvedValueOnce(json({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 1800, interval: 5 }))
      .mockResolvedValueOnce(json({ message: 'authorization_pending' }, 400)).mockResolvedValueOnce(json({ message: 'slow_down' }, 400))
      .mockResolvedValueOnce(json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ data: [{ id: 'sender', display_name: '認証済み' }] }));
    c.begin('twitch'); expect(c.account('twitch')).toBeNull(); await vi.waitFor(() => expect(c.account('twitch')).toBe('認証済み'));
    expect(pause.mock.calls.map(c => c[0])).toEqual([5000, 5000, 10000]);
    expect(new URLSearchParams(String(fetcher.mock.calls[1][1]?.body)).get('scopes')).toBe('user:write:chat');
    expect(String(fetcher.mock.calls[1][1]?.body)).not.toContain('client_secret');
  });
  it('Geminiへ必要な会話データだけを送り、検索・ツールを指定しない', async () => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), key: 'gemini-secret', youtube: token }); await c.initialize();
    fetcher.mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'reply', target: 1, text: 'こんにちは', reason: 'none' }) }] } }] }));
    const memory = [{ id: 'internal-id', at: '2026-09-13T00:00:00Z', role: 'viewer' as const, source: 'youtube' as const, text: '配信の話' }];
    expect(await c.generate(defaultAiSettings(), persona, memory, true, new AbortController().signal)).toBe('こんにちは');
    const [url, init] = fetcher.mock.calls[0]; expect(String(url)).toContain('gemini-3.1-flash-lite:generateContent');
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'gemini-secret' });
    const body = JSON.parse(String(init?.body)); const data = JSON.parse(body.contents[0].parts[0].text);
    expect(data['最近の会話'][0].entries).toEqual([[expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/), '視聴者', 'YouTube Live', '配信の話', 1]]);
    expect(data['最近の会話'][0].utcOffset).toMatch(/^[+-]\d{2}:\d{2}$/);
    expect(data['関連する過去の会話']).toBeUndefined();
    expect(body.tools).toBeUndefined(); expect(String(init?.body)).not.toContain('secret'); expect(String(init?.body)).not.toContain('internal-id');
  });
  it('Gemini利用制限は再生成の一時障害と区別する', async () => {
    const { c, fetcher } = fixture(); await c.initialize(); fetcher.mockResolvedValue(json({}, 429));
    await expect(c.generate(defaultAiSettings(), persona, [], true, new AbortController().signal)).rejects.toMatchObject({ kind: 'attention' });
    fetcher.mockResolvedValue(json({}, 503)); await expect(c.generate(defaultAiSettings(), persona, [], true, new AbortController().signal)).rejects.toMatchObject({ kind: 'temporary' });
  });
  it('YouTubeの配信IDからチャットを解決し、投稿前記録後に一度だけ送信する', async () => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), youtube: token }); await c.initialize();
    fetcher.mockResolvedValueOnce(json({ items: [{ liveStreamingDetails: { activeLiveChatId: 'chat' } }] })).mockResolvedValueOnce(json({ id: 'posted' }));
    const before = vi.fn(async () => { expect(fetcher).toHaveBeenCalledTimes(1); });
    expect(await c.post('youtube', 'video', '会話本文', defaultAiSettings(), new AbortController().signal, before)).toBe('posted');
    expect(before).toHaveBeenCalledOnce(); const payload = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(payload.snippet.liveChatId).toBe('chat'); expect(payload.snippet.textMessageDetails.messageText).toBe('会話本文');
  });
  it('投稿前記録を保存できない場合は外部へPOSTしない', async () => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), youtube: token }); await c.initialize();
    fetcher.mockResolvedValueOnce(json({ items: [{ liveStreamingDetails: { activeLiveChatId: 'chat' } }] }));
    await expect(c.post('youtube', 'video', '本文', defaultAiSettings(), new AbortController().signal, async () => { throw new Error('disk'); })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  });
  it('PKCE・stateを検証し、誤ったstateを拒否してからDesktop認証を保存する', async () => {
    let challenge = '';
    const { c, fetcher, store } = fixture({ ...emptyAiSecrets(), youtubeClient: { id: 'desktop-id', secret: 'desktop-secret' } }, async url => {
      const request = new URL(url); challenge = request.searchParams.get('code_challenge')!;
      expect(request.origin).toBe('https://accounts.google.com'); expect(request.searchParams.get('code_challenge_method')).toBe('S256');
      const callback = new URL(request.searchParams.get('redirect_uri')!); expect(callback.hostname).toBe('127.0.0.1');
      callback.searchParams.set('code', 'test-code'); callback.searchParams.set('state', 'wrong'); expect((await fetch(callback)).status).toBe(400);
      callback.searchParams.set('state', request.searchParams.get('state')!); expect((await fetch(callback)).status).toBe(200);
    });
    await c.initialize(); fetcher.mockImplementation(async (url, init) => {
      if (String(url).includes('/token')) {
        const form = new URLSearchParams(String(init?.body)); expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(challenge);
        return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
      }
      return json({ items: [{ id: 'channel', snippet: { title: 'アカウント' } }] });
    });
    c.begin('youtube'); await vi.waitFor(() => expect(c.account('youtube')).toBe('アカウント'));
    expect(store.saveSecrets).toHaveBeenCalledOnce();
  });
  it('Twitchの送信拒否を成功とせず、起動時にトークンの主体と権限を検証する', async () => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), twitchClientId: 'client', twitch: token });
    fetcher.mockResolvedValueOnce(json({ client_id: 'client', user_id: 'sender', scopes: ['user:write:chat'] })); await c.initialize();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    fetcher.mockResolvedValueOnce(json({ data: [{ id: 'broadcaster' }] })).mockResolvedValueOnce(json({ data: [{ is_sent: false, message_id: '' }] }));
    await expect(c.post('twitch', 'channel', '本文', defaultAiSettings(), new AbortController().signal, async () => undefined)).rejects.toMatchObject({ kind: 'rejected' });
    expect(String(fetcher.mock.calls[0][0])).toContain('/validate');
  });
  it('暗号化保存失敗後に古いキーで稼働を続けない', async () => {
    const { c, store } = fixture({ ...emptyAiSecrets(), key: 'old' }); await c.initialize();
    store.saveSecrets.mockRejectedValueOnce(new Error('encryption unavailable')); await expect(c.configure({ key: 'new' })).rejects.toThrow(); expect(c.hasKey()).toBe(false);
    await c.configure({ key: 'new' }); expect(c.hasKey()).toBe(true);
  });
  it('送信後の通信切断を結果不明として扱い自動再送しない', async () => {
    const { c, fetcher } = fixture({ ...emptyAiSecrets(), youtube: token }); await c.initialize();
    fetcher.mockResolvedValueOnce(json({ items: [{ liveStreamingDetails: { activeLiveChatId: 'chat' } }] })).mockRejectedValueOnce(new Error('offline'));
    await expect(c.post('youtube', 'video', '本文', defaultAiSettings(), new AbortController().signal, async () => undefined)).rejects.toEqual(new AiServiceError('unknown', '投稿結果が不明です。サービス上で確認してください。'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
