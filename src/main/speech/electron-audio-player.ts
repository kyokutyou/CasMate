import { join } from 'node:path';
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import type { PcAudioPlayer } from './comment-speech-controller';
import { analyzeVoicevoxWav } from './lip-sync-analyzer';

const playChannel = 'casmate:speech-player:play';
const stopChannel = 'casmate:speech-player:stop';
const resultChannel = 'casmate:speech-player:result';
const initializationTimeoutMs = 10_000;
const playbackGraceMs = 5_000;
const unknownDurationTimeoutMs = 120_000;

interface PlayerWindow {
  window: BrowserWindow;
  ready: Promise<void>;
  initialized: boolean;
  finishReady(error?: Error): void;
}

interface Playback {
  id: number;
  resolve(): void;
  reject(error: Error): void;
  onMouthShape?: (shape: 'closed' | 'open') => void;
  timers: NodeJS.Timeout[];
}

export class ElectronAudioPlayer implements PcAudioPlayer {
  private session: PlayerWindow | null = null;
  private pending: Playback | null = null;
  private closed = false;
  private requestId = 0;

  constructor() {
    ipcMain.on(resultChannel, this.handleResult);
  }

  play(request: Parameters<PcAudioPlayer['play']>[0]): Promise<void> {
    if (this.closed) return Promise.reject(new Error('PC音声プレイヤーは終了しています。'));
    this.stop();
    return new Promise<void>((resolve, reject) => {
      const playback: Playback = {
        id: ++this.requestId, resolve, reject,
        onMouthShape: request.onMouthShape, timers: [],
      };
      this.pending = playback;
      void this.beginPlayback(request, playback);
    });
  }

  stop(): void {
    const session = this.session;
    const playback = this.pending;
    if (playback) this.finishPlayback(playback);
    if (!session) return;
    if (!session.initialized) {
      this.invalidateWindow(session, new Error('PC音声プレイヤーの準備を停止しました。'));
      return;
    }
    try {
      if (!session.window.isDestroyed()) session.window.webContents.send(stopChannel);
    } catch {
      this.invalidateWindow(session, new Error('PC音声プレイヤーを停止できませんでした。'));
    } finally {
      if (playback) this.invalidateWindow(session, new Error('PC音声プレイヤーを停止しました。'));
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.stop();
    ipcMain.removeListener(resultChannel, this.handleResult);
    if (this.session) this.invalidateWindow(this.session, new Error('PC音声プレイヤーは終了しています。'));
  }

  private readonly handleResult = (
    event: IpcMainEvent,
    result: { id?: number; ok?: boolean },
  ) => {
    if (!this.session || event.sender !== this.session.window.webContents || result?.id !== this.pending?.id) return;
    const playback = this.pending;
    if (!playback) return;
    this.finishPlayback(playback, result.ok === true ? undefined : new Error('PC音声を再生できませんでした。'));
  };

  private async beginPlayback(request: Parameters<PcAudioPlayer['play']>[0], playback: Playback): Promise<void> {
    let session: PlayerWindow | undefined;
    try {
      session = this.session ?? this.createWindow();
      await session.ready;
      if (this.pending !== playback || this.closed || this.session !== session) return;
      let transitions: ReturnType<typeof analyzeVoicevoxWav> = [];
      try {
        transitions = request.onMouthShape ? analyzeVoicevoxWav(request.wav) : [];
      } catch {
        request.onMouthShape?.('closed');
      }
      for (const transition of transitions) {
        playback.timers.push(setTimeout(() => {
          if (this.pending === playback) request.onMouthShape?.(transition.shape);
        }, transition.atMs));
      }
      const currentSession = session;
      playback.timers.push(setTimeout(() => {
        if (this.pending === playback) this.invalidateWindow(currentSession, new Error('PC音声の再生完了を確認できませんでした。'));
      }, playbackTimeoutMs(request.wav)));
      session.window.webContents.send(playChannel, { id: playback.id, wav: new Uint8Array(request.wav) });
    } catch {
      if (this.pending !== playback) return;
      const error = new Error('PC音声を再生できませんでした。');
      if (session) this.invalidateWindow(session, error);
      this.finishPlayback(playback, error);
    }
  }

  private createWindow(): PlayerWindow {
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(__dirname, 'speech-player-preload.js'),
      },
    });
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    let settled = false;
    const timer = setTimeout(() => {
      this.invalidateWindow(session, new Error('PC音声プレイヤーを準備できませんでした。'));
    }, initializationTimeoutMs);
    const session: PlayerWindow = {
      window, ready, initialized: false,
      finishReady(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) rejectReady(error);
        else { session.initialized = true; resolveReady(); }
      },
    };
    this.session = session;
    try {
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('render-process-gone', () => {
        this.invalidateWindow(session, new Error('PC音声プレイヤーが停止しました。'));
      });
      window.on('closed', () => {
        this.invalidateWindow(session, new Error('PC音声プレイヤーが停止しました。'));
      });
      void window.loadURL(playerDocumentUrl).then(() => session.finishReady(), () => {
        this.invalidateWindow(session, new Error('PC音声プレイヤーを準備できませんでした。'));
      });
    } catch {
      this.invalidateWindow(session, new Error('PC音声プレイヤーを準備できませんでした。'));
    }
    return session;
  }

  private invalidateWindow(session: PlayerWindow, error: Error): void {
    if (this.session !== session) return;
    this.session = null;
    session.finishReady(error);
    if (this.pending) this.finishPlayback(this.pending, error);
    try {
      if (!session.window.isDestroyed()) session.window.destroy();
    } catch {
      // A failed player must not prevent the reading queue from recovering.
    }
  }

  private finishPlayback(playback: Playback, error?: Error): void {
    if (this.pending !== playback) return;
    this.pending = null;
    for (const timer of playback.timers) clearTimeout(timer);
    playback.timers = [];
    playback.onMouthShape?.('closed');
    if (error) playback.reject(error);
    else playback.resolve();
  }
}

function playbackTimeoutMs(wav: Buffer): number {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    return unknownDurationTimeoutMs;
  }
  let byteRate = 0;
  let dataBytes: number | null = null;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > wav.length) return unknownDurationTimeoutMs;
    if (id === 'fmt ' && size >= 16) byteRate = wav.readUInt32LE(body + 8);
    else if (id === 'data') dataBytes = (dataBytes ?? 0) + size;
    offset = body + size + (size % 2);
  }
  return byteRate > 0 && dataBytes !== null
    ? Math.ceil(dataBytes / byteRate * 1_000) + playbackGraceMs
    : unknownDurationTimeoutMs;
}

const playerDocumentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(
  '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; media-src blob:">',
)}`;
