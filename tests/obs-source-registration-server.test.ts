import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication, LocalServer } from '../src/main/server/local-server';
import { mobileBootstrap, projectMobileRealtimeEvent } from '../src/main/server/mobile-lan-server';
import { readOnlyEvent, readOnlySnapshot, speechRecognitionOverlayEvent } from '../src/main/server/local-view-projections';
import type { RealtimeEvent } from '../src/shared/types';
import { sourceSetup, firstScene } from './fixtures/obs-source-registration';

function setup() {
  const source = sourceSetup();
  const state = new AppState(createDefaultSettings());
  const app = createHttpApplication({ state, port: 3000, operationToken: 'secret', obsSources: source.controller });
  return { ...source, state, app };
}
const origin = 'http://127.0.0.1:3000';
const host = '127.0.0.1:3000';
const contextPath = '/api/management/obs-sources/context?target=' +
  encodeURIComponent(JSON.stringify({ kind: 'overlay', overlay: 'comments' }));

describe('OBSソース登録の管理境界', () => {
  it('GETは管理認証・Host・Originとno-storeを要求する', async () => {
    const { app, state, obs } = setup();
    try {
      for (const headers of [
        { Host: host },
        { Host: 'example.com:3000', 'X-CasMate-Management': 'secret' },
        { Host: host, Origin: 'https://example.com', 'X-CasMate-Management': 'secret' },
        { Host: host, 'X-CasMate-Token': 'secret' },
      ]) {
        expect((await request(app).get(contextPath).set(headers)).status).toBe(403);
      }
      expect(obs.calls).toEqual([]);
      const authorized = await request(app).get(contextPath).set('Host', host).set('Origin', origin).set('X-CasMate-Management', 'secret');
      expect(authorized.status).toBe(200);
      expect(authorized.headers['cache-control']).toBe('no-store');
      expect(authorized.body).toMatchObject({ title: 'コメント', collection: '配信', currentSceneUuid: firstScene,
        canvas: { width: 1920, height: 1080 }, candidates: [] });
      const snapshot = await request(app).get('/api/bootstrap?view=management').set('Host', host).set('X-CasMate-Management', 'secret');
      expect(snapshot.body.snapshot.settings.application.port).toBe(3000);
      // Runtime canonical target comes from the controller, not the saved pending-restart port.
      expect((await sourceInput(app, authorized.body.collection)).body.operation.status).toBe('succeeded');
      expect(obs.inputs[0].settings.url).toBe('http://127.0.0.1:3100/overlay/comments');
    } finally { await state.shutdown(); }
  });

  it('POSTは操作認証とOriginを要求し、任意URL・要求型・無関係なUUIDを拒否する', async () => {
    const { app, state, obs, target } = setup();
    const body = { target, collection: '配信', sceneUuid: firstScene };
    try {
      for (const headers of [
        { Host: host, Origin: origin },
        { Host: host, 'X-CasMate-Token': 'secret' },
        { Host: host, Origin: 'https://example.com', 'X-CasMate-Token': 'secret' },
        { Host: 'example.com:3000', Origin: origin, 'X-CasMate-Token': 'secret' },
        { Host: host, Origin: origin, 'X-CasMate-Management': 'secret' },
      ]) expect((await request(app).post('/api/obs-sources/add').set(headers).send(body)).status).toBe(403);
      expect(obs.calls).toEqual([]);
      for (const invalid of [
        { ...body, target: { ...target, url: 'https://example.com' } },
        { ...body, requestType: 'StartStream' },
        { ...body, sceneUuid: 'not-a-uuid' },
      ]) {
        expect((await request(app).post('/api/obs-sources/add').set({ Host: host, Origin: origin, 'X-CasMate-Token': 'secret' })
          .send(invalid)).body).toMatchObject({ code: 'OBS_SOURCE_INVALID_REQUEST' });
      }
      expect(obs.calls).toEqual([]);
      const valid = await sourceInput(app, '配信');
      expect(valid.status).toBe(200); expect(valid.headers['cache-control']).toBe('no-store');
      expect(valid.body.operation).toMatchObject({ status: 'succeeded', phase: 'complete' });
      expect(valid.body.revision).toBe(state.snapshotEvent().revision);
      expect(valid.body.snapshot.obsControl).toBeUndefined();
    } finally { await state.shutdown(); }
  });

  it('壊れたcontext対象と未接続は安定したエラーを返し、他の管理機能を維持する', async () => {
    const { app, state, obs } = setup();
    try {
      const invalid = await request(app).get('/api/management/obs-sources/context?target=broken').set('Host', host).set('X-CasMate-Management', 'secret');
      expect(invalid.status).toBe(400); expect(invalid.body.code).toBe('OBS_SOURCE_INVALID_REQUEST');
      obs.connected = false;
      const disconnected = await sourceInput(app, '配信');
      expect(disconnected.status).toBe(503); expect(disconnected.body.code).toBe('OBS_UNAVAILABLE');
      expect((await request(app).get('/api/bootstrap').set('Host', host)).status).toBe(200);
    } finally { await state.shutdown(); }
  });

  it('登録状態と結果は管理snapshot/eventだけに含み、全公開投影から除外する', async () => {
    const { state, controller, add } = setup();
    const captured: RealtimeEvent[] = [];
    state.subscribe(event => captured.push(event));
    try {
      await add();
      state.setObsSourceRegistrationState(controller.view());
      const snapshot = state.snapshot();
      expect(snapshot.obsSourceRegistration?.lastOperation?.status).toBe('succeeded');
      expect(readOnlySnapshot(snapshot)).not.toHaveProperty('obsSourceRegistration');
      expect(mobileBootstrap(state)).not.toHaveProperty('obsSourceRegistration');
      const event = captured.find(event => event.type === 'obsSourceRegistration.stateChanged')!;
      expect(readOnlyEvent(event)).toBeNull();
      expect(projectMobileRealtimeEvent(event, state)).toBeNull();
      expect(speechRecognitionOverlayEvent(event, 1)).toBeNull();
      expect(readOnlyEvent(state.snapshotEvent())?.payload).not.toHaveProperty('obsSourceRegistration');
      state.invalidateObsSourceContext();
      const invalidation = captured.find(event => event.type === 'obsSourceRegistration.contextInvalidated')!;
      expect(invalidation.payload).toEqual({});
      expect(readOnlyEvent(invalidation)).toBeNull();
      expect(projectMobileRealtimeEvent(invalidation, state)).toBeNull();
      expect(speechRecognitionOverlayEvent(invalidation, 1)).toBeNull();
    } finally { await state.shutdown(); }
  });

  it('読取専用WebSocketへ結果イベントを送らず、管理面だけ再接続後も結果を確認できる', async () => {
    const port = await freePort();
    const state = new AppState(createDefaultSettings());
    const source = sourceSetup();
    const server = new LocalServer({ state, port, operationToken: 'secret', obsSources: source.controller });
    state.setObsSourceRegistrationState(source.controller.view());
    await server.start();
    const read = new WebSocket('ws://127.0.0.1:' + port + '/ws', { origin: 'http://127.0.0.1:' + port });
    const manage = new WebSocket('ws://127.0.0.1:' + port + '/ws?management=secret', { origin: 'http://127.0.0.1:' + port });
    try {
      const [readSnapshot, managementSnapshot] = await Promise.all([next(read), next(manage)]);
      expect(readSnapshot.payload).not.toHaveProperty('obsSourceRegistration');
      expect(managementSnapshot.payload).toHaveProperty('obsSourceRegistration');
      const nextRead = next(read); const nextManage = next(manage);
      await source.add(); state.setObsSourceRegistrationState(source.controller.view());
      state.acceptComment({ source: 'twitch', externalId: 'public', authorName: 'viewer',
        content: [{ type: 'text', text: '公開コメント' }], initialHistory: false });
      expect((await nextManage).type).toBe('obsSourceRegistration.stateChanged');
      expect((await nextRead).type).toBe('comment.received');
    } finally { read.close(); manage.close(); await server.stop(); await state.shutdown(); }
  });
});
function sourceInput(app: ReturnType<typeof createHttpApplication>, collection: string) {
  return request(app).post('/api/obs-sources/add').set({ Host: host, Origin: origin, 'X-CasMate-Token': 'secret' })
    .send({ target: { kind: 'overlay', overlay: 'comments' }, collection, sceneUuid: firstScene });
}
function next(socket: WebSocket): Promise<RealtimeEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('missing websocket event')), 3000);
    socket.once('message', data => { clearTimeout(timer); resolve(JSON.parse(String(data))); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}
