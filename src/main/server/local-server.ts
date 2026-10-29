import { registerSmartphoneManagementRoutes, type SmartphoneManagementOptions } from './smartphone-management-routes';
import { asyncHandler, errorBody, HttpError, isPlainRecord } from './http-handlers';
import { LocalAccess } from './local-access';
import { readOnlySnapshot, readOnlyEvent, speechRecognitionOverlayBootstrap, speechRecognitionOverlayEvent } from './local-view-projections';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  CommentSource,
  ConnectionKey,
  SettingsSection,
  SpeechRecognitionOverlayRealtimeEvent,
} from '../../shared/types';
import { AppState, SpeechRecognitionConflict } from '../core/app-state';
import { InitialSetupError } from '../core/initial-setup-store';
import { ValidationError } from '../core/validation-error';
import type { CharacterAssetStore } from './character-asset-store';
import { emptyPcStatus, type PcStatusSnapshot } from '../../shared/pc-status';
import { WindowsFontCatalog } from '../core/windows-fonts';
import { registerAiVisual } from './ai-visual-server';
import { registerAiApiTest } from './ai-api-test-routes';
import { registerObsSourceRegistrationRoutes } from './obs-source-registration-routes';
import { registerObsSourceTestRoutes } from './obs-source-test-routes';
import { obsOverlayDefinitions } from '../../shared/obs-source-registration';

export interface WindowActions {
  showObsDesign?(target: 'comments' | 'speech'): Promise<void>;
  toggleCommentList(): Promise<void>;
  toggleCharacter(): Promise<void>;
  showCharacterSettings(): Promise<void>;
}

export interface SpeechActions {
  selectEngine(): Promise<boolean>;
  openRecognitionRecordings?(): Promise<void>;
  openThirdPartyNotices?(): Promise<void>;
}

export interface HttpApplicationOptions extends SmartphoneManagementOptions {
  readOnlyRevision?: () => number;
  obsSources?: import('../obs/obs-source-registration-controller').ObsSourceRegistrationController;
  obsTests?: import('../obs/obs-source-test-controller').ObsSourceTestController;
  aiVisual?: { visual: import('../obs/obs-visual').ObsVisual; debug?: import('../ai/visual-debug').VisualDebug };
  fonts?: { list(): Promise<string[]> };
  pcStatus?: { getStatus(): PcStatusSnapshot };
  ai?: { controller: import('../ai/ai-controller').AiController; connections: import('../ai/ai-connections').AiConnections; openLogs(): Promise<void> };
  state: AppState;
  port: number;
  operationToken: string;
  staticDirectory?: string;
  assetStore?: CharacterAssetStore;
  windowActions?: WindowActions;
  speechActions?: SpeechActions;
  openSettingsDirectory?(): Promise<void>;
  acceptingRequests?(): boolean;
}

