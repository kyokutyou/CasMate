import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createRelay, connect as connectRelay } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { WebSocket as ClientSocket, WebSocketServer } from 'ws';
import { attachSmartphoneControlServer, rejectedControlHandshake, SmartphoneControlSession, type Principal } from '../src/main/smartphone/smartphone-control-session';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import type { RealtimeEvent, SpeechRecognitionControlState } from '../src/shared/types';
import type { UpdatedSmartphoneRegistration } from '../src/shared/smartphone';

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  sent: Array<{ type: string; generation: number; payload: Record<string, unknown> }> = [];
  closeCode = 0;
  binary: Buffer[] = [];
  autoAck = true;
  binarySent?: () => void;
  send(value: string | Buffer, callback?: (error?: Error) => void) {
    if (Buffer.isBuffer(value)) {
      this.binary.push(value);
      if (this.autoAck) this.receive({ type: 'obs.imageAck', generation: value.readUInt32BE(4), payload: { imageId: value.toString('ascii', 12, 36), offset: value.readUInt32BE(8) + value.length - 36 } });
      this.binarySent?.();
    }
    else this.sent.push(JSON.parse(value));
    callback?.();
  }
  close(code = 1000) { if (this.readyState !== 1) return; this.readyState = 3; this.closeCode = code; this.emit('close'); }
  terminate() { this.close(1006); }
  receive(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
}
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.useRealTimers(); });

