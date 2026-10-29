import { randomUUID, randomBytes } from 'node:crypto';
import { setImmediate as yieldTurn, setTimeout as pause } from 'node:timers/promises';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { isAllowedObsEndpointAddress, isRegistrationId, type ObsControlRegistration } from '../../shared/obs-control';
import type { SmartphoneControlVersion, SmartphoneNetwork } from '../../shared/smartphone';
import type { DirectCredential } from '../../shared/direct-connection';
import type { AppState } from '../core/app-state';
import { ValidationError } from '../core/validation-error';
import { ObsControlHttpError, type ObsControlController } from '../obs/obs-control-controller';
import type { SmartphoneController } from './smartphone-controller';

export interface Principal {
  deviceId: string; obs: ObsControlRegistration | null; video: boolean; protocolVersion: SmartphoneControlVersion;
  update: DirectCredential; speechRecognition?: DirectCredential | null;
}
export interface ControlOptions {
  controller: Pick<SmartphoneController, 'authenticateControl' | 'registrationTokenCurrent' | 'registrationUpdateCurrent' | 'updatedRegistration' | 'touchReport' | 'releaseReport' | 'feedback' | 'acceptReport'>;
  obs: Pick<ObsControlController, 'view' | 'prepareAndroid' | 'confirmAndroid' | 'cancelAndroid' | 'captureProgramAndroid' | 'canCaptureProgramAndroid'>;
  state: Pick<AppState, 'subscribe' | 'remoteSpeechRecognitionState' | 'setSpeechRecognitionEnabled' | 'selectSpeechRecognitionInput' | 'retrySpeechRecognition'>;
  network: SmartphoneNetwork;
  address: string;
  port: number;
}

export function attachSmartphoneControlServer(server: Server, options: ControlOptions): () => void {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on('upgrade', (request, socket, head) => {
    // Before WebSocket ownership, rejected peers can reset their TCP connection.
    const onSocketError = () => socket.destroy();
    socket.on('error', onSocketError);
    const remote = request.socket.remoteAddress?.replace(/^::ffff:/u, '');
    const allowed = request.url === '/smartphone/ws' && request.headers.origin === undefined &&
      request.headers.authorization === undefined && request.headers['x-casmate-read'] === undefined &&
      request.headers.host === `${options.address}:${options.port}` && request.socket.localAddress === options.address &&
      remote && options.network !== 'direct' && isAllowedObsEndpointAddress(options.network, remote);
    const version = controlVersionHeader(request);
    if (allowed && version === null) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    const authenticate = () => version === null ? null : options.controller.authenticateControl(options.network,
      header(request, 'x-casmate-obs'), header(request, 'x-casmate-outdoor'), header(request, 'x-casmate-registration'),
      header(request, 'x-casmate-speech'), version);
    const principal = allowed ? authenticate() : null;
    if (!principal) {
      socket.end(allowed ? rejectedControlHandshake(options, header(request, 'x-casmate-registration')) : 'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, ws => {
      new SmartphoneControlSession(ws, options, principal, authenticate);
      socket.removeListener('error', onSocketError);
      sockets.emit('connection', ws);
    });
  });
  return () => { for (const ws of sockets.clients) ws.terminate(); sockets.close(); };
}

/** Only an invalid update authority means revocation; an inactive route remains retryable. */
export function rejectedControlHandshake(options: Pick<ControlOptions, 'controller' | 'network'>, token: string | undefined): string {
  if (token === undefined) return 'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n';
  if (options.controller.registrationTokenCurrent(options.network, token))
    return 'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n';
  return 'HTTP/1.1 403 Forbidden\r\nX-CasMate-Registration-State: revoked\r\nConnection: close\r\n\r\n';
}

function header(request: IncomingMessage, key: string): string | undefined {
  const value = request.headers[key]; return value === undefined ? undefined : typeof value === 'string' ? value : '';
}

/** Only this feature's current and immediately preceding control contracts coexist. */
export function controlVersionHeader(request: IncomingMessage): SmartphoneControlVersion | null {
  if (request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index]!.toLowerCase() === 'x-casmate-control-version').length > 1) return null;
  const value = header(request, 'x-casmate-control-version');
  return value === undefined || value === '2' ? 2 : value === '3' ? 3 : null;
}

