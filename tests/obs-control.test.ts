import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultObsControlPhrases,
  type ObsControlRegistration,
} from '../src/shared/obs-control';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import type { ObsRequestResponse, ObsStreamStatus, ObsWebsocketConnection, ObsWebsocketEvent, ObsWebsocketTransport } from '../src/main/obs/obs-websocket-client';
import { defaultObsControlSettings, validateObsControlRecord, type ObsControlRecord as StoredObsControlRecord } from '../src/main/obs/obs-control-store';
import type { SpeechRecognitionResult } from '../src/shared/types';
import { obsOverlayDefinitions } from '../src/shared/obs-source-registration';

class FakeConnection implements ObsWebsocketConnection {
  private readonly eventListeners = new Set<(event: ObsWebsocketEvent) => void>();
  private readonly disconnectListeners = new Set<(error: Error) => void>();
  stream: ObsStreamStatus = { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' };
  startCalls = 0;
  stopCalls = 0;
  requestResult: ObsRequestResponse = { requestStatus: { result: true, code: 100 } };
  request = vi.fn(async (requestType: string, _requestData?: Record<string, unknown>): Promise<ObsRequestResponse> => {
    if (requestType === 'StartStream') this.startCalls += 1;
    if (requestType === 'StopStream') this.stopCalls += 1;
    return this.requestResult;
  });
  getStreamStatus = vi.fn(async () => this.stream);
  startStream = vi.fn(async () => {
    this.startCalls += 1;
    this.stream = { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' };
    return this.requestResult;
  });
  stopStream = vi.fn(async () => {
    this.stopCalls += 1;
    this.stream = { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' };
    return this.requestResult;
  });
  subscribe(listener: (event: ObsWebsocketEvent) => void) { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  onDisconnect(listener: (error: Error) => void) { this.disconnectListeners.add(listener); return () => this.disconnectListeners.delete(listener); }
  async close() { for (const listener of this.disconnectListeners) listener(new Error('closed')); }
  emit(eventType: string, eventData?: Record<string, unknown>) { for (const listener of this.eventListeners) listener({ eventType, eventData }); }
}

class FakeTransport implements ObsWebsocketTransport {
  constructor(readonly connection: FakeConnection) {}
  connect = vi.fn(async () => this.connection);
}

function registration(): ObsControlRegistration {
  return { registrationId: '550e8400-e29b-41d4-a716-446655440000', revision: 1, token: 'a'.repeat(64), endpoints: [{ network: 'lan', address: '192.168.1.25', port: 3002 }] };
}

function record(): StoredObsControlRecord {
  return { version: 1, settings: {
    enabled: true, voiceEnabled: true, androidEnabled: true, port: 4455, password: 'secret',
    phrases: { ...defaultObsControlPhrases },
    publication: { lanEnabled: true, tailscaleEnabled: false, port: 3002 },
  }, registration: null };
}

class FakeStore {
  resetNotice: string | null = null;
  value: StoredObsControlRecord | null = record();
  load = vi.fn(async () => this.value);
  save = vi.fn(async (value: StoredObsControlRecord) => { this.value = structuredClone(value); });
}

function result(overrides: Partial<SpeechRecognitionResult> = {}): SpeechRecognitionResult {
  return { id: 'r1', sessionId: 's1', capturePeriodId: 'c1', sequence: 1, recognizedAt: new Date().toISOString(), text: 'きゃすメイト、配信開始', audioDurationMilliseconds: 500, recognitionDurationMilliseconds: 20, ...overrides };
}

async function connectedController(connection = new FakeConnection()) {
  const store = new FakeStore();
  const controller = new ObsControlController({ store, transport: new FakeTransport(connection), delay: async () => undefined });
  await controller.start();
  await controller.retry();
  controller.useDeviceRegistrations(id => id === registration().registrationId ? registration() : null);
  controller.setPublicationReady(true);
  return { controller, store, connection };
}

describe('OBSブラウザソースの起動時復旧', () => {
  const origin = 'http://127.0.0.1:3100';
  const refresh = 'PressInputPropertiesButton';

  it.each([true, false])('待受とOBS接続が揃ってから正式URLの入力だけを一度ずつ再読み込みする（OBS先行 %s）', async obsFirst => {
    const connection = new FakeConnection();
    const overlays = Object.entries(obsOverlayDefinitions).map(([inputUuid, { path }]) => ({
      inputUuid, kind: 'browser_source', settings: { url: origin + path },
    }));
    const inputs = [...overlays,
      { inputUuid: 'other', kind: 'browser_source', settings: { url: 'https://example.com/overlay/comments' } },
      { inputUuid: 'old-port', kind: 'browser_source', settings: { url: 'http://127.0.0.1:3000/overlay/comments' } },
      { inputUuid: 'file', kind: 'browser_source', settings: { url: origin + '/overlay/comments', is_local_file: true } },
      { inputUuid: 'media', kind: 'ffmpeg_source', settings: { url: origin + '/overlay/comments' } },
    ];
    connection.request.mockImplementation(async (type, data) => {
      const input = inputs.find(item => item.inputUuid === data?.inputUuid);
      if (type === 'GetInputList') return { ...connection.requestResult, responseData: {
        inputs: inputs.map(item => ({ inputUuid: item.inputUuid, unversionedInputKind: item.kind })),
      } };
      if (type === 'GetInputSettings') return { ...connection.requestResult, responseData: {
        inputKind: input?.kind, inputSettings: input?.settings,
      } };
      if (type === refresh && input?.inputUuid === 'reactions') throw new Error('input unavailable');
      return connection.requestResult;
    });
    const controller = new ObsControlController({ store: new FakeStore(), transport: new FakeTransport(connection) });
    try {
      if (!obsFirst) controller.setOverlayServerOrigin(origin);
      await controller.start();
      if (obsFirst) {
        await vi.waitFor(() => expect(controller.view().connection).toBe('connected'));
        expect(connection.request).not.toHaveBeenCalled();
        controller.setOverlayServerOrigin(origin);
      }
      await vi.waitFor(() => expect(connection.request).toHaveBeenCalledWith('GetInputSettings', { inputUuid: 'file' }));
      expect(connection.request.mock.calls.filter(([type]) => type === refresh)).toEqual(
        overlays.map(({ inputUuid }) => [refresh, { inputUuid, propertyName: 'refreshnocache' }]),
      );
      expect(connection.request).not.toHaveBeenCalledWith('GetInputSettings', { inputUuid: 'media' });
      connection.emit('CurrentSceneCollectionChanged');
      await controller.retry();
      expect(connection.request.mock.calls.filter(([type]) => type === 'GetInputList')).toHaveLength(1);
      expect(controller.view().connection).toBe('connected');
    } finally { await controller.stop(); }
  });

  it.each(['quit', 'collection', 'disconnect'])('%sで確認中の入力への再読み込みを取り消す', async reason => {
    const { controller, connection } = await connectedController();
    const inputUuid = 'comments';
    let resolveSettings!: (response: ObsRequestResponse) => void;
    const pendingSettings = new Promise<ObsRequestResponse>(resolve => { resolveSettings = resolve; });
    connection.request.mockImplementation(async type => type === 'GetInputSettings' ? pendingSettings : {
      ...connection.requestResult, responseData: { inputs: [{ inputUuid, unversionedInputKind: 'browser_source' }] },
    });
    try {
      controller.setOverlayServerOrigin(origin);
      await vi.waitFor(() => expect(connection.request).toHaveBeenCalledWith('GetInputSettings', { inputUuid }));
      if (reason === 'quit') controller.setOverlayServerOrigin(null);
      if (reason === 'collection') connection.emit('CurrentSceneCollectionChanged');
      if (reason === 'disconnect') await connection.close();
      resolveSettings({ ...connection.requestResult, responseData: {
        inputKind: 'browser_source', inputSettings: { url: origin + '/overlay/comments' },
      } });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(connection.request.mock.calls.some(([type]) => type === refresh)).toBe(false);
    } finally { await controller.stop(); }
  });
});

describe('OBS静止画のAndroid操作許可', () => {
  it.each(['missing completion', 'late old start'])('restores reaction reads after %s without reconnecting', async fault => {
    let now = 10000;
    const connection = new FakeConnection();
    const controller = new ObsControlController({ store: new FakeStore(), transport: new FakeTransport(connection), monotonicNow: () => now });
    await controller.start(); await controller.retry();
    try {
      if (fault === 'late old start') connection.emit('CurrentSceneCollectionChanged', { sceneCollectionName:'next' });
      const previous = controller.visualReader('background', 'reaction');
      connection.emit('CurrentSceneCollectionChanging', { sceneCollectionName:'next' });
      expect(previous.valid()).toBe(false);
      expect(() => controller.visualReader('background', 'reaction')).toThrow('BUSY');
      connection.emit('CurrentProgramSceneChanged', { sceneName:'current' });
      now += 2000;
      await controller.visualReader('background', 'reaction').request('GetCurrentProgramScene');
      expect(connection.request).toHaveBeenCalledWith('GetCurrentProgramScene', undefined);
    } finally { await controller.stop(); }
  });
  it.each(['A', 'B', undefined])('waits from the latest collection start (%s) even without completion', async name => {
    let now = 10000;
    const connection = new FakeConnection();
    const controller = new ObsControlController({ store: new FakeStore(), transport: new FakeTransport(connection), monotonicNow: () => now });
    await controller.start(); await controller.retry();
    try {
      connection.emit('CurrentSceneCollectionChanging', { sceneCollectionName:'A' });
      now += 750;
      connection.emit('CurrentSceneCollectionChanging', name ? { sceneCollectionName:name } : undefined);
      now += 250;
      expect(() => controller.visualReader('background', 'reaction')).toThrow('BUSY');
      now += 749;
      expect(() => controller.visualReader('background', 'reaction')).toThrow('BUSY');
      now++;
      expect(controller.visualReader('background', 'reaction').valid()).toBe(true);
    } finally { await controller.stop(); }
  });
  it.each(['B','older',undefined])('keeps the current collection wait when a completion reports %s', async destination => {
    let now = 10000;
    const connection = new FakeConnection();
    const controller = new ObsControlController({ store: new FakeStore(), transport: new FakeTransport(connection), monotonicNow: () => now });
    await controller.start(); await controller.retry();
    try {
      connection.emit('CurrentSceneCollectionChanging', { sceneCollectionName:'A' });
      connection.emit('CurrentSceneCollectionChanging', { sceneCollectionName:'B' });
      connection.emit('CurrentSceneCollectionChanged', destination ? { sceneCollectionName:destination } : undefined);
      expect(() => controller.visualReader('background', 'reaction')).toThrow('BUSY');
      connection.emit('CurrentSceneCollectionChanged', { sceneCollectionName:'C' });
      now += 999;
      expect(() => controller.visualReader('background', 'reaction')).toThrow('BUSY');
      now++;
      expect(controller.visualReader('background', 'reaction').valid()).toBe(true);
    } finally { await controller.stop(); }
  });
  it('invalidates a resumed reader when a fresh start arrives without an earlier completion', async () => {
    let now = 10000;
    const connection = new FakeConnection();
    const controller = new ObsControlController({ store: new FakeStore(), transport: new FakeTransport(connection), monotonicNow: () => now });
    await controller.start(); await controller.retry();
    try {
      connection.emit('CurrentSceneCollectionChanging', { sceneCollectionName:'A' });
      now += 1000;
      const reader = controller.visualReader('background','reaction');
      connection.emit('CurrentSceneCollectionChanging', { sceneCollectionName:'A' });
      expect(() => controller.visualReader('background','reaction')).toThrow('BUSY');
      now += 1000;
      expect(reader.valid()).toBe(false);
      expect(controller.visualReader('background','reaction').valid()).toBe(true);
    } finally { await controller.stop(); }
  });
  it.each([-60000, 60000])('uses elapsed time to settle a collection change after a %d ms wall-clock correction', async offset => {
    let elapsed = 10000, wall = 100000;
    const monotonicClock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const wallClock = vi.spyOn(Date, 'now').mockImplementation(() => wall);
    const connection = new FakeConnection();
    const controller = new ObsControlController({ store: new FakeStore(), transport: new FakeTransport(connection) });
    try {
      await controller.start(); await controller.retry();
      connection.emit('CurrentSceneCollectionChanging', { sceneCollectionName:'A' });
      wall += offset;
      elapsed += 999;
      expect(() => controller.visualReader('background', 'reaction')).toThrow('BUSY');
      elapsed++;
      expect(controller.visualReader('background', 'reaction').valid()).toBe(true);
    } finally {
      await controller.stop();
      monotonicClock.mockRestore(); wallClock.mockRestore();
    }
  });
  it('blocks reaction reads during scene collection changes before notifying the reaction controller', async () => {
    let now = 10000;
    const connection = new FakeConnection();
    const controller = new ObsControlController({ store: new FakeStore(), transport: new FakeTransport(connection),
      monotonicNow: () => now,
      onReactionContextChanged: type => {
        if (type === 'CurrentSceneCollectionChanging') expect(() => controller.visualReader('background', 'reaction')).toThrow('BUSY');
      } });
    await controller.start(); await controller.retry();
    try {
      const previous = controller.visualReader('background', 'reaction');
      connection.request.mockClear();
      connection.emit('CurrentSceneCollectionChanging');
      expect(previous.valid()).toBe(false);
      await expect(previous.request('GetSourceScreenshot')).rejects.toThrow('OBS_CAPTURE_CHANGED');
      expect(connection.request).not.toHaveBeenCalled();
      connection.emit('CurrentSceneCollectionChanged');
      now += 1000;
      await controller.visualReader('background', 'reaction').request('GetSourceScreenshot');
      expect(connection.request).toHaveBeenCalledWith('GetSourceScreenshot', undefined);
    } finally { await controller.stop(); }
  });
  it('lets reaction readers verify their own source path without weakening ordinary readers',async()=>{
    const {controller,connection}=await connectedController();
    try {
      const ordinary=controller.visualReader(), reaction=controller.visualReader('background','reaction');
      connection.emit('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:999});
      expect(ordinary.valid()).toBe(false);expect(reaction.valid()).toBe(true);
      await expect(reaction.request('SetSceneItemTransform')).rejects.toThrow('OBS_READ_ONLY');
      connection.emit('CurrentProgramSceneChanged',{sceneName:'other'});expect(reaction.valid()).toBe(false);
    } finally {await controller.stop();}
  });
  it('forwards geometry and rename events to reactions and invalidates outstanding visual readers', async () => {
    const connection = new FakeConnection(), changed = vi.fn();
    const controller = new ObsControlController({ store: new FakeStore(), transport: new FakeTransport(connection), delay: async () => undefined, onReactionContextChanged: changed });
    await controller.start(); await controller.retry();
    try {
      const read = controller.visualReader();
      const transform = { sceneUuid: 'scene-id', sceneName: 'scene', sceneItemId: 7, sceneItemTransform: { positionX: 100 } };
      connection.emit('SceneItemTransformChanged', transform);
      expect(changed).toHaveBeenCalledWith('SceneItemTransformChanged', transform); expect(read.valid()).toBe(false);
      const renamed = { sceneUuid: 'scene-id', oldSceneName: 'scene', sceneName: 'renamed' };
      connection.emit('SceneNameChanged', renamed); expect(changed).toHaveBeenCalledWith('SceneNameChanged', renamed);
    } finally { await controller.stop(); }
  });
  it('notifies reactions on actual websocket disconnect, explicit reconnect and disable', async () => {
    const connection=new FakeConnection(), changed=vi.fn();const controller=new ObsControlController({store:new FakeStore(),transport:new FakeTransport(connection),onReactionContextChanged:changed});
    await controller.start();await controller.retry();changed.mockClear();
    try { await connection.close();expect(changed).toHaveBeenCalledWith('Disconnected');expect(controller.view().connection).toBe('unavailable');
      await controller.retry();changed.mockClear();await controller.configure({enabled:false});expect(changed).toHaveBeenCalledWith('Disabled');
    } finally { await controller.stop(); }
  });
  it('shares the physical screenshot slot across background and foreground readers', async () => {
    const { controller, connection } = await connectedController();
    try {
      let finish!: (value: ObsRequestResponse) => void;
      connection.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const background = controller.visualReader('background').request('GetSourceScreenshot', { imageCompressionQuality: 50 });
      await expect(controller.visualReader().request('GetSourceScreenshot', { imageCompressionQuality: 75 })).rejects.toThrow('BUSY');
      expect(connection.request).toHaveBeenCalledTimes(1);
      finish({ requestStatus: { result: true, code: 100 }, responseData: { imageData: 'value' } }); await background;
      await expect(controller.visualReader('background').request('GetSourceScreenshot')).rejects.toThrow('BUSY');
      await controller.visualReader().request('GetSourceScreenshot', { imageCompressionQuality: 75 });
      expect(connection.request).toHaveBeenCalledTimes(2);
    } finally { await controller.stop(); }
  });
  it.each(['preview', 'connection', 'unregistered connection'])(
    'handles Android retry priority during a physical capture (%s)', async route => {
    const { controller, connection } = await connectedController();
    let elapsed = 10000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const imageData = `data:image/jpeg;base64,${readFileSync(new URL('./fixtures/obs-program-black.jpg', import.meta.url)).toString('base64')}`;
    let release: (() => void) | undefined;
    connection.request.mockImplementation(async (type, data) => {
      let responseData: Record<string, unknown>;
      switch (type) {
        case 'GetSceneCollectionList': responseData = { currentSceneCollectionName:'collection' }; break;
        case 'GetCurrentProgramScene': responseData = { currentProgramSceneName:'scene', currentProgramSceneUuid:'scene-id' }; break;
        case 'GetVideoSettings': responseData = { baseWidth:32, baseHeight:18 }; break;
        case 'GetVersion': responseData = { supportedImageFormats:['jpg'] }; break;
        case 'GetSourceScreenshot':
          if (data?.imageCompressionQuality === 75) await new Promise<void>(resolve => { release = resolve; });
          responseData = { imageData };
          break;
        default: throw new Error(type);
      }
      return { requestStatus:{ result:true, code:100 }, responseData };
    });
    const android = () => controller.captureProgramAndroid(registration(), new AbortController().signal);
    const background = () => controller.visualReader('background', 'reaction').request('GetSourceScreenshot', { imageCompressionQuality:50 });
    try {
      const first = android();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      if (route === 'preview') await expect(android()).rejects.toMatchObject({ status:409 });
      else controller.noteAndroidCaptureContention(route === 'connection' ? registration() : { ...registration(), token:'revoked' });
      release?.();
      await expect(first).resolves.toMatchObject({ width:32, height:18 });
      if (route !== 'unregistered connection') {
        elapsed += 4999;
        await expect(background()).rejects.toThrow('BUSY');
        elapsed++;
      }
      // A transfer-only conflict has no physical capture to reserve a retry for.
      controller.noteAndroidCaptureContention(registration());
      await expect(background()).resolves.toEqual({ imageData });
    } finally {
      release?.();
      clock.mockRestore();
      await controller.stop();
    }
  });
  it('現在の登録・OBS連携・Android操作許可を必須にし、撮影だけで配信を操作しない', async () => {
    const { controller, connection } = await connectedController();
    try {
      expect(controller.canCaptureProgramAndroid(registration())).toBe(true);
      expect(controller.canCaptureProgramAndroid({ ...registration(), revision: 2 })).toBe(false);
      await expect(controller.captureProgramAndroid({ ...registration(), token: 'wrong' }, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
      await controller.configure({ androidEnabled: false });
      expect(controller.canCaptureProgramAndroid(registration())).toBe(false);
      await expect(controller.captureProgramAndroid(registration(), new AbortController().signal)).rejects.toMatchObject({ status: 403 });
      await controller.configure({ androidEnabled: true, enabled: false });
      expect(controller.canCaptureProgramAndroid(registration())).toBe(false);
      expect(connection.startCalls).toBe(0); expect(connection.stopCalls).toBe(0);
      expect(connection.request).not.toHaveBeenCalled();
    } finally { await controller.stop(); }
  });
});

describe('OBS control controller', () => {
  it('音声の有効期間変更でAndroidの未送信確認は取り消さない', async () => {
    const { controller } = await connectedController();
    try {
      await controller.prepareAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440002', action: 'start',
        epoch: controller.view().epoch, expectedRevision: controller.view().revision }, registration());
      const confirmation = controller.view().confirmation;
      controller.invalidateVoiceCapturePeriod();
      expect(controller.view().confirmation).toEqual(confirmation);
      expect(controller.view().confirmation?.source).toBe('android');
    } finally { await controller.stop(); }
  });

  it('初期オンの保存拒否後も、パスワードとオン希望を同時保存すれば接続し、配信操作は送らない', async () => {
    const store = new FakeStore();
    store.value = { version: 1, settings: defaultObsControlSettings(), registration: null };
    const connection = new FakeConnection();
    const transport = new FakeTransport(connection);
    const controller = new ObsControlController({ store, transport });
    await controller.start();
    try {
      await expect(controller.configure({ enabled: true })).rejects.toThrow('OBS_PASSWORD_REQUIRED');
      expect(transport.connect).not.toHaveBeenCalled();
      await controller.configure({ enabled: true, port: 4455, password: 'first-password' });
      await vi.waitFor(() => expect(controller.view().connection).toBe('connected'));
      expect(transport.connect).toHaveBeenCalledExactlyOnceWith('ws://127.0.0.1:4455', 'first-password');
      expect(store.value?.settings.enabled).toBe(true);
      expect(connection.startStream).not.toHaveBeenCalled();
      expect(connection.stopStream).not.toHaveBeenCalled();
    } finally { await controller.stop(); }
  });
  it('旧OBS登録の退避案内を公開障害と分離し、実際の公開警告を維持する', async () => {
    const { controller, store } = await connectedController();
    try {
      store.resetNotice = '旧OBS操作登録を退避しました。共通QRで再登録してください。';
      expect(controller.updateNotice).toBe(store.resetNotice);
      expect(controller.view().publication.warning).toBeNull();
      controller.setDevicePublication('lan', [], false, '現在の待受を準備できません。');
      expect(controller.view().publication.warning).toBe('現在の待受を準備できません。');
      expect(controller.updateNotice).toBe(store.resetNotice);
    } finally { await controller.stop(); }
  });
  it('ソース登録の占有をAndroidへ同期し、配信確認との競合と任意の書込みを拒否する', async () => {
    const { controller } = await connectedController();
    const before = controller.view();
    const lease = controller.acquireSourceRegistration();
    expect(controller.view().busy).toBe(true);
    expect(controller.view().revision).toBeGreaterThan(before.revision);
    expect(controller.view().lastOperation).toBeNull();
    expect(() => controller.acquireSourceRegistration()).toThrow('BUSY');
    await expect(controller.prepareAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440002', action: 'start',
      epoch: controller.view().epoch, expectedRevision: controller.view().revision }, registration())).rejects.toMatchObject({ code: 'BUSY' });
    await expect(lease.session.request('StartStream')).rejects.toThrow('OBS_SOURCE_REQUEST_FORBIDDEN');
    await expect(controller.sourceReader().request('CreateInput')).rejects.toThrow('OBS_SOURCE_REQUEST_FORBIDDEN');
    await expect(controller.visualReader().request('CreateInput')).rejects.toThrow('OBS_READ_ONLY');
    lease.release(); lease.release();
    expect(controller.view().busy).toBe(false);
    expect(lease.session.valid()).toBe(false);
    controller.handleSpeechResult(result());
    expect(() => controller.acquireSourceRegistration()).toThrow('BUSY');
    await controller.stop();
  });

  it('OBSコレクション変更と再接続で旧ソース登録セッションを失効させる', async () => {
    const { controller, connection } = await connectedController();
    const lease = controller.acquireSourceRegistration();
    connection.emit('InputCreated');
    expect(lease.session.valid()).toBe(true);
    connection.emit('CurrentSceneCollectionChanging');
    expect(lease.session.valid()).toBe(false);
    await expect(lease.session.request('CreateInput')).rejects.toThrow('OBS_SOURCE_TARGET_CHANGED');
    expect(() => controller.sourceReader()).toThrow('OBS_SOURCE_TARGET_CHANGED');
    connection.emit('CurrentSceneCollectionChanged');
    lease.release();
    const reader = controller.sourceReader();
    await controller.retry();
    expect(reader.valid()).toBe(false);
    await controller.stop();
  });

  it('端末ごとに要求IDと確認所有者を分離し、他端末から確認・取消できない', async () => {
    const { controller, connection } = await connectedController();
    const a = registration();
    const b = { ...registration(), registrationId: '550e8400-e29b-41d4-a716-446655440001', token: 'b'.repeat(64) };
    const principals = new Map([a, b].map(r => [r.registrationId, r]));
    controller.useDeviceRegistrations(id => principals.get(id) ?? null);
    const prepare = () => ({ version: 1 as const, requestId: '550e8400-e29b-41d4-a716-446655440002', action: 'start' as const,
      epoch: controller.view().epoch, expectedRevision: controller.view().revision });
    const first = await controller.prepareAndroid(prepare(), a);
    expect(() => controller.cancelAndroid(first.confirmationId, b)).toThrow();
    await expect(controller.confirmAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440003', confirmationId: first.confirmationId }, b)).rejects.toThrow();
    expect(connection.startStream).not.toHaveBeenCalled();
    controller.cancelAndroid(first.confirmationId, a);
    const second = await controller.prepareAndroid(prepare(), b);
    expect(second.confirmationId).not.toBe(first.confirmationId);
    controller.invalidateDeviceRegistration(a.registrationId);
    expect(controller.view().confirmation).not.toBeNull();
    principals.delete(b.registrationId);
    controller.invalidateDeviceRegistration(b.registrationId);
    expect(controller.view().confirmation).toBeNull();
    principals.set(b.registrationId, b);
    const third = await controller.prepareAndroid({ ...prepare(), requestId: '550e8400-e29b-41d4-a716-446655440004' }, b);
    await controller.confirmAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440005', confirmationId: third.confirmationId }, b);
    expect(connection.startStream).toHaveBeenCalledOnce();
    await controller.stop();
  });
  it('ソース登録の占有リビジョンだけでは並行するAIの配信確認を失効させない', async () => {
    const { controller, connection } = await connectedController();
    let finish!: (value: ObsStreamStatus) => void;
    connection.getStreamStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.readAiStreamState();
    const before = controller.view().revision;
    const lease = controller.acquireSourceRegistration(); lease.release();
    expect(controller.view().revision).toBeGreaterThan(before);
    finish({ outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
    await expect(pending).resolves.toEqual({ connected: true, stream: 'streaming' });
    expect(connection.startCalls).toBe(0); expect(connection.stopCalls).toBe(0);
    await controller.stop();
  });
  it('実際の配信状態の変更後は古いAI読取応答を採用しない', async () => {
    const { controller, connection } = await connectedController();
    let finish!: (value: ObsStreamStatus) => void;
    connection.getStreamStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.readAiStreamState();
    connection.emit('StreamStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
    finish({ outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' });
    await expect(pending).rejects.toThrow('OBS_STATE_CHANGED');
    expect(controller.view().stream).toBe('streaming');
    await controller.stop();
  });
  it('AIの配信確認は読取専用で、状態変更後の遅延応答を採用しない', async () => {
    const { controller, connection } = await connectedController();
    connection.stream = { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_RECONNECTING' };
    expect(await controller.readAiStreamState()).toEqual({ connected: true, stream: 'reconnecting' });
    let finish!: (value: ObsStreamStatus) => void;
    connection.getStreamStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.readAiStreamState();
    await controller.configure({ enabled: false });
    finish({ outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
    await expect(pending).rejects.toThrow('OBS_STATE_CHANGED');
    expect(await controller.readAiStreamState()).toEqual({ connected: false, stream: 'unknown' });
    expect(connection.startCalls).toBe(0); expect(connection.stopCalls).toBe(0); await controller.stop();
  });
  it('accepts incomplete disabled settings but rejects enabling them in the protected store', () => {
    const initial = { version: 1, settings: defaultObsControlSettings(), registration: null };
    expect(validateObsControlRecord(initial).settings.password).toBe('');
    expect(() => validateObsControlRecord({ ...initial, settings: { ...initial.settings, enabled: true } })).toThrow();
  });

  it('does not overwrite a protected record that failed to load', async () => {
    const store = new FakeStore(); store.load.mockRejectedValueOnce(new Error('unreadable'));
    const controller = new ObsControlController({ store }); await controller.start();
    await expect(controller.configure({ voiceEnabled: true })).rejects.toThrow('OBS_SECRET_UNAVAILABLE');
    expect(store.save).not.toHaveBeenCalled(); await controller.stop();
  });

  it('discards late OBS connections made with obsolete credentials', async () => {
    const oldConnection = new FakeConnection(); const newConnection = new FakeConnection();
    const close = vi.spyOn(oldConnection, 'close');
    let finish!: (value: FakeConnection) => void;
    const transport = { connect: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(newConnection) };
    const controller = new ObsControlController({ store: new FakeStore(), transport });
    await controller.start();
    await controller.configure({ password: 'new-secret' });
    finish(oldConnection); await new Promise(resolve => setTimeout(resolve, 0));
    expect(close).toHaveBeenCalledOnce();
    expect(controller.view().connection).toBe('connected');
    expect(transport.connect).toHaveBeenLastCalledWith('ws://127.0.0.1:4455', 'new-secret');
    await controller.stop();
  });

  it('autosaves phrases and Android settings without reconnecting OBS or losing stream state', async () => {
    const { controller, connection } = await connectedController();
    const close = vi.spyOn(connection, 'close');
    const before = controller.view();
    await controller.configure({ phrases: { ...defaultObsControlPhrases, startCommand: '配信を始めて' } });
    await controller.configure({ voiceEnabled: false });
    await controller.configure({ publication: { lanEnabled: true, tailscaleEnabled: true, port: 3002 } });
    expect(close).not.toHaveBeenCalled();
    expect(controller.view().connection).toBe('connected');
    expect(controller.view().stream).toBe(before.stream);
    expect(connection.startStream).not.toHaveBeenCalled();
    expect(connection.stopStream).not.toHaveBeenCalled();
    await controller.stop();
  });

  it('ignores identical saves and reconnects only when connection information changes', async () => {
    const { controller, connection } = await connectedController();
    const close = vi.spyOn(connection, 'close');
    controller.handleSpeechResult(result(), false);
    await controller.configure({ port: 4455, enabled: true });
    expect(controller.view().confirmation).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
    await controller.configure({ port: 4456 });
    expect(close).toHaveBeenCalledTimes(1);
    expect(controller.view().confirmation).toBeNull();
    await controller.stop();
  });

  it('saves initial settings while disabled without a password, but cannot enable OBS', async () => {
    const store = new FakeStore(); store.value = null;
    const controller = new ObsControlController({ store });
    await controller.start();
    await controller.configure({ phrases: { ...defaultObsControlPhrases, startCommand: '開始してください' } });
    expect(store.value?.settings.phrases.startCommand).toBe('開始してください');
    expect(controller.view()).toMatchObject({ passwordConfigured: false, enabled: false });
    await expect(controller.configure({ enabled: true })).rejects.toThrow('OBS_PASSWORD_REQUIRED');
    expect(controller.view().enabled).toBe(false);
    await controller.configure({ password: 'new-secret' });
    expect(controller.view()).toMatchObject({ passwordConfigured: true });
    expect(JSON.stringify(controller.view())).not.toContain('new-secret');
    await controller.stop();
  });

  it('serializes concurrent partial saves and keeps old settings when storage fails', async () => {
    const { controller, store, connection } = await connectedController();
    const close = vi.spyOn(connection, 'close');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.save.mockImplementationOnce(async value => { await gate; store.value = structuredClone(value); });
    const first = controller.configure({ voiceEnabled: false });
    const second = controller.configure({ androidEnabled: false });
    release(); await Promise.all([first, second]);
    expect(store.value?.settings).toMatchObject({ voiceEnabled: false, androidEnabled: false });
    store.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(controller.configure({ port: 4457 })).rejects.toThrow('disk full');
    expect(controller.view().obsPort).toBe(4455);
    expect(close).not.toHaveBeenCalled();
    await controller.stop();
  });

  it('preserves connection errors on unrelated saves', async () => {
    const { controller, connection } = await connectedController();
    connection.getStreamStatus.mockRejectedValueOnce(new Error('OBS_AUTHENTICATION_FAILED'));
    await controller.retry();
    const error = controller.view().error;
    await controller.configure({ voiceEnabled: false });
    expect(controller.view().error).toBe(error);
    expect(controller.view().connection).toBe('unavailable');
    await controller.stop();
  });

  it('connects with the protected setting and only starts after voice confirmation', async () => {
    const { controller, connection } = await connectedController();
    controller.handleSpeechResult(result(), false);
    expect(controller.view().confirmation?.action).toBe('start');
    expect(connection.startStream).not.toHaveBeenCalled();

    controller.handleSpeechResult(result({ id: 'r2', sequence: 2, text: '開始を実行' }), false);
    await vi.waitFor(() => expect(connection.startStream).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(controller.view().lastOperation?.status).toBe('succeeded'));
  });

  it('ignores preview, duplicates, same utterance confirmations, and late sessions', async () => {
    const { controller, connection } = await connectedController();
    controller.handleSpeechResult(result(), true);
    expect(controller.view().confirmation).toBeNull();
    controller.handleSpeechResult(result(), false);
    controller.handleSpeechResult(result(), false);
    controller.handleSpeechResult(result({ id: 'same', text: '開始を実行', sequence: 1 }), false);
    expect(connection.startStream).not.toHaveBeenCalled();
    controller.handleSpeechResult(result({ id: 'late', sessionId: 'old', text: '開始を実行', sequence: 2 }), false);
    expect(connection.startStream).not.toHaveBeenCalled();
  });

  it('uses one shared Android confirmation and rejects stale revisions', async () => {
    const { controller } = await connectedController();
    const view = controller.view();
    const prepared = await controller.prepareAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440001', action: 'start', epoch: view.epoch, expectedRevision: view.revision }, registration());
    await expect(controller.prepareAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440002', action: 'stop', epoch: view.epoch, expectedRevision: controller.view().revision }, registration())).rejects.toMatchObject({ code: 'BUSY' }, registration());
    const confirmed = await controller.confirmAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440003', confirmationId: prepared.confirmationId }, registration());
    expect(confirmed.status).toBe('executing');
    await expect(controller.prepareAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440004', action: 'start', epoch: view.epoch, expectedRevision: view.revision }, registration())).rejects.toMatchObject({ code: 'STALE_STATE' }, registration());
  });

  it('スマホ音声待ちで音声確認だけを取り消し、Androidの確認を維持する', async () => {
    const { controller, connection } = await connectedController();
    controller.handleSpeechResult(result(), false);
    expect(controller.view().confirmation?.source).toBe('voice');
    controller.handleSpeechRecognitionState('waitingForInput', null);
    expect(controller.view().confirmation).toBeNull();
    const prepared = await controller.prepareAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440006', action: 'start',
      epoch: controller.view().epoch, expectedRevision: controller.view().revision }, registration());
    controller.handleSpeechRecognitionState('waitingForInput', null);
    expect(controller.view().confirmation?.source).toBe('android');
    await controller.confirmAndroid({ version: 1, requestId: '550e8400-e29b-41d4-a716-446655440007', confirmationId: prepared.confirmationId }, registration());
    expect(connection.startStream).toHaveBeenCalledOnce();
    await controller.stop();
  });

  it('does not resend an operation when the request becomes uncertain', async () => {
    const connection = new FakeConnection();
    connection.startStream = vi.fn(async () => {
      connection.stream = { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING' };
      throw new Error('disconnected after send');
    });
    const { controller } = await connectedController(connection);
    controller.handleSpeechResult(result(), false);
    controller.handleSpeechResult(result({ id: 'r2', sequence: 2, text: '開始を実行' }), false);
    await vi.waitFor(() => expect(controller.view().lastOperation?.status).toBe('unknown'));
    expect(connection.startStream).toHaveBeenCalledTimes(1);
  });


});


it('OBSのシーン・スタジオモード変更とソース削除を独立した対象通知へ渡す', async () => {
  const connection = new FakeConnection(), changed = vi.fn();
  const controller = new ObsControlController({ store: new FakeStore(), transport: new FakeTransport(connection), onSourceContextChanged: changed, delay: async () => undefined });
  await controller.start(); await controller.retry();
  const reader = controller.sourceReader(); const revision = reader.destinationRevision();
  for (const event of ['CurrentProgramSceneChanged', 'CurrentPreviewSceneChanged', 'StudioModeStateChanged', 'CurrentSceneCollectionChanged']) connection.emit(event);
  expect(changed).toHaveBeenCalledTimes(4); expect(controller.view().lastOperation).toBeNull();
  expect(reader.destinationRevision()).toBe(revision + 4);
  for (const event of ['InputRemoved', 'SceneItemRemoved', 'SceneRemoved']) connection.emit(event);
  expect(changed).toHaveBeenCalledTimes(7); expect(controller.view().lastOperation).toBeNull();
  expect(reader.destinationRevision()).toBe(revision + 4);
  await expect(controller.sourceReader().request('GetStudioModeEnabled')).resolves.toEqual({});
  await controller.stop();
});