export function createHttpApplication(options: HttpApplicationOptions): Express {
  const app = express();
  const fonts = options.fonts ?? new WindowsFontCatalog();
  const access = new LocalAccess(options.port, options.operationToken);

  app.disable('x-powered-by');
  app.use(access.requireHost);
  app.use(express.json({ limit: '1mb' }));
  app.use((_request, response, next) => {
    if (options.acceptingRequests?.() === false) {
      response.status(503).json(errorBody('APPLICATION_STOPPING', 'アプリを終了しています。'));
      return;
    }
    next();
  });
  registerObsSourceRegistrationRoutes(app, {
    controller: options.obsSources, state: options.state,
    managementRead: access.requireManagementRead, operation: access.requireOperation,
  });
  registerObsSourceTestRoutes(app, { controller: options.obsTests, state: options.state,
    managementRead: access.requireManagementRead, operation: access.requireOperation });
  app.get('/api/overlays/obs-test/bootstrap', (request, response) => {
    if (!access.validOrigin(request.headers.origin)) { response.status(403).json(errorBody('INVALID_ORIGIN', '要求元を確認できません。')); return; }
    const overlay = parseTestOverlay(request.query.overlay);
    if (!overlay || Object.keys(request.query).length !== 1) { response.status(400).json(errorBody('OBS_TEST_INVALID_REQUEST', '表示を選択してください。')); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.json(options.obsTests?.display(overlay) ?? { revision: 0, display: null });
  });

  app.get('/api/management/pc-status', access.requireManagementRead, (_request, response) => {
    response.json(options.pcStatus?.getStatus() ?? emptyPcStatus('unsupported'));
  });

  app.get('/api/management/fonts', access.requireManagementRead, asyncHandler(async (_request, response) => {
    try { response.json({ fonts: await fonts.list() }); }
    catch { throw new HttpError(503, 'FONTS_UNAVAILABLE', 'フォント一覧を取得できませんでした。Windowsで再取得してください。'); }
  }));

  app.get('/api/management/smartphone-lan-adapters', access.requireManagementRead, asyncHandler(async (_request, response) => {
    try {
      const smartphone = options.smartphone?.();
      if (!smartphone) throw new Error('Unavailable');
      response.json({ adapters: await smartphone.lanAdapters() });
    } catch { throw new HttpError(503, 'ADAPTERS_UNAVAILABLE', 'ネットワーク一覧を取得できません。一覧を更新してください。'); }
  }));

  app.get('/api/management/smartphone-adapters', access.requireManagementRead, asyncHandler(async (_request, response) => {
    try {
      const smartphone = options.smartphone?.();
      if (!smartphone) throw new Error('Unavailable');
      response.json({ adapters: await smartphone.directAdapters() });
    } catch { throw new HttpError(503, 'ADAPTERS_UNAVAILABLE', 'ネットワーク一覧を取得できません。一覧を更新してください。'); }
  }));

  app.get('/api/bootstrap', (request, response) => {
    const managementAuthorized =
      request.query.view === 'management' &&
      access.managementToken(request.header('X-CasMate-Management'));
    const snapshot = options.state.snapshotEvent();
    response.setHeader('Cache-Control', 'no-store');
    response.json({
      revision: managementAuthorized ? snapshot.revision : options.readOnlyRevision?.() ?? 0,
      snapshot: managementAuthorized
        ? snapshot.payload
        : readOnlySnapshot(snapshot.payload),
      ...(managementAuthorized
        ? { operationToken: options.operationToken }
        : {}),
    });
  });

  app.get('/api/overlays/speech-recognition/bootstrap', (request, response) => {
    const origin = request.headers.origin;
    if (!access.validOrigin(origin)) {
      response.status(403).json(errorBody('INVALID_ORIGIN', '要求元を確認できません。'));
      return;
    }
    response.json(speechRecognitionOverlayBootstrap(options.state.snapshot()));
  });

  app.use('/api', access.requireOperation);

  app.post('/api/management/initial-setup', asyncHandler(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try { await options.state.updateInitialSetup(request.body); }
    catch (error) {
      if (error instanceof InitialSetupError) {
        const event = options.state.snapshotEvent();
        response.status(error.conflict ? 409 : 400).json({ code: error.conflict ? 'INITIAL_SETUP_CONFLICT' : 'INITIAL_SETUP_FAILED', message: error.message,
          snapshot: event.payload, revision: event.revision });
        return;
      }
      throw new HttpError(503, 'INITIAL_SETUP_UNAVAILABLE', '初回設定を利用できません。管理画面を開き直してください。');
    }
    const event = options.state.snapshotEvent();
    response.json({ snapshot: event.payload, revision: event.revision });
  }));

  app.post('/api/management/update-notices/acknowledge', asyncHandler(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!isPlainRecord(request.body) || Object.keys(request.body).join(',') !== 'id' ||
      typeof request.body.id !== 'string' || !/^[a-f0-9]{64}$/.test(request.body.id)) {
      throw new HttpError(400, 'INVALID_UPDATE_NOTICE', '確認する更新案内を選択してください。');
    }
    try { await options.state.acknowledgeUpdateNotice(request.body.id); }
    catch (error) { throw new HttpError(400, 'UPDATE_NOTICE_ACKNOWLEDGEMENT_FAILED', error instanceof Error ? error.message : '更新案内を確認済みにできませんでした。'); }
    response.json({ snapshot: options.state.snapshot() });
  }));

  if (options.aiVisual && options.ai) registerAiVisual(app, { ...options.aiVisual, controller: options.ai.controller,
    connections: options.ai.connections, settings: () => options.state.snapshot().settings.aiListener });

  registerAiApiTest(app, options.ai);

  app.post('/api/ai-listener/:action', asyncHandler(async (request, response) => {
    const ai = options.ai;
    if (!ai) throw new HttpError(503, 'AI_UNAVAILABLE', 'AIリスナーを利用できません。');
    const action = singleParam(request.params.action);
    const body = request.body as { source?: string; confirmed?: boolean } | undefined;
    try {
      if (action === 'start') await ai.controller.start();
      else if (action === 'stop') { ai.connections.cancelAuthorization(); await ai.controller.stop(); }
      else if (action === 'resume') await ai.controller.resume(body?.source ? parseCommentSource(body.source) : undefined);
      else if (action === 'clear-memory') {
        if (body?.confirmed !== true) throw new Error('共有記憶の削除を確認してください。');
        await ai.controller.clearMemory();
      } else if (action === 'credentials') { ai.controller.invalidate(); await ai.connections.configure(request.body); }
      else if (action === 'link' || action === 'unlink') {
        if (body?.source !== 'youtube' && body?.source !== 'twitch') throw new Error('連携先を選択してください。');
        ai.controller.invalidate();
        if (action === 'link') ai.connections.begin(body.source); else await ai.connections.unlink(body.source);
      } else if (action === 'open-logs') await ai.openLogs();
      else throw new Error('AI操作が正しくありません。');
    } catch { throw new HttpError(400, 'AI_OPERATION_FAILED', 'AI操作を完了できません。設定・保存状態・認証を確認してください。'); }
    response.setHeader('Cache-Control', 'no-store'); response.json({ snapshot: options.state.snapshot() });
  }));

  app.put('/api/settings/:section', asyncHandler(async (request, response) => {
    const section = parseSection(request.params.section);
    const snapshot = await options.state.updateSettings(section, request.body);
    response.json({ snapshot });
  }));

  for (const optionsOnly of [false, true]) app.put(`/api/obs-design/:target${optionsOnly ? '/options' : ''}`, asyncHandler(async (request, response) => {
    const target = request.params.target;
    if (target !== 'comments' && target !== 'speech') throw new ValidationError('編集する表示を選択してください。');
    await options.state.updateObsDesign(target, request.body, optionsOnly);
    const event = options.state.snapshotEvent();
    response.json({ snapshot: event.payload, revision: event.revision });
  }));

  for (const operation of ['add', 'remove'] as const) app[operation === 'add' ? 'post' : 'delete'](`/api/obs-design/:target/saved${operation === 'remove' ? '/:id' : ''}`, asyncHandler(async (request, response) => {
    const target = request.params.target;
    if (target !== 'comments' && target !== 'speech') throw new ValidationError('編集する表示を選択してください。');
    await options.state.updateSavedObsDesign(target, operation, operation === 'add' ? request.body : request.params.id);
    const event = options.state.snapshotEvent();
    response.json({ snapshot: event.payload, revision: event.revision });
  }));

  app.post('/api/windows/obs-design/show', asyncHandler(async (request, response) => {
    if (!request.body || Object.keys(request.body).join(',') !== 'target' || !['comments', 'speech'].includes(request.body.target)) throw new ValidationError('編集する表示を選択してください。');
    if (!options.windowActions?.showObsDesign) throw new HttpError(503, 'WINDOW_UNAVAILABLE', '編集ウィンドウを開けません。');
    await options.windowActions.showObsDesign(request.body.target);
    response.json({});
  }));

  registerSmartphoneManagementRoutes(app, options);

  app.post('/api/sources/start-all', asyncHandler(async (_request, response) => {
    await options.state.startAllSources();
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/sources/stop-all', asyncHandler(async (_request, response) => {
    await options.state.stopAllSources();
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/sources/:source/start', asyncHandler(async (request, response) => {
    await options.state.startSource(parseConnectionKey(request.params.source));
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/sources/:source/stop', asyncHandler(async (request, response) => {
    await options.state.stopSource(parseConnectionKey(request.params.source));
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/sources/:source/reconnect', asyncHandler(async (request, response) => {
    await options.state.reconnectSource(parseConnectionKey(request.params.source));
    response.json({ snapshot: options.state.snapshot() });
  }));

  app.post('/api/text-effects/rules/:ruleId/test', asyncHandler(async (request, response) => {
    options.state.testTextEffectRule(singleParam(request.params.ruleId));
    response.json({ snapshot: options.state.snapshot() });
  }));

  app.post('/api/shitaraba/next-thread/create', asyncHandler(async (_request, response) => {
    await options.state.createShitarabaNextThread();
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/shitaraba/next-thread/resolve', asyncHandler(async (request, response) => {
    await options.state.resolveShitarabaNextThread(parseNextThreadResolution(request.body));
    response.json({ snapshot: options.state.snapshot() });
  }));

  app.post('/api/speech/voices', asyncHandler(async (_request, response) => {
    response.json({ voices: await options.state.listSpeechVoices() });
  }));
  app.post('/api/speech/preview', asyncHandler(async (_request, response) => {
    await options.state.previewSpeech();
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/speech/engine/select', asyncHandler(async (_request, response) => {
    let selected: boolean;
    try {
      selected = await options.speechActions?.selectEngine() ?? false;
    } catch {
      throw new HttpError(
        400,
        'SPEECH_ENGINE_SELECTION_FAILED',
        'VOICEVOXの vv-engine\\run.exe を選択してください。',
      );
    }
    response.json({ selected, snapshot: options.state.snapshot() });
  }));

  const recognitionSnapshot = () => {
    const event = options.state.snapshotEvent(); return { snapshot: event.payload, revision: event.revision };
  };
  app.post('/api/speech-recognition/preview/start', asyncHandler(async (_request, response) => {
    await options.state.startSpeechRecognitionPreview();
    response.json(recognitionSnapshot());
  }));

  app.put('/api/speech-recognition/enabled', asyncHandler(async (request, response) => {
    if (!isPlainRecord(request.body) || Object.keys(request.body).join(',') !== 'enabled') throw new ValidationError('音声認識のON/OFFが正しくありません。');
    await options.state.setSpeechRecognitionEnabled(request.body.enabled as boolean);
    response.json(recognitionSnapshot());
  }));
  app.put('/api/speech-recognition/input', asyncHandler(async (request, response) => {
    await options.state.selectSpeechRecognitionInput(request.body);
    response.json(recognitionSnapshot());
  }));
  app.put('/api/speech-recognition/settings', asyncHandler(async (request, response) => {
    await options.state.applySpeechRecognitionSettings(request.body);
    response.json(recognitionSnapshot());
  }));
  app.post('/api/speech-recognition/preview/stop', asyncHandler(async (_request, response) => {
    await options.state.stopSpeechRecognitionPreview();
    response.json(recognitionSnapshot());
  }));
  app.put('/api/speech-recognition/preview/wav-saving', asyncHandler(async (request, response) => {
    if (!isPlainRecord(request.body) || Object.keys(request.body).length !== 1 ||
      typeof request.body.enabled !== 'boolean') {
      throw new ValidationError('WAV保存設定が正しくありません。');
    }
    await options.state.setSpeechRecognitionWavSaving(request.body.enabled);
    response.json(recognitionSnapshot());
  }));
  app.post('/api/speech-recognition/microphones/refresh', asyncHandler(async (_request, response) => {
    await options.state.refreshSpeechRecognitionMicrophones();
    response.json(recognitionSnapshot());
  }));
  app.post('/api/speech-recognition/retry', asyncHandler(async (_request, response) => {
    await options.state.retrySpeechRecognition();
    response.json(recognitionSnapshot());
  }));
  app.post('/api/speech-recognition/model/prepare', asyncHandler(async (_request, response) => {
    await options.state.prepareSpeechRecognitionModel();
    response.json(recognitionSnapshot());
  }));
  app.post('/api/speech-recognition/recordings/open', asyncHandler(async (_request, response) => {
    await options.speechActions?.openRecognitionRecordings?.();
    response.json(recognitionSnapshot());
  }));
  app.post('/api/application/third-party-notices/open', asyncHandler(async (_request, response) => {
    await options.speechActions?.openThirdPartyNotices?.();
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/application/settings-directory/open', asyncHandler(async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!options.openSettingsDirectory) throw new HttpError(503, 'SETTINGS_DIRECTORY_UNAVAILABLE', '設定の保存先を開けません。PC版きゃすメイトからお試しください。');
    try { await options.openSettingsDirectory(); }
    catch { throw new HttpError(500, 'SETTINGS_DIRECTORY_OPEN_FAILED', '設定の保存先を開けませんでした。もう一度お試しください。'); }
    response.json({});
  }));

  app.put('/api/character/options', asyncHandler(async (request, response) => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).some(key => !['alwaysOnTop', 'clickThrough'].includes(key))) throw new ValidationError('キャラクター表示設定の項目が正しくありません。');
    response.json({ snapshot: await options.state.updateCharacterOptions(request.body) });
  }));

  app.post(
    '/api/character/simple/assets/:slot',
    express.raw({ type: ['image/png'], limit: '20mb' }),
    asyncHandler(async (request, response) => {
      if (!options.assetStore) throw new HttpError(503, 'ASSET_STORE_UNAVAILABLE', '素材を保存できません。');
      const slot = request.params.slot;
      if (slot !== 'closed' && slot !== 'open') {
        throw new ValidationError('素材種別が正しくありません。');
      }
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        throw new ValidationError('画像ファイルを選択してください。');
      }
      const current = options.state.snapshot().settings.character;
      const simple = current.simple;
      const isOpen = slot === 'open';
      const expected = isOpen && simple.closedAsset
        ? await options.assetStore.dimensions(simple.closedAsset)
        : undefined;
      if (isOpen && !expected) {
        throw new ValidationError('先に対応する閉口素材を登録してください。');
      }
      const assetUrl = await options.assetStore.save(
        slot,
        request.body,
        request.header('content-type') ?? '',
        expected ?? undefined,
      );
      await options.state.updateCharacterAsset(slot, assetUrl, asset => options.assetStore!.dimensions(asset));
      response.json({ assetUrl, snapshot: options.state.snapshot() });
    }),
  );

  app.delete('/api/character/simple/assets/:slot', asyncHandler(async (request, response) => {
    const slot = request.params.slot;
    if (slot !== 'closed' && slot !== 'open') {
      throw new ValidationError('素材種別が正しくありません。');
    }
    await options.state.updateCharacterAsset(slot, null, async () => null);
    response.json({ snapshot: options.state.snapshot() });
  }));

  app.put('/api/character/simple/motion-preview', (request, response) => {
    options.state.previewCharacterMotion(request.body);
    response.json({ snapshot: options.state.snapshot() });
  });
  app.put('/api/character/simple/motion', asyncHandler(async (request, response) => {
    response.json({ snapshot: await options.state.updateCharacterMotion(request.body) });
  }));

  app.post('/api/windows/comment-list/toggle', asyncHandler(async (_request, response) => {
    await options.windowActions?.toggleCommentList();
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/windows/character/toggle', asyncHandler(async (_request, response) => {
    await options.windowActions?.toggleCharacter();
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/windows/character-settings/show', asyncHandler(async (_request, response) => {
    await options.windowActions?.showCharacterSettings();
    response.json({ snapshot: options.state.snapshot() });
  }));

  if (options.assetStore) app.use('/assets', express.static(options.assetStore.directory));
  if (options.staticDirectory) {
    const sendManagementPage = async (_request: Request, response: Response) => {
      const index = await readFile(join(options.staticDirectory!, 'index.html'), 'utf8');
      response
        .type('html')
        .send(index.replace('</head>', `<meta name="casmate-management" content="${options.operationToken}"></head>`));
    };
    app.get('/', asyncHandler(sendManagementPage));
    app.get('/character/simple/settings', asyncHandler(sendManagementPage));
    app.get('/obs/design', asyncHandler(sendManagementPage));
    app.use(express.static(options.staticDirectory));
    for (const path of [
      '/comments',
      '/overlay/comments',
      '/overlay/character',
      '/overlay/speech-recognition',
      '/overlay/text-effects',
    ]) {
      app.get(path, (_request, response) => response.sendFile(join(options.staticDirectory!, 'index.html')));
    }
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof SpeechRecognitionConflict) { response.status(error.status).json(errorBody(error.code, error.message)); return; }
    if (error instanceof ValidationError) {
      response.status(400).json(errorBody('VALIDATION_ERROR', error.message));
      return;
    }
    if (error instanceof HttpError) {
      response.status(error.status).json(errorBody(error.code, error.message));
      return;
    }
    if (
      error instanceof Error &&
      'type' in error &&
      (error as { type?: unknown }).type === 'entity.too.large'
    ) {
      response.status(413).json(errorBody('ASSET_TOO_LARGE', '画像ファイルは20 MiB以下にしてください。'));
      return;
    }
    response.status(500).json(errorBody('INTERNAL_ERROR', '処理中にエラーが発生しました。'));
  });

  return app;
}

