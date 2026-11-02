import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication } from '../src/main/server/local-server';
import { readOnlyEvent, readOnlySnapshot, speechRecognitionOverlayEvent } from '../src/main/server/local-view-projections';
import { mobileBootstrap, projectMobileRealtimeEvent } from '../src/main/server/mobile-lan-server';
import { ObsSourceTestController } from '../src/main/obs/obs-source-test-controller';
import { sourceSetup, firstScene, deviceId } from './fixtures/obs-source-registration';

it('字幕テストは認証済み操作だけで専用表示へ送り、認識・コメント・設定を変更しない', async () => {
  const settings = createDefaultSettings(); settings.speechRecognitionOverlay.displayDurationSeconds = 3;
  const state = new AppState(settings);
  const app = createHttpApplication({ state, operationToken: 'secret', port: 3000 });
  const auth = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
  try {
    expect((await request(app).post('/api/overlays/speech-recognition/test').set('Host', auth.Host)).status).toBe(403);
    expect((await request(app).post('/api/overlays/speech-recognition/test').set(auth).send({ text: '配信開始' })).status).toBe(400);
    const before = state.snapshot(); const response = await request(app).post('/api/overlays/speech-recognition/test').set(auth);
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.snapshot.speechRecognitionOverlay.active.text).toBe('OBS音声認識表示のテストです');
    expect(Date.parse(response.body.snapshot.speechRecognitionOverlay.active.expiresAt) - Date.now()).toBeGreaterThan(2000);
    expect(state.snapshot().settings).toEqual(before.settings); expect(state.snapshot().comments).toEqual(before.comments);
    expect(state.snapshot().speechRecognition).toEqual(before.speechRecognition);
  } finally { await state.shutdown(); }
});

it('直接受信APIはOBSなしで1回1件だけ投入し、認証・不正本文・終了中を拒否する', async () => {
  const state = new AppState(createDefaultSettings()); let accepting = true;
  const app = createHttpApplication({ state, operationToken: 'secret', port: 3000, acceptingRequests: () => accepting });
  const auth = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
  try {
    expect((await request(app).post('/api/comments/test').set('Host', auth.Host)).status).toBe(403);
    expect((await request(app).post('/api/comments/test').set({ ...auth, Origin: 'https://evil' })).status).toBe(403);
    expect((await request(app).post('/api/comments/test').set(auth).send({ text: '任意の本文' })).status).toBe(400);
    expect(state.snapshot().comments).toHaveLength(0);
    const first = await request(app).post('/api/comments/test').set(auth);
    expect(first.status).toBe(200); expect(first.body.snapshot.comments).toHaveLength(1); expect(first.headers['cache-control']).toBe('no-store');
    const second = await request(app).post('/api/comments/test').set(auth).send({});
    expect(second.body.snapshot.comments).toHaveLength(2); expect(second.body.revision).toBeGreaterThan(first.body.revision);
    accepting = false;
    expect((await request(app).post('/api/comments/test').set(auth)).status).toBe(503);
    expect(state.snapshot().comments).toHaveLength(2);
  } finally { await state.shutdown(); }
});

it('認証済みのコメントテストは通常受信へ一度だけ投入し、停止しても履歴・積み上げを消さない', async () => {
  const f = sourceSetup(); const input = await f.add();
  const settings = createDefaultSettings(); settings.commentOverlay.mode = 'stack';
  const state = new AppState(settings);
  const receiveComments = vi.fn((id: string) => state.receiveTestComments(id));
  const controller = new ObsSourceTestController({ sources: f.controller, obs: { acquireSourceTest: () => f.obs.acquireSourceRegistration() }, settings: () => state.snapshot().settings, assetReadable: async () => true, receiveComments, onState: value => state.setObsSourceTestState(value) });
  const app = createHttpApplication({ state, obsTests: controller, operationToken: 'secret', port: 3000 });
  const body = { target: f.target, collection: f.obs.collection, sceneUuid: firstScene, inputUuid: input.inputUuid };
  const auth = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
  try {
    expect((await request(app).post('/api/obs-sources/test/start').set('Host', auth.Host).send(body)).status).toBe(403);
    expect(receiveComments).not.toHaveBeenCalled();
    const response = await request(app).post('/api/obs-sources/test/start').set(auth).send(body);
    expect(response.status).toBe(200); expect(response.body.result.phase).toBe('complete');
    expect(receiveComments).toHaveBeenCalledOnce(); expect(state.snapshot().comments).toHaveLength(1);
    expect(response.body.result.message).toContain('1件');
    expect(controller.view().busy).toBe(false); expect(f.obs.occupied).toBe(false);
    expect(controller.display('comments').display).toBeNull();
    await request(app).post('/api/obs-sources/test/stop').set(auth).send({ testId: response.body.result.id });
    expect(state.snapshot().commentOverlay.active).toHaveLength(1);
    expect(receiveComments).toHaveBeenCalledOnce();
    const second = await request(app).post('/api/obs-sources/test/start').set(auth).send(body);
    expect(second.status).toBe(200); expect(state.snapshot().comments).toHaveLength(2);
    expect(receiveComments).toHaveBeenCalledTimes(2);
  } finally { await controller.shutdown(); await state.shutdown(); }
});

