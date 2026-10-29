import { randomUUID, createHash } from 'node:crypto';
import {
  isObsControlPort,
  isObsPort,
  isObsPhrase,
  normalizeObsPhrase,
  type ObsAction,
  type ObsConnectionState,
  type ObsControlConfirmationView,
  type ObsControlEndpoint,
  type ObsControlLastOperation,
  type ObsControlPhrases,
  type ObsControlRegistration,
  type ObsControlSettings,
  type ObsControlSource,
  type ObsControlView,
  type ObsOperationStatus,
  type ObsStreamState,
} from '../../shared/obs-control';
import type { SpeechRecognitionResult } from '../../shared/types';
import { ObsControlStore, ObsControlStorageError, defaultObsControlSettings, type ObsControlRecord } from './obs-control-store';
import { ObsProgramPreview, type ObsProgramImage } from './obs-program-preview';
import {
  DefaultObsWebsocketTransport,
  obsStreamStateFromStatus,
  type ObsWebsocketConnection,
  type ObsWebsocketTransport,
} from './obs-websocket-client';

const CONFIRMATION_WINDOW_MS = 10_000;
const ANDROID_CONFIRMATION_WINDOW_MS = 10_000;
const OPERATION_TIMEOUT_MS = 30_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

const SOURCE_READ_REQUESTS = new Set([
  'GetVersion', 'GetInputKindList', 'GetInputList', 'GetInputSettings', 'GetInputDefaultSettings',
  'GetSceneCollectionList', 'GetSceneList', 'GetStudioModeEnabled', 'GetGroupList', 'GetSceneItemList',
  'GetGroupSceneItemList', 'GetSceneItemTransform', 'GetVideoSettings',
]);
const SOURCE_WRITE_REQUESTS = new Set(['CreateInput', 'CreateSceneItem', 'SetSceneItemTransform']);