export interface LocalServerOptions extends Omit<HttpApplicationOptions, 'operationToken'> {
  operationToken?: string;
}

export class LocalServer {
  readonly operationToken: string;
  private server: Server | null = null;
  private sockets: WebSocketServer | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly connections = new WeakMap<Server, {
    sockets: Set<Socket>; requests: Map<Socket, Set<IncomingMessage>>; stopping: boolean; deadlineReached: boolean;
  }>();

  constructor(private readonly options: LocalServerOptions) {
    this.operationToken = options.operationToken ?? randomBytes(32).toString('base64url');
  }

  async start(): Promise<void> {
    if (this.server) return;
    let readOnlyRevision = 0;
    const connections = { sockets: new Set<Socket>(), requests: new Map<Socket, Set<IncomingMessage>>(), stopping: false, deadlineReached: false };
    const app = createHttpApplication({ ...this.options, operationToken: this.operationToken, readOnlyRevision: () => readOnlyRevision,
      acceptingRequests: () => !connections.stopping });
    const server = createServer(app);
    this.connections.set(server, connections);
    server.on('connection', socket => {
      connections.sockets.add(socket);
      socket.once('close', () => { connections.sockets.delete(socket); connections.requests.delete(socket); });
    });
    server.on('request', (request, response) => {
      const socket = request.socket;
      let requests = connections.requests.get(socket);
      if (!requests) { requests = new Set(); connections.requests.set(socket, requests); }
      requests.add(request);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        requests.delete(request);
        if (requests.size === 0) connections.requests.delete(socket);
        this.closeIncompleteConnection(server, socket);
      };
      response.once('finish', finish); response.once('close', finish);
    });
    const sockets = new WebSocketServer({ noServer: true });
    const managementClients = new WeakSet<WebSocket>();
    const speechRecognitionOverlayClients = new WeakSet<WebSocket>();
    const testClients = new WeakMap<WebSocket, keyof typeof obsOverlayDefinitions>();
    const access = new LocalAccess(this.options.port, this.operationToken);
    let speechRecognitionOverlayRevision = 0;
    server.on('upgrade', (request, socket, head) => {
      const origin = request.headers.origin;
      const requestUrl = new URL(request.url ?? '', `http://127.0.0.1:${this.options.port}`);
      const requestedManagement = requestUrl.searchParams.get('management');
      if (
        (requestUrl.pathname !== '/ws' &&
          requestUrl.pathname !== '/ws/overlay/speech-recognition' && requestUrl.pathname !== '/ws/overlay/obs-test') ||
        (requestUrl.pathname === '/ws/overlay/obs-test' && (!parseTestOverlay(requestUrl.searchParams.get('overlay')) || [...requestUrl.searchParams.keys()].some(key => key !== 'overlay'))) ||
        !access.validHost(request.headers.host) ||
        (requestedManagement !== null && !access.managementToken(requestedManagement)) ||
        !access.validOrigin(origin)
      ) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (webSocket) => {
        sockets.emit('connection', webSocket, request);
      });
    });
    sockets.on('connection', (socket, request) => {
      const requestUrl = new URL(request.url ?? '', `http://127.0.0.1:${this.options.port}`);
      if (requestUrl.pathname === '/ws/overlay/obs-test') {
        const overlay = parseTestOverlay(requestUrl.searchParams.get('overlay'))!;
        testClients.set(socket, overlay);
        socket.send(JSON.stringify(this.options.obsTests?.display(overlay) ?? { revision: 0, display: null }));
        return;
      }
      const speechRecognitionOverlay =
        requestUrl.pathname === '/ws/overlay/speech-recognition';
      if (speechRecognitionOverlay) {
        speechRecognitionOverlayClients.add(socket);
        const event: SpeechRecognitionOverlayRealtimeEvent = {
          type: 'speechRecognitionOverlay.snapshot',
          revision: speechRecognitionOverlayRevision,
          payload: speechRecognitionOverlayBootstrap(this.options.state.snapshot()),
        };
        socket.send(JSON.stringify(event));
        return;
      }
      const management = access.managementToken(requestUrl.searchParams.get('management'));
      if (management) managementClients.add(socket);
      const snapshotEvent = this.options.state.snapshotEvent();
      socket.send(JSON.stringify(management
        ? snapshotEvent
        : {
            ...snapshotEvent,
            revision: readOnlyRevision,
            payload: readOnlySnapshot(snapshotEvent.payload),
          }));
      socket.on('message', (data) => {
        const raw = String(data);
        if (raw.length > 2_000) return;
        try {
          const message = JSON.parse(raw) as { type?: string };
          if (message.type === 'character.assetError') {
            this.options.state.setCharacterAssetWarning('口開き素材を読み込めない表示面があります。素材を確認してください。');
          } else if (message.type === 'textEffects.renderError') {
            this.options.state.reportTextEffectError();
          }
        } catch {
          // Read-only views may only report the fixed asset error signal.
        }
      });
    });
    this.unsubscribe = this.options.state.subscribe((event) => {
      const sanitized = readOnlyEvent(event);
      const nextReadOnlyRevision = sanitized ? readOnlyRevision + 1 : readOnlyRevision;
      const overlayEvent = speechRecognitionOverlayEvent(
        event,
        speechRecognitionOverlayRevision + 1,
      );
      if (overlayEvent) speechRecognitionOverlayRevision = overlayEvent.revision;
      for (const client of sockets.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;
        const testOverlay = testClients.get(client);
        if (testOverlay) {
          if (event.type === 'obsSourceTest.stateChanged' || event.type === 'application.stopping')
            client.send(JSON.stringify(this.options.obsTests?.display(testOverlay) ?? { revision: 0, display: null }));
          continue;
        }
        if (speechRecognitionOverlayClients.has(client)) {
          if (overlayEvent) client.send(JSON.stringify(overlayEvent));
          continue;
        }
        if (managementClients.has(client)) {
          client.send(JSON.stringify(event));
          continue;
        }
        if (sanitized) {
          client.send(JSON.stringify({ ...sanitized, revision: nextReadOnlyRevision }));
        }
      }
      readOnlyRevision = nextReadOnlyRevision;
    });

    this.server = server;
    this.sockets = sockets;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.options.port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      sockets.close();
      this.server = null;
      this.sockets = null;
      throw error;
    }
    void this.options.state.startSourcesOnLaunch().catch(() => {
      // Source/next-thread controllers expose their failures without blocking local readiness.
    });
    void this.options.state.startSpeechRecognitionOnLaunch().catch(() => {
      // The controller exposes the isolated failure through AppState.
    });
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const server = this.server;
    if (server) {
      const connections = this.connections.get(server);
      if (connections) connections.stopping = true;
    }
    for (const client of this.sockets?.clients ?? []) client.close(1001, 'アプリを終了します。');
    this.sockets?.close();
    this.sockets = null;
    this.server = null;
    if (server) await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => {
        // Do not let incomplete communication block quit, but retain accepted operations
        // until their HTTP response completes so their pending saves can settle.
        const connections = this.connections.get(server);
        if (connections) connections.deadlineReached = true;
        for (const socket of connections?.sockets ?? []) this.closeIncompleteConnection(server, socket);
      }, 1500);
      server.close(() => { clearTimeout(deadline); resolve(); });
    });
  }

  private closeIncompleteConnection(server: Server, socket: Socket): void {
    const connections = this.connections.get(server);
    if (!connections?.deadlineReached) return;
    const accepted = [...(connections.requests.get(socket) ?? [])].some(request => request.complete);
    if (!accepted) socket.destroy();
  }
}

