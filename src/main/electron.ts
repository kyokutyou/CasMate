import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { app, BrowserWindow, dialog, screen, shell, safeStorage, nativeImage, ipcMain } from 'electron';
import { ObsVisual } from './obs/obs-visual';
import { VisualDebug } from './ai/visual-debug';
import { SmartphoneController } from './smartphone/smartphone-controller';
import { OutdoorReceivers, ReceiverOwnership, nativeReceiverFactory } from './outdoor/outdoor-receivers';
import { SmartphoneStore } from './smartphone/smartphone-store';
import { listenDirect } from './smartphone/direct-server';
import { DirectCommentAssets } from './smartphone/direct-assets';
import { WindowsDirectNetwork } from './smartphone/direct-windows';
import { handleCommentListWindowOpen } from '../shared/comment-list-window-actions';
import type { WindowBounds } from '../shared/types';
import { AppState } from './core/app-state';
import { UpdateNoticeStore } from './core/update-notice-store';
import { InitialSetupStore } from './core/initial-setup-store';
import { SettingsStore } from './core/settings';
import {
  IndependentWindowController,
  restoreIndependentWindows,
  saveWindowStatesSequentially,
} from './independent-window-controller';
import { requestQuitFromManagementWindow } from './management-window-close';
import { createManagementWindowOpenHandler } from './management-window-open';
import { installManagementHistory } from './management-history';
import { SettingsWindowController } from './settings-window-controller';
import { CharacterAssetStore } from './server/character-asset-store';
import { LocalServer } from './server/local-server';
import { MobilePublicationServerManager } from './server/mobile-lan-server';
import { ObsControlController } from './obs/obs-control-controller';
import { ObsControlStore } from './obs/obs-control-store';
import { ObsSourceRegistrationController } from './obs/obs-source-registration-controller';
import { ObsSourceTestController } from './obs/obs-source-test-controller';
import { ElectronAudioPlayer } from './speech/electron-audio-player';
import { FfmpegTranscoder } from './speech/ffmpeg-transcoder';
import { VoicevoxAdapter } from './speech/voicevox-adapter';
import { JsonLinesSpeechRecognitionWorker } from './speech-recognition/json-lines-speech-recognition-worker';
import { ReceiverRecognitionInputs } from './speech-recognition/smartphone-recognition-input';
import { configureSystemCa } from './system-ca';
import { AiStore } from './ai/ai-store';
import { AiConnections } from './ai/ai-connections';
import { AiController } from './ai/ai-controller';
import { legacyUserDataDirectory, withAppWindowTitle } from './window-branding';
import { JsonLinesPcSampler, PcStatusController } from './pc-status/pc-status-controller';
import { managementWindowBounds, restoreManagementSize } from './management-window-bounds';
import { ownedProcessIdentities } from './pc-status/owned-processes';
import { pcStatusWorkerExecutablePath } from './pc-status/worker-path';
import { WindowsFontCatalog } from './core/windows-fonts';
import { ObsDesignWindowController } from './obs-design-window-controller';
import { createNativeObsDesignWindow } from './obs-design-window';

configureSystemCa();

app.setPath('userData', legacyUserDataDirectory(app.getPath('appData')));

let managementWindow: BrowserWindow | null = null;
let characterWindow: BrowserWindow | null = null;
let commentListWindowController: IndependentWindowController | null = null;
let characterWindowController: IndependentWindowController | null = null;
let characterSettingsWindowController: SettingsWindowController | null = null;
let obsDesignWindowController: ObsDesignWindowController | null = null;
let obsDesignWindow: ReturnType<typeof createNativeObsDesignWindow> | null = null;
let state: AppState | null = null;
let server: LocalServer | null = null;
let smartphone: SmartphoneController | null = null;
let mobileServer: MobilePublicationServerManager | null = null;
let obsControl: ObsControlController | null = null;
let obsSources: ObsSourceRegistrationController | null = null;
let obsTests: ObsSourceTestController | null = null;

let baseUrl = '';
let quitting = false;
let shutdownStarted = false;
let pcStatus: PcStatusController | null = null;
let fonts: WindowsFontCatalog | null = null;

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (managementWindow) {
      if (managementWindow.isMinimized()) managementWindow.restore();
      managementWindow.show();
      managementWindow.focus();
    }
  });
  void app.whenReady().then(startApplication).catch((error: unknown) => {
    if (quitting) return;
    dialog.showErrorBox(
      'きゃすメイトを起動できません',
      `起動処理を完了できませんでした。きゃすメイトを起動し直してください。繰り返す場合は、下の技術詳細を添えて報告してください。\n\n技術詳細：\n${error instanceof Error ? error.message : '原因を取得できませんでした。'}`,
    );
    app.quit();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !managementWindow) app.quit();
});