export interface ObsSourceSession {
  valid(): boolean;
  destinationRevision(): number;
  request(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ObsSourceLease { session: ObsSourceSession; release(): void }

/** An explicit negative OBS response proves the request was rejected, unlike a lost response. */
export class ObsSourceRequestRejected extends Error {
  constructor(readonly requestCode: number) { super('OBS_SOURCE_REQUEST_REJECTED'); }
}

export interface ObsControlControllerOptions {
  store: ObsControlStore;
  transport?: ObsWebsocketTransport;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
  onState?: (view: ObsControlView) => void;
  onSourceContextChanged?: () => void;
}

export interface AndroidPrepareRequest {
  version: 1;
  requestId: string;
  action: ObsAction;
  epoch: string;
  expectedRevision: number;
}

export interface AndroidConfirmRequest {
  version: 1;
  requestId: string;
  confirmationId: string;
}

export interface AndroidPrepareResponse {
  confirmationId: string;
  expiresAt: number;
  action: ObsAction;
}

export interface AndroidConfirmResponse {
  operationId: string;
  status: ObsOperationStatus;
}

interface Confirmation extends AndroidPrepareResponse {
  id: string;
  source: ObsControlSource;
  createdAt: number;
  stateRevision: number;
  registrationId: string | null;
  registrationRevision: number | null;
  sessionId?: string;
  resultId?: string;
  resultSequence?: number;
  capturePeriodId?: string;
}

interface RequestRetention<T> {
  bodyHash: string;
  response: T;
  expiresAt: number;
}

export class ObsControlController {
  private readonly programPreview = new ObsProgramPreview(() => this.visualReader());

  canCaptureProgramAndroid(principal: ObsControlRegistration): boolean {
    return this.validAndroidRegistration(principal) && this.connectionState === 'connected';
  }

  async captureProgramAndroid(principal: ObsControlRegistration, signal: AbortSignal): Promise<ObsProgramImage> {
    if (!this.canCaptureProgramAndroid(principal)) throw new ObsControlHttpError(403, 'ANDROID_CONTROL_DISABLED');
    try {
      const image = await this.programPreview.capture(signal);
      if (!this.canCaptureProgramAndroid(principal) || !image.current()) throw new Error('OBS_CAPTURE_CHANGED');
      return image;
    } catch (error) {
      signal.throwIfAborted();
      throw new ObsControlHttpError(error instanceof Error && error.message === 'BUSY' ? 409 : 503,
        error instanceof Error && error.message === 'BUSY' ? 'BUSY' : 'OBS_CAPTURE_UNAVAILABLE');
    }
  }
  private readonly transport: ObsWebsocketTransport;
  private readonly now: () => number;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private record: ObsControlRecord | null = null;
  private protectedUnavailable = false;
  private connection: ObsWebsocketConnection | null = null;
  private visualRevision = 0;
  private streamRevision = 0;
  private sourceOwner: symbol | null = null;
  private sourceCollectionRevision = 0;
  private sourceDestinationRevision = 0;
  private sourceCollectionChanging = false;

  sourceReader(): ObsSourceSession { return this.sourceSession(); }

  acquireSourceRegistration(): ObsSourceLease {
    if (this.confirmation && this.now() >= this.confirmation.expiresAt) this.cancelConfirmation('CONFIRMATION_EXPIRED');
    if (this.confirmation || this.operation || this.sourceOwner) throw new ObsControlHttpError(409, 'BUSY');
    this.sourceSession();
    const owner = Symbol('OBS source registration');
    this.sourceOwner = owner;
    this.bump();
    return {
      session: this.sourceSession(owner),
      release: () => {
        if (this.sourceOwner !== owner) return;
        this.sourceOwner = null;
        this.bump();
      },
    };
  }

  acquireSourceTest(): ObsSourceLease { return this.acquireSourceRegistration(); }

  private sourceSession(owner?: symbol): ObsSourceSession {
    const connection = this.connection;
    const generation = this.connectionGeneration;
    const collectionRevision = this.sourceCollectionRevision;
    if (this.sourceCollectionChanging) throw new Error('OBS_SOURCE_TARGET_CHANGED');
    if (!connection || this.connectionState !== 'connected' || !this.settings().enabled) throw new Error('OBS_UNAVAILABLE');
    const valid = () => this.connection === connection && this.connectionGeneration === generation &&
      this.connectionState === 'connected' && this.settings().enabled && !this.sourceCollectionChanging &&
      this.sourceCollectionRevision === collectionRevision && (owner === undefined || this.sourceOwner === owner);
    return {
      valid,
      destinationRevision: () => this.sourceDestinationRevision,
      request: async (type, data) => {
        if (!SOURCE_READ_REQUESTS.has(type) && !(owner !== undefined && SOURCE_WRITE_REQUESTS.has(type))) {
          throw new Error('OBS_SOURCE_REQUEST_FORBIDDEN');
        }
        if (!valid()) throw new Error('OBS_SOURCE_TARGET_CHANGED');
        const response = await connection.request(type, data);
        if (!valid()) throw new Error('OBS_SOURCE_TARGET_CHANGED');
        if (!response.requestStatus.result) throw new ObsSourceRequestRejected(response.requestStatus.code);
        return response.responseData ?? {};
      },
    };
  }
  async readAiStreamState(): Promise<{ connected: boolean; stream: ObsStreamState }> {
    const connection = this.connection; const generation = this.connectionGeneration; const revision = this.streamRevision;
    if (!connection || this.connectionState !== 'connected' || !this.settings().enabled) return { connected: false, stream: 'unknown' };
    const status = await connection.getStreamStatus();
    if (connection !== this.connection || generation !== this.connectionGeneration || revision !== this.streamRevision || !this.settings().enabled) {
      throw new Error('OBS_STATE_CHANGED');
    }
    const stream = obsStreamStateFromStatus(status);
    this.setStreamState(stream);
    return { connected: true, stream };
  }
  visualReader(): import('./obs-visual').ObsVisualReader {
    const connection = this.connection; const revision = this.visualRevision;
    if (!connection || this.connectionState !== 'connected' || !this.settings().enabled) throw new Error('OBS_UNAVAILABLE');
    const allowed = new Set(['GetSceneCollectionList', 'GetSceneList', 'GetCurrentProgramScene', 'GetSceneItemList', 'GetGroupSceneItemList', 'GetVersion', 'GetSourceScreenshot', 'GetVideoSettings']);
    return { valid: () => this.connection === connection && this.visualRevision === revision && this.settings().enabled,
      request: async (type, data) => {
        if (!allowed.has(type)) throw new Error('OBS_READ_ONLY');
        const response = await connection.request(type, data);
        if (!response.requestStatus.result) throw new Error('OBS_VISUAL_UNAVAILABLE');
        return response.responseData ?? {};
      } };
  }
  private unsubscribeConnection: (() => void) | null = null;
  private unsubscribeDisconnect: (() => void) | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectionGeneration = 0;
  private saveQueue: Promise<unknown> = Promise.resolve();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopped = true;
  private connectionState: ObsConnectionState = 'disabled';
  private streamState: ObsStreamState = 'unknown';
  private confirmation: Confirmation | null = null;
  private operation: { id: string; action: ObsAction } | null = null;
  private lastOperation: ObsControlLastOperation | null = null;
  private error: string | null = null;
  private warning: string | null = null;
  private publicationEndpoints: ObsControlEndpoint[] = [];
  private publicationReady = false;
  private deviceRegistration?: (id: string) => ObsControlRegistration | null;
  private selectedNetwork: 'lan' | 'tailscale' | null = null;

  useDeviceRegistrations(resolve: (id: string) => ObsControlRegistration | null): void {
    this.deviceRegistration = resolve;
  }

  invalidateDeviceRegistration(id: string): void {
    if (this.confirmation?.source === 'android' && this.confirmation.registrationId === id) this.cancelConfirmation('REGISTRATION_CHANGED');
    for (const requests of [this.androidPrepareRequests, this.androidConfirmRequests]) {
      for (const key of requests.keys()) if (key.startsWith(id + ':')) requests.delete(key);
    }
  }

  setDevicePublication(network: 'lan' | 'tailscale' | null, endpoints: ObsControlEndpoint[], ready: boolean, warning: string | null = null): void {
    const changed = this.selectedNetwork !== network || JSON.stringify(this.publicationEndpoints) !== JSON.stringify(endpoints) || this.warning !== warning;
    this.selectedNetwork = network;
    this.publicationEndpoints = structuredClone(endpoints);
    this.warning = warning;
    this.setPublicationReady(ready);
    if (changed) this.bump();
  }

  private validAndroidRegistration(principal: ObsControlRegistration | null): boolean {
    const current = principal && this.deviceRegistration?.(principal.registrationId);
    return Boolean(this.settings().enabled && this.settings().androidEnabled && this.publicationReady && current &&
      current.registrationId === principal?.registrationId && current.token === principal?.token && current.revision === principal?.revision);
  }
  private confirmationTimer: NodeJS.Timeout | null = null;
  private epoch = randomUUID();
  private revision = 0;
  private readonly androidPrepareRequests = new Map<string, RequestRetention<AndroidPrepareResponse | ErrorResponse>>();
  private readonly androidConfirmRequests = new Map<string, RequestRetention<AndroidConfirmResponse | ErrorResponse>>();
  private readonly seenRecognitionResults = new Set<string>();
  private voiceCaptureReady = true;
  private readonly options: ObsControlControllerOptions;

  constructor(options: ObsControlControllerOptions) {
    this.options = options;
    this.transport = options.transport ?? new DefaultObsWebsocketTransport();
    this.now = options.now ?? (() => Date.now());
    this.delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.epoch = randomUUID();
    try {
      this.record = await this.options.store.load();
      this.publicationEndpoints = [];
      this.protectedUnavailable = false;
    } catch (error) {
      this.record = null;
      this.protectedUnavailable = true;
      this.connectionState = 'unavailable';
      this.error = error instanceof ObsControlStorageError ? error.message : obsControlUserError('OBS_SECRET_UNAVAILABLE');
      this.bump();
      return;
    }
    if (!this.record) {
      this.connectionState = 'disabled';
      this.streamState = 'unknown';
      this.bump();
      return;
    }
    if (this.record.settings.enabled) void this.connect();
    else {
      this.connectionState = 'disabled';
      this.streamState = 'unknown';
      this.bump();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.saveQueue;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.cancelConfirmation('OBS_STOPPED');
    await this.closeConnection();
    this.connectionState = 'disabled';
    this.streamState = 'unknown';
    this.bump();
  }

  view(): ObsControlView {
    this.expireConfirmationIfNeeded();
    const settings = this.settings();
    const confirmation: ObsControlConfirmationView | null = this.confirmation ? {
      action: this.confirmation.action,
      source: this.confirmation.source,
      expiresAt: this.confirmation.expiresAt,
    } : null;
    return {
      epoch: this.epoch,
      revision: this.revision,
      enabled: settings.enabled,
      voiceEnabled: settings.voiceEnabled,
      androidEnabled: settings.androidEnabled,
      obsPort: settings.port,
      passwordConfigured: settings.password.length > 0,
      phrases: { ...settings.phrases },
      connection: settings.enabled ? this.connectionState : 'disabled',
      stream: settings.enabled ? this.streamState : 'unknown',
      busy: this.confirmation !== null || this.operation !== null || this.sourceOwner !== null,
      confirmation,
      lastOperation: this.lastOperation ? { ...this.lastOperation } : null,
      publication: {
        ...settings.publication,
        lanEnabled: this.selectedNetwork === 'lan', tailscaleEnabled: this.selectedNetwork === 'tailscale',
        ready: this.publicationReady,
        registered: false,
        registrationId: null,
        revision: null,
        endpoints: this.publicationEndpoints.map(({ network, address, port }) => ({ network, address, port })),
        warning: this.warning,
      },
      error: this.error,
    };
  }

  get updateNotice(): string | null { return this.options.store.resetNotice; }

  setPublicationReady(ready: boolean): void {
    if (this.publicationReady === ready) return;
    this.publicationReady = ready;
    if (!ready && this.confirmation?.source === 'android') this.cancelConfirmation('PUBLICATION_UNAVAILABLE');
    this.bump();
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.saveQueue.then(action);
    this.saveQueue = operation.catch(() => undefined);
    return operation;
  }

  configure(patch: unknown): Promise<void> {
    return this.serialize(() => this.configureNow(patch));
  }

  private async configureNow(patch: unknown): Promise<void> {
    const next = this.parsePatch(patch);
    if (next.publication) {
      next.publication = { ...next.publication, lanEnabled: false, tailscaleEnabled: false };
    }
    const previous = this.record?.settings ?? defaultObsControlSettings();
    if (this.protectedUnavailable) throw new Error('OBS_SECRET_UNAVAILABLE');
    const password = next.password ?? previous.password;
    if ((next.enabled ?? previous.enabled) && password.length === 0) throw new Error('OBS_PASSWORD_REQUIRED');
    const settings: ObsControlSettings = {
      enabled: next.enabled ?? previous.enabled,
      voiceEnabled: next.voiceEnabled ?? previous.voiceEnabled,
      androidEnabled: next.androidEnabled ?? previous.androidEnabled,
      port: next.port ?? previous.port,
      password,
      phrases: next.phrases ?? previous.phrases,
      publication: next.publication ?? previous.publication,
    };
    if (JSON.stringify(settings) === JSON.stringify(previous)) return;
    const connectionChanged = settings.enabled !== previous.enabled || settings.port !== previous.port || settings.password !== previous.password;
    const publicationChanged = settings.enabled !== previous.enabled || settings.androidEnabled !== previous.androidEnabled ||
      JSON.stringify(settings.publication) !== JSON.stringify(previous.publication);
    const record: ObsControlRecord = {
      version: 1,
      settings,
      registration: null,
    };
    await this.options.store.save(record);
    this.record = record;
    this.protectedUnavailable = false;
    this.cancelConfirmation('SETTINGS_CHANGED');
    if (publicationChanged) this.publicationReady = false;
    if (connectionChanged) {
      this.error = null;
      await this.closeConnection();
      this.streamState = 'unknown';
      this.connectionState = settings.enabled ? 'connecting' : 'disabled';
      this.reconnectAttempt = 0;
      if (settings.enabled) void this.connect();
    }
    this.bump();
  }

  async retry(): Promise<void> {
    if (!this.settings().enabled) throw new Error('OBS_DISABLED');
    await this.closeConnection();
    this.reconnectAttempt = 0;
    this.error = null;
    this.connectionState = 'connecting';
    this.streamState = 'unknown';
    this.bump();
    await this.connect();
  }

  async prepareAndroid(request: AndroidPrepareRequest, principal: ObsControlRegistration): Promise<AndroidPrepareResponse> {
    validatePrepareRequest(request);
    if (!this.validAndroidRegistration(principal)) throw new ObsControlHttpError(403, 'REGISTRATION_UNAVAILABLE');
    const requestKey = principal!.registrationId + ':' + request.requestId;
    const bodyHash = hashRequest(request);
    this.pruneRetentions();
    const retained = this.androidPrepareRequests.get(requestKey);
    if (retained) {
      if (retained.bodyHash !== bodyHash) throw new ObsControlHttpError(409, 'REQUEST_ID_REUSED');
      if (retained.response instanceof ErrorResponse) throw retained.response;
      return { ...retained.response };
    }
    try {
      if (!this.settings().androidEnabled) throw new ObsControlHttpError(403, 'ANDROID_CONTROL_DISABLED');

      if (request.epoch !== this.epoch || request.expectedRevision !== this.revision) {
        throw new ObsControlHttpError(409, 'STALE_STATE');
      }
      const response = this.createConfirmation('android', request.action, { registrationId: principal!.registrationId, registrationRevision: principal!.revision });
      this.androidPrepareRequests.set(requestKey, {
        bodyHash,
        response,
        expiresAt: response.expiresAt + OPERATION_TIMEOUT_MS,
      });
      return { ...response };
    } catch (error) {
      this.retainAndroidError(this.androidPrepareRequests, requestKey, bodyHash, error);
      throw error;
    }
  }

  async confirmAndroid(request: AndroidConfirmRequest, principal: ObsControlRegistration): Promise<AndroidConfirmResponse> {
    validateConfirmRequest(request);
    if (!this.validAndroidRegistration(principal)) throw new ObsControlHttpError(403, 'REGISTRATION_UNAVAILABLE');
    const requestKey = principal!.registrationId + ':' + request.requestId;
    const bodyHash = hashRequest(request);
    this.pruneRetentions();
    const retained = this.androidConfirmRequests.get(requestKey);
    if (retained) {
      if (retained.bodyHash !== bodyHash) throw new ObsControlHttpError(409, 'REQUEST_ID_REUSED');
      if (retained.response instanceof ErrorResponse) throw retained.response;
      return { ...retained.response };
    }
    try {
      const confirmation = this.confirmation;
      if (!confirmation || confirmation.source !== 'android' || confirmation.id !== request.confirmationId || confirmation.registrationId !== principal!.registrationId) {
        throw new ObsControlHttpError(409, 'CONFIRMATION_EXPIRED');
      }
      const response = await this.confirmConfirmation(confirmation);
      this.androidConfirmRequests.set(requestKey, {
        bodyHash,
        response,
        expiresAt: this.now() + OPERATION_TIMEOUT_MS,
      });
      return { ...response };
    } catch (error) {
      this.retainAndroidError(this.androidConfirmRequests, requestKey, bodyHash, error);
      throw error;
    }
  }

  cancelAndroid(confirmationId: string, principal: ObsControlRegistration): void {
    if (!this.validAndroidRegistration(principal) || this.confirmation?.registrationId !== principal?.registrationId || this.confirmation?.source !== 'android') {
      throw new ObsControlHttpError(403, 'CONFIRMATION_EXPIRED');
    }
    if (typeof confirmationId !== 'string' || confirmationId.length === 0) return;
    if (this.confirmation?.id === confirmationId) this.cancelConfirmation('CANCELLED');
  }

  cancelManagementConfirmation(confirmationId?: string): void {
    if (!confirmationId || this.confirmation?.id === confirmationId) this.cancelConfirmation('CANCELLED');
  }

  handleSpeechResult(result: SpeechRecognitionResult, previewActive = false): void {
    const settings = this.settings();
    if (previewActive || !settings.enabled || !settings.voiceEnabled || !this.voiceCaptureReady) return;
    const identity = `${result.sessionId}:${result.capturePeriodId ?? result.sessionId}:${result.id}:${result.sequence}`;
    if (this.seenRecognitionResults.has(identity)) return;
    this.seenRecognitionResults.add(identity);
    if (this.seenRecognitionResults.size > 500) {
      const first = this.seenRecognitionResults.values().next().value;
      if (first) this.seenRecognitionResults.delete(first);
    }
    const normalized = normalizeObsPhrase(result.text);
    const confirmation = this.confirmation;
    if (confirmation) {
      if (this.now() >= confirmation.expiresAt) {
        this.cancelConfirmation('CONFIRMATION_EXPIRED');
      } else {
        const expected = confirmation.action === 'start'
          ? normalizeObsPhrase(settings.phrases.startConfirm)
          : normalizeObsPhrase(settings.phrases.stopConfirm);
        if (normalized === expected && result.sessionId === confirmation.sessionId &&
          result.id !== confirmation.resultId && result.sequence > (confirmation.resultSequence ?? -1) &&
          (confirmation.capturePeriodId === undefined || confirmation.capturePeriodId === result.capturePeriodId)) {
          void this.confirmConfirmation(confirmation).catch(() => undefined);
        }
        return;
      }
    }
    if (this.operation || this.sourceOwner) return;
    const action = normalized === normalizeObsPhrase(settings.phrases.startCommand)
      ? 'start'
      : normalized === normalizeObsPhrase(settings.phrases.stopCommand) ? 'stop' : null;
    if (!action) return;
    try {
      this.createConfirmation('voice', action, {
        sessionId: result.sessionId,
        resultId: result.id,
        resultSequence: result.sequence,
        capturePeriodId: result.capturePeriodId,
      });
    } catch {
      // Recognition commands are intentionally silent when OBS is unavailable or busy.
    }
  }

  handleSpeechRecognitionState(status: string, sessionId: string | null): void {
    if (status === 'listening' && sessionId) this.voiceCaptureReady = true;
    if (!this.confirmation || this.confirmation.source !== 'voice') return;
    if (!['listening', 'speechDetected', 'recognizing'].includes(status) ||
      (this.confirmation.source === 'voice' && this.confirmation.sessionId !== sessionId)) {
      this.cancelConfirmation('SPEECH_RECOGNITION_CHANGED');
    }
  }

  invalidateVoiceCapturePeriod(): void {
    this.voiceCaptureReady = false;
    if (this.confirmation?.source === 'voice') this.cancelConfirmation('SPEECH_RECOGNITION_CHANGED');
  }

  setVoiceCaptureAvailable(available: boolean): void {
    const warning = obsControlUserError('OBS_VOICE_CAPTURE_UNAVAILABLE');
    if (!available) { this.invalidateVoiceCapturePeriod(); this.error = warning; this.bump(); }
    else if (this.error === warning) { this.error = null; this.bump(); }
  }

  private createConfirmation(
    source: ObsControlSource,
    action: ObsAction,
    extra: Partial<Confirmation> = {},
  ): AndroidPrepareResponse {
    if (this.confirmation || this.operation || this.sourceOwner) throw new ObsControlHttpError(409, 'BUSY');
    if (!this.settings().enabled || this.connectionState !== 'connected') {
      throw new ObsControlHttpError(503, 'OBS_UNAVAILABLE');
    }
    if (!actionAllowed(this.streamState, action)) throw new ObsControlHttpError(409, 'STREAM_STATE_CHANGED');
    const expiresAt = this.now() + (source === 'android' ? ANDROID_CONFIRMATION_WINDOW_MS : CONFIRMATION_WINDOW_MS);
    const confirmationId = randomUUID();
    this.confirmation = {
      id: confirmationId,
      confirmationId,
      expiresAt,
      action,
      source,
      createdAt: this.now(),
      stateRevision: this.revision,
      registrationId: null,
      registrationRevision: null,
      ...extra,
    };
    this.confirmationTimer = setTimeout(() => {
      if (this.confirmation?.id === confirmationId && this.now() >= expiresAt) this.cancelConfirmation('CONFIRMATION_EXPIRED');
    }, Math.max(0, expiresAt - this.now()));
    this.confirmationTimer.unref?.();
    this.bump();
    return { confirmationId, expiresAt, action };
  }

  private async confirmConfirmation(confirmation: Confirmation): Promise<AndroidConfirmResponse> {
    if (!this.confirmation || this.confirmation.id !== confirmation.id) {
      throw new ObsControlHttpError(409, 'CONFIRMATION_CONSUMED');
    }
    if (this.now() >= confirmation.expiresAt) {
      this.cancelConfirmation('CONFIRMATION_EXPIRED');
      throw new ObsControlHttpError(409, 'CONFIRMATION_EXPIRED');
    }
    const registration = confirmation.source === 'android' ? this.deviceRegistration?.(confirmation.registrationId ?? '') : null;
    if ((confirmation.source === 'android' && (!registration || registration.registrationId !== confirmation.registrationId ||
      registration.revision !== confirmation.registrationRevision)) ||
      this.connectionState !== 'connected' || !actionAllowed(this.streamState, confirmation.action)) {
      this.cancelConfirmation('STATE_CHANGED');
      throw new ObsControlHttpError(409, 'STATE_CHANGED');
    }
    const connection = this.connection;
    if (!connection) {
      this.cancelConfirmation('OBS_UNAVAILABLE');
      throw new ObsControlHttpError(503, 'OBS_UNAVAILABLE');
    }
    let latest: ObsStreamState;
    try {
      latest = obsStreamStateFromStatus(await connection.getStreamStatus());
    } catch {
      this.cancelConfirmation('OBS_UNAVAILABLE');
      throw new ObsControlHttpError(503, 'OBS_UNAVAILABLE');
    }
    if (this.connection !== connection || this.confirmation?.id !== confirmation.id || latest !== this.streamState ||
      !actionAllowed(latest, confirmation.action)) {
      if (this.confirmation?.id === confirmation.id) this.cancelConfirmation('STATE_CHANGED');
      throw new ObsControlHttpError(409, 'STATE_CHANGED');
    }
    if (this.confirmationTimer) clearTimeout(this.confirmationTimer);
    this.confirmationTimer = null;
    this.confirmation = null;
    if ((confirmation.action === 'start' && this.streamState === 'streaming') ||
      (confirmation.action === 'stop' && this.streamState === 'stopped')) {
      const operationId = randomUUID();
      this.lastOperation = { operationId, action: confirmation.action, status: 'alreadySatisfied', errorCode: null };
      this.bump();
      return { operationId, status: 'alreadySatisfied' };
    }
    const operationId = randomUUID();
    this.operation = { id: operationId, action: confirmation.action };
    this.lastOperation = { operationId, action: confirmation.action, status: 'executing', errorCode: null };
    this.setStreamState(confirmation.action === 'start' ? 'starting' : 'stopping');
    this.bump();
    void this.executeOperation(operationId, confirmation.action);
    return { operationId, status: 'executing' };
  }

  private async executeOperation(operationId: string, action: ObsAction): Promise<void> {
    const connection = this.connection;
    if (!connection) {
      this.finishOperation(operationId, action, 'failed', 'OBS_UNAVAILABLE');
      return;
    }
    const deadline = this.now() + OPERATION_TIMEOUT_MS;
    const timeout = setTimeout(() => this.finishOperation(operationId, action, 'unknown', 'OBS_OPERATION_TIMEOUT'), OPERATION_TIMEOUT_MS);
    timeout.unref?.();
    try {
      await this.waitForOperation(connection, operationId, action, deadline);
    } finally { clearTimeout(timeout); }
  }

  private async waitForOperation(connection: ObsWebsocketConnection, operationId: string, action: ObsAction, deadline: number): Promise<void> {
    const current = () => {
      if (this.operation?.id !== operationId) return false;
      if (this.now() >= deadline) {
        this.finishOperation(operationId, action, 'unknown', 'OBS_OPERATION_TIMEOUT');
        return false;
      }
      if (this.connection !== connection) {
        this.finishOperation(operationId, action, 'unknown', 'OBS_OPERATION_UNKNOWN');
        return false;
      }
      return true;
    };
    try {
      const result = action === 'start' ? await connection.startStream() : await connection.stopStream();
      if (!current()) return;
      if (!result.requestStatus.result) {
        this.finishOperation(operationId, action, 'failed', 'OBS_REQUEST_REJECTED');
        return;
      }
    } catch {
      this.finishOperation(operationId, action, 'unknown', 'OBS_OPERATION_UNKNOWN');
      return;
    }
    while (current()) {
      try {
        const status = await connection.getStreamStatus();
        if (!current()) return;
        const next = obsStreamStateFromStatus(status);
        this.setStreamState(next);
        if ((action === 'start' && next === 'streaming') || (action === 'stop' && next === 'stopped')) {
          this.finishOperation(operationId, action, 'succeeded', null);
          return;
        }
      } catch {
        this.finishOperation(operationId, action, 'unknown', 'OBS_OPERATION_UNKNOWN');
        return;
      }
      await this.delay(250);
    }
  }

  private finishOperation(operationId: string, action: ObsAction, status: ObsOperationStatus, errorCode: string | null): void {
    if (this.operation?.id !== operationId) return;
    this.operation = null;
    this.lastOperation = { operationId, action, status, errorCode };
    if (status === 'failed' || status === 'unknown') this.error = errorCode ? obsControlUserError(errorCode) : null;
    this.bump();
  }

  private cancelConfirmation(reason: string): void {
    if (!this.confirmation) return;
    const cancelled = this.confirmation;
    if (this.confirmationTimer) clearTimeout(this.confirmationTimer);
    this.confirmationTimer = null;
    this.confirmation = null;
    this.lastOperation = {
      operationId: randomUUID(),
      action: cancelled.action,
      status: 'cancelled',
      errorCode: reason,
    };
    this.error = obsControlUserError(reason);
    this.bump();
  }

  private async connect(): Promise<void> {
    if (this.stopped || !this.settings().enabled || this.connectPromise) return this.connectPromise ?? Promise.resolve();
    this.connectionState = 'connecting';
    this.bump();
    const generation = this.connectionGeneration;
    this.connectPromise = (async () => {
      let candidate: ObsWebsocketConnection | null = null;
      try {
        const settings = this.settings();
        candidate = await this.transport.connect(`ws://127.0.0.1:${settings.port}`, settings.password);
        if (generation !== this.connectionGeneration || this.stopped || !this.settings().enabled) { await candidate.close(); return; }
        this.connection = candidate;
        this.unsubscribeConnection = candidate.subscribe((event) => this.handleObsEvent(event.eventType, event.eventData));
        this.unsubscribeDisconnect = candidate.onDisconnect(() => this.handleDisconnect(candidate!));
        this.connectionState = 'connected';
        this.sourceCollectionChanging = false;
        this.reconnectAttempt = 0;
        this.error = null;
        const status = await candidate.getStreamStatus();
        if (generation !== this.connectionGeneration) return;
        this.setStreamState(obsStreamStateFromStatus(status));
        this.bump();
      } catch (error) {
        if (generation !== this.connectionGeneration) return;
        if (candidate && this.connection === candidate) {
          this.unsubscribeConnection?.();
          this.unsubscribeConnection = null;
          this.unsubscribeDisconnect?.();
          this.unsubscribeDisconnect = null;
          this.connection = null;
          await candidate.close().catch(() => undefined);
        }
        this.connectionState = 'unavailable';
        this.streamState = 'unknown';
        const code = error instanceof Error ? error.message : 'OBS_UNAVAILABLE';
        this.error = obsControlUserError(code);
        this.cancelConfirmation('OBS_DISCONNECTED');
        this.bump();
        if (!['OBS_AUTH_REQUIRED', 'OBS_AUTHENTICATION_FAILED', 'OBS_PROTOCOL_UNSUPPORTED'].includes(code)) this.scheduleReconnect();
      } finally {
        if (generation === this.connectionGeneration) this.connectPromise = null;
      }
    })();
    return this.connectPromise;
  }

  private handleObsEvent(eventType: string, eventData?: Record<string, unknown>): void {
    if (/Scene|Input|Source|Transition/.test(eventType)) this.visualRevision++;
    if (eventType === 'CurrentSceneCollectionChanging' || eventType === 'CurrentSceneCollectionChanged') {
      this.sourceCollectionRevision++;
      this.sourceCollectionChanging = eventType === 'CurrentSceneCollectionChanging';
    }
    if (['CurrentSceneCollectionChanged', 'CurrentProgramSceneChanged', 'CurrentPreviewSceneChanged', 'StudioModeStateChanged'].includes(eventType)) {
      this.sourceDestinationRevision++;
      this.options.onSourceContextChanged?.();
    }
    if (['InputRemoved', 'SceneItemRemoved', 'SceneRemoved'].includes(eventType)) this.options.onSourceContextChanged?.();
    if (eventType !== 'StreamStateChanged' || !eventData) return;
    if (typeof eventData.outputActive !== 'boolean' || typeof eventData.outputState !== 'string') return;
    this.setStreamState(obsStreamStateFromStatus({ outputActive: eventData.outputActive, outputState: eventData.outputState }));
  }

  private handleDisconnect(connection: ObsWebsocketConnection): void {
    if (this.connection !== connection || this.stopped) return;
    this.connection = null;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = null;
    this.unsubscribeDisconnect?.();
    this.unsubscribeDisconnect = null;
    this.connectionState = 'unavailable';
    this.streamState = 'unknown';
    this.cancelConfirmation('OBS_DISCONNECTED');
    this.bump();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.settings().enabled || this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async closeConnection(): Promise<void> {
    this.connectionGeneration += 1;
    this.connectPromise = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = null;
    this.unsubscribeDisconnect?.();
    this.unsubscribeDisconnect = null;
    const connection = this.connection;
    this.connection = null;
    if (connection) await connection.close().catch(() => undefined);
  }

  private settings(): ObsControlSettings {
    return this.record?.settings ?? defaultObsControlSettings();
  }

  initialSetupFingerprint(): string {
    const { port, password } = this.settings();
    return createHash('sha256').update(JSON.stringify([port, password])).digest('hex');
  }

  private parsePatch(value: unknown): {
    enabled?: boolean;
    voiceEnabled?: boolean;
    androidEnabled?: boolean;
    port?: number;
    password?: string;
    phrases?: ObsControlPhrases;
    publication?: ObsControlSettings['publication'];
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OBS_CONFIGURATION_INVALID');
    const input = value as Record<string, unknown>;
    const allowed = ['enabled', 'voiceEnabled', 'androidEnabled', 'port', 'password', 'phrases', 'publication'];
    if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('OBS_CONFIGURATION_INVALID');
    const result: ReturnType<ObsControlController['parsePatch']> = {};
    for (const key of ['enabled', 'voiceEnabled', 'androidEnabled'] as const) {
      if (key in input) {
        if (typeof input[key] !== 'boolean') throw new Error('OBS_CONFIGURATION_INVALID');
        result[key] = input[key];
      }
    }
    if ('port' in input) {
      if (!isObsPort(input.port)) throw new Error('OBS_CONFIGURATION_INVALID');
      result.port = input.port;
    }
    if ('password' in input) {
      if (typeof input.password !== 'string' || input.password.length === 0 || input.password.length > 256) throw new Error('OBS_PASSWORD_INVALID');
      result.password = input.password;
    }
    if ('phrases' in input) {
      const phrases = input.phrases;
      if (!phrases || typeof phrases !== 'object' || Array.isArray(phrases)) throw new Error('OBS_PHRASES_INVALID');
      const keys = ['startCommand', 'stopCommand', 'startConfirm', 'stopConfirm'] as const;
      if (Object.keys(phrases).some((key) => !keys.includes(key as typeof keys[number])) ||
        keys.some((key) => !isObsPhrase((phrases as Record<string, unknown>)[key]))) throw new Error('OBS_PHRASES_INVALID');
      const normalized = keys.map((key) => normalizeObsPhrase((phrases as Record<string, string>)[key]));
      if (new Set(normalized).size !== normalized.length) throw new Error('OBS_PHRASES_DUPLICATE');
      result.phrases = Object.fromEntries(keys.map((key) => [key, (phrases as Record<string, string>)[key]])) as unknown as ObsControlPhrases;
    }
    if ('publication' in input) {
      const publication = input.publication;
      if (!publication || typeof publication !== 'object' || Array.isArray(publication)) throw new Error('OBS_PUBLICATION_INVALID');
      const value = publication as Record<string, unknown>;
      if (Object.keys(value).some((key) => !['lanEnabled', 'tailscaleEnabled', 'port'].includes(key)) ||
        typeof value.lanEnabled !== 'boolean' || typeof value.tailscaleEnabled !== 'boolean' || !isObsControlPort(value.port)) {
        throw new Error('OBS_PUBLICATION_INVALID');
      }
      result.publication = { lanEnabled: value.lanEnabled, tailscaleEnabled: value.tailscaleEnabled, port: value.port };
    }
    return result;
  }

  private setStreamState(value: ObsStreamState): void {
    if (this.streamState === value) return;
    this.streamRevision++;
    if (this.confirmation && this.streamState !== value) this.cancelConfirmation('STREAM_STATE_CHANGED');
    this.streamState = value;
    this.bump();
  }

  private bump(): void {
    this.revision += 1;
    this.options.onState?.(this.view());
  }

  private pruneRetentions(): void {
    const now = this.now();
    for (const [key, value] of this.androidPrepareRequests) if (value.expiresAt < now) this.androidPrepareRequests.delete(key);
    for (const [key, value] of this.androidConfirmRequests) if (value.expiresAt < now) this.androidConfirmRequests.delete(key);
  }

  private expireConfirmationIfNeeded(): void {
    if (this.confirmation && this.now() >= this.confirmation.expiresAt) this.cancelConfirmation('CONFIRMATION_EXPIRED');
  }

  private retainAndroidError<T>(
    map: Map<string, RequestRetention<T | ErrorResponse>>,
    requestId: string,
    bodyHash: string,
    error: unknown,
  ): void {
    if (error instanceof ObsControlHttpError) {
      map.set(requestId, {
        bodyHash,
        response: new ErrorResponse(error.status, error.code),
        expiresAt: this.now() + OPERATION_TIMEOUT_MS,
      });
    }
  }
}

export class ObsControlHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

class ErrorResponse extends ObsControlHttpError {
  constructor(status: number, code: string) { super(status, code); }
}

function validatePrepareRequest(request: AndroidPrepareRequest): void {
  if (!request || typeof request !== 'object' || Object.keys(request as object).sort().join(',') !== 'action,epoch,expectedRevision,requestId,version' || request.version !== 1 || typeof request.requestId !== 'string' || !isRequestId(request.requestId) ||
    (request.action !== 'start' && request.action !== 'stop') || typeof request.epoch !== 'string' ||
    !isRequestId(request.epoch) || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new ObsControlHttpError(400, 'INVALID_REQUEST');
  }
}

function validateConfirmRequest(request: AndroidConfirmRequest): void {
  if (!request || typeof request !== 'object' || Object.keys(request as object).sort().join(',') !== 'confirmationId,requestId,version' || request.version !== 1 || typeof request.requestId !== 'string' || !isRequestId(request.requestId) ||
    typeof request.confirmationId !== 'string' || !isRequestId(request.confirmationId)) {
    throw new ObsControlHttpError(400, 'INVALID_REQUEST');
  }
}

function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function actionAllowed(state: ObsStreamState, action: ObsAction): boolean {
  return action === 'start' ? ['stopped', 'streaming'].includes(state) : ['streaming', 'reconnecting', 'stopped'].includes(state);
}



function obsControlUserError(code: string): string {
  return {
    OBS_SECRET_UNAVAILABLE: 'OBS操作の保護設定を復元できません。資格情報を再設定してください。',
    OBS_AUTH_REQUIRED: 'OBS WebSocketの認証設定を確認してください。',
    OBS_AUTHENTICATION_FAILED: 'OBS WebSocketの認証に失敗しました。パスワードを確認して再試行してください。',
    OBS_VOICE_CAPTURE_UNAVAILABLE: 'OBS音声操作の取得期間を更新できませんでした。音声操作をOFFにしてからONにし直してください。',
    OBS_PROTOCOL_UNSUPPORTED: 'OBS WebSocketのバージョンに対応していません。OBSを更新してください。',
    OBS_WEBSOCKET_TIMEOUT: 'OBSへの接続がタイムアウトしました。OBSとポートを確認してください。',
    OBS_WEBSOCKET_DISCONNECTED: 'OBSとの接続が切断されました。再接続を待つか再試行してください。',
    OBS_WEBSOCKET_UNAVAILABLE: 'OBSへ接続できません。OBSとポートを確認してください。',
    OBS_REQUEST_REJECTED: 'OBSが操作を拒否しました。OBSの配信設定を確認してください。',
    OBS_OPERATION_UNKNOWN: 'OBS操作の結果を確認できません。再接続後に状態を確認してください。',
    OBS_OPERATION_TIMEOUT: 'OBSの状態確認がタイムアウトしました。状態を確認してから再試行してください。',
    OBS_UNAVAILABLE: 'OBSを利用できません。OBSとの接続を確認してください。',
    CONFIRMATION_EXPIRED: '確認の有効期限が切れました。',
    OBS_DISCONNECTED: 'OBSとの接続が切断されたため確認を取り消しました。',
    STREAM_STATE_CHANGED: 'OBSの配信状態が変化したため確認を取り消しました。',
    PUBLICATION_UNAVAILABLE: 'Android操作用の待受が利用できないため確認を取り消しました。',
    SETTINGS_CHANGED: '設定が変更されたため確認を取り消しました。',
    REGISTRATION_CHANGED: 'Android操作用登録が変更されたため確認を取り消しました。',
    REGISTRATION_REVOKED: 'Android操作用登録が失効したため確認を取り消しました。',
    SPEECH_RECOGNITION_CHANGED: '音声認識の状態が変化したため確認を取り消しました。',
    CANCELLED: '確認を取り消しました。',
  }[code] ?? 'OBS操作を完了できません。';
}