/** Privileged transport only: state comes from OBS, commands retain controller deduplication. */
export class SmartphoneControlSession {
  private capture: { requestId: string; abort: AbortController; ack: { imageId: string; offset: number; resolve(): void } | null } | null = null;
  private readonly connectionId = randomUUID();
  private generation = 0;
  private obsSubscribed = false;
  private outdoorSubscribed = false;
  private registrationSubscribed = false;
  private speechSubscribed = false;
  private registrationPending = false;
  private lastRegistrationRevision = 0;
  private feedback: { sessionId: string; generation: number } | null = null;
  private lastPong = Date.now();
  private lastPing = Date.now();
  private nonce = '';
  private lastState = '';
  private lastSpeechState = '';
  private closed = false;
  private pending = 0;
  private confirmations = new Set<string>();
  private readonly timer: NodeJS.Timeout;
  private readonly unsubscribe: () => void;

  constructor(private readonly ws: WebSocket, private readonly options: ControlOptions, private readonly principal: Principal,
    private readonly authenticate: () => Principal | null) {
    this.send('control.hello', { protocolVersion: principal.protocolVersion,
      ...(principal.protocolVersion === 3 ? { capabilities: ['obs.captureProgram'] } : {}) });
    this.unsubscribe = options.state.subscribe(event => {
      if (event.type === 'obsControl.stateChanged') this.publishObs();
      if (event.type === 'obsControl.stateChanged' || event.type === 'smartphone.stateChanged') void this.publishRegistration();
      if (event.type === 'speechRecognition.stateChanged' || event.type === 'settings.changed' || event.type === 'smartphone.stateChanged') this.publishSpeech();
    });
    this.timer = setInterval(() => {
      if (!this.validate()) return;
      if (this.capture && this.principal.obs && !options.obs.canCaptureProgramAndroid(this.principal.obs)) this.capture.abort.abort();
      void this.publishRegistration();
      this.publishSpeech();
      if (Date.now() - this.lastPong >= 4000) { ws.terminate(); return; }
      if (Date.now() - this.lastPing >= 2000) {
        this.lastPing = Date.now(); this.nonce = randomUUID(); this.send('ping', { nonce: this.nonce });
      }
      if (this.outdoorSubscribed) {
        options.controller.touchReport(principal.deviceId, options.network, this.connectionId);
        if (this.feedback) this.send('outdoor.feedback', options.controller.feedback(principal.deviceId, options.network, this.feedback));
      }
    }, 250).unref();
    ws.on('message', (data, binary) => { if (!binary) void this.receive(String(data)); });
    ws.on('error', () => ws.terminate());
    ws.once('close', () => {
      this.closed = true; clearInterval(this.timer); this.unsubscribe(); this.cancelConfirmations();
      this.capture?.abort.abort();
      options.controller.releaseReport(principal.deviceId, options.network, this.connectionId);
    });
  }

  private validate(): boolean {
    const next = this.authenticate();
    if (!next || next.deviceId !== this.principal.deviceId || Boolean(next.obs) !== Boolean(this.principal.obs) ||
      next.video !== this.principal.video ||
      next.protocolVersion !== this.principal.protocolVersion || next.update?.revision !== this.principal.update?.revision) {
      const retained = this.principal.update && this.options.controller.registrationUpdateCurrent(this.principal.deviceId, this.options.network, this.principal.update);
      this.ws.close(retained ? 1012 : 4403, retained ? '接続を準備中です。' : '登録を確認して読み取り直してください。'); return false;
    }
    if (next.speechRecognition?.registrationId !== this.principal.speechRecognition?.registrationId ||
      next.speechRecognition?.revision !== this.principal.speechRecognition?.revision) { this.ws.close(1012, '認識操作の登録情報を更新してください。'); return false; }
    return !this.closed;
  }