app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  quitting = true;
  fonts?.stop();
  pcStatus?.stop();
  void (async () => {
    // Begin network closure before OBS checks or window-state persistence can delay quit.
    const smartphoneStopping = Promise.allSettled([smartphone?.stop()]);
    await obsTests?.shutdown();
    obsSources?.stop();
    await saveWindowStatesSequentially([
      () => managementWindow && state ? saveManagementBounds(managementWindow) : Promise.resolve(),
      () => commentListWindowController?.prepareForShutdown(),
      () => characterWindowController?.prepareForShutdown(),
      () => characterSettingsWindowController?.prepareForShutdown(),
      () => obsDesignWindowController?.prepareForShutdown(),
    ]);
    await Promise.allSettled([state?.shutdown(), server?.stop(), smartphoneStopping, obsControl?.stop()]);
    app.exit(0);
  })();
});

async function startApplication() {
  pcStatus = new PcStatusController(() => {
    const executable = pcStatusWorkerExecutablePath(app.isPackaged, app.getAppPath(), process.resourcesPath);
    return new JsonLinesPcSampler(executable, () => [
      ...app.getAppMetrics().map(metric => ({ pid: metric.pid, earliest: Math.floor(metric.creationTime), latest: Math.ceil(metric.creationTime), descendants: false })),
      ...ownedProcessIdentities(),
    ]);
  });
  const characterAssetDirectory = join(app.getPath('userData'), 'character-assets');
  const settingsStore = new SettingsStore(
    join(app.getPath('userData'), 'settings.json'),
  );
  const loaded = await settingsStore.load();
  let setupAiFingerprint = () => '';
  let setupVoicevoxPath = loaded.voicevoxExecutablePath ?? '';
  const initialSetup = new InitialSetupStore(join(app.getPath('userData'), 'initial-setup.json'), loaded.firstRun === true, undefined,
    () => ({ obs: obsControl?.initialSetupFingerprint(), ai: setupAiFingerprint(), port: loaded.settings.application.port, voicevox: setupVoicevoxPath }));
  await initialSetup.load();
  if (quitting) return;
  const voicevox = new VoicevoxAdapter({
    executablePath: loaded.voicevoxExecutablePath,
    onExecutableDiscovered: async (path, previousPath) => {
      const saved = await settingsStore.saveDiscoveredVoicevoxExecutablePath(path, state?.snapshot().settings ?? loaded.settings, previousPath);
      if (saved) setupVoicevoxPath = path;
      return saved;
    },
  });
  const audioPlayer = new ElectronAudioPlayer();
  const previewAudioPlayer = new ElectronAudioPlayer();
  const transcoder = new FfmpegTranscoder(ffmpegExecutablePath());
  const speechRecognitionRoot = join(app.getPath('userData'), 'speech-recognition');
  const recordingsDirectory = join(speechRecognitionRoot, 'preview-recordings');
  const speechRecognitionWorker = new JsonLinesSpeechRecognitionWorker({
    executablePath: speechRecognitionWorkerExecutablePath(),
    modelDirectory: join(speechRecognitionRoot, 'models'),
    recordingsDirectory,
  });
  obsControl = new ObsControlController({
    store: new ObsControlStore(join(app.getPath('userData'), 'obs-control.protected'), safeStorage),
    onState: value => state?.setObsControlState(value),
    onSourceContextChanged: () => state?.invalidateObsSourceContext(),
  });
  const updateNotices = new UpdateNoticeStore(join(app.getPath('userData'), 'update-notices.json'), {
    settings: () => loaded.warning,
    obsControl: () => obsControl?.updateNotice,
    smartphone: () => smartphone?.updateNotice,
  });
  await updateNotices.load();
  if (quitting) return;
  state = new AppState(loaded.settings, {
    initialSetup,
    updateNotices,
    saveSettings: (settings) => settingsStore.save(settings),
    speechSynthesizer: voicevox,
    audioPlayer,
    previewAudioPlayer,
    audioTranscoder: transcoder,
    onMobileAudioReady: (clientId, audio) => { mobileServer?.sendAudioReady(clientId, audio); smartphone?.sendDirectAudioReady(clientId, audio); },
    onMobileAudioDiscard: (clientId, audioId) => { mobileServer?.discardAudio(clientId, audioId); smartphone?.discardDirectAudio(clientId, audioId); },
    speechRecognitionWorker,
    obsControl,
  });
  await obsControl.start();
  if (quitting) return;
  const aiStore = new AiStore(join(app.getPath('userData'), 'ai-listener'), safeStorage);
  const visual = new ObsVisual(() => obsControl!.visualReader(), bytes => {
    const image = nativeImage.createFromBuffer(bytes); if (image.isEmpty()) throw new Error('画像を読み込めません。'); return image.getSize();
  });
  const aiConnections = new AiConnections(aiStore, url => shell.openExternal(url), (authorization, message) => aiController?.authorizationChanged(authorization, message),
    fetch, undefined, (source, signal) => visual.capture(source, signal));
  setupAiFingerprint = () => aiConnections.initialSetupFingerprint();
  const aiController = new AiController(loaded.settings.aiListener, {
    store: aiStore, gateway: aiConnections, changed: view => state?.setAiView(view),
    acquire: () => state!.acquireAiDependencies(), release: () => state!.releaseAiDependencies(),
    ngWords: () => state!.snapshot().settings.commentFilter.ngWords,
    invalidated: () => aiConnections.invalidateVisual(),
    checkObs: () => obsControl!.readAiStreamState(),
  });
  // Temporary visual debugging: this is the single activation/removal point.
  const visualDebug = !app.isPackaged && process.env.CASMATE_AI_VISUAL_DEBUG === '1' ? new VisualDebug(aiController, aiConnections) : undefined;
  state.attachAi(aiController, () => { visualDebug?.close(); return aiConnections.shutdown(); });
  await aiConnections.initialize().catch(() => aiController.authorizationChanged(null, 'AI資格情報を復元できません。再設定してください。'));
  if (quitting) return;
  await aiController.initialize();
  if (quitting) return;
  state.setObsControlState(obsControl.view());
  createIndependentWindowControllers();
  const assetStore = new CharacterAssetStore(characterAssetDirectory);

  let port = loaded.settings.application.port;
  obsSources = new ObsSourceRegistrationController({
    obs: obsControl, baseUrl: () => 'http://127.0.0.1:' + port,
    smartphone: () => smartphone, onState: value => state?.setObsSourceRegistrationState(value),
  });
  state.setObsSourceRegistrationState(obsSources.view());
  obsTests = new ObsSourceTestController({ sources: obsSources, obs: obsControl,
    settings: () => state!.snapshot().settings,
    assetReadable: async asset => Boolean(await assetStore.dimensions(asset)),
    onState: value => state?.setObsSourceTestState(value) });
  state.setObsSourceTestState(obsTests.view());
  fonts = new WindowsFontCatalog(undefined, pcStatusWorkerExecutablePath(app.isPackaged, app.getAppPath(), process.resourcesPath));
  while (true) {
    server = new LocalServer({
      openSettingsDirectory: async () => {
        try {
          const directory = app.getPath('userData');
          await mkdir(directory, { recursive: true });
          if (await shell.openPath(directory)) throw new Error('OS could not open directory');
        } catch { throw new Error('設定の保存先を開けませんでした。もう一度お試しください。'); }
      },
      aiVisual: { visual, debug: visualDebug },
      pcStatus,
      fonts,
      ai: { controller: aiController, connections: aiConnections, openLogs: async () => {
        await mkdir(aiStore.logsDirectory, { recursive: true });
        if (await shell.openPath(aiStore.logsDirectory)) throw new Error('発言ログ保存先を開けませんでした。');
      } },
      smartphone: () => smartphone,
      obsControl,
      obsSources,
      obsTests,
      state,
      port,
      staticDirectory: rendererDirectory(),
      assetStore,
      windowActions: {
        showObsDesign: target => obsDesignWindowController?.show(target) ?? Promise.reject(new Error('編集画面を準備しています。')),
        toggleCommentList: () => commentListWindowController?.toggle() ?? Promise.resolve(),
        toggleCharacter: () => characterWindowController?.toggle() ?? Promise.resolve(),
        showCharacterSettings: () => characterSettingsWindowController?.show() ?? Promise.resolve(),
      },
      speechActions: {
        selectEngine: async () => {
          const dialogOptions: Electron.OpenDialogOptions = {
            title: 'VOICEVOXの起動ファイルを選択',
            properties: ['openFile'],
            filters: [{ name: 'VOICEVOX Engine', extensions: ['exe'] }],
          };
          const result = managementWindow
            ? await dialog.showOpenDialog(managementWindow, dialogOptions)
            : await dialog.showOpenDialog(dialogOptions);
          const selected = result.filePaths[0];
          if (result.canceled || !selected) return false;
          await voicevox.validateExecutable(selected);
          await settingsStore.saveVoicevoxExecutablePath(selected, state!.snapshot().settings);
          voicevox.setExecutablePath(selected);
          setupVoicevoxPath = selected;
          const speech = state!.snapshot().settings.commentSpeech;
          await state!.updateSettings('commentSpeech', speech);
          return true;
        },
        openRecognitionRecordings: async () => {
          await mkdir(recordingsDirectory, { recursive: true });
          const error = await shell.openPath(recordingsDirectory);
          if (error) throw new Error('WAV保存先を開けませんでした。');
        },
        openThirdPartyNotices: async () => {
          const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
          const error = await shell.openPath(join(root, 'THIRD_PARTY_NOTICES.md'));
          if (error) throw new Error('第三者ライセンスを開けませんでした。');
        },
      },
    });
    try {
      await server.start();
      if (quitting) return;
      break;
    } catch (error) {
      if (!isPortConflict(error)) throw error;
      const selected = await choosePortAfterConflict(port);
      if (quitting) return;
      if (selected === null) {
        app.quit();
        return;
      }
      port = selected;
      const application = state.snapshot().settings.application;
      await state.updateSettings('application', { ...application, port });
    }
  }

  baseUrl = `http://127.0.0.1:${port}`;
  createCharacterSettingsWindowController();
  obsDesignWindowController = new ObsDesignWindowController({ create: createObsDesignWindow,
    saveBounds: async bounds => { await state!.updateObsDesignWindowBounds(bounds); } });
  ipcMain.on('casmate:obs-design-close-ready', event => {
    if (obsDesignWindow && event.sender === obsDesignWindow.webContents && !quitting) void obsDesignWindowController?.closeReady().catch(() => undefined);
  });
  ipcMain.on('casmate:obs-design-ready', event => {
    if (obsDesignWindow && event.sender === obsDesignWindow.webContents && !quitting) obsDesignWindow.notifyTarget();
  });
  mobileServer = new MobilePublicationServerManager({
    state,
    port,
    staticDirectory: rendererDirectory(),
  });
  const directAssets = new DirectCommentAssets();
  const receiverOwnership = new ReceiverOwnership();
  const receiverFactory = nativeReceiverFactory(join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'outdoor-worker', 'casmate-outdoor-worker.exe'));
  const outdoorReceivers = new OutdoorReceivers(receiverFactory, Date.now, receiverOwnership);
  const directOutdoorReceivers = new OutdoorReceivers(receiverFactory, Date.now, receiverOwnership);
  smartphone = new SmartphoneController({
    receivers: outdoorReceivers,
    lanNetwork: new WindowsDirectNetwork(pcStatusWorkerExecutablePath(app.isPackaged, app.getAppPath(), process.resourcesPath), true),
    store: new SmartphoneStore(join(app.getPath('userData'), 'smartphone.protected'), safeStorage),
    state, mobile: mobileServer, obs: obsControl,
    managementPorts: () => [port, state!.snapshot().settings.application.port],
    direct: {
      receivers: directOutdoorReceivers,
      windows: new WindowsDirectNetwork(pcStatusWorkerExecutablePath(app.isPackaged, app.getAppPath(), process.resourcesPath)),
      program: process.execPath, workerProgram: join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'outdoor-worker', 'casmate-outdoor-worker.exe'),
      listen: (identity, address, directPort, hosts, failed) => listenDirect({ identity, address, port: directPort, hosts, failed,
        staticDirectory: rendererDirectory(), assets: directAssets, state: state!, obs: obsControl!, controller: smartphone!,
        read: token => smartphone!.authenticateRead(token), connected: (_id, _protocol, host) => smartphone!.directConnected(address, directPort, host) }),
    },
  });
  state.attachSmartphoneRecognitionInputs(new ReceiverRecognitionInputs(outdoorReceivers, directOutdoorReceivers,
    () => smartphone!.snapshot(), ffmpegExecutablePath(), listener => state!.subscribe(event => { if (event.type === 'smartphone.stateChanged') listener(); })));
  if (quitting) return;
  createManagementWindow();
  // Publication and receiver preparation must not hold back the local UI.
  // SmartphoneController cancels late startup work when shutdown begins.
  void smartphone.start().catch(() => {
    // Public preparation failures are isolated; the smartphone view reports availability.
  });
  state.subscribe((event) => {
    if (event.type !== 'settings.changed' || !characterWindow) return;
    const settings = state?.snapshot().settings.character;
    if (settings) applyCharacterWindowSettings(characterWindow, settings.alwaysOnTop, settings.clickThrough);
  });
  await restoreIndependentWindows([
    commentListWindowController,
    characterWindowController,
  ]);
}