describe('OBS画像の認証付き制御転送', () => {
  it('実TCPの下りを4KiB/sへ制限しても撮影中のheartbeatと制御接続を維持する', async () => {
    const f = captureFixture();
    f.capture.mockResolvedValue({ bytes: Buffer.alloc(16000, 1), sceneName: '配信', capturedAt: '2026-10-14T00:00:00Z',
      width: 1280, height: 720, mimeType: 'image/jpeg', current: () => true });
    const server = createServer(); const wss = new WebSocketServer({ server });
    const timers = new Set<NodeJS.Timeout>(); const peers = new Set<import('node:net').Socket>();
    wss.on('connection', ws => new SmartphoneControlSession(ws, { controller: f.controller, obs: f.obs, state: f.state,
      network: 'lan', address: '192.168.1.2', port: 3001 }, f.principal, f.authenticate));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as import('node:net').AddressInfo).port;
    const relay = createRelay(down => {
      const up = connectRelay(port, '127.0.0.1'); peers.add(up); peers.add(down);
      const queue: Buffer[] = []; let offset = 0;
      down.pipe(up); up.on('data', bytes => queue.push(bytes));
      const timer = setInterval(() => {
        const front = queue[0]; if (!front) return;
        const end = Math.min(front.length, offset + 64);
        down.write(front.subarray(offset, end)); offset = end;
        if (offset === front.length) { queue.shift(); offset = 0; }
      }, 16);
      timers.add(timer); down.on('close', () => { clearInterval(timer); timers.delete(timer); up.destroy(); });
      up.on('error', () => down.destroy()); down.on('error', () => up.destroy());
    });
    relay.listen(0, '127.0.0.1'); await once(relay, 'listening');
    const client = new ClientSocket(`ws://127.0.0.1:${(relay.address() as import('node:net').AddressInfo).port}`);
    let received = 0; let pings = 0;
    client.on('message', (data, binary) => {
      if (binary) {
        const frame = Buffer.from(data as Buffer); received += frame.length - 36;
        client.send(JSON.stringify({ type: 'obs.imageAck', generation: 1, payload: { imageId: frame.toString('ascii', 12, 36), offset: frame.readUInt32BE(8) + frame.length - 36 } }));
      } else {
        const event = JSON.parse(String(data));
        if (event.type === 'ping') { pings++; client.send(JSON.stringify({ type: 'pong', nonce: event.payload.nonce })); }
        if (event.type === 'control.hello') {
          client.send(JSON.stringify({ type: 'control.subscribe', protocolVersion: 3, generation: 1, obs: true, outdoor: false, registration: false, speechRecognition: false }));
          client.send(JSON.stringify({ type: 'obs.captureProgram', id: 'slow', generation: 1, payload: {} }));
        }
      }
    });
    try {
      await vi.waitFor(() => expect(received).toBe(16000), { timeout: 10000 });
      expect(pings).toBeGreaterThanOrEqual(2); expect(client.readyState).toBe(ClientSocket.OPEN);
    } finally {
      client.terminate(); for (const peer of peers) peer.destroy(); for (const timer of timers) clearInterval(timer);
      for (const ws of wss.clients) ws.terminate(); wss.close(); relay.close(); server.close();
    }
  }, 12000);
  function captureFixture() {
    const f = setup(false, false, true);
    const current = vi.fn(() => true);
    const capture = vi.spyOn(f.obs, 'captureProgramAndroid').mockResolvedValue({ bytes: Buffer.alloc(65537, 1), sceneName: '配信',
      capturedAt: '2026-10-14T00:00:00.000Z', width: 1280, height: 720, mimeType: 'image/jpeg', current });
    vi.spyOn(f.obs, 'canCaptureProgramAndroid').mockReturnValue(true);
    f.ws.receive({ type: 'control.subscribe', protocolVersion: 3, generation: 1, obs: true, outdoor: false, registration: false, speechRecognition: false });
    return { ...f, capture, current };
  }
  it.each(['id', 'offset', 'generation'])('誤った%sの画像ACKで次の断片を送らず、正常ACKだけで再開する', async kind => {
    const f = captureFixture(); f.ws.autoAck = false;
    f.ws.receive({ type: 'obs.captureProgram', id: 'image', generation: 1, payload: {} });
    await vi.waitFor(() => expect(f.ws.binary).toHaveLength(1));
    const first = f.ws.binary[0]!;
    const ack = { imageId: first.toString('ascii', 12, 36), offset: first.length - 36 };
    f.ws.receive({ type: 'obs.imageAck', generation: kind === 'generation' ? 2 : 1,
      payload: { imageId: kind === 'id' ? 'x'.repeat(24) : ack.imageId, offset: ack.offset + (kind === 'offset' ? 1 : 0) } });
    f.ws.receive({ type: 'ping', nonce: 'waiting-for-valid-ack' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.ws.binary).toHaveLength(1);
    expect(f.ws.sent.some(event => event.type === 'pong' && event.payload.nonce === 'waiting-for-valid-ack')).toBe(true);
    f.ws.receive({ type: 'obs.imageAck', generation: 1, payload: ack });
    await vi.waitFor(() => expect(f.ws.binary).toHaveLength(2));
    expect(f.ws.binary[1]!.readUInt32BE(8)).toBe(ack.offset);
    f.ws.receive({ type: 'obs.cancelCapture', generation: 1, payload: { requestId: 'image' } });
    await vi.waitFor(() => expect(f.ws.sent.some(event => event.type === 'obs.captureFailed')).toBe(true));
    expect(f.ws.readyState).toBe(1);
  });
  it('任意の対応機能を版3だけへ通知し、画像を小さく分割して制御応答を維持する', async () => {
    const f = captureFixture();
    expect(f.ws.sent[0]!.payload).toMatchObject({ protocolVersion: 3, capabilities: ['obs.captureProgram'] });
    expect(setup().ws.sent[0]!.payload).not.toHaveProperty('capabilities');
    f.ws.binarySent = () => f.ws.receive({ type: 'ping', nonce: 'during-image' });
    f.ws.receive({ type: 'obs.captureProgram', id: 'image', generation: 1, payload: {} });
    await vi.waitFor(() => expect(f.ws.binary.reduce((sum, frame) => sum + frame.length - 36, 0)).toBe(65537));
    const meta = f.ws.sent.find(e => e.type === 'control.result' && e.payload.id === 'image')!.payload.payload as Record<string, unknown>;
    expect(meta).toMatchObject({ sceneName: '配信', byteLength: 65537, mimeType: 'image/jpeg' });
    expect(meta).not.toHaveProperty('bytes');
    expect(f.ws.sent.some(e => e.type === 'pong')).toBe(true);
    let offset = 0;
    f.ws.binary.forEach(frame => {
      expect(frame.length).toBeLessThanOrEqual(16420);
      expect(frame.readUInt32BE()).toBe(0x434d4931);
      expect(frame.readUInt32BE(4)).toBe(1);
      expect(frame.readUInt32BE(8)).toBe(offset); offset += frame.length - 36;
      expect(frame.toString('ascii', 12, 36)).toBe(meta.imageId);
    });
    expect(Buffer.concat(f.ws.binary.map(frame => frame.subarray(36)))).toEqual(Buffer.alloc(65537, 1));
  });
  it('版2・用途違い・任意ソース指定から撮影させない', async () => {
    for (const [version, videoOnly] of [[2, false], [3, true]] as const) {
      const f = setup(videoOnly, false, version === 3);
      const capture = vi.spyOn(f.obs, 'captureProgramAndroid');
      f.ws.receive({ type: 'control.subscribe', protocolVersion: version, generation: 1, obs: !videoOnly, outdoor: videoOnly,
        registration: false, ...(version === 3 ? { speechRecognition: false } : {}) });
      f.ws.receive({ type: 'obs.captureProgram', id: 'image', generation: 1, payload: {} });
      await vi.waitFor(() => expect(f.ws.sent.at(-1)!.payload.status).toBe(version === 2 ? 503 : 403));
      expect(capture).not.toHaveBeenCalled();
    }
    const f = captureFixture();
    f.ws.receive({ type: 'obs.captureProgram', id: 'image', generation: 1, payload: { sourceName: 'secret' } });
    await vi.waitFor(() => expect(f.ws.sent.at(-1)!.payload.status).toBe(400));
    expect(f.capture).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'generation', 'close', 'revoked'])('%sで遅い撮影結果を送らない', async kind => {
    const f = captureFixture(); let finish!: () => void; let signal!: AbortSignal;
    const image = await f.capture.getMockImplementation()!(f.principal.obs!, new AbortController().signal);
    f.capture.mockImplementation((_principal, incoming) => { signal = incoming; return new Promise(resolve => { finish = () => resolve(image); }); });
    f.ws.receive({ type: 'obs.captureProgram', id: 'image', generation: 1, payload: {} });
    if (kind === 'cancel') f.ws.receive({ type: 'obs.cancelCapture', generation: 1, payload: { requestId: 'image' } });
    else if (kind === 'generation') f.ws.receive({ type: 'control.subscribe', protocolVersion: 3, generation: 2, obs: true,
      outdoor: false, registration: false, speechRecognition: false });
    else if (kind === 'close') f.ws.close(); else f.authenticate.mockReturnValue(null);
    if (kind !== 'revoked') expect(signal.aborted).toBe(true);
    finish(); await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.ws.binary).toHaveLength(0);
    expect(f.ws.sent.some(e => e.type === 'control.result' && e.payload.id === 'image' && e.payload.status === 200)).toBe(false);
  });
  it('同時要求を拒否し、転送途中の許可OFFでも他機能の接続を維持する', async () => {
    const f = captureFixture();
    f.ws.bufferedAmount = 40000;
    f.ws.receive({ type: 'obs.captureProgram', id: 'image', generation: 1, payload: {} });
    await vi.waitFor(() => expect(f.ws.sent.some(e => e.type === 'control.result' && e.payload.id === 'image')).toBe(true));
    f.ws.receive({ type: 'obs.captureProgram', id: 'busy', generation: 1, payload: {} });
    await vi.waitFor(() => expect(f.ws.sent.find(e => e.payload.id === 'busy')!.payload.status).toBe(409));
    vi.mocked(f.obs.canCaptureProgramAndroid).mockReturnValue(false);
    await vi.waitFor(() => expect(f.ws.sent.some(e => e.type === 'obs.captureFailed')).toBe(true));
    expect(f.ws.binary).toHaveLength(0); expect(f.ws.readyState).toBe(1);
  });
});
function setup(videoOnly = false, modern = false, speech: boolean | 'bootstrap' = false) {
  const ws = new Socket(); cleanup.push(() => ws.close());
  const obs = new ObsControlController({ store: { load: async () => null, save: async () => undefined } });
  const registration: UpdatedSmartphoneRegistration = JSON.parse(readFileSync(new URL('./fixtures/smartphone-registration-v12.json', import.meta.url), 'utf8'));
  const principal: Principal = { deviceId: 'one', video: !modern, protocolVersion: 2, update: registration.registrationUpdate, obs: videoOnly ? null : {
    registrationId: '550e8400-e29b-41d4-a716-446655440000', revision: 1, token: 'a'.repeat(64), endpoints: [],
  } };
  if (speech) principal.protocolVersion = 3;
  if (speech === true) principal.speechRecognition = { registrationId: '550e8400-e29b-41d4-a716-446655440003', revision: 1, token: 's'.repeat(64) };
  const authenticate = vi.fn(() => principal as typeof principal | null);
  const listeners = new Set<(event: RealtimeEvent) => void>();
  const controller = { authenticateControl: vi.fn(), registrationTokenCurrent: vi.fn(() => true), registrationUpdateCurrent: vi.fn(() => true),
    updatedRegistration: vi.fn(async () => registration), touchReport: vi.fn(), releaseReport: vi.fn(), acceptReport: vi.fn(() => true), feedback: vi.fn(() => ({ version: 1, sample: null })) };
  const controlState: SpeechRecognitionControlState = { revision: 1, enabled: false, inputSource: 'microphone', microphoneId: null,
    smartphoneDeviceId: null, inputs: [], status: 'disabled', message: null };
  const state = { subscribe: (fn: (event: RealtimeEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    remoteSpeechRecognitionState: vi.fn(() => controlState), setSpeechRecognitionEnabled: vi.fn(async (_enabled: boolean) => undefined),
    selectSpeechRecognitionInput: vi.fn(async (_payload: unknown) => undefined), retrySpeechRecognition: vi.fn(async () => undefined) };
  new SmartphoneControlSession(ws as unknown as WebSocket, { controller, obs, network: 'lan', address: '192.168.1.2', port: 3001,
    state }, principal, authenticate);
  return { ws, obs, controller, authenticate, listeners, registration, state, principal };
}

describe('用途別の認証付き制御接続', () => {
  it('版3の認識用途だけで操作でき、認識本文・履歴・WAVを状態や応答へ含めない', async () => {
    const { ws, state, listeners, controller } = setup(true, true, true);
    const projection = { ...state.remoteSpeechRecognitionState(), previewHistory: [{ text: '秘密の認識本文' }], wavSaving: true };
    state.remoteSpeechRecognitionState.mockReturnValue(projection);
    ws.receive({ type: 'control.subscribe', protocolVersion: 3, generation: 1, obs: false, outdoor: false, registration: true, speechRecognition: true });
    expect(ws.sent.find(event => event.type === 'speechRecognition.state')?.payload).toEqual({ revision: 1, enabled: false, inputSource: 'microphone', microphoneId: null,
      smartphoneDeviceId: null, inputs: [], status: 'disabled', message: null });
    await vi.waitFor(() => expect(controller.updatedRegistration).toHaveBeenCalledWith('one', 'lan', expect.any(Object), 3));
    ws.receive({ type: 'speechRecognition.setEnabled', id: 'on', generation: 1, payload: { enabled: true } });
    ws.receive({ type: 'speechRecognition.selectInput', id: 'input', generation: 1, payload: { revision: 1, inputSource: 'smartphone', smartphoneDeviceId: '550e8400-e29b-41d4-a716-446655440004' } });
    ws.receive({ type: 'speechRecognition.retry', id: 'retry', generation: 1, payload: {} });
    await vi.waitFor(() => expect(ws.sent.filter(event => event.type === 'control.result')).toHaveLength(3));
    expect(state.setSpeechRecognitionEnabled).toHaveBeenCalledExactlyOnceWith(true); expect(state.selectSpeechRecognitionInput).toHaveBeenCalledOnce();
    expect(state.retrySpeechRecognition).toHaveBeenCalledOnce(); expect(JSON.stringify(ws.sent)).not.toContain('秘密の認識本文');
    expect(JSON.stringify(ws.sent)).not.toContain('wavSaving');
    state.remoteSpeechRecognitionState.mockReturnValue({ ...projection, revision: 2, enabled: true, status: 'waitingForInput' });
    listeners.forEach(fn => fn({ type: 'speechRecognition.stateChanged', revision: 2, payload: null }));
    expect(ws.sent.at(-1)).toMatchObject({ type: 'speechRecognition.state', payload: { revision: 2, enabled: true, status: 'waitingForInput' } });
    const count = ws.sent.length; listeners.forEach(fn => fn({ type: 'speechRecognition.resultReceived', revision: 3, payload: { text: '秘密' } }));
    expect(ws.sent).toHaveLength(count);
  });
  it('版3の登録専用bootstrapは認識資格なしで使え、旧版と別用途資格から認識操作できない', async () => {
    for (const version of [2, 3] as const) {
      const { ws, principal, state, controller } = setup(true, true, version === 3 ? 'bootstrap' : false);
      ws.receive({ type: 'control.subscribe', protocolVersion: version, generation: 1, obs: false, outdoor: false, registration: true,
        ...(version === 3 ? { speechRecognition: false } : {}) });
      await vi.waitFor(() => expect(controller.updatedRegistration).toHaveBeenCalledWith('one', 'lan', principal.update, version));
      ws.receive({ type: 'speechRecognition.setEnabled', id: 'forbidden', generation: 1, payload: { enabled: true } });
      await vi.waitFor(() => expect(ws.sent.at(-1)).toMatchObject({ type: 'control.result', payload: { status: 403 } }));
      expect(state.setSpeechRecognitionEnabled).not.toHaveBeenCalled(); expect(state.remoteSpeechRecognitionState).not.toHaveBeenCalled();
    }
  });
  it('入力競合を409で返し、不正な変更・別世代・切断後の応答を適用しない', async () => {
    const { ws, state } = setup(true, true, true);
    ws.receive({ type: 'control.subscribe', protocolVersion: 3, generation: 1, obs: false, outdoor: false, registration: false, speechRecognition: true });
    const conflict = Object.assign(new Error('他の画面で入力が変更されました。'), { status: 409, code: 'SPEECH_SETTINGS_CONFLICT' });
    state.selectSpeechRecognitionInput.mockRejectedValueOnce(conflict);
    state.remoteSpeechRecognitionState.mockReturnValue({ ...state.remoteSpeechRecognitionState(), revision: 2, microphoneId: 'new-input' });
    ws.receive({ type: 'speechRecognition.selectInput', id: 'conflict', generation: 1, payload: { revision: 1, inputSource: 'microphone', microphoneId: null } });
    await vi.waitFor(() => expect(ws.sent.find(event => event.type === 'control.result' && event.payload.id === 'conflict'))
      .toMatchObject({ type: 'control.result', payload: { status: 409, code: 'SPEECH_SETTINGS_CONFLICT' } }));
    expect(ws.sent.at(-1)).toMatchObject({ type: 'speechRecognition.state', payload: { revision: 2, microphoneId: 'new-input' } });
    for (const [type, payload] of [['speechRecognition.setEnabled', { enabled: 'yes' }], ['speechRecognition.setEnabled', { enabled: true, microphoneId: null }],
      ['speechRecognition.selectInput', { revision: 1, inputSource: 'smartphone', smartphoneDeviceId: 'unknown' }],
      ['speechRecognition.retry', { preview: true }]] as const) {
      ws.receive({ type, id: 'invalid', generation: 1, payload });
      await vi.waitFor(() => expect(ws.sent.at(-1)).toMatchObject({ type: 'control.result', payload: { status: 400 } }));
    }
    expect(state.setSpeechRecognitionEnabled).not.toHaveBeenCalled(); expect(state.selectSpeechRecognitionInput).toHaveBeenCalledOnce();
    expect(state.retrySpeechRecognition).not.toHaveBeenCalled();
    ws.receive({ type: 'speechRecognition.setEnabled', id: 'old', generation: 2, payload: { enabled: true } });
    expect(state.setSpeechRecognitionEnabled).not.toHaveBeenCalled();
    let finish!: () => void; state.setSpeechRecognitionEnabled.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    ws.receive({ type: 'speechRecognition.setEnabled', id: 'delayed', generation: 1, payload: { enabled: true } });
    ws.close(); const count = ws.sent.length; finish(); await Promise.resolve(); await Promise.resolve(); expect(ws.sent).toHaveLength(count);
  });
  it('UpgradeでHost・Origin・経路・資格を検証し、過大メッセージを拒否する', async () => {
    const server = createServer();
    let upgradedSocket: import('node:stream').Duplex | undefined;
    // A loopback test socket models the interface/peer metadata without requiring a particular LAN.
    server.on('upgrade', request => {
      upgradedSocket = request.socket;
      Object.defineProperty(request.socket, 'localAddress', { value: '192.168.1.2' });
      Object.defineProperty(request.socket, 'remoteAddress', { value: '192.168.1.3' });
    });
    const obs = new ObsControlController({ store: { load: async () => null, save: async () => undefined } });
    const close = attachSmartphoneControlServer(server, { obs, network: 'lan', address: '192.168.1.2', port: 3001,
      state: { subscribe: () => () => undefined }, controller: {
        authenticateControl: (_network, _obs, _outdoor, token, _speech, version = 2) => token === 'Bearer fixture' ? { deviceId: 'one', obs: null, video: true, protocolVersion: version, update: { registrationId: '550e8400-e29b-41d4-a716-446655440002', revision: 1, token: 'a'.repeat(64) } } : null,
        registrationTokenCurrent: vi.fn(), registrationUpdateCurrent: vi.fn(), updatedRegistration: vi.fn(),
        touchReport: vi.fn(), releaseReport: vi.fn(), feedback: vi.fn(), acceptReport: vi.fn(),
      } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    const headers = { Host: '192.168.1.2:3001', 'X-CasMate-Outdoor': 'ignored', 'X-CasMate-Registration': 'Bearer fixture' };
    try {
      for (const [route, extra] of [
        ['/smartphone/ws', { Origin: 'http://192.168.1.2:3000' }],
        ['/smartphone/ws', { Host: 'attacker.invalid' }],
        ['/smartphone/ws', { 'X-CasMate-Registration': 'Bearer invalid' }],
        ['/obs-control/state', {}],
      ] as const) {
        const ws = new ClientSocket(`ws://127.0.0.1:${address.port}${route}`, { headers: { ...headers, ...extra } });
        const error = await new Promise<Error>(resolve => ws.once('error', resolve));
        expect(error.message).toContain('403');
        // A peer reset during the rejected HTTP upgrade must remain connection-local.
        expect(() => upgradedSocket?.emit('error', new Error('ECONNRESET'))).not.toThrow();
        expect(upgradedSocket?.destroyed).toBe(true);
      }
      for (const version of ['1', '99', '3,2']) {
        const ws = new ClientSocket(`ws://127.0.0.1:${address.port}/smartphone/ws`, { headers: { ...headers, 'X-CasMate-Control-Version': version } });
        const error = await new Promise<Error>(resolve => ws.once('error', resolve)); expect(error.message).toContain('400');
      }
      for (const version of [2, 3]) {
        const ws = new ClientSocket(`ws://127.0.0.1:${address.port}/smartphone/ws`, { headers: { ...headers, ...(version === 3 ? { 'X-CasMate-Control-Version': '3' } : {}) } });
        const hello = once(ws, 'message'); await once(ws, 'open');
        expect(JSON.parse(String((await hello)[0]))).toMatchObject({ type: 'control.hello', payload: { protocolVersion: version } });
        const closed = once(ws, 'close'); ws.send('x'.repeat(8193)); expect((await closed)[0]).toBe(1009);
      }
    } finally { close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('OBS変化を即時反映し、接続喪失時に確認を破棄して操作を再送しない', async () => {
    vi.useFakeTimers(); const { ws, obs, listeners } = setup();
    const prepared = { confirmationId: '550e8400-e29b-41d4-a716-446655440001', expiresAt: Date.now() + 10000, action: 'start' as const };
    const prepare = vi.spyOn(obs, 'prepareAndroid').mockResolvedValue(prepared);
    const cancel = vi.spyOn(obs, 'cancelAndroid').mockImplementation(() => undefined);
    const confirm = vi.spyOn(obs, 'confirmAndroid');
    ws.receive({ type: 'control.subscribe', protocolVersion: 2, generation: 1, obs: true, outdoor: false, registration: false });
    expect(ws.sent.at(-1)?.type).toBe('obs.state');
    vi.spyOn(obs, 'view').mockReturnValue({ ...obs.view(), stream: 'streaming', revision: 2 });
    listeners.forEach(fn => fn({ type: 'obsControl.stateChanged', revision: 2, payload: null }));
    expect(ws.sent.at(-1)?.payload.stream).toBe('streaming');
    ws.receive({ type: 'obs.prepare', id: 'request', generation: 1, payload: {} });
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4000);
    expect(ws.closeCode).toBe(1006); expect(cancel).toHaveBeenCalledWith(prepared.confirmationId, expect.any(Object));
    expect(confirm).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
  });

  it('映像資格からOBSを購読・操作できず、別世代の要求も実行しない', async () => {
    const { ws, obs } = setup(true); const prepare = vi.spyOn(obs, 'prepareAndroid');
    ws.receive({ type: 'control.subscribe', protocolVersion: 2, generation: 1, obs: false, outdoor: true, registration: false });
    ws.receive({ type: 'obs.prepare', id: 'old', generation: 2, payload: {} });
    ws.receive({ type: 'obs.prepare', id: 'unauthorized', generation: 1, payload: {} });
    await Promise.resolve(); expect(prepare).not.toHaveBeenCalled();
    expect(ws.sent.at(-1)?.payload.status).toBe(403);
    ws.receive({ type: 'control.subscribe', protocolVersion: 2, generation: 2, obs: true, outdoor: true, registration: false });
    expect(ws.closeCode).toBe(4403);
  });

  it('受信確認を購読中だけ250ms間隔で返し、失効すると閉じる', async () => {
    vi.useFakeTimers(); const { ws, controller, authenticate } = setup();
    ws.receive({ type: 'control.subscribe', protocolVersion: 2, generation: 1, obs: false, outdoor: true, registration: false });
    const payload = { sessionId: 'session', generation: 12 };
    ws.receive({ type: 'outdoor.feedbackSubscribe', generation: 1, payload });
    await vi.advanceTimersByTimeAsync(750);
    expect(ws.sent.filter(e => e.type === 'outdoor.feedback')).toHaveLength(3);
    expect(controller.feedback).toHaveBeenLastCalledWith('one', 'lan', payload);
    controller.registrationUpdateCurrent.mockReturnValue(false);
    authenticate.mockReturnValue(null); await vi.advanceTimersByTimeAsync(250);
    expect(ws.closeCode).toBe(4403);
  });

  it('更新資格だけの版2は登録の初期値と変更を返し、OBS操作の権限を与えない', async () => {
    vi.useFakeTimers(); const { ws, obs, controller, registration } = setup(true, true);
    expect(ws.sent[0]).toMatchObject({ type: 'control.hello', payload: { protocolVersion: 2 } });
    ws.receive({ type: 'control.subscribe', protocolVersion: 2, generation: 1, obs: false, outdoor: false, registration: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent.filter(e => e.type === 'registration.state')).toHaveLength(1);
    const prepare = vi.spyOn(obs, 'prepareAndroid');
    ws.receive({ type: 'obs.prepare', id: 'forbidden', generation: 1, payload: {} });
    await vi.advanceTimersByTimeAsync(250);
    expect(prepare).not.toHaveBeenCalled(); expect(ws.sent.find(e => e.type === 'control.result')?.payload.status).toBe(403);
    expect(ws.sent.filter(e => e.type === 'registration.state')).toHaveLength(1);
    controller.updatedRegistration.mockResolvedValue({ ...registration, updateRevision: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(ws.sent.filter(e => e.type === 'registration.state').at(-1)?.payload.updateRevision).toBe(2);
  });

  it('版1の購読で更新を要求できず、版2を版1の購読へ降格できない', () => {
    for (const modern of [false, true]) {
      const { ws } = setup(true, modern);
      ws.receive({ type: 'control.subscribe', protocolVersion: 1, generation: 1, obs: false, outdoor: false, registration: true });
      expect(ws.closeCode).toBe(4406);
    }
  });

  it('非選択経路は再試行可能、失効資格は明示的失効とし、遅延応答を破棄する', async () => {
    vi.useFakeTimers(); const { ws, controller, authenticate, registration } = setup(true, true);
    const options = { controller, network: 'lan' as const };
    expect(rejectedControlHandshake(options, 'Bearer valid')).toContain('503');
    controller.registrationTokenCurrent.mockReturnValue(false);
    expect(rejectedControlHandshake(options, 'Bearer expired')).toContain('X-CasMate-Registration-State: revoked');
    expect(rejectedControlHandshake(options, undefined)).not.toContain('Registration-State');
    let finish!: (value: UpdatedSmartphoneRegistration) => void;
    controller.updatedRegistration.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    ws.receive({ type: 'control.subscribe', protocolVersion: 2, generation: 1, obs: false, outdoor: false, registration: true });
    authenticate.mockReturnValue(null);
    await vi.advanceTimersByTimeAsync(250);
    expect(ws.closeCode).toBe(1012);
    finish(registration); await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent.some(e => e.type === 'registration.state')).toBe(false);
    const revoked = setup(true, true);
    revoked.authenticate.mockReturnValue(null); revoked.controller.registrationUpdateCurrent.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(250); expect(revoked.ws.closeCode).toBe(4403);
  });
});