it.each(['lan', 'tailscale', 'direct'] as const)('rejects obsolete smartphone test API requests before touching OBS: %s', async network => {
  const f = sourceSetup(); const state = new AppState(createDefaultSettings());
  const acquire = vi.fn(() => f.obs.acquireSourceRegistration());
  const controller = new ObsSourceTestController({ sources: f.controller, obs: { acquireSourceTest: acquire }, settings: createDefaultSettings, assetReadable: async () => true });
  const app = createHttpApplication({ state, obsTests: controller, operationToken: 'secret', port: 3000 });
  const body = { target: { kind: 'smartphone', deviceId, network }, collection: f.obs.collection, sceneUuid: firstScene, inputUuid: deviceId };
  const auth = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
  try {
    const path = '/api/management/obs-sources/test-context?request=' + encodeURIComponent(JSON.stringify(body));
    expect((await request(app).get(path).set('Host', auth.Host)).status).toBe(403);
    const context = await request(app).get(path).set({ Host: auth.Host, 'X-CasMate-Management': 'secret' });
    expect(context.status).toBe(400); expect(context.body.code).toBe('OBS_SOURCE_INVALID_REQUEST');
    const start = await request(app).post('/api/obs-sources/test/start').set(auth).send(body);
    expect(start.status).toBe(400); expect(start.body.code).toBe('OBS_SOURCE_INVALID_REQUEST');
    expect(acquire).not.toHaveBeenCalled(); expect(f.obs.calls).toEqual([]); expect(controller.view().current).toBeNull();
  } finally { await controller.shutdown(); await state.shutdown(); }
});

it('requires management/operation credentials and projects only dedicated display data', async () => {
  const f = sourceSetup(); const target = { kind: 'overlay', overlay: 'effects' } as const; const input = await f.add({ target }); const state = new AppState(createDefaultSettings());
  const controller = new ObsSourceTestController({ sources: f.controller, obs: { acquireSourceTest: () => f.obs.acquireSourceRegistration() },
    settings: () => state.snapshot().settings, assetReadable: async () => true, onState: value => state.setObsSourceTestState(value) });
  const app = createHttpApplication({ state, obsTests: controller, operationToken: 'secret', port: 3000 });
  const body = { target, collection: f.obs.collection, sceneUuid: firstScene, inputUuid: input.inputUuid };
  const path = '/api/management/obs-sources/test-context?request=' + encodeURIComponent(JSON.stringify(body));
  const auth = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
  try {
    expect((await request(app).get(path).set('Host', auth.Host)).status).toBe(403);
    expect((await request(app).get(path).set({ Host: auth.Host, Origin: 'https://evil', 'X-CasMate-Management': 'secret' })).status).toBe(403);
    expect((await request(app).get(path).set({ Host: auth.Host, 'X-CasMate-Management': 'secret' })).body.available).toBe(true);
    expect((await request(app).post('/api/obs-sources/test/start').set('Host', auth.Host).send(body)).status).toBe(403);
    expect((await request(app).post('/api/obs-sources/test/start').set(auth).send({ ...body, requestType: 'StartStream' })).status).toBe(400);
    const starting = await request(app).post('/api/obs-sources/test/start').set(auth).send(body);
    expect(starting.status).toBe(200); expect(starting.headers['cache-control']).toBe('no-store');
    expect(starting.body.snapshot.obsSourceTest.current.phase).toBe('sending');
    const publicView = await request(app).get('/api/overlays/obs-test/bootstrap?overlay=effects').set('Host', auth.Host);
    expect(publicView.body.display).toMatchObject({ data: { kind: 'effects' } });
    for (const privateValue of [body.collection, body.sceneUuid, body.inputUuid, 'operationToken', 'sourceStatuses'])
      expect(JSON.stringify(publicView.body)).not.toContain(privateValue);
    expect((await request(app).get('/api/overlays/obs-test/bootstrap?overlay=effects').set({ Host: auth.Host, Origin: 'https://evil' })).status).toBe(403);
    const event = { type: 'obsSourceTest.stateChanged' as const, revision: 1, payload: controller.view() };
    expect(readOnlySnapshot(state.snapshot())).not.toHaveProperty('obsSourceTest'); expect(readOnlyEvent(event)).toBeNull();
    expect(speechRecognitionOverlayEvent(event, 1)).toBeNull(); expect(projectMobileRealtimeEvent(event)).toBeNull();
    expect(mobileBootstrap(state)).not.toHaveProperty('obsSourceTest');
    expect((await request(app).post('/api/obs-sources/test/stop').set(auth).send({ testId: starting.body.result.id })).status).toBe(200);
    expect(controller.display('effects').display).toBeNull();
    expect(state.snapshot().comments).toEqual([]); expect(state.snapshot().speechRecognitionOverlay.active).toBeNull();
  } finally { await controller.shutdown(); await state.shutdown(); }
});
