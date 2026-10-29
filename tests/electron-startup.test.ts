import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings/schema';
import type { AppSettings } from '../src/shared/types';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const startup = vi.hoisted(() => ({
  settings: undefined as AppSettings | undefined,
  events: [] as string[],
  handlers: new Map<string, (event: { preventDefault(): void }) => void>(),
  navigatePort: undefined as ((event: { preventDefault(): void }, url: string) => void) | undefined,
  closePort: undefined as (() => void) | undefined,
  ready: undefined as ReturnType<typeof deferred> | undefined,
  settingsLoad: vi.fn<() => Promise<void>>(),
  initialSetupLoad: vi.fn<() => Promise<void>>(),
  updateNoticesLoad: vi.fn<() => Promise<void>>(),
  loadURL: vi.fn<(url: string) => Promise<void>>(),
  serverStart: vi.fn<() => Promise<void>>(),
  serverPorts: [] as number[],
  openDirectory: undefined as (() => Promise<void>) | undefined,
  mkdir: vi.fn(),
  openPath: vi.fn(),
  smartphoneStart: vi.fn<() => Promise<void>>(),
  smartphoneStop: vi.fn<() => Promise<void>>(),
  attachRecognitionInputs: vi.fn(),
  obsStart: vi.fn<() => Promise<void>>(),
  aiConnectionsInitialize: vi.fn<() => Promise<void>>(),
  aiControllerInitialize: vi.fn<() => Promise<void>>(),
  showErrorBox: vi.fn(),
  quit: vi.fn(),
  exit: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => 'test-user-data',
    setPath: vi.fn(),
    getAppPath: () => process.cwd(),
    requestSingleInstanceLock: () => true,
    whenReady: () => startup.ready!.promise,
    on: (event: string, handler: (event: { preventDefault(): void }) => void) => startup.handlers.set(event, handler),
    quit: startup.quit,
    exit: startup.exit,
  },
  BrowserWindow: class {
    private size: number[];
    private closed?: () => void;
    constructor(options: { width: number; height: number }) { this.size = [options.width, options.height]; }
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: (event: string, handler: (event: { preventDefault(): void }, url: string) => void) => {
        if (event === 'will-navigate') {
          startup.navigatePort = handler;
          startup.closePort = () => this.close();
        }
      },
    };
    setMenuBarVisibility() {}
    setSize(width: number, height: number) { this.size = [width, height]; }
    getSize() { return this.size; }
    loadURL = startup.loadURL;
    on(event: string, handler: () => void) { if (event === 'closed') this.closed = handler; }
    close() { this.closed?.(); }
    isDestroyed() { return false; }
    isMaximized() { return false; }
    getBounds() { return { x: 0, y: 0, width: this.size[0], height: this.size[1] }; }
  },
  dialog: { showErrorBox: startup.showErrorBox },
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  },
  shell: { openExternal: vi.fn(), openPath: startup.openPath },
  safeStorage: {},
  nativeImage: {},
  ipcMain: { on: vi.fn() },
}));
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), mkdir: startup.mkdir }));