function createCharacterSettingsWindowController() {
  characterSettingsWindowController = new SettingsWindowController({
    create: createCharacterSettingsWindow,
    saveBounds: async (bounds) => {
      await state!.updateCharacterOptions({ settingsWindowBounds: bounds });
    },
  });
}

function createIndependentWindowControllers() {
  commentListWindowController = new IndependentWindowController({
    read: () => {
      const application = state!.snapshot().settings.application;
      return {
        visible: application.commentListWindowVisible,
        bounds: application.commentListWindow,
      };
    },
    save: async ({ visible, bounds }) => {
      await state!.updateApplicationWindowState({
        commentListWindow: bounds,
        commentListWindowVisible: visible,
      });
    },
    create: createCommentListWindow,
  });
  characterWindowController = new IndependentWindowController({
    read: () => {
      const character = state!.snapshot().settings.character;
      return { visible: character.windowVisible, bounds: character.windowBounds };
    },
    save: async ({ visible, bounds }) => {
      await state!.updateCharacterOptions({
        windowBounds: bounds,
        windowVisible: visible,
      });
    },
    create: createCharacterWindow,
  });
}

function createManagementWindow() {
  if (!state) return;
  const bounds = visibleBounds(managementWindowBounds(state.snapshot().settings.application.managementWindow));
  const window = new BrowserWindow(withAppWindowTitle({
    ...bounds,
    minWidth: 320,
    minHeight: 360,
    icon: appIconPath(),
    backgroundColor: '#0f1020',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(__dirname, 'management-preload.js') },
  }));
  managementWindow = window;
  installManagementHistory(window);
  window.setMenuBarVisibility(false);
  // Windows can enlarge the initial frame while the default menu is present.
  // Restore the saved outer size after hiding that menu, respecting native minima.
  restoreManagementSize(window, bounds);
  window.webContents.setWindowOpenHandler(createManagementWindowOpenHandler(url => { void shell.openExternal(url); }));
  void window.loadURL(baseUrl);
  window.on('close', (event) => {
    requestQuitFromManagementWindow(quitting, event, () => {
      quitting = true;
      app.quit();
    });
  });
  window.on('closed', () => { managementWindow = null; });
}

