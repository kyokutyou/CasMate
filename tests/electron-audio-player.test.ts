import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectronAudioPlayer } from '../src/main/speech/electron-audio-player';
import { CommentSpeechController } from '../src/main/speech/comment-speech-controller';
import { createDefaultSettings } from '../src/main/core/settings';
import type { CommonComment } from '../src/shared/types';

const playChannel = 'casmate:speech-player:play';
const stopChannel = 'casmate:speech-player:stop';
const resultChannel = 'casmate:speech-player:result';

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (event: { sender: unknown }, result: unknown) => void>();
  const loadURL = vi.fn<() => Promise<void>>();
  class Window {
    constructor(readonly options: unknown) { windows.push(this); }
    private destroyed = false;
    private events = new Map<string, () => void>();
    webContents = {
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: (event: string, listener: () => void) => { this.events.set(event, listener); },
    };
    loadURL = loadURL;
    on(event: string, listener: () => void) { this.events.set(event, listener); }
    isDestroyed() { return this.destroyed; }
    destroy = vi.fn(() => { this.destroyed = true; this.events.get('closed')?.(); });
    emit(event: string) { this.events.get(event)?.(); }
  }
  const windows: Window[] = [];
  return {
    windows, loadURL, Window, listeners,
    ipcMain: {
      on: (channel: string, listener: (event: { sender: unknown }, result: unknown) => void) => {
        listeners.set(channel, listener);
      },
      removeListener: vi.fn((channel: string) => { listeners.delete(channel); }),
    },
  };
});

vi.mock('electron', () => ({ BrowserWindow: electron.Window, ipcMain: electron.ipcMain }));

let player: ElectronAudioPlayer;
beforeEach(() => {
  vi.useFakeTimers();
  electron.windows.splice(0);
  electron.listeners.clear();
  electron.loadURL.mockReset().mockResolvedValue(undefined);
  player = new ElectronAudioPlayer();
});
afterEach(async () => {
  await player.shutdown();
  vi.useRealTimers();
});