vi.mock('../src/main/system-ca', () => ({ configureSystemCa: vi.fn() }));
vi.mock('../src/main/core/settings', () => ({
  SettingsStore: class {
    async load() { await startup.settingsLoad(); return { settings: startup.settings }; }
    async save() {}
  },
}));
vi.mock('../src/main/core/update-notice-store', () => ({
  UpdateNoticeStore: class { load = startup.updateNoticesLoad; },
}));
vi.mock('../src/main/core/initial-setup-store', () => ({
  InitialSetupStore: class { load = startup.initialSetupLoad; },
}));
vi.mock('../src/main/core/app-state', () => ({
  AppState: class {
    snapshot() { return { settings: startup.settings }; }
    attachAi() {}
    setObsControlState() {}
    setObsSourceRegistrationState() {}
    setObsSourceTestState() {}
    attachSmartphoneRecognitionInputs = startup.attachRecognitionInputs;
    subscribe() { return () => {}; }
    async updateSettings<K extends keyof AppSettings>(section: K, value: AppSettings[K]) {
      startup.settings = { ...startup.settings!, [section]: value };
    }
    async updateApplicationWindowState(value: Partial<AppSettings['application']>) {
      startup.settings = { ...startup.settings!, application: { ...startup.settings!.application, ...value } };
    }
    async shutdown() {}
  },
}));
vi.mock('../src/main/speech/electron-audio-player', () => ({ ElectronAudioPlayer: class {} }));
vi.mock('../src/main/obs/obs-control-controller', () => ({
  ObsControlController: class {
    start = startup.obsStart;
    view() { return {}; }
    async stop() {}
  },
}));
vi.mock('../src/main/obs/obs-source-registration-controller', () => ({
  ObsSourceRegistrationController: class {
    view() { return {}; }
    stop() {}
  },
}));
vi.mock('../src/main/obs/obs-source-test-controller', () => ({
  ObsSourceTestController: class {
    view() { return {}; }
    async shutdown() {}
  },
}));
vi.mock('../src/main/ai/ai-store', () => ({ AiStore: class {} }));
vi.mock('../src/main/ai/ai-connections', () => ({
  AiConnections: class {
    initialize = startup.aiConnectionsInitialize;
    async shutdown() {}
  },
}));
vi.mock('../src/main/ai/ai-controller', () => ({
  AiController: class {
    initialize = startup.aiControllerInitialize;
    authorizationChanged() {}
  },
}));
vi.mock('../src/main/server/local-server', () => ({
  LocalServer: class {
    constructor(options: { port: number; openSettingsDirectory?(): Promise<void> }) { startup.serverPorts.push(options.port); startup.openDirectory = options.openSettingsDirectory; }
    start = startup.serverStart;
    async stop() {}
  },
}));
vi.mock('../src/main/server/mobile-lan-server', () => ({ MobilePublicationServerManager: class {} }));
vi.mock('../src/main/smartphone/smartphone-controller', () => ({
  SmartphoneController: class {
    start = startup.smartphoneStart;
    stop = startup.smartphoneStop;
  },
}));

// All startup I/O is replaced above; draining promises reaches either a gate or
// the real orchestration's window call without timing guesses or open handles.
async function drainStartup() {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
}

let pending: ReturnType<typeof deferred>[];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  startup.settings = createDefaultSettings();
  startup.events = [];
  startup.handlers.clear();
  startup.navigatePort = undefined;
  startup.closePort = undefined;
  startup.serverPorts = [];
  startup.openDirectory = undefined;
  startup.mkdir.mockResolvedValue(undefined);
  startup.openPath.mockResolvedValue('');
  startup.ready = deferred();
  pending = [];
  startup.loadURL.mockImplementation(async url => { startup.events.push(`window:${url}`); });
  startup.serverStart.mockImplementation(async () => { startup.events.push('loopback.ready'); });
  for (const operation of [startup.settingsLoad, startup.initialSetupLoad, startup.updateNoticesLoad, startup.smartphoneStart, startup.smartphoneStop,
    startup.obsStart, startup.aiConnectionsInitialize, startup.aiControllerInitialize]) {
    operation.mockResolvedValue(undefined);
  }
});

afterEach(async () => {
  for (const gate of pending) gate.resolve();
  startup.closePort?.();
  await drainStartup();
  startup.handlers.get('before-quit')?.({ preventDefault() {} });
  await drainStartup();
});

async function launch() {
  await import('../src/main/electron');
  startup.ready!.resolve();
  await drainStartup();
}