function createCommentListWindow() {
  const saved = state?.snapshot().settings.application.commentListWindow ?? { width: 520, height: 760 };
  const window = new BrowserWindow(withAppWindowTitle({
    ...visibleBounds(saved),
    minWidth: 320,
    minHeight: 300,
    icon: appIconPath(),
    backgroundColor: '#10111c',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  }));
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    handleCommentListWindowOpen(
      url,
      (enabled) => window.setAlwaysOnTop(enabled),
      (externalUrl) => { void shell.openExternal(externalUrl); },
    );
    return { action: 'deny' };
  });
  void window.loadURL(`${baseUrl}/comments?window=independent`);
  return window;
}

function createCharacterWindow() {
  const settings = state?.snapshot().settings.character;
  const window = new BrowserWindow(withAppWindowTitle({
    ...visibleBounds(settings?.windowBounds ?? { width: 420, height: 520 }),
    minWidth: 200,
    minHeight: 200,
    icon: appIconPath(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    hasShadow: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  }));
  characterWindow = window;
  if (settings) applyCharacterWindowSettings(window, settings.alwaysOnTop, settings.clickThrough);
  void window.loadURL(`${baseUrl}/overlay/character?presentation=standalone`);
  if (settings?.windowBounds.maximized) window.maximize();
  window.on('closed', () => { characterWindow = null; });
  return window;
}

function createCharacterSettingsWindow() {
  const saved = state?.snapshot().settings.character.settingsWindowBounds ?? { width: 760, height: 760 };
  const window = new BrowserWindow(withAppWindowTitle({
    ...visibleBounds(saved),
    minWidth: 560,
    minHeight: 600,
    icon: appIconPath(),
    backgroundColor: '#0f1020',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  }));
  window.setMenuBarVisibility(false);
  allowExternalWindows(window);
  void window.loadURL(`${baseUrl}/character/simple/settings?window=electron`);
  if (saved.maximized) window.maximize();
  return window;
}

function createObsDesignWindow(target: 'comments' | 'speech') {
  const saved = state?.snapshot().settings.application.obsDesignWindow ?? { width: 1200, height: 820 };
  const window = createNativeObsDesignWindow({ baseUrl, bounds: { ...visibleBounds(saved), maximized: saved.maximized },
    icon: appIconPath(), preload: join(__dirname, 'obs-design-preload.js') }, target);
  obsDesignWindow = window;
  window.on('closed', () => { if (obsDesignWindow === window) obsDesignWindow = null; });
  return window;
}

async function saveManagementBounds(window: BrowserWindow) {
  if (!state || window.isDestroyed()) return;
  await state.updateApplicationWindowState({
    managementWindow: boundsOf(window),
  });
}

function boundsOf(window: BrowserWindow): WindowBounds {
  const bounds = window.getBounds();
  return { ...bounds, maximized: window.isMaximized() };
}

function visibleBounds(saved: WindowBounds) {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(saved.width, area.width);
  const height = Math.min(saved.height, area.height);
  const proposed = {
    x: saved.x ?? area.x + Math.round((area.width - width) / 2),
    y: saved.y ?? area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
  const visible = screen.getAllDisplays().some((display) => intersects(proposed, display.workArea));
  return visible ? proposed : { x: area.x, y: area.y, width, height };
}

function appIconPath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png');
}

function intersects(a: Electron.Rectangle, b: Electron.Rectangle) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function applyCharacterWindowSettings(window: BrowserWindow, alwaysOnTop: boolean, clickThrough: boolean) {
  window.setAlwaysOnTop(alwaysOnTop);
  window.setIgnoreMouseEvents(clickThrough, { forward: true });
}

function allowExternalWindows(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith(baseUrl) ||
      url.startsWith('https://voicevox.hiroshiba.jp/') ||
      isVerifiedShitarabaUrl(url)
    ) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

function isVerifiedShitarabaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'jbbs.shitaraba.net';
  } catch {
    return false;
  }
}

