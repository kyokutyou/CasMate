import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { trackOwnedProcess } from '../pc-status/owned-processes';
import type { AudioTranscoder } from './mobile-speech-controller';

interface FfmpegOptions {
  exists?: (path: string) => boolean;
  run?: (executable: string, args: string[], input: Buffer, signal: AbortSignal) => Promise<Buffer>;
}

export class FfmpegTranscoder implements AudioTranscoder {
  private readonly exists: (path: string) => boolean;
  private readonly run: NonNullable<FfmpegOptions['run']>;
  private readonly conversions = new Set<AbortController>();
  private stopped = false;

  constructor(private readonly executablePath: string, options: FfmpegOptions = {}) {
    this.exists = options.exists ?? existsSync;
    this.run = options.run ?? runFfmpeg;
  }

  available(): boolean {
    return this.exists(this.executablePath);
  }

  async transcode(wav: Buffer, bitrateKbps: number): Promise<Buffer> {
    if (this.stopped) throw new Error('FFmpegの処理は終了しています。');
    if (!this.available()) throw new Error('FFmpegを利用できません。');
    const controller = new AbortController();
    this.conversions.add(controller);
    let cancel!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', cancel, { once: true });
    });
    const timeout = setTimeout(() => controller.abort(new Error('FFmpegの変換が30秒以内に完了しませんでした。')), 30_000);
    try {
      const audio = await Promise.race([this.run(this.executablePath, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'wav', '-i', 'pipe:0', '-vn',
        '-ac', '1', '-c:a', 'aac', '-b:a', `${bitrateKbps}k`,
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4', 'pipe:1',
      ], wav, controller.signal), cancelled]);
      if (controller.signal.aborted) throw new Error('FFmpegの変換を取り消しました。');
      return audio;
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', cancel);
      this.conversions.delete(controller);
    }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const controller of this.conversions) controller.abort(new Error('FFmpegの変換を取り消しました。'));
    this.conversions.clear();
  }
}

function runFfmpeg(executable: string, args: string[], input: Buffer, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const process = trackOwnedProcess(() => spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], signal }));
    const chunks: Buffer[] = [];
    process.stdout.on('data', (chunk: Buffer) => { if (!signal.aborted) chunks.push(Buffer.from(chunk)); });
    const cancel = () => { chunks.length = 0; };
    signal.addEventListener('abort', cancel, { once: true });
    process.once('error', () => reject(new Error('FFmpegを起動できません。')));
    process.stdin.on('error', () => {
      process.kill();
      reject(new Error('FFmpegへ音声を送信できません。'));
    });
    process.once('close', (code) => {
      signal.removeEventListener('abort', cancel);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error('FFmpegで音声を変換できません。'));
    });
    process.stdin.end(input);
  });
}
