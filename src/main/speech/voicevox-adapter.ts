import { access } from 'node:fs/promises';
import { win32 } from 'node:path';
import { spawn } from 'node:child_process';
import { trackOwnedProcess } from '../pc-status/owned-processes';
import { createServer } from 'node:net';
import type { CommentSpeechSettings, VoicevoxSpeaker } from '../../shared/types';
import type { SpeechSynthesizer } from './comment-speech-controller';
import { standardVoicevoxExecutables, voicevoxInstallLocations } from './voicevox-discovery';

interface OwnedProcess {
  kill(): boolean;
  once?(event: 'error', listener: (error: Error) => void): unknown;
}

export interface VoicevoxAdapterOptions {
  executablePath?: string;
  endpoint?: string;
  fetch?: typeof fetch;
  exists?: (path: string) => Promise<boolean>;
  spawn?: (executable: string, args: string[]) => OwnedProcess;
  delay?: (milliseconds: number) => Promise<void>;
  probePort?: () => Promise<number>;
  installLocations?: () => Promise<string[]>;
  onExecutableDiscovered?: (path: string, previousPath: string | undefined) => Promise<boolean | void>;
}

export class VoicevoxAdapter implements SpeechSynthesizer {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly exists: (path: string) => Promise<boolean>;
  private readonly spawnProcess: (executable: string, args: string[]) => OwnedProcess;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private ownedProcess: OwnedProcess | null = null;
  private ownedProcessFailed = false;
  private readonly probeProcesses = new Set<OwnedProcess>();
  private stopped = false;
  private preparation: Promise<void> | null = null;
  private readonly requests = new Set<AbortController>();

