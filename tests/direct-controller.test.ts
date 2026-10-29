import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import { OutdoorReceivers, type ReceiverConfig } from '../src/main/outdoor/outdoor-receivers';
import { SmartphoneController } from '../src/main/smartphone/smartphone-controller';
import { MappingFailure, type DirectAdapter, type DirectGateway, type RouterMapping } from '../src/main/smartphone/direct-gateway';
import type { SmartphoneRecord } from '../src/main/smartphone/smartphone-store';
import type { ObsWebsocketConnection } from '../src/main/obs/obs-websocket-client';
import request from 'supertest';
import { createHttpApplication } from '../src/main/server/local-server';

async function readyRegistration(controller: SmartphoneController, registration: import('../src/shared/smartphone').SmartphoneRegistration) {
  await controller.refresh(); await controller.directRetry();
  await vi.waitFor(async () => expect((await controller.updatedRegistration(registration.deviceId, 'direct', registration.registrationUpdate, registration.control.protocolVersion)).preparation.video).toBe('ready'));
  return controller.updatedRegistration(registration.deviceId, 'direct', registration.registrationUpdate, registration.control.protocolVersion);
}

const finishes: (() => Promise<void>)[] = [];
afterEach(async () => { for (const finish of finishes.splice(0)) await finish(); });
const bearer = (token: string) => `Bearer ${token}`;
const phone = (name: string) => ({ invitationVersion: 13 as const, clientId: randomUUID(), clientSecret: 'a'.repeat(64), name });
async function setup(initial: SmartphoneRecord | null = null, withObs = false) {
  let saved = initial;
  let failNewVideo = false;
  const state = new AppState(createDefaultSettings());
  let streaming = false; const startStream = vi.fn(async () => { streaming = true; return { requestStatus: { result: true, code: 100 } }; });
  const connection: ObsWebsocketConnection = { request: async () => ({ requestStatus: { result: true, code: 100 } }),
    startStream,
    stopStream: async () => { streaming = false; return { requestStatus: { result: true, code: 100 } }; },
    getStreamStatus: async () => ({ outputActive: streaming, outputState: streaming ? 'OBS_WEBSOCKET_OUTPUT_STARTED' : 'OBS_WEBSOCKET_OUTPUT_STOPPED' }),
    subscribe: () => () => undefined, onDisconnect: () => () => undefined, close: async () => undefined };
  const obs = new ObsControlController({ store: { load: async () => null, save: async () => undefined }, transport: { connect: async () => connection } }); await obs.start();
  if (withObs) { await obs.configure({ enabled: true, androidEnabled: true, password: 'test-only' }); await obs.retry(); }
  else vi.spyOn(obs, 'view').mockReturnValue({ ...obs.view(), enabled: true, androidEnabled: true });
  const directWorkers = new Map<string, ReceiverConfig>();
  const directReceivers = new OutdoorReceivers((config, change) => {
    directWorkers.set(config.id, config);
    const emit = (next: ReceiverConfig) => change({ version: 1, state: 'listening', sessionId: null, generation: 0, receivedBytes: 0,
      videoFrames: 0, audioFrames: 0, videoPts: -1, audioPts: -1, lostPackets: 0, droppedPackets: 0, listeners: next.listeners });
    emit(config);
    return { close: async () => { directWorkers.delete(config.id); }, update: emit };
  });
  const adapter: DirectAdapter = { id: initial?.settings.direct?.interfaceId ?? randomUUID(), name: 'Ethernet', profile: 'Private', index: 1,
    addresses: [{ family: 'ipv4', address: '192.168.1.9' }, { family: 'ipv6', address: '2001:4860:1::9' }], gateway4: '192.168.1.1', gateway6: 'fe80::1%1' };
  const unavailable = (mapping: RouterMapping) => mapping.protocol === 'tcp' ? mapping.family === 'ipv6' : mapping.family === 'ipv4' ||
    failNewVideo && Object.entries(saved?.direct?.devices ?? {}).some(([id, d]) => id !== saved?.devices[0]?.id && d.outdoor?.internalPort === mapping.localPort);
  const gateway = {
    prepare: vi.fn<DirectGateway['prepare']>(async (_adapter, request, _process, before) => {
      const mapping: RouterMapping = { ...request, method: 'pcp', gateway: request.family === 'ipv6' ? adapter.gateway6! : adapter.gateway4!,
        address: request.family === 'ipv6' ? request.localAddress : '8.8.8.8', publicPort: request.localPort, renewedAt: Date.now(), expiresAt: Date.now() + 3600000 };
      await before(mapping); if (unavailable(mapping)) throw new MappingFailure('upstream'); return mapping;
    }),
    renew: vi.fn(async (_adapter, mapping: RouterMapping) => { if (unavailable(mapping)) throw new MappingFailure('upstream'); return mapping; }),
    remove: vi.fn(async () => undefined),
  };
  const mobile = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
  const windows = { list: async () => [{ ...adapter, description: '', preferred: true }], adapter: async () => adapter,
    allow: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
  const controller = new SmartphoneController({ state, obs, store: { load: async () => initial, save: async value => { saved = structuredClone(value); } },
    mobile,
    managementPorts: () => [3000], listen: async () => ({ close: async () => undefined }), receivers: new OutdoorReceivers(() => ({ close: async () => undefined })),
    direct: { receivers: directReceivers, windows, gateway,
      program: 'C:/CasMate.exe', workerProgram: 'C:/receiver.exe', listen: async () => ({ close: async () => undefined, updateIdentity: () => undefined, sendAudioReady: () => undefined, discardAudio: () => undefined }) } });
  finishes.push(async () => { await controller.stop(); await obs.stop(); await state.shutdown(); });
  await controller.start();
  const prepared = async () => { await controller.directRetry(); await vi.waitFor(() => expect(controller.snapshot().networks.direct?.registrationReady).toBe(true), { timeout: 5000 }); };
  return { controller, obs, startStream, saved: () => saved!, gateway, windows, mobile, directWorkers, prepared, failNew: (value: boolean) => { failNewVideo = value; } };
}

it('直接接続OFFは他の停止待ち中にも規則削除を開始し、閉鎖の保存で設定キューを待ち合わせない', async () => {
  const f = await setup(); await f.controller.configure({ activeNetwork: 'direct' }); await f.prepared();
  f.windows.remove.mockClear(); let finish!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; }); f.mobile.stop.mockImplementation(() => blocked);
  const switching = f.controller.configure({ activeNetwork: null });
  try { await vi.waitFor(() => expect(f.windows.remove).toHaveBeenCalled(), { timeout: 500 }); }
  finally { finish(); await switching; }
  await f.controller.configure({ activeNetwork: 'direct' }); await f.prepared();
});

