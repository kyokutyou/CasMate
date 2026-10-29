import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AiConnections } from '../src/main/ai/ai-connections';
import { AiController } from '../src/main/ai/ai-controller';
import { VisualDebug } from '../src/main/ai/visual-debug';
import { type AiPersistence, emptyAiSecrets } from '../src/main/ai/ai-store';
import { createDefaultSettings } from '../src/main/core/settings';
import { AppState } from '../src/main/core/app-state';
import { createHttpApplication } from '../src/main/server/local-server';
import { ObsVisual } from '../src/main/obs/obs-visual';
import type { AiCapture } from '../src/shared/ai-visual';
import { readOnlyEvent } from '../src/main/server/local-view-projections';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function fixture(debugEnabled = true, withoutPersona = false) {
  const settings = createDefaultSettings();
  const persona = { id: 'p', name: '人格', tone: '', personality: '', firstPerson: '', topics: '', notes: '' };
  settings.aiListener.personas = withoutPersona ? [] : [persona]; settings.aiListener.debugPromptLog = true;
  settings.aiListener.visual = { enabled: true, source: { uuid: 'game', name: 'private-source', collection: 'private-collection' } };
  const store: AiPersistence = {
    loadPostingBudget: async () => null, savePostingBudget: async () => {},
    loadSecrets: async () => ({ ...emptyAiSecrets(), key: 'private-key' }), saveSecrets: async () => {},
    loadMemory: async () => [{ id: '1', at: '2026-09-18T01:00:00Z', role: 'streamer', source: null, text: 'ここ見て' }],
    saveMemory: vi.fn(async () => {}), loadAttempts: async () => [], log: vi.fn(async () => {}),
    discardAttempt: async () => {}, logPrompt: vi.fn(async () => {}), logPromptOutcome: vi.fn(async () => {}),
    loadSuppressed: async () => false, saveSuppressed: async () => {}, checkWritable: async () => {}, prune: async () => {}, flush: async () => {},
  };
  const capture = vi.fn(async (): Promise<AiCapture> => ({ image: { data: 'unique-image-bytes', mimeType: 'image/jpeg', width: 1280, height: 720, bytes: 42, capturedAt: '2026-09-18T03:00:00Z' }, reason: '画像あり', durationMs: 12 }));
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'reply', target: 1, text: '大きな建物だ', reason: 'none' }) }] } }] }), { status: 200 }));
  const connections = new AiConnections(store, async () => {}, () => {}, fetcher, undefined, capture);
  await connections.initialize();
  const state = new AppState(settings);
  const controller = new AiController(settings.aiListener, { store, gateway: connections, changed: v => state.setAiView(v), acquire: async () => {}, release: async () => {}, ngWords: () => [], invalidated: () => connections.invalidateVisual() });
  await controller.initialize(); state.attachAi(controller);
  const debug = new VisualDebug(controller, connections);
  const visual = new ObsVisual(() => { throw new Error('disconnected'); });
  const app = createHttpApplication({ state, port: 3000, operationToken: 'token', ai: { controller, connections, openLogs: async () => {} }, aiVisual: { visual, ...(debugEnabled ? { debug } : {}) } });
  cleanups.push(async () => { debug.close(); await state.shutdown(); await connections.shutdown(); });
  const post = (path: string) => request(app).post(`/api/ai-listener/${path}`).set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').set('X-CasMate-Token', 'token');
  return { settings, persona, store, capture, fetcher, connections, controller, debug, post, app };
}
describe('画像生成の統合境界', () => {
  it('テスト生成の明示見送りを固定理由で表示し、投稿・保存・通常結果へ加算しない', async () => {
    const f = await fixture(); const before = f.controller.view();
    f.fetcher.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'skip', target: 0, text: '', reason: 'resolved' }) }] } }] })));
    expect((await f.post('visual-debug/generate').send({ personaId: 'p' })).status).toBe(200);
    const result = await f.post('visual-debug/status');
    expect(result.body.event).toMatchObject({ status: 'succeeded', message: '今回は見送りました（解決済み）。' });
    expect(result.body.event.text).toBeUndefined(); expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.store.log).not.toHaveBeenCalled(); expect(f.store.saveMemory).not.toHaveBeenCalled();
    expect(f.store.logPrompt).not.toHaveBeenCalled(); expect(f.store.logPromptOutcome).not.toHaveBeenCalled();
    expect(f.controller.view().usage?.outcomes).toEqual(before.usage?.outcomes);
    expect(f.controller.view().postingBudget).toEqual(before.postingBudget);
  });
  it('APIテストの使用量を管理状態へ反映し、読取面とテスト応答へ公開しない', async () => {
    const f = await fixture(false);
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 } })));
    expect((await f.post('test-api').send({})).body.usage).toBeUndefined();
    const management = await request(f.app).get('/api/bootstrap?view=management').set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'token');
    expect(management.body.snapshot.aiListener.usage).toEqual({ api: { requests: 1, pending: 0,
      input: { tokens: 8, responses: 1 }, output: { tokens: 2, responses: 1 }, total: { tokens: 10, responses: 1 } },
      outcomes: { succeeded: 0, skipped: 0, cancelled: 0, failed: 0, unknown: 0 } });
    expect(readOnlyEvent({ type: 'aiListener.stateChanged', revision: 1, payload: f.controller.view() })).toBeNull();
    expect(readOnlyEvent({ type: 'state.snapshot', revision: 1, payload: management.body.snapshot })).not.toHaveProperty('payload.aiListener');
    const publicView = await request(f.app).get('/api/bootstrap').set('Host', '127.0.0.1:3000');
    expect(JSON.stringify(publicView.body)).not.toContain('usage');
    expect(f.store.log).not.toHaveBeenCalled(); expect(f.store.saveMemory).not.toHaveBeenCalled(); expect(f.store.logPrompt).not.toHaveBeenCalled();
  });
  it('連携のAPIテストはデバッグ無効でも固定文だけを1回送り、会話・画像・投稿・通常状態を変更しない', async () => {
    const f = await fixture(false, true);
    const before = f.controller.view();
    const response = await f.post('test-api').send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ model: f.settings.aiListener.model, message: expect.stringContaining('応答を確認') });
    const body = String(f.fetcher.mock.calls[0][1]?.body);
    expect(body).not.toContain('ここ見て'); expect(body).not.toContain('人格'); expect(body).not.toContain('inlineData');
    expect(f.capture).not.toHaveBeenCalled(); expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.store.log).not.toHaveBeenCalled(); expect(f.store.saveMemory).not.toHaveBeenCalled(); expect(f.store.logPrompt).not.toHaveBeenCalled();
    expect(f.controller.view()).toEqual({ ...before, usage: { ...before.usage, api: { ...before.usage!.api, requests: 1 } } });
    expect(JSON.stringify(response.body)).not.toContain('大きな建物だ');
    expect(f.connections.imageStatus()).toEqual({ reason: 'まだ生成していません。', durationMs: 0 });
  });
  it('APIテストの管理認証・形式を検証し、拒否時はGeminiを呼ばない', async () => {
    const f = await fixture(false);
    expect((await request(f.app).post('/api/ai-listener/test-api').set('Host', '127.0.0.1:3000').send({})).status).toBe(403);
    expect((await f.post('test-api').set('Origin', 'https://example.com').send({})).status).toBe(403);
    expect((await f.post('test-api').send({ model: 'other-model' })).status).toBe(400);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('APIテストのキー未設定・空応答・Gemini拒否を成功にせず、外部の秘密入り本文は返さない', async () => {
    const f = await fixture(false);
    await f.connections.configure({ key: '' });
    const missing = await f.post('test-api').send({});
    expect(missing.status).toBe(409); expect(missing.body.message).toContain('APIキーを保存');
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.connections.configure({ key: 'private-key' });
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    const empty = await f.post('test-api').send({}); expect(empty.status).toBe(409); expect(empty.body.message).toContain('文章応答を確認できません');
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'private-key ここ見て', details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 }));
    const denied = await f.post('test-api').send({}); expect(denied.status).toBe(409); expect(denied.body.message).toContain('APIキーが無効');
    expect(JSON.stringify(denied.body)).not.toMatch(/private-key|ここ見て/);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it('APIテスト中の開始・別テストを拒否し、設定変更後の古い応答を成功として返さない', async () => {
    const f = await fixture(false); let finish!: (response: Response) => void;
    f.fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.post('test-api').send({}).then(response => response);
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
    expect((await f.post('test-api').send({})).status).toBe(409);
    expect((await f.post('start').send({})).status).toBe(400);
    f.controller.invalidate();
    finish(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200 }));
    const response = await pending;
    expect(response.status).toBe(409); expect(response.body.message).toContain('取り消しました');
    expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.controller.view().requested).toBe(false);
  });
  it('APIテストの期限で通信を中止し、固定エラーを返して排他を解除する', async () => {
    const f = await fixture(false);
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    try {
      f.fetcher.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('private-key transport detail')), { once: true });
      }));
      const pending = f.post('test-api').send({}).then(response => response);
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
      deadline.abort();
      const response = await pending;
      expect(response.status).toBe(409); expect(response.body.message).toContain('30秒以内');
      expect(JSON.stringify(response.body)).not.toContain('private-key');
      expect(f.fetcher).toHaveBeenCalledOnce();
    } finally { timeout.mockRestore(); }
    expect((await f.post('test-api').send({})).status).toBe(200);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it('APIテスト中のOBS配信開始を終了後に反映し、古いテスト成功を返さない', async () => {
    const f = await fixture(false); let finish!: (response: Response) => void;
    await f.controller.configure({ ...f.settings.aiListener, mode: 'obs' });
    await f.controller.observeObs(true, 'stopped');
    f.fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.post('test-api').send({}).then(response => response);
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
    await f.controller.observeObs(true, 'streaming');
    expect(f.controller.view().requested).toBe(false);
    finish(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200 }));
    const response = await pending;
    expect(response.status).toBe(409); expect(response.body.message).toContain('取り消しました');
    expect(f.controller.view().requested).toBe(true);
    expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.capture).not.toHaveBeenCalled(); expect(f.store.log).not.toHaveBeenCalled();
  });
  it('同じAPI要求に画像を含め、ログには画像とOBS識別情報を保存しない', async () => {
    const f = await fixture();
    await f.connections.generate(f.settings.aiListener, f.persona, [], false, new AbortController().signal);
    const body = String(f.fetcher.mock.calls[0][1]?.body);
    expect(body).toContain('unique-image-bytes'); expect(body).not.toContain('private-source'); expect(body).not.toContain('private-collection');
    expect(JSON.parse(body).contents[0].parts).toHaveLength(2);
    expect(JSON.stringify(vi.mocked(f.store.logPrompt).mock.calls)).not.toContain('unique-image-bytes');
    expect(JSON.stringify(vi.mocked(f.store.logPrompt).mock.calls)).toContain('imageOmitted');
    expect(f.connections.imageStatus().image).not.toHaveProperty('data');
  });
  it('取得失敗では会話だけを送り、Gemini拒否時は二重送信しない', async () => {
    const f = await fixture(); f.capture.mockResolvedValue({ reason: '画像なし', durationMs: 2 });
    f.fetcher.mockResolvedValue(new Response('{}', { status: 400 }));
    await expect(f.connections.generate(f.settings.aiListener, f.persona, [], false, new AbortController().signal)).rejects.toThrow('HTTP 400');
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(String(f.fetcher.mock.calls[0][1]?.body)).not.toContain('inlineData');
  });
  it('テスト生成は投稿・記憶・ログ・通常状態を変更しない', async () => {
    const f = await fixture(); const before = f.controller.view();
    const response = await f.post('visual-debug/generate').send({ personaId: 'p' });
    expect(response.status).toBe(200);
    const status = await f.post('visual-debug/status');
    expect(status.body.event.text).toBe('大きな建物だ'); expect(status.body.event.capture.image.data).toBe('unique-image-bytes');
    expect(f.store.log).not.toHaveBeenCalled(); expect(f.store.saveMemory).not.toHaveBeenCalled(); expect(f.store.logPrompt).not.toHaveBeenCalled();
    expect(f.controller.view()).toEqual({ ...before, usage: { ...before.usage, api: { ...before.usage!.api, requests: 1 } } }); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('テスト実行中の通常開始・別テストを拒否し、クリアで遅延結果を捨てる', async () => {
    const f = await fixture(); let finish!: (r: Response) => void;
    f.fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const operation = f.debug.generate('p');
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalled());
    await expect(f.controller.start()).rejects.toThrow('テスト生成');
    await expect(f.debug.generate('p')).rejects.toThrow('テスト生成');
    f.debug.clear(); finish(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '遅延結果' }] } }] })));
    await expect(operation).rejects.toThrow(); expect(f.debug.touch()?.text).toBeUndefined();
    expect(f.store.log).not.toHaveBeenCalled();
  });
  it('無効時はデバッグAPIを登録せず、画像は公開bootstrapにも含めない', async () => {
    const f = await fixture(false);
    expect((await f.post('visual/status')).body.debugEnabled).toBe(false);
    expect((await f.post('visual-debug/status')).status).toBe(404);
    expect((await request(f.app).post('/api/ai-listener/visual/sources').set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000')).status).toBe(403);
    expect((await f.post('visual/status').set('Origin', 'https://untrusted.example')).status).toBe(403);
    const bootstrap = await request(f.app).get('/api/bootstrap').set('Host', '127.0.0.1:3000');
    expect(bootstrap.body.snapshot.settings.aiListener).toBeUndefined();
    expect(bootstrap.body.snapshot.aiListener).toBeUndefined();
    const management = await request(f.app).get('/api/bootstrap?view=management').set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'token');
    expect(management.status).toBe(200); expect(management.body.snapshot.aiListener.activity).toEqual({ stage: 'idle', startedAt: null, lastDurationsMs: {} });
    expect(readOnlyEvent({ type: 'aiListener.stateChanged', revision: 1, payload: f.controller.view() })).toBeNull();
    expect(readOnlyEvent({ type: 'state.snapshot', revision: 1, payload: management.body.snapshot })).not.toHaveProperty('payload.aiListener');
    expect(JSON.stringify(bootstrap.body)).not.toContain('private-source');
  });
  it('通常生成中にクリアした画像は応答到着後にも復活しない', async () => {
    const f = await fixture(); f.debug.touch(); let finish!: (r: Response) => void;
    f.fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const operation = f.connections.generate(f.settings.aiListener, f.persona, await f.store.loadMemory(), false, new AbortController().signal);
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalled());
    expect(f.debug.touch()?.capture.image).toBeDefined(); f.debug.clear(); f.debug.clear();
    finish(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'reply', target: 1, text: '通常生成', reason: 'none' }) }] } }] })));
    expect(await operation).toBe('通常生成'); expect(f.debug.touch()).toBeNull();
  });
});