  constructor(private readonly options: VoicevoxAdapterOptions = {}) {
    this.endpoint = options.endpoint ?? 'http://127.0.0.1:50021';
    this.fetcher = options.fetch ?? fetch;
    this.exists = options.exists ?? fileExists;
    this.spawnProcess = options.spawn ?? ((executable, args) => trackOwnedProcess(() => spawn(executable, args, {
      windowsHide: true,
      stdio: 'ignore',
    })));
    this.delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async prepare(): Promise<void> {
    this.ensureActive();
    if (this.preparation) return this.preparation;
    const preparation = this.prepareEngine();
    this.preparation = preparation;
    try {
      await preparation;
    } finally {
      if (this.preparation === preparation) this.preparation = null;
    }
  }

  private async prepareEngine(): Promise<void> {
    const configured = this.options.executablePath;
    const ready = await this.isReady(this.endpoint);
    this.ensureActive();
    if (ready) return;
    if (!this.ownedProcess) {
      const executable = await this.resolveExecutable();
      this.ensureActive();
      if (!executable) throw new Error('VOICEVOX Engineが見つかりません。');
      try {
        this.ownedProcess = this.spawnProcess(executable, [
          '--host', '127.0.0.1', '--port', endpointPort(this.endpoint),
        ]);
      } catch {
        throw new Error('VOICEVOX Engineを起動できませんでした。');
      }
      this.ownedProcessFailed = false;
      this.ownedProcess.once?.('error', () => { this.ownedProcessFailed = true; });
    }
    try {
      if (await this.waitUntilReady(this.endpoint, () => this.ownedProcessFailed)) {
        if (this.discoveredExecutable && this.options.executablePath === configured) {
          const path = this.discoveredExecutable;
          const saved = await this.options.onExecutableDiscovered?.(path, configured);
          this.ensureActive();
          if (saved !== false && this.options.executablePath === configured) this.options.executablePath = path;
          this.discoveredExecutable = null;
        }
        return;
      }
    } catch {
      this.stopOwnedProcess();
      throw new Error('VOICEVOX Engineを起動できませんでした。');
    }
    this.stopOwnedProcess();
    throw new Error('VOICEVOX Engineの準備が30秒以内に完了しませんでした。');
  }

  async listVoices(): Promise<VoicevoxSpeaker[]> {
    const values = await this.request(`${this.endpoint}/speakers`, undefined, async (response, signal) => {
      if (!response.ok) throw new Error('VOICEVOXの話者一覧を取得できません。');
      return JSON.parse((await readBody(response, signal)).toString('utf8')) as Array<{
      speaker_uuid: string;
      name: string;
      styles: Array<{ id: number; name: string }>;
      }>;
    });
    return values.map((speaker) => ({
      speakerUuid: speaker.speaker_uuid,
      name: speaker.name,
      styles: speaker.styles.map((style) => ({ id: style.id, name: style.name })),
    }));
  }

  async synthesize(text: string, settings: CommentSpeechSettings): Promise<Buffer> {
    if (!settings.voice) throw new Error('話者とスタイルが未選択です。');
    const speaker = String(settings.voice.styleId);
    const query = await this.request(
      `${this.endpoint}/audio_query?${new URLSearchParams({ text, speaker })}`,
      { method: 'POST' },
      async (response, signal) => {
        if (!response.ok) throw new Error('VOICEVOXで音声を準備できません。');
        return JSON.parse((await readBody(response, signal)).toString('utf8')) as Record<string, unknown>;
      },
    );
    Object.assign(query, {
      speedScale: settings.speedScale,
      pitchScale: settings.pitchScale,
      intonationScale: settings.intonationScale,
      volumeScale: settings.volumeScale,
    });
    return this.request(
      `${this.endpoint}/synthesis?${new URLSearchParams({ speaker })}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      },
      async (response, signal) => {
        if (!response.ok) throw new Error('VOICEVOXで音声を生成できません。');
        return readBody(response, signal);
      },
    );
  }

  async validateExecutable(path: string): Promise<void> {
    this.ensureActive();
    if (win32.basename(path).toLowerCase() !== 'run.exe' ||
      win32.basename(win32.dirname(path)).toLowerCase() !== 'vv-engine' ||
      !await this.exists(path)) {
      throw new Error('VOICEVOXの vv-engine\\run.exe を選択してください。');
    }
    const port = await (this.options.probePort ?? availableLoopbackPort)();
    this.ensureActive();
    const endpoint = `http://127.0.0.1:${port}`;
    let process: OwnedProcess;
    try {
      process = this.spawnProcess(path, ['--host', '127.0.0.1', '--port', String(port)]);
    } catch {
      throw new Error('選択したVOICEVOX Engineを起動できません。');
    }
    this.probeProcesses.add(process);
    let failed = false;
    process.once?.('error', () => { failed = true; });
    try {
      if (!await this.waitUntilReady(endpoint, () => failed)) {
        throw new Error('VOICEVOX Engineの準備が30秒以内に完了しませんでした。');
      }
    } catch {
      throw new Error('選択したVOICEVOX Engineを起動できません。');
    } finally {
      if (this.probeProcesses.delete(process)) process.kill();
    }
  }

  setExecutablePath(path: string): void {
    this.options.executablePath = path;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const controller of this.requests) controller.abort(new Error('VOICEVOX Engineの処理は終了しています。'));
    this.stopOwnedProcess();
    for (const process of this.probeProcesses) process.kill();
    this.probeProcesses.clear();
  }

  private async isReady(endpoint: string): Promise<boolean> {
    try {
      return await this.request(`${endpoint}/version`, undefined, async (response, signal) => {
        await readBody(response, signal);
        return response.ok;
      }, 250);
    } catch {
      return false;
    }
  }

  private async waitUntilReady(endpoint: string, failed: () => boolean): Promise<boolean> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      this.ensureActive();
      const startedAt = Date.now();
      if (failed()) throw new Error('VOICEVOX Engine process failed');
      const ready = await this.isReady(endpoint);
      this.ensureActive();
      if (ready) return true;
      if (failed()) throw new Error('VOICEVOX Engine process failed');
      await this.delay(Math.max(0, 250 - (Date.now() - startedAt)));
    }
    return false;
  }

  private async request<T>(
    input: string,
    init: RequestInit | undefined,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
    timeoutMilliseconds = 30_000,
  ): Promise<T> {
    this.ensureActive();
    const controller = new AbortController();
    this.requests.add(controller);
    let cancel!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', cancel, { once: true });
    });
    const timeout = setTimeout(() => controller.abort(new Error('VOICEVOXの応答が期限内に完了しませんでした。')), timeoutMilliseconds);
    try {
      return await Promise.race([
        (async () => {
          const response = await this.fetcher(input, { ...init, signal: controller.signal });
          try {
            if (controller.signal.aborted) throw controller.signal.reason;
            const result = await consume(response, controller.signal);
            if (controller.signal.aborted) throw controller.signal.reason;
            return result;
          } finally {
            if (response.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
          }
        })(),
        cancelled,
      ]);
    } catch {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new Error('VOICEVOXの応答を取得できません。');
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', cancel);
      this.requests.delete(controller);
    }
  }

  private stopOwnedProcess(): void {
    if (this.ownedProcess) this.ownedProcess.kill();
    this.ownedProcess = null;
    this.ownedProcessFailed = false;
  }

  private ensureActive(): void {
    if (this.stopped) throw new Error('VOICEVOX Engineの処理は終了しています。');
  }

  private discoveredExecutable: string | null = null;

  private async resolveExecutable(): Promise<string | null> {
    this.discoveredExecutable = null;
    const configured = this.options.executablePath;
    if (configured && await this.exists(configured)) return configured;
    const find = async (candidates: string[]) => {
      for (const path of candidates) {
        this.ensureActive();
        if (await this.exists(path)) { this.discoveredExecutable = path; return path; }
      }
      return null;
    };
    const standard = await find(standardVoicevoxExecutables(process.env));
    if (standard) return standard;
    this.ensureActive();
    const locations = await (this.options.installLocations ?? voicevoxInstallLocations)().catch(() => []);
    return find(locations.filter(path => win32.isAbsolute(path)).map(path => win32.join(path, 'vv-engine', 'run.exe')));
  }
}

async function readBody(response: Response, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Buffer[] = [];
  try {
    if (signal.aborted) throw signal.reason;
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) return Buffer.concat(chunks);
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new Error('VOICEVOX Engineの確認用ポートを確保できません。');
  return port;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function endpointPort(endpoint: string): string {
  return new URL(endpoint).port || '50021';
}