describe('Electron startup readiness', () => {
  it('保存先リンクは実際のuserDataを開き、OS・フォルダー作成の失敗を通知できる', async () => {
    await launch();
    expect(startup.openPath).not.toHaveBeenCalled();
    await startup.openDirectory!();
    expect(startup.mkdir).toHaveBeenCalledWith('test-user-data', { recursive: true });
    expect(startup.openPath).toHaveBeenCalledWith('test-user-data');
    startup.openPath.mockResolvedValueOnce('OS error');
    await expect(startup.openDirectory!()).rejects.toThrow('設定の保存先を開けませんでした');
    startup.mkdir.mockRejectedValueOnce(new Error('private path'));
    await expect(startup.openDirectory!()).rejects.toThrow('設定の保存先を開けませんでした');
  });
  it('スマホ連携の準備が待機中でも、準備済みのローカル管理画面を開く', async () => {
    const gate = deferred();
    pending.push(gate);
    startup.smartphoneStart.mockReturnValue(gate.promise);

    await launch();

    expect(startup.smartphoneStart).toHaveBeenCalledOnce();
    expect(startup.attachRecognitionInputs).toHaveBeenCalledOnce();
    expect(startup.showErrorBox).not.toHaveBeenCalled();
    expect(startup.serverStart).toHaveBeenCalledOnce();
    expect(startup.loadURL).toHaveBeenCalledWith('http://127.0.0.1:3000');
    expect(startup.events).toEqual(['loopback.ready', 'window:http://127.0.0.1:3000']);
    expect(startup.quit).not.toHaveBeenCalled();
  });

  it.each([
    ['初回設定', startup.initialSetupLoad],
    ['OBS保護保存', startup.obsStart],
    ['AI資格情報', startup.aiConnectionsInitialize],
    ['AIリスナー保存', startup.aiControllerInitialize],
  ] as const)('%s の復元中は管理APIを公開しない', async (_store, operation) => {
    const gate = deferred();
    pending.push(gate);
    operation.mockReturnValue(gate.promise);

    await launch();

    expect(operation).toHaveBeenCalledOnce();
    expect(startup.serverStart).not.toHaveBeenCalled();
    expect(startup.loadURL).not.toHaveBeenCalled();
    expect(startup.showErrorBox).not.toHaveBeenCalled();
  });

  it.each([
    ['一般設定', startup.settingsLoad],
    ['更新案内', startup.updateNoticesLoad],
    ['初回設定', startup.initialSetupLoad],
    ['OBS保護保存', startup.obsStart],
    ['AI資格情報', startup.aiConnectionsInitialize],
    ['AIリスナー保存', startup.aiControllerInitialize],
  ] as const)('%s の復元中に終了した場合、復元完了後の起動処理を再開しない', async (_store, operation) => {
    const gate = deferred();
    pending.push(gate);
    operation.mockReturnValue(gate.promise);
    await launch();
    expect(operation).toHaveBeenCalledOnce();
    const laterOperations = [startup.obsStart, startup.aiConnectionsInitialize, startup.aiControllerInitialize,
      startup.serverStart, startup.smartphoneStart, startup.loadURL];
    const callsBeforeQuit = laterOperations.map(operation => operation.mock.calls.length);

    startup.handlers.get('before-quit')!({ preventDefault() {} });
    await drainStartup();
    expect(startup.exit).toHaveBeenCalledWith(0);

    gate.resolve();
    await drainStartup();
    expect(laterOperations.map(operation => operation.mock.calls.length)).toEqual(callsBeforeQuit);
    expect(startup.showErrorBox).not.toHaveBeenCalled();
  });

  it('スマホ連携の準備失敗がローカル管理画面とアプリを終了しない', async () => {
    startup.smartphoneStart.mockRejectedValueOnce(new Error('公開待受を準備できません。'));

    await launch();

    expect(startup.smartphoneStart).toHaveBeenCalledOnce();
    expect(startup.serverStart).toHaveBeenCalledOnce();
    expect(startup.loadURL).toHaveBeenCalledWith('http://127.0.0.1:3000');
    expect(startup.showErrorBox).not.toHaveBeenCalled();
    expect(startup.quit).not.toHaveBeenCalled();
    expect(startup.exit).not.toHaveBeenCalled();
  });

  it('スマホ連携の準備中に終了しても、準備完了後にウィンドウを追加しない', async () => {
    const gate = deferred();
    pending.push(gate);
    startup.smartphoneStart.mockReturnValue(gate.promise);
    await launch();
    expect(startup.smartphoneStart).toHaveBeenCalledOnce();
    const windowsBeforeQuit = startup.loadURL.mock.calls.length;

    startup.handlers.get('before-quit')!({ preventDefault() {} });
    await drainStartup();
    expect(startup.smartphoneStop).toHaveBeenCalledOnce();
    expect(startup.exit).toHaveBeenCalledWith(0);

    gate.resolve();
    await drainStartup();
    expect(startup.loadURL).toHaveBeenCalledTimes(windowsBeforeQuit);
    expect(startup.showErrorBox).not.toHaveBeenCalled();
  });

  it('ローカルバックエンドの準備完了前には管理画面を開かない', async () => {
    const gate = deferred();
    pending.push(gate);
    startup.serverStart.mockImplementation(async () => {
      await gate.promise;
      startup.events.push('loopback.ready');
    });

    await launch();

    expect(startup.serverStart).toHaveBeenCalledOnce();
    expect(startup.loadURL).not.toHaveBeenCalled();
    gate.resolve();
    await drainStartup();
    expect(startup.events).toEqual(['loopback.ready', 'window:http://127.0.0.1:3000']);
    expect(startup.showErrorBox).not.toHaveBeenCalled();
  });

  it('ローカルバックエンドの準備中に終了した場合、完了後に管理画面と公開準備を開始しない', async () => {
    const gate = deferred();
    pending.push(gate);
    startup.serverStart.mockReturnValue(gate.promise);
    await launch();
    expect(startup.serverStart).toHaveBeenCalledOnce();

    startup.handlers.get('before-quit')!({ preventDefault() {} });
    await drainStartup();
    expect(startup.exit).toHaveBeenCalledWith(0);

    gate.resolve();
    await drainStartup();
    expect(startup.serverStart).toHaveBeenCalledOnce();
    expect(startup.smartphoneStart).not.toHaveBeenCalled();
    expect(startup.loadURL).not.toHaveBeenCalled();
    expect(startup.showErrorBox).not.toHaveBeenCalled();
  });

  it('ポート競合は利用者の変更操作後に再試行し、変更後のURLを公開準備待ちなしで開く', async () => {
    const gate = deferred();
    pending.push(gate);
    startup.smartphoneStart.mockReturnValue(gate.promise);
    startup.serverStart.mockRejectedValueOnce(Object.assign(new Error('使用中です。'), { code: 'EADDRINUSE' }));
    await launch();

    expect(startup.serverPorts).toEqual([3000]);
    expect(startup.loadURL).not.toHaveBeenCalledWith('http://127.0.0.1:3000');
    expect(startup.navigatePort).toBeDefined();
    const preventDefault = vi.fn();
    startup.navigatePort!({ preventDefault }, 'casmate-port://3001');
    await drainStartup();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(startup.serverPorts).toEqual([3000, 3001]);
    expect(startup.settings!.application.port).toBe(3001);
    expect(startup.loadURL).toHaveBeenCalledWith('http://127.0.0.1:3001');
    expect(startup.smartphoneStart).toHaveBeenCalledOnce();
    expect(startup.showErrorBox).not.toHaveBeenCalled();
    expect(startup.quit).not.toHaveBeenCalled();
  });

  it('ポート変更待ちで終了した場合、遅れて変更されてもバックエンドを再起動しない', async () => {
    startup.serverStart.mockRejectedValueOnce(Object.assign(new Error('使用中です。'), { code: 'EADDRINUSE' }));
    await launch();
    expect(startup.navigatePort).toBeDefined();
    const windowsBeforeQuit = startup.loadURL.mock.calls.length;

    startup.handlers.get('before-quit')!({ preventDefault() {} });
    await drainStartup();
    expect(startup.exit).toHaveBeenCalledWith(0);
    startup.navigatePort!({ preventDefault() {} }, 'casmate-port://3001');
    await drainStartup();

    expect(startup.serverPorts).toEqual([3000]);
    expect(startup.smartphoneStart).not.toHaveBeenCalled();
    expect(startup.loadURL).toHaveBeenCalledTimes(windowsBeforeQuit);
    expect(startup.showErrorBox).not.toHaveBeenCalled();
  });
});
