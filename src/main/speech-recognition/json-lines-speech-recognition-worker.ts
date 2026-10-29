import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { trackOwnedProcess } from '../pc-status/owned-processes';
import type { Readable, Writable } from 'node:stream';
import type {
  SpeechRecognitionMicrophone,
  SpeechRecognitionResult,
  SpeechRecognitionRuntimeStatus,
  SpeechRecognitionSettings,
} from '../../shared/types';
import type {
  SpeechRecognitionWorker,
  SpeechRecognitionWorkerEvent,
  SpeechRecognitionExternalInput,
} from './speech-recognition-worker';

const protocolVersion = 1;

export interface SpeechRecognitionProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
}

export interface JsonLinesSpeechRecognitionWorkerOptions {
  executablePath: string;
  modelDirectory: string;
  recordingsDirectory: string;
  spawnProcess?: (executablePath: string) => SpeechRecognitionProcess;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ProtocolResponse {
  protocolVersion: number;
  type: 'response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

interface ProtocolEvent {
  protocolVersion: number;
  type: 'event';
  event: string;
  payload?: unknown;
}

export class JsonLinesSpeechRecognitionWorker implements SpeechRecognitionWorker {
  private readonly listeners = new Set<(event: SpeechRecognitionWorkerEvent) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private process: SpeechRecognitionProcess | null = null;
  private stdoutBuffer = '';
  private readonly expectedExits = new WeakSet<SpeechRecognitionProcess>();
  private communicationFailed = false;
  private readonly spawnProcess: (executablePath: string) => SpeechRecognitionProcess;

  constructor(private readonly options: JsonLinesSpeechRecognitionWorkerOptions) {
    this.spawnProcess = options.spawnProcess ?? ((executablePath) => trackOwnedProcess(() => spawn(executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })) as unknown as SpeechRecognitionProcess);
  }

  subscribe(listener: (event: SpeechRecognitionWorkerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    await this.command('initialize', { modelDirectory: this.options.modelDirectory });
  }

  async prepareModel(): Promise<void> {
    await this.command('prepareModel', { modelDirectory: this.options.modelDirectory });
  }

  async listMicrophones(): Promise<SpeechRecognitionMicrophone[]> {
    const result = await this.command('listMicrophones', {});
    return readMicrophones(result);
  }

  async start(settings: SpeechRecognitionSettings, externalInput?: SpeechRecognitionExternalInput): Promise<{ sessionId: string }> {
    const result = await this.command('start', {
      settings,
      modelDirectory: this.options.modelDirectory,
      recordingsDirectory: this.options.recordingsDirectory,
      ...(externalInput ? { externalInput } : {}),
    });
    if (!isRecord(result) || typeof result.sessionId !== 'string') {
      throw new Error('音声認識ワーカーから不正な開始応答を受信しました。');
    }
    return { sessionId: result.sessionId };
  }

  async stop(discard = false): Promise<void> {
    if (!this.process) return;
    const stopped = this.command('stop', discard ? { discard: true } : {});
    if (!discard) { await stopped; return; }
    try { await withTimeout(stopped, 5_000, '旧音声の破棄がタイムアウトしました。'); }
    catch { await this.terminateProcess(); }
  }

  async setWavSaving(enabled: boolean): Promise<void> {
    if (!this.process && !enabled) return;
    await this.command('setWavSaving', { enabled });
  }

  async setVoiceCapturePeriod(id: string): Promise<void> {
    await withTimeout(this.command('setVoiceCapturePeriod', { id }), 5_000, 'OBS音声操作の取得期間を更新できませんでした。');
  }

  async retry(): Promise<void> {
    await this.terminateProcess();
    this.ensureProcess();
  }

  async shutdown(): Promise<void> {
    const process = this.process;
    if (!process) return;
    this.expectedExits.add(process);
    const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
    try {
      await withTimeout(
        this.command('shutdown', {}),
        5_000,
        '音声認識ワーカーの終了がタイムアウトしました。',
      );
      await withTimeout(exited, 5_000, '音声認識ワーカーの終了がタイムアウトしました。');
    } catch {
      process.kill();
      await waitAtMost(exited, 2_000);
    } finally {
      if (this.process === process) this.process = null;
      this.rejectPending('音声認識ワーカーを終了しました。');
    }
  }

  private command(command: string, payload: unknown): Promise<unknown> {
    const process = this.ensureProcess();
    const requestId = randomUUID();
    const message = JSON.stringify({
      protocolVersion,
      type: 'command',
      requestId,
      command,
      payload,
    });
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      process.stdin.write(`${message}\n`, (error) => {
        if (!error) return;
        this.pending.delete(requestId);
        reject(new Error('音声認識ワーカーへ要求を送信できませんでした。'));
      });
    });
  }

