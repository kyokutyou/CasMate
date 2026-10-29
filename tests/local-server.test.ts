import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication, LocalServer } from '../src/main/server/local-server';
import { CharacterAssetStore } from '../src/main/server/character-asset-store';
import { AiController } from '../src/main/ai/ai-controller';
import { AiConnections } from '../src/main/ai/ai-connections';
import { AiStore } from '../src/main/ai/ai-store';
import type { ShitarabaWriteAdapter } from '../src/main/shitaraba/shitaraba-write-adapter';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('ローカルREST境界', () => {
  it('キャラクターの表示オプションは管理認証と型・項目を検証し、素材・微動を保持する', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const headers = { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'X-CasMate-Token': 'secret' };
    try {
      expect((await request(app).put('/api/character/options').set('Host', 'localhost:3000').send({ clickThrough: true })).status).toBe(403);
      for (const body of [{ simple: {} }, { alwaysOnTop: 'true' }, { windowVisible: true }])
        expect((await request(app).put('/api/character/options').set(headers).send(body)).status).toBe(400);
      const before = state.snapshot().settings.character.simple;
      expect((await request(app).put('/api/character/options').set(headers).send({ clickThrough: true })).status).toBe(200);
      expect(state.snapshot().settings.character.simple).toEqual(before);
      expect(state.snapshot().settings.character.clickThrough).toBe(true);
      const stopping = createHttpApplication({ state, port: 3000, operationToken: 'secret', acceptingRequests: () => false });
      expect((await request(stopping).put('/api/character/options').set(headers).send({ clickThrough: false })).status).toBe(503);
    } finally { state.dispose(); }
  });
  it('画像保存中の微動変更を保持し、破損素材では以前の参照を維持する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-assets-'));
    let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    class SlowAssetStore extends CharacterAssetStore {
      override async save(...args: Parameters<CharacterAssetStore['save']>) {
        enter(); await gate; return super.save(...args);
      }
    }
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret', assetStore: new SlowAssetStore(directory) });
    const headers = { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'X-CasMate-Token': 'secret', 'Content-Type': 'image/png' };
    const pending = request(app).post('/api/character/simple/assets/closed').set(headers).send(onePixelPng).then(response => response);
    try {
      await entered;
      const motion = { ...state.snapshot().settings.character.simple.motion, enabled: false };
      await state.updateCharacterMotion(motion);
      release(); expect((await pending).status).toBe(200);
      expect(state.snapshot().settings.character.simple.motion).toEqual(motion);
      const before = state.snapshot().settings.character;
      const broken = await request(app).post('/api/character/simple/assets/closed').set(headers).send(onePixelPng.subarray(0, 33));
      expect(broken.status).toBe(400);
      expect(state.snapshot().settings.character).toEqual(before);
    } finally { release(); await pending; state.dispose(); }
  });
  it('OBS音声認識表示の専用設定を管理面で保存し、専用bootstrapへ外観だけ反映する', async () => {
    const state = new AppState(createDefaultSettings(), { saveSettings: vi.fn(async () => undefined) });
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    try {
      const originalCommentOverlay = structuredClone(state.snapshot().settings.commentOverlay);
      const value = { ...state.snapshot().settings.speechRecognitionOverlay, fontSizePx: 64, displayDurationSeconds: 6 };
      const path = '/api/settings/speechRecognitionOverlay';
      expect((await request(app).put(path).set('Host', '127.0.0.1:3000').send(value)).status).toBe(403);
      const response = await request(app).put(path).set({ Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' }).send(value);
      expect(response.status).toBe(200);
      expect(state.snapshot().settings.speechRecognitionOverlay).toEqual(value);
      expect(state.snapshot().settings.commentOverlay).toEqual(originalCommentOverlay);
      const bootstrap = await request(app).get('/api/overlays/speech-recognition/bootstrap').set('Host', '127.0.0.1:3000');
      expect(bootstrap.body.appearance.fontSizePx).toBe(64);
      expect(bootstrap.body.appearance.displayDurationSeconds).toBeUndefined();
    } finally { state.dispose(); }
  });
  it('設定保存先を開く操作は管理認証を要求し、要求のパスを使わず失敗・未対応を返す', async () => {
    const state = new AppState(createDefaultSettings());
    const openSettingsDirectory = vi.fn(async () => {});
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret', openSettingsDirectory });
    const path = '/api/application/settings-directory/open';
    const headers = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
    try {
      expect((await request(app).post(path).set('Host', headers.Host)).status).toBe(403);
      expect((await request(app).post(path).set({ ...headers, Origin: 'https://example.com' })).status).toBe(403);
      expect((await request(app).post(path).set({ ...headers, Host: 'example.com' })).status).toBe(403);
      expect(openSettingsDirectory).not.toHaveBeenCalled();
      const opened = await request(app).post(path).set(headers).send({ path: 'C:/untrusted' });
      expect(opened.status).toBe(200); expect(opened.body).toEqual({});
      expect(opened.headers['cache-control']).toBe('no-store');
      expect(openSettingsDirectory).toHaveBeenCalledExactlyOnceWith();
      openSettingsDirectory.mockRejectedValueOnce(new Error('private directory detail'));
      const failed = await request(app).post(path).set(headers);
      expect(failed.status).toBe(500); expect(failed.body.message).toContain('設定の保存先を開けませんでした');
      expect(JSON.stringify(failed.body)).not.toContain('private directory');
      const unsupported = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
      expect((await request(unsupported).post(path).set(headers)).status).toBe(503);
    } finally { await state.shutdown(); }
  });
  it('認識入力の版競合を409で返し、認証付き部分ON変更と版付き状態返信だけを許可する', async () => {
    const save = vi.fn(async () => undefined); const state = new AppState(createDefaultSettings(), { saveSettings: save });
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const headers = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
    try {
      const enabled = await request(app).put('/api/speech-recognition/enabled').set(headers).send({ enabled: true });
      expect(enabled.status).toBe(200); expect(enabled.body.revision).toBe(state.snapshotEvent().revision);
      const conflict = await request(app).put('/api/speech-recognition/input').set(headers).send({ revision: 1, inputSource: 'microphone', microphoneId: null });
      expect(conflict.status).toBe(409); expect(conflict.body.code).toBe('SPEECH_SETTINGS_CONFLICT');
      expect(save).toHaveBeenCalledOnce();
      const denied = await request(app).put('/api/speech-recognition/enabled').set('Host', headers.Host).send({ enabled: false });
      expect(denied.status).toBe(403); expect(state.snapshot().settings.speechRecognition.enabled).toBe(true);
      const invalid = await request(app).put('/api/speech-recognition/enabled').set(headers).send({ enabled: false, inputSource: 'smartphone' });
      expect(invalid.status).toBe(400); expect(save).toHaveBeenCalledOnce();
      const retry = await request(app).post('/api/speech-recognition/retry').set(headers);
      expect(retry.status).toBe(200); expect(retry.body.revision).toBe(state.snapshotEvent().revision);
    } finally { await state.shutdown(); }
  });
  it('bootstrapの公開連番と管理連番を分け、private状態を読取面へ混入させない', async () => {
    const state = new AppState(createDefaultSettings());
    state.setObsSourceTestState({ busy: false, current: null, warnings: [] });
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret', readOnlyRevision: () => 7 });
    try {
      const publicView = await request(app).get('/api/bootstrap').set('Host', '127.0.0.1:3000');
      expect(publicView.body.revision).toBe(7); expect(publicView.body.snapshot).not.toHaveProperty('obsSourceTest');
      const management = await request(app).get('/api/bootstrap?view=management').set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'secret');
      expect(management.body.revision).toBe(state.snapshotEvent().revision); expect(management.body.revision).not.toBe(7);
      expect(management.headers['cache-control']).toBe('no-store');
    } finally { await state.shutdown(); }
  });
  it('AI操作は管理トークンが必要で、確認なしの記憶削除と閲覧面への公開を拒む', async () => {
    const settings = createDefaultSettings(); const state = new AppState(settings);
    const store = new AiStore(await mkdtemp(join(tmpdir(), 'casmate-ai-http-')), { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' });
    const connections = new AiConnections(store, async () => undefined, () => undefined, vi.fn());
    const controller = new AiController(settings.aiListener, { store, gateway: connections, changed: view => state.setAiView(view), acquire: async () => undefined, release: async () => undefined, ngWords: () => [] });
    state.attachAi(controller); await controller.initialize();
    const clear = vi.spyOn(controller, 'clearMemory'); const start = vi.spyOn(controller, 'start');
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret', ai: { controller, connections, openLogs: async () => undefined } });
    try {
      const untrusted = await request(app).post('/api/ai-listener/start').set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000');
      expect(untrusted.status).toBe(403); expect(start).not.toHaveBeenCalled();
      const unconfirmed = await request(app).post('/api/ai-listener/clear-memory').set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').set('X-CasMate-Token', 'secret').send({});
      expect(unconfirmed.status).toBe(400); expect(clear).not.toHaveBeenCalled();
      const confirmed = await request(app).post('/api/ai-listener/clear-memory').set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').set('X-CasMate-Token', 'secret').send({ confirmed: true });
      expect(confirmed.status).toBe(200); expect(clear).toHaveBeenCalledOnce();
      const readOnly = await request(app).get('/api/bootstrap').set('Host', '127.0.0.1:3000');
      expect(readOnly.body.snapshot.aiListener).toBeUndefined(); expect(readOnly.body.snapshot.settings.aiListener).toBeUndefined();
      const trusted = await request(app).get('/api/bootstrap?view=management').set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'secret');
      expect(trusted.body.snapshot.aiListener).toBeDefined(); expect(trusted.body.snapshot.aiListener.memory).toBeUndefined(); expect(trusted.body.snapshot.settings.aiListener.key).toBeUndefined();
    } finally { await state.shutdown(); await connections.shutdown(); }
  });
  it('バックエンドの待受完了後に起動時自動接続を行う', async () => {
    const starts: string[] = [];
    const settings = createDefaultSettings();
    settings.sources.autoConnect = true;
    settings.sources.twitch = { enabled: true, channel: 'channel' };
    const state = new AppState(settings, {
      sourceFactory: (source) => ({
        source,
        start: async () => { starts.push(source); },
        stop: vi.fn(),
      }),
    });
    const server = new LocalServer({ state, port: 0 });

    await server.start();
    try {
      await vi.waitFor(() => expect(starts).toEqual(['twitch']));
    } finally {
      await server.stop();
      state.dispose();
    }
  });

  it('音声認識の自動開始完了を待たず管理バックエンドを利用可能にする', async () => {
    const state = new AppState(createDefaultSettings());
    vi.spyOn(state, 'startSpeechRecognitionOnLaunch').mockImplementation(
      () => new Promise<void>(() => undefined),
    );
    const server = new LocalServer({ state, port: 0 });

    await expect(server.start()).resolves.toBeUndefined();
    await server.stop();
    state.dispose();
  });

  it('bootstrapを提供し、管理画面の秘密を持つ要求だけへ操作トークンを返す', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });

    const readOnly = await request(app).get('/api/bootstrap').set('Host', '127.0.0.1:3000');
    expect(readOnly.status).toBe(200);
    expect(readOnly.body.operationToken).toBeUndefined();
    expect(readOnly.body.snapshot.settings.application.port).toBe(3000);
    expect(readOnly.body.snapshot.settings.application.managementTheme).toBeUndefined();
    expect(readOnly.body.snapshot.settings.application.managementTextSize).toBeUndefined();
    expect(readOnly.body.snapshot.settings.sources.shitaraba.nextThread).toBeUndefined();
    expect(readOnly.body.snapshot.shitarabaNextThread).toBeUndefined();
    expect(readOnly.body.snapshot.settings.speechRecognition).toBeUndefined();
    expect(readOnly.body.snapshot.speechRecognition).toBeUndefined();
    expect(readOnly.body.snapshot.speechRecognitionOverlay).toBeUndefined();

    const management = await request(app)
      .get('/api/bootstrap?view=management')
      .set('Host', '127.0.0.1:3000');
    expect(management.body.operationToken).toBeUndefined();
    const trustedManagement = await request(app)
      .get('/api/bootstrap?view=management')
      .set('Host', '127.0.0.1:3000')
      .set('X-CasMate-Management', 'secret');
    expect(trustedManagement.body.operationToken).toBe('secret');
    expect(trustedManagement.body.snapshot.settings.sources.shitaraba.nextThread).toBeDefined();
    expect(trustedManagement.body.snapshot.settings.application.managementTheme).toBe('ocean');
    expect(trustedManagement.body.snapshot.settings.application.managementTextSize).toBe('medium');
    expect(trustedManagement.body.snapshot.shitarabaNextThread).toBeDefined();
    state.dispose();
  });

  it('OBS音声認識専用bootstrapへ最小状態と共用外観だけを返す', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });

    const response = await request(app)
      .get('/api/overlays/speech-recognition/bootstrap')
      .set('Host', '127.0.0.1:3000');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      state: { active: null },
      appearance: {
        fontFamily: 'Yu Gothic UI', fontSizePx: 32, textColor: '#ffffffff',
        backgroundColor: '#00000099', paddingPx: 8, borderRadiusPx: 8,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('speechRecognition');
    expect(JSON.stringify(response.body)).not.toContain('microphone');
    const invalidOrigin = await request(app)
      .get('/api/overlays/speech-recognition/bootstrap')
      .set('Host', '127.0.0.1:3000')
      .set('Origin', 'https://attacker.test');
    expect(invalidOrigin.status).toBe(403);
    state.dispose();
  });

  it('管理要求から音声認識プレビュー、WAV保存、再試行を操作する', async () => {
    const state = new AppState(createDefaultSettings());
    const start = vi.spyOn(state, 'startSpeechRecognitionPreview').mockResolvedValue();
    const stop = vi.spyOn(state, 'stopSpeechRecognitionPreview').mockResolvedValue();
    const wav = vi.spyOn(state, 'setSpeechRecognitionWavSaving').mockResolvedValue();
    const refresh = vi.spyOn(state, 'refreshSpeechRecognitionMicrophones').mockResolvedValue();
    const retry = vi.spyOn(state, 'retrySpeechRecognition').mockResolvedValue();
    const prepare = vi.spyOn(state, 'prepareSpeechRecognitionModel').mockResolvedValue();
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const headers = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };

    expect((await request(app).post('/api/speech-recognition/preview/start').set(headers)).status).toBe(200);
    expect((await request(app).put('/api/speech-recognition/preview/wav-saving').set(headers).send({ enabled: true })).status).toBe(200);
    expect((await request(app).post('/api/speech-recognition/microphones/refresh').set(headers)).status).toBe(200);
    expect((await request(app).post('/api/speech-recognition/retry').set(headers)).status).toBe(200);
    expect((await request(app).post('/api/speech-recognition/model/prepare').set(headers)).status).toBe(200);
    expect((await request(app).post('/api/speech-recognition/model/prepare').set({ Host: headers.Host, Origin: headers.Origin })).status).toBe(403);
    expect(prepare).toHaveBeenCalledOnce();
    expect((await request(app).post('/api/speech-recognition/preview/stop').set(headers)).status).toBe(200);

    expect(start).toHaveBeenCalledOnce();
    expect(wav).toHaveBeenCalledWith(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect((await request(app).put('/api/speech-recognition/preview/wav-saving').set(headers).send({ enabled: 'yes' })).status).toBe(400);
    state.dispose();
  });

  it('文字演出のテスト再生はHost・Origin・操作トークンを検証する', async () => {
    const state = new AppState(createDefaultSettings());
    const test = vi.spyOn(state, 'testTextEffectRule');
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const path = '/api/text-effects/rules/default-grass/test';

    expect((await request(app).post(path).set('Host', 'attacker.test')).status).toBe(403);
    expect((await request(app).post(path).set('Host', '127.0.0.1:3000').set('Origin', 'https://attacker.test').set('X-CasMate-Token', 'secret')).status).toBe(403);
    expect((await request(app).post(path).set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000')).status).toBe(403);
    const accepted = await request(app).post(path).set({
      Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret',
    });
    expect(accepted.status).toBe(200);
    expect(test).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('正しいローカル管理要求だけで次スレッドの手動作成と結果不明解決を行う', async () => {
    const settings = createDefaultSettings();
    settings.sources.shitaraba = {
      ...settings.sources.shitaraba,
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/',
      nextThread: {
        ...settings.sources.shitaraba.nextThread,
        enabled: true,
        titleMode: 'manual',
        manualTitle: '次タイトル',
        bodyMode: 'manual',
        manualBody: '次本文',
      },
    };
    const writer: ShitarabaWriteAdapter = {
      fetchThreadContent: vi.fn(async () => ({ title: '現行1', body: '本文' })),
      findThreadsByTitle: vi.fn(async () => []),
      createNextThread: vi.fn(async () => ({
        threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
      })),
      announceNextThread: vi.fn(async () => undefined),
    };
    const state = new AppState(settings, {
      shitarabaWriteAdapter: writer,
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const headers = {
      Host: 'localhost:3000',
      Origin: 'http://localhost:3000',
      'X-CasMate-Token': 'secret',
    };

    const created = await request(app)
      .post('/api/shitaraba/next-thread/create')
      .set(headers);
    expect(created.status).toBe(200);
    expect(created.body.snapshot.shitarabaNextThread.status).toBe('created');

    const invalidResolve = await request(app)
      .post('/api/shitaraba/next-thread/resolve')
      .set(headers)
      .send({ outcome: 'created', threadUrl: 123, extra: true });
    expect(invalidResolve.status).toBe(400);

    const unauthorized = await request(app)
      .post('/api/shitaraba/next-thread/create')
      .set('Host', 'localhost:3000')
      .set('Origin', 'http://attacker.test')
      .set('X-CasMate-Token', 'secret');
    expect(unauthorized.status).toBe(403);
    state.dispose();
  });

  it('不正Hostとトークンなしの変更を拒否する', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });

    expect((await request(app).get('/api/bootstrap').set('Host', 'attacker.test')).status).toBe(403);
    const response = await request(app)
      .put('/api/settings/commentList')
      .set('Host', '127.0.0.1:3000')
      .set('Origin', 'http://127.0.0.1:3000')
      .send({ showSource: true, showAuthor: true, showContent: true });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('OPERATION_TOKEN_REQUIRED');
    state.dispose();
  });

  it('話者一覧GETを読取画面へ公開しない', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });

    const response = await request(app)
      .get('/api/speech/voices')
      .set('Host', '127.0.0.1:3000');

    expect(response.status).toBe(404);
    state.dispose();
  });

  it('Originを伴う管理POSTで話者一覧を返す', async () => {
    const settings = createDefaultSettings();
    settings.commentSpeech.enabled = true;
    const state = new AppState(settings, {
      speechSynthesizer: {
        prepare: async () => undefined,
        listVoices: async () => [{
          speakerUuid: 'speaker',
          name: '話者',
          styles: [{ id: 1, name: 'ノーマル' }],
        }],
        synthesize: async () => Buffer.from('wav'),
      },
    });
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });

    const response = await request(app)
      .post('/api/speech/voices')
      .set('Host', '127.0.0.1:3000')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CasMate-Token', 'secret');

    expect(response.status).toBe(200);
    expect(response.body.voices).toEqual([{
      speakerUuid: 'speaker',
      name: '話者',
      styles: [{ id: 1, name: 'ノーマル' }],
    }]);
    state.dispose();
  });

  it('Engine選択失敗を秘密を伏せた復旧可能な案内として返す', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({
      state,
      port: 3000,
      operationToken: 'secret',
      speechActions: {
        selectEngine: async () => {
          throw new Error('D:\\VOICEVOX\\VOICEVOX.exe を起動できません');
        },
      },
    });

    const response = await request(app)
      .post('/api/speech/engine/select')
      .set('Host', '127.0.0.1:3000')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CasMate-Token', 'secret');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'SPEECH_ENGINE_SELECTION_FAILED',
      message: 'VOICEVOXの vv-engine\\run.exe を選択してください。',
    });
    expect(JSON.stringify(response.body)).not.toContain('D:\\VOICEVOX');
    state.dispose();
  });

  it('操作トークンを管理画面HTMLだけへ埋め込み、読取画面には公開しない', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-static-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><head></head><div id="root"></div>');
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({
      state, port: 3000, operationToken: 'secret-token', staticDirectory: directory,
    });

    const management = await request(app).get('/').set('Host', '127.0.0.1:3000');
    const characterSettings = await request(app)
      .get('/character/simple/settings')
      .set('Host', '127.0.0.1:3000');
    const overlay = await request(app).get('/overlay/comments').set('Host', '127.0.0.1:3000');
    const recognitionOverlay = await request(app)
      .get('/overlay/speech-recognition')
      .set('Host', '127.0.0.1:3000');

    expect(management.text).toContain('casmate-management');
    expect(management.text).toContain('secret-token');
    expect(characterSettings.text).toContain('casmate-management');
    expect(characterSettings.text).toContain('secret-token');
    expect(overlay.text).not.toContain('secret-token');
    expect(recognitionOverlay.text).not.toContain('secret-token');
    state.dispose();
  });

  it('正しいローカル要求で設定更新と個別ソース操作を行う', async () => {
    const state = new AppState(createDefaultSettings(), {
      sourceFactory: (source) => ({ source, start: vi.fn(), stop: vi.fn() }),
    });
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const headers = {
      Host: 'localhost:3000',
      Origin: 'http://localhost:3000',
      'X-CasMate-Token': 'secret',
    };

    const update = await request(app)
      .put('/api/settings/commentList')
      .set(headers)
      .send({ ...createDefaultSettings().commentList, showSource: false, showAuthor: true, showContent: true });
    expect(update.status).toBe(200);
    expect(update.body.snapshot.settings.commentList.showSource).toBe(false);

    const filterUpdate = await request(app)
      .put('/api/settings/commentFilter')
      .set(headers)
      .send({ ngWords: [' 禁止語 '], asciiArtEnabled: true });
    expect(filterUpdate.status).toBe(200);
    expect(filterUpdate.body.snapshot.settings.commentFilter).toEqual({
      ngWords: ['禁止語'],
      asciiArtEnabled: true,
    });

    const start = await request(app).post('/api/sources/twitch/start').set(headers);
    expect(start.status).toBe(200);
    expect(start.body.snapshot.sourceStatuses.twitch.state).toBe('connecting');
    const reconnectWithoutToken = await request(app).post('/api/sources/twitch/reconnect').set('Host', 'localhost:3000');
    expect(reconnectWithoutToken.status).toBe(403);
    const reconnect = await request(app).post('/api/sources/twitch/reconnect').set(headers);
    expect(reconnect.status).toBe(200);
    expect(reconnect.body.snapshot.sourceStatuses.twitch.state).toBe('connecting');
    state.dispose();
  });

  it('簡易キャラクターの閉口・口開きPNGを登録・解除する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-assets-'));
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({
      state,
      port: 3000,
      operationToken: 'secret',
      assetStore: new CharacterAssetStore(directory),
    });
    const headers = {
      Host: 'localhost:3000',
      Origin: 'http://localhost:3000',
      'X-CasMate-Token': 'secret',
      'Content-Type': 'image/png',
    };

    const closed = await request(app)
      .post('/api/character/simple/assets/closed')
      .set(headers)
      .send(onePixelPng);
    const open = await request(app)
      .post('/api/character/simple/assets/open')
      .set(headers)
      .send(onePixelPng);
    const legacy = await request(app)
      .post('/api/character/assets/idle')
      .set(headers)
      .send(onePixelPng);

    expect(closed.status).toBe(200);
    expect(open.status).toBe(200);
    expect(open.body.snapshot.settings.character.simple).toMatchObject({
      closedAsset: expect.stringMatching(/^\/assets\/closed-/),
      openAsset: expect.stringMatching(/^\/assets\/open-/),
    });
    expect(legacy.status).toBe(404);

    const clearOpen = await request(app)
      .delete('/api/character/simple/assets/open')
      .set(headers);
    expect(clearOpen.status).toBe(200);
    expect(clearOpen.body.snapshot.settings.character.simple.openAsset).toBeNull();

    const clearClosed = await request(app)
      .delete('/api/character/simple/assets/closed')
      .set(headers);
    expect(clearClosed.status).toBe(200);
    expect(clearClosed.body.snapshot.settings.character.simple).toMatchObject({
      closedAsset: null,
      openAsset: null,
    });
    state.dispose();
  });

  it('簡易キャラクターの微動を保存せず一時配信する', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const motion = { ...state.snapshot().settings.character.simple.motion, verticalAmplitudePercent: 2.5 };
    const response = await request(app)
      .put('/api/character/simple/motion-preview')
      .set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:3000')
      .set('X-CasMate-Token', 'secret')
      .send(motion);

    expect(response.status).toBe(200);
    expect(response.body.snapshot.character.motion.verticalAmplitudePercent).toBe(2.5);
    expect(response.body.snapshot.settings.character.simple.motion.verticalAmplitudePercent).toBe(0.5);

    const saved = await request(app)
      .put('/api/character/simple/motion')
      .set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:3000')
      .set('X-CasMate-Token', 'secret')
      .send(motion);
    expect(saved.status).toBe(200);
    expect(saved.body.snapshot.settings.character.simple.motion.verticalAmplitudePercent).toBe(2.5);
    state.dispose();
  });

  it('独立コメント一覧と独立キャラクターを切り替え、専用設定画面を開く', async () => {
    const state = new AppState(createDefaultSettings());
    const toggleCommentList = vi.fn(async () => undefined);
    const toggleCharacter = vi.fn(async () => undefined);
    const showCharacterSettings = vi.fn(async () => undefined);
    const app = createHttpApplication({
      state,
      port: 3000,
      operationToken: 'secret',
      windowActions: { toggleCommentList, toggleCharacter, showCharacterSettings },
    });
    const headers = {
      Host: 'localhost:3000',
      Origin: 'http://localhost:3000',
      'X-CasMate-Token': 'secret',
    };

    expect((await request(app).post('/api/windows/comment-list/toggle').set(headers)).status).toBe(200);
    expect((await request(app).post('/api/windows/character/toggle').set(headers)).status).toBe(200);
    expect((await request(app).post('/api/windows/character-settings/show').set(headers)).status).toBe(200);
    expect(toggleCommentList).toHaveBeenCalledOnce();
    expect(toggleCharacter).toHaveBeenCalledOnce();
    expect(showCharacterSettings).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('個別ソースの入力検証エラーを成功扱いにしない', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const response = await request(app)
      .post('/api/sources/twitch/start')
      .set('Host', '127.0.0.1:3000')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CasMate-Token', 'secret');

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Twitchチャンネル名またはURL');
    expect(state.snapshot().sourceStatuses.twitch.state).toBe('error');
    state.dispose();
  });

  it('検証エラーを安定した日本語エラーとして返す', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const response = await request(app)
      .put('/api/settings/commentList')
      .set('Host', '127.0.0.1:3000')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('X-CasMate-Token', 'secret')
      .send({ ...createDefaultSettings().commentList, showSource: false, showAuthor: false, showContent: false });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(response.body.message).toContain('少なくとも1項目');
    state.dispose();
  });
});