function parseTestOverlay(value: unknown): keyof typeof obsOverlayDefinitions | null {
  return typeof value === 'string' && Object.hasOwn(obsOverlayDefinitions, value) ? value as keyof typeof obsOverlayDefinitions : null;
}

function parseSection(value: string | string[] | undefined): SettingsSection {
  if (
    value === 'application' ||
    value === 'sources' ||
    value === 'commentOverlay' ||
    value === 'speechRecognitionOverlay' ||
    value === 'commentList' ||
    value === 'commentFilter' ||
    value === 'character'
    || value === 'commentSpeech'
    || value === 'mobileSpeech'
    || value === 'speechRecognition'
    || value === 'textEffects'
    || value === 'aiListener'
  ) return value;
  throw new ValidationError('設定セクションが正しくありません。');
}

function singleParam(value: string | string[] | undefined): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new ValidationError('文字演出ルールIDが正しくありません。');
}

function parseConnectionKey(value: string | string[] | undefined): ConnectionKey {
  if (value === 'youtube' || value === 'twitch' || value === 'shitaraba') return value;
  throw new ValidationError('コメントソースが正しくありません。');
}

function parseNextThreadResolution(value: unknown) {
  if (!isPlainRecord(value)) throw new ValidationError('結果不明の解決内容が正しくありません。');
  const keys = Object.keys(value).sort();
  if (value.outcome === 'notCreated' && keys.length === 1) {
    return { outcome: 'notCreated' as const };
  }
  if (
    value.outcome === 'created' &&
    keys.length === 2 &&
    keys[0] === 'outcome' && keys[1] === 'threadUrl' &&
    typeof value.threadUrl === 'string'
  ) {
    return { outcome: 'created' as const, threadUrl: value.threadUrl };
  }
  throw new ValidationError('結果不明の解決内容が正しくありません。');
}

function parseCommentSource(value: string | string[] | undefined): CommentSource {
  if (value === 'jpnkn') return value;
  return parseConnectionKey(value);
}
