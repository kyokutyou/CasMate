import { describe, expect, it, vi } from 'vitest';
import { FfmpegTranscoder } from '../src/main/speech/ffmpeg-transcoder';
import type { AudioTranscoder } from '../src/main/speech/mobile-speech-controller';
import { ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: vi.fn(),
}));

describe('FFmpeg AAC-LC・M4A変換境界', () => {
  it('変換期限で所有プロセスを中断し、遅れて届く出力を使用しない', async () => {
    vi.useFakeTimers();
    try {
      const process = new ChildProcess();
      const stdout = new PassThrough();
      Object.assign(process, { stdin: new PassThrough(), stdout });
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
      vi.mocked(spawn).mockImplementationOnce((_exe, _args, options) => {
        options?.signal?.addEventListener('abort', () => { kill(); });
        return process;
      });
      const transcoder = new FfmpegTranscoder('C:\\app\\ffmpeg.exe', { exists: () => true });
      const outcome = transcoder.transcode(Buffer.from('wav'), 32).catch((error: unknown) => error);
      stdout.write(Buffer.from('partial'));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await outcome).toBeInstanceOf(Error);
      expect(kill).toHaveBeenCalledOnce();
      stdout.write(Buffer.from('late'));
      process.emit('close', 0);
      await transcoder.shutdown();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('FFmpegが入力パイプを閉じても例外を外へ漏らさず所有プロセスを停止する', async () => {
    const process = new ChildProcess();
    const stdin = new PassThrough();
    Object.assign(process, { stdin, stdout: new PassThrough() });
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    vi.mocked(spawn).mockReturnValueOnce(process);
    const transcoder = new FfmpegTranscoder('C:\\app\\ffmpeg.exe', { exists: () => true });
    const converting = transcoder.transcode(Buffer.from('wav'), 32);
    const result = converting.catch((error: unknown) => error);
    expect(() => stdin.emit('error', new Error('EPIPE'))).not.toThrow();
    expect(await result).toBeInstanceOf(Error);
    expect(kill).toHaveBeenCalledOnce();
    await transcoder.shutdown();
  });

  it('終了時に進行中の変換を取り消し、終了後の変換を開始しない', async () => {
    let finish!: (value: Buffer) => void;
    let aborted = false;
    const run = vi.fn((_executable: string, _args: string[], _input: Buffer, signal?: AbortSignal) =>
      new Promise<Buffer>((resolve) => {
        finish = resolve;
        signal?.addEventListener('abort', () => { aborted = true; });
      }));
    const transcoder = new FfmpegTranscoder('C:\\app\\ffmpeg.exe', { run, exists: () => true });
    const converting = transcoder.transcode(Buffer.from('wav'), 32);
    await (transcoder as AudioTranscoder).shutdown?.();
    finish(Buffer.from('late audio'));
    expect(aborted).toBe(true);
    await expect(converting).rejects.toThrow();
    await expect(transcoder.transcode(Buffer.from('wav'), 32)).rejects.toThrow();
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([16, 32, 128])('%i kbpsをネイティブAAC・モノラル・M4Aとして渡す', async (bitrate) => {
    const run = vi.fn(async () => Buffer.from('m4a'));
    const transcoder = new FfmpegTranscoder('C:\\app\\ffmpeg.exe', { run, exists: () => true });

    expect(await transcoder.transcode(Buffer.from('wav'), bitrate)).toEqual(Buffer.from('m4a'));
    expect(run).toHaveBeenCalledWith(
      'C:\\app\\ffmpeg.exe',
      expect.arrayContaining(['-ac', '1', '-c:a', 'aac', '-b:a', `${bitrate}k`, '-f', 'mp4']),
      Buffer.from('wav'),
      expect.any(AbortSignal),
    );
    expect(run.mock.calls[0]?.[1]).not.toContain('libfdk_aac');
  });
});
