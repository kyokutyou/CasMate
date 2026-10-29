import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoicevoxAdapter } from '../src/main/speech/voicevox-adapter';
import { FfmpegTranscoder } from '../src/main/speech/ffmpeg-transcoder';
import { createDefaultSettings } from '../src/main/core/settings';
import { CommentSpeechController } from '../src/main/speech/comment-speech-controller';
import { MobileSpeechController } from '../src/main/speech/mobile-speech-controller';
import type { CommonComment } from '../src/shared/types';
import { createServer } from 'node:http';
import { AppState } from '../src/main/core/app-state';
import { AiController } from '../src/main/ai/ai-controller';
import { AiStore } from '../src/main/ai/ai-store';

afterEach(() => { vi.useRealTimers(); });
const settings = { ...createDefaultSettings().commentSpeech, enabled: true, voice: { speakerUuid: 'speaker', styleId: 1 } };
const comment = (sequence: number): CommonComment => ({
  id: `youtube:${sequence}`, externalId: String(sequence), sequence, source: 'youtube',
  authorName: '視聴者', content: [{ type: 'text', text: `コメント${sequence}` }],
  receivedAt: '2026-10-15T00:00:00.000Z', initialHistory: false,
});
function stalledBody() {
  const cancel = vi.fn();
  return { response: new Response(new ReadableStream({ cancel })), cancel };
}