it('管理認証とHost・Originを検証してネットワーク一覧を返し、取得失敗を空一覧にしない', async () => {
  const { controller } = await setup();
  const state = new AppState(createDefaultSettings());
  const app = createHttpApplication({ state, port: 3000, operationToken: 'secret', smartphone: () => controller });
  const read = vi.spyOn(controller, 'directAdapters');
  const path = '/api/management/smartphone-adapters';
  for (const [host, origin, token] of [['127.0.0.1:3000', 'http://127.0.0.1:3000', ''],
    ['192.168.1.9:3000', 'http://127.0.0.1:3000', 'secret'], ['127.0.0.1:3000', 'https://example.com', 'secret']]) {
    expect((await request(app).get(path).set('Host', host).set('Origin', origin).set('X-CasMate-Management', token)).status).toBe(403);
  }
  expect(read).not.toHaveBeenCalled();
  const response = await request(app).get(path).set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'secret');
  expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(Object.keys(response.body.adapters[0]).sort()).toEqual(['addresses', 'description', 'id', 'name', 'preferred']);
  read.mockRejectedValueOnce(new Error('offline'));
  expect((await request(app).get(path).set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'secret')).status).toBe(503);
  await state.shutdown();
});

it('TCPとSRTを独立に選び、ネットワークOFFで全待受を停止する', async () => {
  const { controller, prepared, directWorkers } = await setup();
  await controller.configure({ activeNetwork: 'direct' }); await prepared();
  const invitation = controller.invitation('direct'); expect(invitation.version).toBe(13);
  const a = await readyRegistration(controller, await controller.enroll('direct', bearer(invitation.token), phone('A')));
  const b = await readyRegistration(controller, await controller.enroll('direct', bearer(invitation.token), phone('B')));
  if (a.version !== 16 || b.version !== 16) throw new Error('Expected direct registration');
  expect(a.endpoints.map(e => e.family)).toEqual(['ipv4']); expect(a.outdoor!.endpoints.map(e => e.family)).toEqual(['ipv6']);
  expect(a.outdoor!.endpoints[0].outdoorPort).not.toBe(b.outdoor!.endpoints[0].outdoorPort);
  expect(controller.authenticateRead(bearer(a.comments.token))).toBe(a.deviceId);
  expect(controller.authenticateRead(bearer(a.outdoor!.token))).toBeNull();
  expect(controller.authenticateControl('direct', bearer(a.comments.token))).toBeNull();
  expect(controller.authenticateControl('direct', bearer(a.obsControl!.token), bearer(b.outdoor!.token))).toBeNull();
  const input = controller.obsInput(a.deviceId); expect(input).toContain('127.0.0.1');
  await controller.configure({ activeNetwork: null });
  await vi.waitFor(() => expect(directWorkers.size).toBe(0));
  expect(controller.authenticateRead(bearer(a.comments.token))).toBeNull();
  expect(controller.authenticateControl('direct', bearer(a.obsControl!.token), bearer(a.outdoor!.token))).toBeNull();
  expect(controller.authenticateVideo('direct', bearer(a.outdoor!.token))).toBeNull();
  expect(() => controller.invitation('direct')).toThrow();
});