function rendererDirectory() {
  return app.isPackaged ? join(app.getAppPath(), 'dist') : join(__dirname, '..', '..', 'dist');
}

function ffmpegExecutablePath() {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(root, 'resources', 'ffmpeg', 'ffmpeg.exe');
}

function speechRecognitionWorkerExecutablePath() {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(
    root,
    'resources',
    'speech-recognition-worker',
    'CasMate.SpeechRecognition.Worker.exe',
  );
}

function isPortConflict(error: unknown) {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
}

function choosePortAfterConflict(currentPort: number): Promise<number | null> {
  return new Promise((resolve) => {
    const window = new BrowserWindow(withAppWindowTitle({ width: 460, height: 300, resizable: false, icon: appIconPath(), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } }));
    window.setMenuBarVisibility(false);
    let resolved = false;
    const finish = (value: number | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
      if (!window.isDestroyed()) window.close();
    };
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('casmate-port://')) return;
      event.preventDefault();
      const selected = Number(url.replace('casmate-port://', '').replace('/', ''));
      if (Number.isInteger(selected) && selected >= 1024 && selected <= 65535) finish(selected);
    });
    window.on('closed', () => finish(null));
    const html = `<!doctype html><meta charset="utf-8"><style>body{font:15px sans-serif;background:#171827;color:#fff;padding:24px}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #555}input{width:180px}button{margin-left:8px;background:#8d68ef;color:white}small{display:block;color:#bbb;margin:12px 0}</style><h2>ポート${currentPort}は使用中です</h2><p>使用する別のポートを入力して再試行してください。</p><form onsubmit="location.href='casmate-port://'+port.value;return false"><input id="port" type="number" min="1024" max="65535" value="${Math.min(65535, currentPort + 1)}" required><button>変更して再試行</button></form><small>終了する場合はこの画面を閉じてください。</small>`;
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}