describe('音声処理の期限と復旧', () => {
  it('アプリ終了はAIの保存待ちより先に音声要求と変換を取り消す', async () => {
    const adapter = new VoicevoxAdapter({ fetch: () => new Promise(() => undefined) });
    const transcoder = new FfmpegTranscoder('ffmpeg.exe', { exists: () => true, run: () => new Promise(() => undefined) });
    const state = new AppState(createDefaultSettings(), { speechSynthesizer: adapter, audioTranscoder: transcoder });
    const ai = new AiController(createDefaultSettings().aiListener, {
      store: new AiStore('unused-audio-shutdown-fixture', {
        isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '',
      }),
      gateway: { hasKey: () => false, account: () => null, generate: vi.fn(), post: vi.fn() },
      changed: vi.fn(), acquire: vi.fn(), release: vi.fn(), ngWords: () => [],
    });
    let finish!: () => void;
    vi.spyOn(ai, 'shutdown').mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const closeConnections = vi.fn(async () => undefined);
    state.attachAi(ai, closeConnections);
    const voiceOutcome = state.listSpeechVoices().catch((error: unknown) => error);
    const conversionOutcome = transcoder.transcode(Buffer.from('wav'), 32).catch((error: unknown) => error);
    const closing = state.shutdown();
    try {
      expect(await voiceOutcome).toBeInstanceOf(Error);
      expect(await conversionOutcome).toBeInstanceOf(Error);
      expect(closeConnections).not.toHaveBeenCalled();
    } finally {
      finish();
      await closing;
    }
    expect(closeConnections).toHaveBeenCalledOnce();
  });

  it('実HTTPの本文受信中でも終了操作で通信を切断する', async () => {
    let received = false;
    let closed = false;
    const server = createServer((_request, response) => {
      received = true;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('[');
      response.on('close', () => { closed = true; });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('テスト待受失敗');
    const adapter = new VoicevoxAdapter({ endpoint: `http://127.0.0.1:${address.port}` });
    try {
      const outcome = adapter.listVoices().catch((error: unknown) => error);
      await vi.waitFor(() => expect(received).toBe(true));
      await adapter.shutdown();
      expect(await outcome).toBeInstanceOf(Error);
      await vi.waitFor(() => expect(closed).toBe(true));
    } finally {
      await adapter.shutdown();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('不正な応答本文をエラーへ露出しない', async () => {
    const adapter = new VoicevoxAdapter({ fetch: async () => new Response('秘密の応答本文') });
    await expect(adapter.listVoices()).rejects.toThrow('VOICEVOXの応答を取得できません。');
    await adapter.shutdown();
  });

  it.each(['speakers', 'audio_query', 'synthesis'])('%sの本文停止を30秒で取り消し、次の要求は成功する', async (endpoint) => {
    vi.useFakeTimers();
    const stalled = stalledBody();
    let signal: AbortSignal | undefined;
    let fail = true;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes(`/${endpoint}`) && fail) {
        signal = init?.signal ?? undefined;
        return stalled.response;
      }
      return new Response(String(input).includes('/speakers') ? '[]' : '{}');
    });
    const adapter = new VoicevoxAdapter({ fetch: fetcher });
    const operation = endpoint === 'speakers' ? adapter.listVoices() : adapter.synthesize('本文', settings);
    const outcome = operation.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(Error);
    expect(signal?.aborted).toBe(true);
    expect(stalled.cancel).toHaveBeenCalledOnce();
    fail = false;
    if (endpoint === 'speakers') await expect(adapter.listVoices()).resolves.toEqual([]);
    else await expect(adapter.synthesize('後続', settings)).resolves.toEqual(Buffer.from('{}'));
    await adapter.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ヘッダー待ちと本文待ちに同じ期限を使用する', async () => {
    vi.useFakeTimers();
    const stalled = stalledBody();
    const adapter = new VoicevoxAdapter({ fetch: vi.fn(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(stalled.response), 20_000);
    })) });
    const outcome = adapter.listVoices().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toBeInstanceOf(Error);
    expect(stalled.cancel).toHaveBeenCalledOnce();
    await adapter.shutdown();
  });

  it('終了は中断を無視する要求の待機も解除し、遅い応答の本文を破棄する', async () => {
    let finish!: (response: Response) => void;
    const adapter = new VoicevoxAdapter({ fetch: vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })) });
    const outcome = adapter.listVoices().catch((error: unknown) => error);
    await adapter.shutdown();
    expect(await outcome).toBeInstanceOf(Error);
    const stalled = stalledBody();
    finish(stalled.response);
    await vi.waitFor(() => expect(stalled.cancel).toHaveBeenCalledOnce());
  });

  it('起動確認の本文停止も250ミリ秒で中断する', async () => {
    vi.useFakeTimers();
    const stalled = stalledBody();
    const adapter = new VoicevoxAdapter({ fetch: vi.fn(async () => stalled.response), exists: async () => false });
    const outcome = adapter.prepare().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(250);
    expect(await outcome).toBeInstanceOf(Error);
    expect(stalled.cancel).toHaveBeenCalledOnce();
    await adapter.shutdown();
  });

  it('PCは本文停止の項目を一度再試行し、二度の期限切れ後に後続を再生する', async () => {
    vi.useFakeTimers();
    const adapter = new VoicevoxAdapter({ fetch: vi.fn(async (input) => {
      if (String(input).includes('/audio_query') && new URL(String(input)).searchParams.get('text')?.includes('1')) return stalledBody().response;
      if (String(input).includes('/speakers')) return new Response('[{"speaker_uuid":"speaker","name":"話者","styles":[{"id":1,"name":"通常"}]}]');
      return new Response('{}');
    }) });
    const play = vi.fn(async () => undefined);
    const controller = new CommentSpeechController(settings, { synthesizer: adapter, player: { play, stop: vi.fn() } });
    await controller.whenReady();
    controller.accept(comment(1)); controller.accept(comment(2));
    await vi.advanceTimersByTimeAsync(60_000);
    await controller.whenIdle();
    expect(play).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'youtube:2' }));
    await adapter.shutdown();
  });

  it('変換停止は30秒で中断し、遅い結果を返さず次の変換は成功する', async () => {
    vi.useFakeTimers();
    let finish!: (audio: Buffer) => void;
    let signal!: AbortSignal;
    const run = vi.fn((_exe: string, _args: string[], _input: Buffer, value: AbortSignal) => {
      signal = value;
      return new Promise<Buffer>((resolve) => { finish = resolve; });
    }).mockResolvedValueOnce(Buffer.from('initial'));
    const transcoder = new FfmpegTranscoder('ffmpeg.exe', { exists: () => true, run });
    await transcoder.transcode(Buffer.from('wav'), 32);
    const outcome = transcoder.transcode(Buffer.from('wav'), 32).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toBeInstanceOf(Error);
    expect(signal.aborted).toBe(true);
    finish(Buffer.from('late'));
    run.mockResolvedValueOnce(Buffer.from('next'));
    await expect(transcoder.transcode(Buffer.from('wav'), 32)).resolves.toEqual(Buffer.from('next'));
    await transcoder.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('終了は中断を無視する変換の待機も直ちに解除する', async () => {
    const transcoder = new FfmpegTranscoder('ffmpeg.exe', { exists: () => true, run: () => new Promise(() => undefined) });
    const outcome = transcoder.transcode(Buffer.from('wav'), 32).catch((error: unknown) => error);
    await transcoder.shutdown();
    expect(await outcome).toBeInstanceOf(Error);
  });

  it('スマホの共有変換が停止しても後続を配信し、警告と利用不可状態を解除する', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValue(Buffer.from('m4a'));
    const transcoder = new FfmpegTranscoder('ffmpeg.exe', { exists: () => true, run });
    const ready = vi.fn();
    const availability = vi.fn();
    const controller = new MobileSpeechController(settings, { ...createDefaultSettings().mobileSpeech, lanEnabled: true }, {
      synthesizer: { prepare: async () => undefined, listVoices: async () => [], synthesize: async () => Buffer.from('wav') },
      transcoder, onAudioReady: ready, now: () => 0,
      onState: (state) => {
        availability(state.audioAvailable);
        // Browser and Android unsubscribe when this public flag becomes false.
        if (!state.audioAvailable) { controller.stop('phone1'); controller.stop('phone2'); }
      },
    });
    controller.start('phone1'); controller.start('phone2');
    controller.accept(comment(1)); controller.accept(comment(2));
    await vi.advanceTimersByTimeAsync(30_000);
    await controller.whenSettled();
    expect(run).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledTimes(2);
    expect(availability.mock.calls.every(([available]) => available === true)).toBe(true);
    for (const call of ready.mock.calls) expect(call[1]).toMatchObject({ commentId: 'youtube:2' });
    expect(controller.snapshot()).toMatchObject({ audioAvailable: true, warning: null });
    await controller.shutdown();
  });
});