it.each([{ protocolVersion: 2, registrationVersion: 14 }, { protocolVersion: 3, registrationVersion: 16 }] as const)(
  '版$registrationVersionはUDPの失敗から登録を分離し、同じ更新資格で後から準備完了を取得できる', async ({ protocolVersion, registrationVersion }) => {
  const { controller, prepared, saved, failNew } = await setup();
  await controller.configure({ activeNetwork: 'direct' }); await prepared();
  const invite = controller.invitation('direct'); const auth = bearer(invite.token);
  const a = await controller.enroll('direct', auth, { ...phone('A'), invitationVersion: 13 }, protocolVersion);
  if (a.network !== 'direct') throw new Error('Expected direct registration');
  expect(a.version).toBe(registrationVersion); expect(a.control.protocolVersion).toBe(protocolVersion);
  if (protocolVersion === 2) expect(a).not.toHaveProperty('speechRecognition');
  else expect(a.speechRecognition).toMatchObject({ revision: 1, token: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  expect(a.preparation.video).toBe('preparing'); expect(a.outdoor).toBeUndefined();
  expect(controller.authenticateRead(bearer(a.comments.token))).toBe(a.deviceId);
  await prepared();
  await vi.waitFor(async () => expect((await controller.updatedRegistration(a.deviceId, 'direct', a.registrationUpdate, protocolVersion)).preparation.video).toBe('ready'));
  const input = controller.obsInput(a.deviceId);
  failNew(true);
  const b = await controller.enroll('direct', auth, { ...phone('B'), invitationVersion: 13 }, protocolVersion);
  if (b.network !== 'direct') throw new Error('Expected direct registration');
  expect(b.version).toBe(registrationVersion);
  expect(saved().direct!.devices[b.deviceId].registered).toBe(true);
  await controller.directRetry();
  expect(controller.authenticateRead(bearer(b.comments.token))).toBe(b.deviceId);
  await vi.waitFor(async () => expect((await controller.updatedRegistration(b.deviceId, 'direct', b.registrationUpdate, protocolVersion)).preparation.video).toBe('error'));
  expect((await controller.updatedRegistration(a.deviceId, 'direct', a.registrationUpdate, protocolVersion)).preparation.video).toBe('ready');
  const ports = structuredClone(saved().direct!.devices[b.deviceId].outdoor);
  failNew(false); await prepared();
  await vi.waitFor(async () => expect((await controller.updatedRegistration(b.deviceId, 'direct', b.registrationUpdate, protocolVersion)).preparation.video).toBe('ready'));
  expect(saved().direct!.devices[b.deviceId].outdoor).toEqual(ports);
  expect(controller.invitation('direct').token).toBe(invite.token);
  await controller.configure({ activeNetwork: null });
  expect(controller.registrationTokenCurrent('direct', bearer(b.registrationUpdate.token))).toBe(true);
  await controller.configure({ activeNetwork: 'direct' }); await prepared();
  expect(controller.obsInput(a.deviceId)).toBe(input);
  expect(controller.registrationTokenCurrent('direct', bearer(b.registrationUpdate.token))).toBe(true);
}, 15000);

it('保存済みON設定から本人確認鍵・端末資格・OBS入力を保持して再準備する', async () => {
  const first = await setup(); await first.controller.configure({ activeNetwork: 'direct' }); await first.prepared();
  const invite = first.controller.invitation('direct'); const registered = await readyRegistration(first.controller, await first.controller.enroll('direct', bearer(invite.token), phone('A')));
  if (registered.version !== 16) throw new Error('Expected direct registration');
  const input = first.controller.obsInput(registered.deviceId); await first.controller.stop();
  const second = await setup(first.saved()); await second.prepared();
  await vi.waitFor(async () => expect(await second.controller.updatedRegistration(registered.deviceId, 'direct', registered.registrationUpdate)).toMatchObject({ comments: registered.comments, pcKey: registered.pcKey }));
  expect(second.controller.obsInput(registered.deviceId)).toBe(input);
  expect(second.controller.authenticateRead(bearer(registered.comments.token))).toBe(registered.deviceId);
});

it('定期的な連携状態更新で直接接続のOBS確認を取り消さず、明示確認した操作を1回だけ実行する', async () => {
  const { controller, obs, startStream, prepared } = await setup(null, true);
  await controller.configure({ activeNetwork: 'direct' }); await prepared();
  const invite = controller.invitation('direct'); const registered = await readyRegistration(controller, await controller.enroll('direct', bearer(invite.token), phone('OBS')));
  if (registered.version !== 16 || !registered.obsControl) throw new Error('Expected OBS registration');
  const principal = controller.authenticateControl('direct', bearer(registered.obsControl.token), undefined, bearer(registered.registrationUpdate.token),
    bearer(registered.speechRecognition.token), 3); if (!principal?.obs) throw new Error('No OBS principal');
  const view = obs.view();
  const confirmation = await obs.prepareAndroid({ version: 1, requestId: randomUUID(), action: 'start', epoch: view.epoch, expectedRevision: view.revision }, principal.obs);
  await controller.refresh(); await controller.refresh();
  expect(obs.view().confirmation).toEqual({ action: 'start', source: 'android', expiresAt: confirmation.expiresAt }); expect(startStream).not.toHaveBeenCalled();
  await obs.confirmAndroid({ version: 1, requestId: randomUUID(), confirmationId: confirmation.confirmationId }, principal.obs);
  expect(startStream).toHaveBeenCalledOnce();
});
