import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication } from '../src/main/server/local-server';
import { readOnlyEvent, readOnlySnapshot, speechRecognitionOverlayEvent } from '../src/main/server/local-view-projections';
import { mobileBootstrap, projectMobileRealtimeEvent } from '../src/main/server/mobile-lan-server';
import { ObsSourceTestController } from '../src/main/obs/obs-source-test-controller';
import { sourceSetup, firstScene, deviceId } from './fixtures/obs-source-registration';

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
  const f = sourceSetup(); const input = await f.add(); const state = new AppState(createDefaultSettings());
  const controller = new ObsSourceTestController({ sources: f.controller, obs: { acquireSourceTest: () => f.obs.acquireSourceRegistration() },
    settings: () => state.snapshot().settings, assetReadable: async () => true, onState: value => state.setObsSourceTestState(value) });
  const app = createHttpApplication({ state, obsTests: controller, operationToken: 'secret', port: 3000 });
  const body = { target: f.target, collection: f.obs.collection, sceneUuid: firstScene, inputUuid: input.inputUuid };
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
    const publicView = await request(app).get('/api/overlays/obs-test/bootstrap?overlay=comments').set('Host', auth.Host);
    expect(publicView.body.display).toMatchObject({ data: { kind: 'comments' } });
    for (const privateValue of [body.collection, body.sceneUuid, body.inputUuid, 'operationToken', 'sourceStatuses'])
      expect(JSON.stringify(publicView.body)).not.toContain(privateValue);
    expect((await request(app).get('/api/overlays/obs-test/bootstrap?overlay=comments').set({ Host: auth.Host, Origin: 'https://evil' })).status).toBe(403);
    const event = { type: 'obsSourceTest.stateChanged' as const, revision: 1, payload: controller.view() };
    expect(readOnlySnapshot(state.snapshot())).not.toHaveProperty('obsSourceTest'); expect(readOnlyEvent(event)).toBeNull();
    expect(speechRecognitionOverlayEvent(event, 1)).toBeNull(); expect(projectMobileRealtimeEvent(event)).toBeNull();
    expect(mobileBootstrap(state)).not.toHaveProperty('obsSourceTest');
    expect((await request(app).post('/api/obs-sources/test/stop').set(auth).send({ testId: starting.body.result.id })).status).toBe(200);
    expect(controller.display('comments').display).toBeNull();
    expect(state.snapshot().comments).toEqual([]); expect(state.snapshot().speechRecognitionOverlay.active).toBeNull();
  } finally { await controller.shutdown(); await state.shutdown(); }
});