  private ensureProcess(): SpeechRecognitionProcess {
    if (this.process) return this.process;
    const process = this.spawnProcess(this.options.executablePath);
    this.process = process;
    this.communicationFailed = false;
    this.stdoutBuffer = '';
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (data) => {
      if (this.process === process && !this.communicationFailed) this.consumeStdout(String(data));
    });
    process.stderr.on('data', () => {
      // Diagnostics stay private and intentionally are not copied into app logs or state.
    });
    process.once('error', () => {
      if (this.process === process && !this.expectedExits.has(process)) this.handleUnexpectedFailure();
    });
    process.once('exit', () => {
      if (this.process !== process) return;
      this.process = null;
      this.rejectPending('音声認識ワーカーが終了しました。');
      if (!this.expectedExits.has(process)) this.handleUnexpectedFailure();
    });
    return process;
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        try {
          this.consumeLine(line);
        } catch {
          this.handleUnexpectedFailure();
        }
      }
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private consumeLine(line: string): void {
    let message: ProtocolResponse | ProtocolEvent;
    try {
      message = JSON.parse(line) as ProtocolResponse | ProtocolEvent;
    } catch {
      this.handleUnexpectedFailure();
      return;
    }
    if (message.protocolVersion !== protocolVersion) {
      this.handleUnexpectedFailure();
      return;
    }
    if (message.type === 'response') {
      if (typeof message.requestId !== 'string' || typeof message.ok !== 'boolean') {
        this.handleUnexpectedFailure();
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error?.message ?? '音声認識ワーカーの操作に失敗しました。'));
      return;
    }
    if (message.type === 'event' && typeof message.event === 'string') {
      this.publishProtocolEvent(message);
      return;
    }
    this.handleUnexpectedFailure();
  }

  private publishProtocolEvent(message: ProtocolEvent): void {
    const payload = isRecord(message.payload) ? message.payload : {};
    switch (message.event) {
      case 'worker.ready':
        return;
      case 'status.changed':
        if (isRuntimeStatus(payload.status)) {
          this.publish({
            type: 'status',
            status: payload.status,
            sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
            warning: typeof payload.warning === 'string' ? payload.warning : null,
          });
        }
        return;
      case 'model.changed':
        if (isModelStatus(payload.status)) {
          this.publish({
            type: 'model',
            status: payload.status,
            progress: typeof payload.progress === 'number' ? payload.progress : null,
            warning: typeof payload.warning === 'string' ? payload.warning : null,
          });
        }
        return;
      case 'microphones.changed':
        this.publish({ type: 'microphones', microphones: readMicrophones({ microphones: payload.microphones }) });
        return;
      case 'wavSaving.changed':
        if (typeof payload.enabled === 'boolean') {
          this.publish({
            type: 'wavSaving',
            enabled: payload.enabled,
            sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
            warning: typeof payload.warning === 'string' ? payload.warning : null,
          });
        }
        return;
      case 'recognition.result':
        if (isRecognitionResult(payload)) this.publish({ type: 'result', result: payload });
        return;
      case 'worker.fatal':
        this.publish({
          type: 'fatal',
          warning: typeof payload.warning === 'string'
            ? payload.warning
            : '音声認識ワーカーを利用できません。再試行してください。',
        });
        return;
    }
  }

  private handleUnexpectedFailure(): void {
    if (this.communicationFailed) return;
    this.communicationFailed = true;
    const process = this.process;
    if (process) {
      this.expectedExits.add(process);
      process.kill();
    }
    this.rejectPending('音声認識ワーカーとの通信に失敗しました。');
    this.publish({
      type: 'fatal',
      warning: '音声認識ワーカーとの通信に失敗しました。再試行してください。',
    });
  }

  private async terminateProcess(): Promise<void> {
    if (!this.process) return;
    const process = this.process;
    this.expectedExits.add(process);
    this.rejectPending('音声認識ワーカーを再起動しました。');
    const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
    process.kill();
    await withTimeout(exited, 5_000, '音声認識ワーカーを終了できませんでした。');
    if (this.process === process) this.process = null;
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
  }

  private publish(event: SpeechRecognitionWorkerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function readMicrophones(value: unknown): SpeechRecognitionMicrophone[] {
  if (!isRecord(value) || !Array.isArray(value.microphones)) {
    throw new Error('音声認識ワーカーから不正なマイク一覧を受信しました。');
  }
  return value.microphones.filter(isMicrophone);
}

function isMicrophone(value: unknown): value is SpeechRecognitionMicrophone {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    typeof value.isDefault === 'boolean';
}

function isRecognitionResult(value: unknown): value is SpeechRecognitionResult {
  return isRecord(value) && typeof value.id === 'string' && typeof value.sessionId === 'string' &&
    (!('capturePeriodId' in value) || typeof value.capturePeriodId === 'string') &&
    (!('voiceCapturePeriodId' in value) || typeof value.voiceCapturePeriodId === 'string') &&
    typeof value.sequence === 'number' && typeof value.recognizedAt === 'string' &&
    typeof value.text === 'string' && typeof value.audioDurationMilliseconds === 'number' &&
    typeof value.recognitionDurationMilliseconds === 'number';
}

function isRuntimeStatus(value: unknown): value is SpeechRecognitionRuntimeStatus {
  return value === 'disabled' || value === 'preparing' || value === 'listening' ||
    value === 'speechDetected' || value === 'recognizing' || value === 'unavailable' || value === 'waitingForInput';
}

function isModelStatus(value: unknown): value is 'missing' | 'downloading' | 'extracting' | 'validating' | 'ready' | 'failed' {
  return value === 'missing' || value === 'downloading' || value === 'extracting' ||
    value === 'validating' || value === 'ready' || value === 'failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function waitAtMost(promise: Promise<void>, milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    promise.finally(() => { clearTimeout(timer); resolve(); }).catch(() => undefined);
  });
}
