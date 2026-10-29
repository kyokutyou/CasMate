import { describe, expect, it, vi } from 'vitest';
import { MobileSpeechController } from '../src/main/speech/mobile-speech-controller';
import { createDefaultSettings } from '../src/main/core/settings';
import type { CommonComment } from '../src/shared/types';

const comment = (sequence: number): CommonComment => ({
  id: `twitch:${sequence}`,
  externalId: String(sequence),
  sequence,
  source: 'twitch',
  authorName: '視聴者',
  content: [{ type: 'text', text: `コメント${sequence}` }],
  receivedAt: '2026-08-24T00:00:00.000Z',
  initialHistory: false,
});

describe('スマホ音声の独立キュー', () => {
  it('先読みの再生エラーは現在の音声を止めず次の先読みへ進む', async () => {
    const ready = vi.fn();
    const controller = controllerWithFakes(ready);
    controller.start('phone');
    for (let i = 1; i <= 3; i++) controller.accept(comment(i));
    await controller.whenSettled();
    const current = ready.mock.calls[0]![1].audioId as string;
    const prefetched = ready.mock.calls[1]![1].audioId as string;
    controller.audioEnded('phone', prefetched);
    await controller.whenSettled();
    expect(controller.audio(prefetched)).toBeNull();
    expect(controller.audio(current)).not.toBeNull();
    expect(ready.mock.calls.map(([, audio]) => audio.commentId)).toEqual(['twitch:1', 'twitch:2', 'twitch:3']);
    controller.stop('phone');
  });
  it('未再生15秒を破棄し、開始済み音声と他端末の参照を保持する', async () => {
    let now = 0;
    const ready = vi.fn();
    const discarded = vi.fn();
    const controller = controllerWithFakes(ready, undefined, { now: () => now, onAudioDiscard: discarded });
    controller.start('phone');
    controller.accept(comment(1));
    await controller.whenSettled();
    const playing = ready.mock.calls[0]![1].audioId as string;
    controller.audioStarted('phone', playing);
    controller.accept(comment(2));
    await controller.whenSettled();
    const prefetch = ready.mock.calls[1]![1].audioId as string;
    now = 15_001;
    controller.accept(comment(3));
    await controller.whenSettled();
    expect(discarded).toHaveBeenCalledWith('phone', prefetch);
    expect(controller.audio(prefetch)).toBeNull();
    expect(controller.audio(playing)).not.toBeNull();
    expect(ready.mock.calls.map(([, item]) => item.commentId)).toEqual(['twitch:1', 'twitch:2', 'twitch:3']);
    controller.audioEnded('phone', playing);
    expect(controller.snapshot().currentCommentId).toBe('twitch:3');
    controller.stop('phone');
  });

  it('LAN公開とTailscale公開が両方オフなら音声開始を拒否する', () => {
    const settings = createDefaultSettings();
    settings.commentSpeech.enabled = true;
    settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    const controller = new MobileSpeechController(settings.commentSpeech, settings.mobileSpeech, {
      synthesizer: {
        prepare: vi.fn(async () => undefined),
        listVoices: vi.fn(async () => []),
        synthesize: vi.fn(async () => Buffer.from('wav')),
      },
      transcoder: { transcode: async () => Buffer.from('m4a'), available: () => true },
    });

    expect(controller.start('phone')).toBe(false);
  });

  it('開始後の新着を複数台へ送り、同じ音声の変換を共有する', async () => {
    const ready = vi.fn();
    const transcode = vi.fn(async () => Buffer.from('m4a'));
    const controller = controllerWithFakes(ready, transcode, { now: () => 0 });
    controller.accept(comment(0));

    expect(controller.start('phone-1')).toBe(true);
    expect(controller.start('phone-2')).toBe(true);
    controller.accept(comment(1));
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(2));

    expect(ready.mock.calls[0]?.[0]).toBe('phone-1');
    expect(ready.mock.calls[0]?.[1]).toMatchObject({ commentId: 'twitch:1' });
    expect(ready.mock.calls[1]?.[0]).toBe('phone-2');
    expect(ready.mock.calls[1]?.[1]).toEqual(ready.mock.calls[0]?.[1]);
    expect(transcode).toHaveBeenCalledOnce();
    expect(transcode).toHaveBeenCalledWith(Buffer.from('wav'), 64);
    const audioId = ready.mock.calls[0]?.[1].audioId as string;
    controller.stop('phone-1');
    expect(controller.audio(audioId)).toEqual(Buffer.from('m4a'));
    controller.audioEnded('phone-1', audioId);
    expect(controller.audio(audioId)).toEqual(Buffer.from('m4a'));
    controller.audioEnded('phone-2', audioId);
    expect(controller.audio(audioId)).toBeNull();
  });

  it('遅い端末の待ち・破棄と再接続を他の端末へ波及させない', async () => {
    const ready = vi.fn();
    const controller = controllerWithFakes(ready);
    controller.start('slow');
    controller.start('fast');
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      controller.accept(comment(sequence));
      await controller.whenSettled();
      const last = ready.mock.calls.filter(([id]) => id === 'fast').at(-1)!;
      controller.audioEnded('fast', last[1].audioId as string);
    }
    expect(ready.mock.calls.filter(([id]) => id === 'fast')).toHaveLength(12);
    expect(ready.mock.calls.filter(([id]) => id === 'slow').map(([, audio]) => audio.commentId))
      .toEqual(['twitch:1', 'twitch:2', 'twitch:3']);
    expect(controller.snapshot()).toMatchObject({ queueLength: 10, droppedCount: 1 });
    controller.stop('slow');
    controller.start('slow');
    controller.accept(comment(13));
    await controller.whenSettled();
    expect(ready.mock.calls.slice(-2).map(([, audio]) => audio.commentId)).toEqual(['twitch:13', 'twitch:13']);
  });

  it('同時に受信した試聴の対象を固定し、停止後の別接続には送らない', async () => {
    const ready = vi.fn();
    const controller = controllerWithFakes(ready);
    controller.start('one');
    controller.start('two');
    const receive = controller.createPreviewReceiver()!;
    controller.stop('one');
    controller.start('one');
    controller.start('three');
    receive(Buffer.from('preview'));
    await controller.whenSettled();
    expect(ready.mock.calls.map(([id]) => id)).toEqual(['two']);
  });

  it('待ちキューを10件に制限し、停止後は音声IDを無効にする', async () => {
    let finish: ((value: Buffer) => void) | undefined;
    const ready = vi.fn();
    const controller = controllerWithFakes(ready, () => new Promise((resolve) => { finish = resolve; }));
    controller.start('phone');
    controller.accept(comment(1));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    for (let sequence = 2; sequence <= 12; sequence += 1) controller.accept(comment(sequence));

    expect(controller.snapshot()).toMatchObject({ queueLength: 10, droppedCount: 1 });
    finish?.(Buffer.from('m4a'));
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    const audioId = ready.mock.calls[0]?.[1].audioId as string;
    expect(controller.audio(audioId)).toEqual(Buffer.from('m4a'));

    controller.stop('phone');
    expect(controller.audio(audioId)).toBeNull();
    expect(controller.snapshot()).toMatchObject({ activeClient: false, queueLength: 0 });
  });

  it('FFmpeg障害をスマホ音声だけの警告として処理する', async () => {
    const controller = controllerWithFakes(vi.fn(), async () => { throw new Error('ffmpeg'); });
    controller.start('phone');
    controller.accept(comment(1));
    await controller.whenSettled();

    expect(controller.snapshot()).toMatchObject({
      currentCommentId: null,
      audioAvailable: true,
    });
    expect(controller.snapshot().warning).toContain('FFmpeg');
  });

  it('開始済みクライアントへシステム案内を専用音声項目として渡す', async () => {
    const ready = vi.fn();
    const controller = controllerWithFakes(ready);
    controller.start('phone');

    controller.acceptSystemAnnouncement('system:next:game:1:2', '新しいスレを用意しました');
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());

    expect(ready.mock.calls[0]?.[1]).toMatchObject({ commentId: 'system:next:game:1:2' });
  });

  it('Tailscale公開だけが有効でも全経路共通の音声購読を維持する', () => {
    const settings = createDefaultSettings();
    settings.commentSpeech.enabled = true;
    settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    settings.mobileSpeech.tailscaleEnabled = true;
    const controller = new MobileSpeechController(settings.commentSpeech, settings.mobileSpeech, {
      synthesizer: {
        prepare: vi.fn(async () => undefined),
        listVoices: vi.fn(async () => []),
        synthesize: vi.fn(async () => Buffer.from('wav')),
      },
      transcoder: { transcode: async () => Buffer.from('m4a'), available: () => true },
    });

    expect(controller.start('phone')).toBe(true);
    controller.updateSettings(settings.commentSpeech, settings.mobileSpeech);

    expect(controller.snapshot().activeClient).toBe(true);
  });

  it('同じスマホからの重複開始要求を状態変更として再通知しない', () => {
    const settings = createDefaultSettings();
    settings.commentSpeech.enabled = true;
    settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    settings.mobileSpeech.tailscaleEnabled = true;
    const onState = vi.fn();
    const controller = new MobileSpeechController(settings.commentSpeech, settings.mobileSpeech, {
      synthesizer: {
        prepare: vi.fn(async () => undefined),
        listVoices: vi.fn(async () => []),
        synthesize: vi.fn(async () => Buffer.from('wav')),
      },
      transcoder: { transcode: async () => Buffer.from('m4a'), available: () => true },
      onState,
    });

    expect(controller.start('phone')).toBe(true);
    expect(controller.start('phone')).toBe(true);

    expect(onState).toHaveBeenCalledTimes(1);
  });
});

function controllerWithFakes(
  onAudioReady: ReturnType<typeof vi.fn>,
  transcode: (wav: Buffer, bitrateKbps: number) => Promise<Buffer> = async () => Buffer.from('m4a'),
  options: { now?: () => number; onAudioDiscard?: (clientId: string, audioId: string) => void } = {},
) {
  const settings = createDefaultSettings();
  settings.commentSpeech.enabled = true;
  settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
  settings.mobileSpeech.lanEnabled = true;
  return new MobileSpeechController(settings.commentSpeech, settings.mobileSpeech, {
    synthesizer: {
      prepare: vi.fn(async () => undefined),
      listVoices: vi.fn(async () => []),
      synthesize: vi.fn(async () => Buffer.from('wav')),
    },
    transcoder: { transcode, available: () => true },
    onAudioReady,
    ...options,
  });
}