describe('PC音声プレイヤーの要求とWindowの所有', () => {
  it('通常再生は狭いIPCとサンドボックスを維持し、音声に合わせて口パクして完了する', async () => {
    const onMouthShape = vi.fn();
    const audio = wav();
    const playback = player.play({ commentId: 'normal', wav: audio, onMouthShape });
    await flush();
    const window = electron.windows[0]!;
    expect(window.options).toMatchObject({
      show: false, skipTaskbar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    expect(plays(window)[0]![1]).toEqual({ id: playId(window), wav: new Uint8Array(audio) });
    await vi.advanceTimersByTimeAsync(0);
    expect(onMouthShape).toHaveBeenLastCalledWith('open');
    await vi.advanceTimersByTimeAsync(80);
    expect(onMouthShape).toHaveBeenLastCalledWith('closed');
    result(window, playId(window), true);
    await playback;
    expect(window.isDestroyed()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('正常完了したWindowを連続するコメントで再利用し、通常再生ごとに作り直さない', async () => {
    const first = player.play({ commentId: 'first', wav: wav() });
    await flush();
    const window = electron.windows[0]!;
    result(window, playId(window), true);
    await first;
    const second = player.play({ commentId: 'second', wav: wav() });
    await flush();
    expect(electron.windows).toHaveLength(1);
    expect(window.isDestroyed()).toBe(false);
    expect(plays(window)).toHaveLength(2);
    result(window, playId(window), true);
    await second;
  });

  it('初期化中に停止した要求はすぐ完了し、遅い準備完了から再生しない', async () => {
    const ready = deferred();
    electron.loadURL.mockReturnValueOnce(ready.promise);
    const onMouthShape = vi.fn();
    const playback = player.play({ commentId: 'old', wav: wav(), onMouthShape });
    await flush();
    const window = electron.windows[0]!;

    await player.stop();
    await expect(playback).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    ready.resolve();
    await flush();

    expect(plays(window)).toHaveLength(0);
    expect(window.isDestroyed()).toBe(true);
    expect(onMouthShape).not.toHaveBeenCalledWith('open');
  });

  it('play直後の停止も、await前に確定した旧要求だけを取り消す', async () => {
    const playback = player.play({ commentId: 'old', wav: wav() });
    await player.stop();
    await flush();
    expect(electron.windows.every(window => plays(window).length === 0)).toBe(true);
    await expect(playback).resolves.toBeUndefined();
  });

  it('初期化中に次のplayを開始しても旧準備は新しいWindowや口パクを変更しない', async () => {
    const oldReady = deferred();
    electron.loadURL.mockReturnValueOnce(oldReady.promise);
    const oldMouth = vi.fn();
    const oldPlayback = player.play({ commentId: 'old', wav: wav(), onMouthShape: oldMouth });
    await flush();
    const oldWindow = electron.windows[0]!;
    const newMouth = vi.fn();
    const playback = player.play({ commentId: 'new', wav: wav(), onMouthShape: newMouth });
    await flush();
    const window = electron.windows.at(-1)!;
    oldReady.resolve();
    await oldPlayback;
    await vi.advanceTimersByTimeAsync(0);

    expect(plays(oldWindow)).toHaveLength(0);
    expect(plays(window)).toHaveLength(1);
    expect(newMouth).toHaveBeenCalledWith('open');
    expect(oldMouth).not.toHaveBeenCalledWith('open');
    result(window, playId(window), true);
    await playback;
    expect(newMouth).toHaveBeenLastCalledWith('closed');
  });

  it('再生の入替えでは旧応答と旧後処理が新要求の完了や口パクへ影響しない', async () => {
    const oldPlayback = player.play({ commentId: 'old', wav: wav() });
    await flush();
    const oldWindow = electron.windows[0]!;
    const oldId = playId(oldWindow);
    const onMouthShape = vi.fn();
    const playback = player.play({ commentId: 'new', wav: wav(), onMouthShape });
    const finished = vi.fn();
    void playback.then(finished);
    await oldPlayback;
    await flush();
    const window = electron.windows[1]!;
    expect(oldWindow.isDestroyed()).toBe(true);
    result(oldWindow, oldId, true);
    result(window, playId(window), true, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(finished).not.toHaveBeenCalled();
    expect(onMouthShape).toHaveBeenCalledWith('open');
    result(window, playId(window), true);
    await playback;
    expect(finished).toHaveBeenCalledOnce();
    expect(onMouthShape).toHaveBeenLastCalledWith('closed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['render-process-gone', 'closed'])('%sで故障したWindowを破棄し、次は新しいWindowで再生する', async event => {
    const playback = player.play({ commentId: 'old', wav: wav() });
    const failed = expect(playback).rejects.toThrow('PC音声');
    await flush();
    const oldWindow = electron.windows[0]!;
    const oldId = playId(oldWindow);
    oldWindow.emit(event);
    await failed;
    expect(oldWindow.isDestroyed()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const next = player.play({ commentId: 'new', wav: wav() });
    const finished = vi.fn();
    void next.then(finished);
    await flush();
    const window = electron.windows[1]!;
    result(oldWindow, oldId, true);
    oldWindow.emit(event);
    await flush();
    expect(finished).not.toHaveBeenCalled();
    expect(window.isDestroyed()).toBe(false);
    expect(plays(window)).toHaveLength(1);
    result(window, playId(window), true);
    await next;
  });

  it('初期化中の描画プロセス故障を通知し、遅いload完了から再生しない', async () => {
    const ready = deferred();
    electron.loadURL.mockReturnValueOnce(ready.promise);
    const playback = player.play({ commentId: 'old', wav: wav() });
    const failed = expect(playback).rejects.toThrow('PC音声');
    await flush();
    const window = electron.windows[0]!;
    window.emit('render-process-gone');
    await failed;
    ready.resolve();
    await flush();
    expect(plays(window)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['reject', 'timeout'])('初期化の%sを失敗として完了させ、故障Windowを再利用しない', async failure => {
    const ready = deferred();
    electron.loadURL.mockReturnValueOnce(ready.promise);
    const playback = player.play({ commentId: 'old', wav: wav() });
    const failed = expect(playback).rejects.toThrow('PC音声');
    await flush();
    const window = electron.windows[0]!;
    if (failure === 'reject') ready.reject(new Error('private load error'));
    else await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(window.isDestroyed()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const next = player.play({ commentId: 'new', wav: wav() });
    await flush();
    expect(electron.windows).toHaveLength(2);
    result(electron.windows[1]!, playId(electron.windows[1]!), true);
    await next;
  });

  it('完了通知がない再生はWAV時間+5秒で停止し、後続は新しいWindowを使用できる', async () => {
    const onMouthShape = vi.fn();
    const playback = player.play({ commentId: 'old', wav: wav(1_000), onMouthShape });
    const failed = expect(playback).rejects.toThrow('PC音声');
    await flush();
    const window = electron.windows[0]!;
    await vi.advanceTimersByTimeAsync(5_999);
    expect(window.isDestroyed()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
    expect(window.isDestroyed()).toBe(true);
    expect(onMouthShape).toHaveBeenLastCalledWith('closed');
    expect(vi.getTimerCount()).toBe(0);
    const next = player.play({ commentId: 'new', wav: wav() });
    await flush();
    result(electron.windows[1]!, playId(electron.windows[1]!), true);
    await next;
  });

  it('時間不明のWAVだけ120秒を期限とし、長い正常WAVは途中で停止しない', async () => {
    const unknown = player.play({ commentId: 'unknown', wav: Buffer.from('invalid') });
    const failed = expect(unknown).rejects.toThrow('PC音声');
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    await failed;

    const playback = player.play({ commentId: 'long', wav: wav(180_000) });
    await flush();
    const window = electron.windows[1]!;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(window.isDestroyed()).toBe(false);
    result(window, playId(window), true);
    await playback;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('完了通知欠落は1回の復旧で打ち切り、同期表示を閉じて後続コメントへ進む', async () => {
    const settings = {
      ...createDefaultSettings().commentSpeech, enabled: true,
      voice: { speakerUuid: 'speaker', styleId: 1 },
    };
    const overlay = { start: vi.fn(), finish: vi.fn(), fallback: vi.fn(), clear: vi.fn() };
    const controller = new CommentSpeechController(settings, {
      synthesizer: {
        prepare: vi.fn(async () => undefined),
        listVoices: vi.fn(async () => [{ speakerUuid: 'speaker', name: '話者', styles: [{ id: 1, name: '通常' }] }]),
        synthesize: vi.fn(async () => wav()),
      },
      player, synchronizedOverlay: overlay, delay: vi.fn(async () => undefined),
    }, true);
    await controller.whenReady();
    controller.accept(comment(1));
    controller.accept(comment(2));
    await flush();
    await vi.advanceTimersByTimeAsync(5_200);
    expect(electron.windows).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_200);
    expect(electron.windows).toHaveLength(3);
    expect(overlay.finish).toHaveBeenCalledWith('youtube:1');
    expect(overlay.fallback).not.toHaveBeenCalled();
    expect(controller.snapshot().currentCommentId).toBe('youtube:2');
    const window = electron.windows[2]!;
    result(window, playId(window), true);
    await controller.whenIdle();
    expect(controller.snapshot()).toMatchObject({ currentCommentId: null, queueLength: 0, warning: null });
    expect(overlay.finish).toHaveBeenCalledWith('youtube:2');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('再生中の停止で口パクと再生期限を解除し、遅い応答を無視する', async () => {
    const onMouthShape = vi.fn();
    const playback = player.play({ commentId: 'old', wav: wav(), onMouthShape });
    await flush();
    const window = electron.windows[0]!;
    await vi.advanceTimersByTimeAsync(0);
    expect(onMouthShape).toHaveBeenLastCalledWith('open');
    await player.stop();
    await playback;
    const callsAfterStop = onMouthShape.mock.calls.length;
    result(window, playId(window), true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(window.webContents.send).toHaveBeenCalledWith(stopChannel);
    expect(onMouthShape).toHaveBeenLastCalledWith('closed');
    expect(onMouthShape).toHaveBeenCalledTimes(callsAfterStop);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('停止IPCに反応しないプレイヤーも破棄して停止を保証し、次の再生は新Windowを使う', async () => {
    const playback = player.play({ commentId: 'old', wav: wav() });
    await flush();
    const window = electron.windows[0]!;
    // Sending the stop succeeds, but this renderer never processes it or reports completion.
    window.webContents.send.mockImplementation(() => undefined);
    await player.stop();
    await expect(playback).resolves.toBeUndefined();
    expect(window.webContents.send).toHaveBeenCalledWith(stopChannel);
    expect(window.isDestroyed()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const next = player.play({ commentId: 'new', wav: wav() });
    await flush();
    expect(electron.windows).toHaveLength(2);
    const newWindow = electron.windows[1]!;
    result(newWindow, playId(newWindow), true);
    await next;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('再生IPCの失敗を隔離し、故障Windowから復旧できる', async () => {
    const playback = player.play({ commentId: 'old', wav: wav() });
    await flush();
    const window = electron.windows[0]!;
    result(window, playId(window), true);
    await playback;
    window.webContents.send.mockImplementation((channel: string) => {
      if (channel === playChannel) throw new Error('private ipc error');
    });
    const broken = player.play({ commentId: 'broken', wav: wav() });
    const rejected = expect(broken).rejects.toThrow('PC音声');
    await flush();
    await rejected;
    expect(window.isDestroyed()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('初期化中の終了と終了後のplayでWindow・音声・タイマーを再作成しない', async () => {
    const ready = deferred();
    electron.loadURL.mockReturnValueOnce(ready.promise);
    const playback = player.play({ commentId: 'old', wav: wav() });
    await flush();
    const window = electron.windows[0]!;
    await player.shutdown();
    await playback;
    expect(vi.getTimerCount()).toBe(0);
    ready.resolve();
    await flush();
    await expect(player.play({ commentId: 'new', wav: wav() })).rejects.toThrow('PC音声');
    expect(electron.windows).toHaveLength(1);
    expect(plays(window)).toHaveLength(0);
    expect(electron.listeners.has(resultChannel)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

function plays(window: InstanceType<typeof electron.Window>) {
  return window.webContents.send.mock.calls.filter(([channel]) => channel === playChannel);
}

function playId(window: InstanceType<typeof electron.Window>): number {
  return (plays(window).at(-1)![1] as { id: number }).id;
}

function result(window: InstanceType<typeof electron.Window>, id: number, ok: boolean, sender: unknown = window.webContents) {
  electron.listeners.get(resultChannel)?.({ sender }, { id, ok });
}

function wav(durationMs = 200): Buffer {
  const data = Buffer.alloc(durationMs * 2);
  for (let index = 0; index < durationMs; index += 1) data.writeInt16LE(index < 80 ? 20_000 : 0, index * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(data.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(1_000, 24); header.writeUInt32LE(2_000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function comment(sequence: number): CommonComment {
  return {
    id: `youtube:${sequence}`, externalId: String(sequence), sequence,
    source: 'youtube', authorName: '視聴者', content: [{ type: 'text', text: 'コメント' }],
    receivedAt: '2026-10-15T00:00:00Z', initialHistory: false,
  };
}
