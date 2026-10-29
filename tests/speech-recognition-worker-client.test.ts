import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import {
  JsonLinesSpeechRecognitionWorker,
  type SpeechRecognitionProcess,
} from '../src/main/speech-recognition/json-lines-speech-recognition-worker';

describe('音声認識ワーカーのJSON Lines境界', () => {
  it('OBS音声の取得期間だけを更新し、セッション開始・停止を送らない', async () => {
    const child = fakeProcess((message, process) => respond(process, message.requestId, {}));
    const worker = new JsonLinesSpeechRecognitionWorker({ executablePath: 'worker.exe', modelDirectory: 'models', recordingsDirectory: 'recordings', spawnProcess: () => child.process });
    await worker.setVoiceCapturePeriod('11111111-1111-4111-8111-111111111111');
    expect(child.commands).toEqual([expect.objectContaining({ command: 'setVoiceCapturePeriod', payload: { id: '11111111-1111-4111-8111-111111111111' } })]);
    child.emitExit(0);
  });
  it('日本語・絵文字のUTF-8がバイト単位で分割されても認識結果を保持する', async () => {
    const child = fakeProcess();
    const worker = new JsonLinesSpeechRecognitionWorker({ executablePath: 'worker.exe', modelDirectory: 'models',
      recordingsDirectory: 'recordings', spawnProcess: () => child.process });
    const events: unknown[] = []; worker.subscribe(event => events.push(event));
    await worker.retry();
    const result = { id: 'result-1', sessionId: 'session-1', sequence: 1, text: '日本語の認識結果👩‍💻',
      recognizedAt: '2026-10-18T00:00:00Z', audioDurationMilliseconds: 1000, recognitionDurationMilliseconds: 10 };
    const bytes = Buffer.from(JSON.stringify({ protocolVersion: 1, type: 'event', event: 'recognition.result', payload: result }) + '\n');
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    expect(events).toContainEqual({ type: 'result', result });
    child.emitExit(0);
  });

  it('初期化でモデル保存先を渡し、モデル確認イベントを公開する', async () => {
    const child = fakeProcess((message, process) => {
      process.stdout.write(`${JSON.stringify({ protocolVersion: 1, type: 'event', event: 'model.changed', payload: { status: 'ready', progress: null, warning: null } })}\n`);
      respond(process, message.requestId, {});
    });
    const worker = new JsonLinesSpeechRecognitionWorker({ executablePath: 'worker.exe', modelDirectory: 'models', recordingsDirectory: 'recordings', spawnProcess: () => child.process });
    const events: unknown[] = []; worker.subscribe(event => events.push(event));
    await worker.initialize();
    expect(child.commands).toEqual([expect.objectContaining({ command: 'initialize', payload: { modelDirectory: 'models' } })]);
    expect(events).toContainEqual({ type: 'model', status: 'ready', progress: null, warning: null });
  });
  it('旧音声の破棄が応答しない場合に所有ワーカーを終了して次の入力を新規開始する', async () => {
    vi.useFakeTimers();
    try {
      const first = fakeProcess((message, process) => {
        if (message.command === 'start') respond(process, message.requestId, { sessionId: 'first' });
      });
      first.process.kill = vi.fn(() => { first.emitExit(0); return true; });
      const second = fakeProcess((message, process) => {
        if (message.command === 'start') respond(process, message.requestId, { sessionId: 'second' });
      });
      const spawnProcess = vi.fn().mockReturnValueOnce(first.process).mockReturnValueOnce(second.process);
      const worker = new JsonLinesSpeechRecognitionWorker({ executablePath: 'worker.exe', modelDirectory: 'models',
        recordingsDirectory: 'recordings', spawnProcess });
      await worker.start(createDefaultSettings().speechRecognition, { udpPort: 43210, ffmpegPath: 'ffmpeg.exe', generation: 'first' });
      const stopped = worker.stop(true);
      await vi.advanceTimersByTimeAsync(5_000);
      await stopped;
      expect(first.process.kill).toHaveBeenCalledOnce();
      expect(first.commands.at(-1)).toMatchObject({ command: 'stop', payload: { discard: true } });
      await expect(worker.start(createDefaultSettings().speechRecognition)).resolves.toEqual({ sessionId: 'second' });
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('要求と応答をrequestIdで対応させ認識結果イベントを公開する', async () => {
    const child = fakeProcess((message, process) => {
      if (message.command === 'listMicrophones') {
        respond(process, message.requestId, { microphones: [
          { id: 'mic-1', name: 'マイク1', isDefault: true },
        ] });
      }
      if (message.command === 'start') {
        respond(process, message.requestId, { sessionId: 'session-1' });
      }
    });
    const worker = new JsonLinesSpeechRecognitionWorker({
      executablePath: 'worker.exe',
      modelDirectory: 'models',
      recordingsDirectory: 'recordings',
      spawnProcess: vi.fn(() => child.process),
    });
    const events: unknown[] = [];
    worker.subscribe((event) => events.push(event));

    const microphones = await worker.listMicrophones();
    const started = await worker.start(createDefaultSettings().speechRecognition);
    child.stdout.write(`${JSON.stringify({
      protocolVersion: 1,
      type: 'event',
      event: 'recognition.result',
      payload: {
        id: 'result-1', sessionId: 'session-1', sequence: 1,
        recognizedAt: '2026-08-28T00:00:00.000Z', text: 'こんにちは',
        audioDurationMilliseconds: 1000, recognitionDurationMilliseconds: 100,
      },
    })}\n`);

    expect(microphones).toEqual([{ id: 'mic-1', name: 'マイク1', isDefault: true }]);
    expect(started).toEqual({ sessionId: 'session-1' });
    expect(events).toContainEqual({
      type: 'result',
      result: expect.objectContaining({ id: 'result-1', text: 'こんにちは' }),
    });
    expect(child.commands.map((command) => command.command)).toEqual([
      'listMicrophones',
      'start',
    ]);
  });

  it('壊れたJSONと予期しない終了を配信者音声認識だけの障害として通知する', async () => {
    const child = fakeProcess((message, process) => {
      if (message.command === 'listMicrophones') {
        respond(process, message.requestId, { microphones: [] });
      }
    });
    const worker = new JsonLinesSpeechRecognitionWorker({
      executablePath: 'worker.exe', modelDirectory: 'models', recordingsDirectory: 'recordings',
      spawnProcess: () => child.process,
    });
    const events: unknown[] = [];
    worker.subscribe((event) => events.push(event));
    await worker.listMicrophones();
    child.stdout.write('{broken}\n');
    child.emitExit(1);

    expect(events).toContainEqual({
      type: 'fatal',
      warning: '音声認識ワーカーとの通信に失敗しました。再試行してください。',
    });
  });

  it('壊れたJSONを受信したとき保留中の要求を拒否してワーカーを終了する', async () => {
    const child = fakeProcess();
    const worker = new JsonLinesSpeechRecognitionWorker({
      executablePath: 'worker.exe', modelDirectory: 'models', recordingsDirectory: 'recordings',
      spawnProcess: () => child.process,
    });

    const pending = worker.listMicrophones();
    child.stdout.write('{broken}\n');

    await expect(pending).rejects.toThrow('通信に失敗');
    expect(child.process.kill).toHaveBeenCalledOnce();
  });

  it('不正なマイク一覧イベントをプロトコル障害として隔離する', async () => {
    const child = fakeProcess();
    const worker = new JsonLinesSpeechRecognitionWorker({
      executablePath: 'worker.exe', modelDirectory: 'models', recordingsDirectory: 'recordings',
      spawnProcess: () => child.process,
    });
    const events: unknown[] = [];
    worker.subscribe((event) => events.push(event));
    await worker.retry();

    child.stdout.write(`${JSON.stringify({
      protocolVersion: 1, type: 'event', event: 'microphones.changed', payload: { microphones: null },
    })}\n`);

    expect(events).toContainEqual(expect.objectContaining({ type: 'fatal' }));
    expect(child.process.kill).toHaveBeenCalledOnce();
  });

  it('プロトコル障害後も旧プロセスの終了確認後にだけ再起動する', async () => {
    const first = fakeProcess();
    const second = fakeProcess();
    const spawnProcess = vi.fn().mockReturnValueOnce(first.process).mockReturnValueOnce(second.process);
    const worker = new JsonLinesSpeechRecognitionWorker({
      executablePath: 'worker.exe', modelDirectory: 'models', recordingsDirectory: 'recordings',
      spawnProcess,
    });
    await worker.retry();
    first.stdout.write('{broken}\n');

    const retry = worker.retry();
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    first.emitExit(1);
    await retry;

    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it('手動再試行後に旧プロセスが終了しても新プロセスを維持する', async () => {
    const first = fakeProcess();
    const second = fakeProcess((message, process) => {
      if (message.command === 'listMicrophones') respond(process, message.requestId, { microphones: [] });
    });
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(first.process)
      .mockReturnValueOnce(second.process);
    const worker = new JsonLinesSpeechRecognitionWorker({
      executablePath: 'worker.exe', modelDirectory: 'models', recordingsDirectory: 'recordings',
      spawnProcess,
    });
    const events: unknown[] = [];
    worker.subscribe((event) => events.push(event));

    await worker.retry();
    const retry = worker.retry();
    first.emitExit(0);
    await retry;
    await expect(worker.listMicrophones()).resolves.toEqual([]);

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'fatal' }));
  });

  it('終了応答後にプロセス終了まで確認する', async () => {
    const child = fakeProcess((message, process) => {
      if (message.command !== 'shutdown') return;
      respond(process, message.requestId, {});
      queueMicrotask(() => process.emitExit(0));
    });
    const worker = new JsonLinesSpeechRecognitionWorker({
      executablePath: 'worker.exe', modelDirectory: 'models', recordingsDirectory: 'recordings',
      spawnProcess: () => child.process,
    });
    await worker.retry();

    await expect(worker.shutdown()).resolves.toBeUndefined();
    expect(child.process.kill).not.toHaveBeenCalled();
  });
});

interface CommandMessage {
  requestId: string;
  command: string;
  payload?: unknown;
}

function fakeProcess(onCommand?: (message: CommandMessage, process: ReturnType<typeof fakeProcess>) => void) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const commands: CommandMessage[] = [];
  const exitListeners: Array<(code: number | null) => void> = [];
  const errorListeners: Array<(error: Error) => void> = [];
  const holder = {
    stdin,
    stdout,
    stderr,
    commands,
    emitExit: (code: number | null) => exitListeners.forEach((listener) => listener(code)),
    process: undefined as unknown as SpeechRecognitionProcess,
  };
  holder.process = {
    stdin,
    stdout,
    stderr,
    kill: vi.fn(() => true),
    once: (event, listener) => {
      if (event === 'exit') exitListeners.push(listener as (code: number | null) => void);
      else errorListeners.push(listener as (error: Error) => void);
      return holder.process;
    },
  };
  let pending = '';
  stdin.on('data', (data) => {
    pending += String(data);
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const message = JSON.parse(pending.slice(0, newline)) as CommandMessage;
      pending = pending.slice(newline + 1);
      commands.push(message);
      onCommand?.(message, holder);
      newline = pending.indexOf('\n');
    }
  });
  return holder;
}

function respond(process: ReturnType<typeof fakeProcess>, requestId: string, result: unknown) {
  process.stdout.write(`${JSON.stringify({
    protocolVersion: 1,
    type: 'response',
    requestId,
    ok: true,
    result,
  })}\n`);
}