  private async receive(raw: string): Promise<void> {
    if (raw.length > 8192 || !this.validate()) return;
    let m: { type?: string; id?: string; generation?: number; protocolVersion?: number; obs?: boolean; outdoor?: boolean;
      registration?: boolean; speechRecognition?: boolean; nonce?: string; payload?: unknown };
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'pong' && m.nonce === this.nonce) { this.lastPong = Date.now(); return; }
    if (m.type === 'ping' && typeof m.nonce === 'string') { this.send('pong', { nonce: m.nonce }); return; }
    if (m.type === 'control.subscribe') {
      if (m.protocolVersion !== this.principal.protocolVersion || typeof m.registration !== 'boolean' ||
        (this.principal.protocolVersion === 3 ? typeof m.speechRecognition !== 'boolean' : m.speechRecognition !== undefined)) { this.ws.close(4406); return; }
      if (!Number.isInteger(m.generation) || m.generation! <= this.generation || m.generation! > 0xffffffff ||
        typeof m.obs !== 'boolean' || typeof m.outdoor !== 'boolean') return;
      if ((m.obs && !this.principal.obs) || (m.outdoor && !this.principal.video)) { this.ws.close(4403); return; }
      if (m.speechRecognition && !this.principal.speechRecognition) { this.ws.close(4403); return; }
      this.cancelConfirmations(); this.generation = m.generation!;
      this.capture?.abort.abort();
      this.obsSubscribed = m.obs; this.outdoorSubscribed = m.outdoor; this.registrationSubscribed = m.registration === true;
      this.speechSubscribed = m.speechRecognition === true;
      if (!m.outdoor) { this.feedback = null; this.options.controller.releaseReport(this.principal.deviceId, this.options.network, this.connectionId); }
      this.lastState = ''; this.lastSpeechState = ''; this.lastRegistrationRevision = 0; this.publishObs(); this.publishSpeech(); void this.publishRegistration(); return;
    }
    if (m.generation !== this.generation || !this.generation) return;
    if (m.type === 'obs.imageAck') {
      const body = m.payload as { imageId?: unknown; offset?: unknown } | null;
      const ack = this.capture?.ack;
      if (body && ack && Object.keys(body).sort().join(',') === 'imageId,offset' && body.imageId === ack.imageId && body.offset === ack.offset) ack.resolve();
      return;
    }
    if (m.type === 'obs.cancelCapture') {
      const body = m.payload as { requestId?: unknown } | null;
      if (body && Object.keys(body).join(',') === 'requestId' && body.requestId === this.capture?.requestId) this.capture?.abort.abort();
      return;
    }
    if (m.type === 'outdoor.feedbackSubscribe' && this.outdoorSubscribed) {
      try {
        this.options.controller.feedback(this.principal.deviceId, this.options.network, m.payload);
        this.feedback = m.payload as { sessionId: string; generation: number };
      } catch { this.feedback = null; }
      return;
    }
    if (!m.id || !/^[\w-]{1,64}$/.test(m.id) || this.pending >= 32) return;
    const id = m.id; const generation = this.generation; this.pending += 1;
    try {
      if (m.type === 'obs.captureProgram') {
        if (this.principal.protocolVersion !== 3) throw new ObsControlHttpError(503, 'OBS_CAPTURE_UNSUPPORTED');
        if (!this.obsSubscribed || !this.principal.obs) throw new ObsControlHttpError(403, 'REGISTRATION_UNAVAILABLE');
        if (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload) || Object.keys(m.payload).length) throw new ObsControlHttpError(400, 'INVALID_REQUEST');
        if (this.capture) throw new ObsControlHttpError(409, 'BUSY');
        await this.captureProgram(id, generation);
        return;
      }
      let payload: unknown = {}; let status = 200;
      if (m.type === 'outdoor.report' && this.outdoorSubscribed) {
        if (!this.options.controller.acceptReport(this.principal.deviceId, this.options.network, m.payload)) throw new ObsControlHttpError(400, 'INVALID_REQUEST');
        status = 204;
      } else if (m.type?.startsWith('speechRecognition.')) {
        if (this.principal.protocolVersion !== 3 || !this.speechSubscribed || !this.principal.speechRecognition) throw new ObsControlHttpError(403, 'REGISTRATION_UNAVAILABLE');
        const body = m.payload;
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ObsControlHttpError(400, 'INVALID_REQUEST');
        if (m.type === 'speechRecognition.setEnabled') {
          if (Object.keys(body).join(',') !== 'enabled' || !('enabled' in body) || typeof body.enabled !== 'boolean') throw new ObsControlHttpError(400, 'INVALID_REQUEST');
          await this.options.state.setSpeechRecognitionEnabled(body.enabled);
        } else if (m.type === 'speechRecognition.selectInput') {
          const selection = body as Record<string, unknown>;
          if (Object.keys(selection).some(key => !['revision', 'inputSource', 'microphoneId', 'smartphoneDeviceId'].includes(key)) ||
            !Number.isSafeInteger(selection.revision) || Number(selection.revision) < 1 || !['microphone', 'smartphone'].includes(String(selection.inputSource)) ||
            !(selection.microphoneId === undefined || selection.microphoneId === null || typeof selection.microphoneId === 'string' && selection.microphoneId.length > 0 && selection.microphoneId.length <= 1024) ||
            (selection.inputSource === 'smartphone' ? !isRegistrationId(selection.smartphoneDeviceId) : selection.smartphoneDeviceId !== undefined && selection.smartphoneDeviceId !== null))
            throw new ObsControlHttpError(400, 'INVALID_REQUEST');
          await this.options.state.selectSpeechRecognitionInput(body);
        } else if (m.type === 'speechRecognition.retry') {
          if (Object.keys(body).length !== 0) throw new ObsControlHttpError(400, 'INVALID_REQUEST');
          await this.options.state.retrySpeechRecognition();
        } else throw new ObsControlHttpError(400, 'INVALID_REQUEST');
        payload = this.speechState();
      } else {
        if (!this.obsSubscribed || !this.principal.obs) throw new ObsControlHttpError(403, 'REGISTRATION_UNAVAILABLE');
        const obs = this.options.obs;
        if (m.type === 'obs.prepare') {
          const result = await obs.prepareAndroid(m.payload as Parameters<typeof obs.prepareAndroid>[0], this.principal.obs);
          this.confirmations.add(result.confirmationId); payload = { version: 1, ...result };
          if (this.closed || generation !== this.generation) this.cancelConfirmations();
        } else if (m.type === 'obs.confirm') {
          payload = { version: 1, ...await obs.confirmAndroid(m.payload as Parameters<typeof obs.confirmAndroid>[0], this.principal.obs) }; status = 202;
        } else if (m.type === 'obs.cancel') {
          const body = m.payload as { version: number; confirmationId: string };
          if (!body || Object.keys(body).sort().join(',') !== 'confirmationId,version' || body.version !== 1 ||
            typeof body.confirmationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.confirmationId)) throw new ObsControlHttpError(400, 'INVALID_REQUEST');
          obs.cancelAndroid(body.confirmationId, this.principal.obs); this.confirmations.delete(body.confirmationId); status = 204;
        } else throw new ObsControlHttpError(400, 'INVALID_REQUEST');
      }
      if (generation === this.generation && this.validate()) this.send('control.result', { id, status, payload });
    } catch (error) {
      if (generation === this.generation && this.validate()) {
        const known = error instanceof ObsControlHttpError || error instanceof Error && 'status' in error && error.status === 409 &&
          'code' in error && error.code === 'SPEECH_SETTINGS_CONFLICT';
        this.send('control.result', { id, status: known ? error.status : error instanceof ValidationError ? 400 : 503,
          code: known ? error.code : error instanceof ValidationError ? 'INVALID_REQUEST' : m.type?.startsWith('speechRecognition.') ? 'SPEECH_RECOGNITION_UNAVAILABLE' : 'OBS_UNAVAILABLE',
          message: m.type === 'obs.captureProgram' ? 'OBS映像を取得できません。OBS接続・操作許可を確認し、更新してください。' :
            known || error instanceof ValidationError ? error.message : '接続状態を確認してください。' });
        if (known && error.status === 409 && m.type === 'speechRecognition.selectInput') this.publishSpeech(true);
      }
    } finally { this.pending -= 1; }
  }

  private publishObs(): void {
    if (!this.obsSubscribed || !this.validate()) return;
    const { epoch, revision, connection, stream, busy, lastOperation, enabled, androidEnabled } = this.options.obs.view();
    if (!enabled || !androidEnabled || connection !== 'connected') this.capture?.abort.abort();
    const value = { version: 1, epoch, revision, connection: enabled && androidEnabled ? connection : 'disabled', stream, busy, lastOperation };
    const signature = JSON.stringify(value);
    if (signature !== this.lastState) { this.lastState = signature; this.send('obs.state', value); }
  }
  private speechState() {
    const state = this.options.state.remoteSpeechRecognitionState();
    return { revision: state.revision, enabled: state.enabled, inputSource: state.inputSource,
      microphoneId: state.microphoneId, smartphoneDeviceId: state.smartphoneDeviceId, status: state.status, message: state.message,
      inputs: state.inputs.map(input => ({ id: input.id, name: input.name, inputSource: input.inputSource,
        microphoneId: input.microphoneId, smartphoneDeviceId: input.smartphoneDeviceId, available: input.available })) };
  }
  private publishSpeech(force = false): void {
    if (!this.speechSubscribed || !this.principal.speechRecognition || this.principal.protocolVersion !== 3 || !this.validate()) return;
    const value = this.speechState(); const signature = JSON.stringify(value);
    if (force || signature !== this.lastSpeechState) { this.lastSpeechState = signature; this.send('speechRecognition.state', value); }
  }
  private async publishRegistration(): Promise<void> {
    if (!this.registrationSubscribed || !this.principal.update || this.registrationPending || !this.validate()) return;
    const generation = this.generation;
    this.registrationPending = true;
    try {
      const registration = await this.options.controller.updatedRegistration(this.principal.deviceId, this.options.network, this.principal.update, this.principal.protocolVersion);
      if (generation !== this.generation || !this.registrationSubscribed || !this.validate()) return;
      if (registration.updateRevision !== this.lastRegistrationRevision) {
        this.lastRegistrationRevision = registration.updateRevision;
        this.send('registration.state', registration);
      }
    } catch { /* A preparation or save failure does not revoke a retained credential. Retry on the next state tick. */ }
    finally { this.registrationPending = false; }
  }
  private cancelConfirmations(): void {
    for (const id of this.confirmations) {
      try { if (this.principal.obs) this.options.obs.cancelAndroid(id, this.principal.obs); } catch { /* Already consumed or invalidated. */ }
    }
    this.confirmations.clear();
  }

  private async captureProgram(requestId: string, generation: number): Promise<void> {
    const principal = this.principal.obs!;
    const capture: NonNullable<SmartphoneControlSession['capture']> = { requestId, abort: new AbortController(), ack: null };
    this.capture = capture;
    const signal = AbortSignal.any([capture.abort.signal, AbortSignal.timeout(10_000)]);
    let announced = false;
    try {
      const image = await this.options.obs.captureProgramAndroid(principal, signal);
      const current = () => !signal.aborted && this.capture === capture && generation === this.generation &&
        this.obsSubscribed && this.validate() && this.options.obs.canCaptureProgramAndroid(principal) && image.current();
      if (!current()) throw new Error('OBS_CAPTURE_CANCELLED');
      const imageId = randomBytes(18).toString('base64url');
      this.send('control.result', { id: requestId, status: 200, payload: { imageId, sceneName: image.sceneName,
        capturedAt: image.capturedAt, width: image.width, height: image.height, mimeType: image.mimeType, byteLength: image.bytes.length } });
      announced = true;
      let chunkSize = 1024;
      for (let offset = 0; offset < image.bytes.length;) {
        while (this.ws.bufferedAmount > 32768 && current()) await pause(10, undefined, { signal });
        if (!current()) throw new Error('OBS_CAPTURE_CANCELLED');
        const chunk = image.bytes.subarray(offset, offset + chunkSize);
        const frame = Buffer.alloc(36 + chunk.length);
        frame.writeUInt32BE(0x434d4931, 0); frame.writeUInt32BE(generation, 4); frame.writeUInt32BE(offset, 8);
        frame.write(imageId, 12, 24, 'ascii'); chunk.copy(frame, 36);
        const started = performance.now();
        const acknowledged = new Promise<void>(resolve => { capture.ack = { imageId, offset: offset + chunk.length, resolve }; });
        let abort!: () => void;
        const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new Error('OBS_CAPTURE_CANCELLED')); signal.addEventListener('abort', abort, { once: true }); });
        try {
          const sent = new Promise<void>((resolve, reject) => { this.ws.send(frame, error => { if (error) reject(error); else resolve(); }); });
          await Promise.race([Promise.all([sent, acknowledged]), cancelled]);
        } finally { signal.removeEventListener('abort', abort); capture.ack = null; }
        offset += chunk.length;
        // Bound queued wire bytes and target <=250ms per frame using observed delivery,
        // including RTT. Slow readers never get a whole image ahead of a heartbeat.
        chunkSize = Math.max(256, Math.min(4096, Math.floor(chunk.length * 250 / Math.max(1, performance.now() - started))));
        await yieldTurn(undefined, { signal });
      }
    } catch (error) {
      if (!announced) throw error;
      if (!this.closed && generation === this.generation && this.validate()) this.send('obs.captureFailed', {
        requestId, message: 'OBS映像の取得が中断されました。更新してください。',
      });
    } finally {
      if (this.capture === capture) this.capture = null;
    }
  }
  private send(type: string, payload: unknown): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.ws.bufferedAmount > 64 * 1024) { this.ws.terminate(); return; }
    const message = JSON.stringify({ type, connectionId: this.connectionId, generation: this.generation, payload });
    if (Buffer.byteLength(message) > 32 * 1024) { this.ws.close(1009); return; }
    this.ws.send(message);
  }
}
