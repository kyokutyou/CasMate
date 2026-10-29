import { describe, expect, it, vi } from 'vitest';
import { CommentSpeechController } from '../src/main/speech/comment-speech-controller';
import { createDefaultSettings } from '../src/main/core/settings';
import type { CommonComment } from '../src/shared/types';

const makeComment = (sequence: number, initialHistory = false): CommonComment => ({
  id: `youtube:${sequence}`,
  externalId: String(sequence),
  sequence,
  source: 'youtube',
  authorName: '視聴者',
  content: [{ type: 'text', text: `コメント${sequence}` }],
  receivedAt: '2026-08-24T00:00:00.000Z',
  initialHistory,
});

describe('コメント読み上げの公開状態', () => {
  it.each(['synthesis', 'recovery', 'playback'].flatMap(stage => ['off', 'sync', 'shutdown'].map(boundary => ({ stage, boundary }))))(
    '$boundary後の旧$stage失敗で復旧・警告・同期表示を再開しない', async ({ stage, boundary }) => {
    let fail!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, reject) => { fail = reject; });
    const synthesizer = fakeSynthesizer();
    if (stage === 'synthesis') synthesizer.synthesize.mockImplementationOnce(() => pending);
    else if (stage === 'recovery') {
      synthesizer.synthesize.mockRejectedValue(new Error('first failure'));
      synthesizer.prepare.mockResolvedValueOnce(undefined).mockImplementationOnce(() => pending);
    }
    const overlay = { start: vi.fn(), finish: vi.fn(), fallback: vi.fn(async () => undefined), clear: vi.fn() };
    const player = { play: vi.fn(async () => undefined), stop: vi.fn() };
    if (stage === 'playback') player.play.mockImplementationOnce(() => pending);
    const controller = new CommentSpeechController(enabledSettings(), { synthesizer, player, synchronizedOverlay: overlay }, true);
    await controller.whenReady();
    controller.accept(makeComment(1));
    if (stage === 'recovery') await vi.waitFor(() => expect(synthesizer.prepare).toHaveBeenCalledTimes(2));
    if (stage === 'playback') await vi.waitFor(() => expect(player.play).toHaveBeenCalledOnce());
    if (boundary === 'shutdown') await controller.shutdown();
    else controller.updateSettings({ ...enabledSettings(), enabled: boundary !== 'off' }, boundary !== 'sync');
    const stopped = controller.snapshot();
    fail(new Error('late failure'));
    // Finish the old promise chain without relying on whenIdle(), whose current item was cleared.
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
    expect(controller.snapshot()).toEqual(stopped);
    expect(synthesizer.synthesize).toHaveBeenCalledOnce();
    expect(synthesizer.prepare).toHaveBeenCalledTimes(stage === 'recovery' ? 2 : 1);
    expect(overlay.fallback).not.toHaveBeenCalled();
    expect(overlay.start).toHaveBeenCalledTimes(stage === 'playback' ? 1 : 0);
    expect(player.play).toHaveBeenCalledTimes(stage === 'playback' ? 1 : 0);
    await controller.shutdown();
  });

  it('復旧準備中にOFF→ONしても旧処理を再合成せず、新しいコメントだけを処理する', async () => {
    let finish!: () => void;
    const recovering = new Promise<void>(resolve => { finish = resolve; });
    const synthesizer = fakeSynthesizer();
    synthesizer.synthesize.mockRejectedValueOnce(new Error('first failure'));
    synthesizer.prepare.mockResolvedValueOnce(undefined).mockImplementationOnce(() => recovering);
    const player = { play: vi.fn(async () => undefined), stop: vi.fn() };
    const controller = new CommentSpeechController(enabledSettings(), { synthesizer, player });
    await controller.whenReady();
    controller.accept(makeComment(1));
    await vi.waitFor(() => expect(synthesizer.prepare).toHaveBeenCalledTimes(2));
    controller.updateSettings({ ...enabledSettings(), enabled: false }, false);
    controller.updateSettings(enabledSettings(), false);
    await controller.whenReady();
    controller.accept(makeComment(2));
    await controller.whenIdle();
    const calls = synthesizer.synthesize.mock.calls.length;
    finish();
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
    expect(synthesizer.synthesize).toHaveBeenCalledTimes(calls);
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.play).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'youtube:2' }));
    await controller.shutdown();
  });

  it('読み上げオフでも話者一覧の更新と試聴ができる', async () => {
    const settings = {
      ...createDefaultSettings().commentSpeech,
      enabled: false,
      voice: { speakerUuid: 'speaker', styleId: 1 },
    };
    const controller = new CommentSpeechController(settings, {
      synthesizer: fakeSynthesizer(),
      player: { play: vi.fn(async () => undefined), stop: vi.fn() },
    });

    await expect(controller.listVoices()).resolves.toHaveLength(1);
    await expect(controller.preview()).resolves.toBeUndefined();
    expect(controller.available()).toBe(false);
  });

  it('Engineが利用可能でも話者未選択なら読み上げ不能の案内を表示する', async () => {
    const player = { play: vi.fn(async () => undefined), stop: vi.fn() };
    const controller = new CommentSpeechController({
      ...createDefaultSettings().commentSpeech,
      enabled: true,
      voice: null,
    }, {
      synthesizer: fakeSynthesizer(),
      player,
    });

    await controller.whenReady();

    expect(controller.snapshot()).toMatchObject({
      engineStatus: 'ready',
      warning: '話者とスタイルを選択してください。',
    });
    controller.accept(makeComment(1));
    await controller.whenIdle();
    expect(player.play).not.toHaveBeenCalled();

    controller.updateSettings(enabledSettings(), false);
    expect(controller.snapshot().warning).toBeNull();
    controller.accept(makeComment(2));
    await controller.whenIdle();
    expect(player.play).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'youtube:2' }));
  });

  it('初回履歴を除き、新着コメントを受理順にPC再生する', async () => {
    const played: string[] = [];
    const controller = new CommentSpeechController(enabledSettings(), {
      synthesizer: fakeSynthesizer(),
      player: {
        play: async ({ commentId }) => { played.push(commentId); },
        stop: vi.fn(),
      },
    });
    await controller.whenReady();

    controller.accept(makeComment(0, true));
    controller.accept(makeComment(1));
    controller.accept(makeComment(2));
    await controller.whenIdle();

    expect(played).toEqual(['youtube:1', 'youtube:2']);
    expect(controller.snapshot()).toMatchObject({ currentCommentId: null, queueLength: 0 });
  });

  it('待ちキュー超過で最古の未読だけを破棄し、オフで再生とキューを消す', async () => {
    let finishCurrent: (() => void) | undefined;
    const player = {
      play: vi.fn(() => new Promise<void>((resolve) => { finishCurrent ??= resolve; })),
      stop: vi.fn(),
    };
    const controller = new CommentSpeechController(enabledSettings(), {
      synthesizer: fakeSynthesizer(),
      player,
    });
    await controller.whenReady();
    controller.accept(makeComment(1));
    await vi.waitFor(() => expect(controller.snapshot().currentCommentId).toBe('youtube:1'));
    for (let sequence = 2; sequence <= 12; sequence += 1) controller.accept(makeComment(sequence));

    expect(controller.snapshot()).toMatchObject({ queueLength: 10, droppedCount: 1 });
    expect(controller.queuedCommentIds()).not.toContain('youtube:2');

    controller.updateSettings({ ...enabledSettings(), enabled: false }, false);
    expect(player.stop).toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ currentCommentId: null, queueLength: 0 });
    finishCurrent?.();
  });

  it('同期1件表示は再生終了後も同じコメントを2秒間残してから閉じる', async () => {
    const events: string[] = [];
    let finishHold: (() => void) | undefined;
    const hold = vi.fn(async () => undefined);
    hold.mockImplementationOnce(() => new Promise<void>((resolve) => { finishHold = resolve; }));
    const dependencies = {
      synthesizer: {
        ...fakeSynthesizer(),
        synthesize: async () => { events.push('prepared'); return Buffer.from('wav'); },
      },
      player: {
        play: async ({ commentId }) => { events.push(`played:${commentId}`); },
        stop: vi.fn(),
      },
      synchronizedOverlay: {
        start: (comment) => { events.push(`shown:${comment.id}`); },
        finish: (commentId) => { events.push(`hidden:${commentId}`); },
        fallback: vi.fn(async () => undefined),
        clear: vi.fn(),
      },
      delay: hold,
    };
    const controller = new CommentSpeechController(enabledSettings(), dependencies, true);
    await controller.whenReady();

    controller.accept(makeComment(1));
    controller.accept(makeComment(2));
    await vi.waitFor(() => expect(hold).toHaveBeenCalledWith(2_000));

    expect(events).toEqual([
      'prepared',
      'shown:youtube:1',
      'played:youtube:1',
    ]);
    expect(controller.snapshot().currentCommentId).toBe('youtube:1');
    expect(controller.queuedCommentIds()).toEqual(['youtube:2']);

    finishHold?.();
    await controller.whenIdle();
    expect(events).toEqual([
      'prepared',
      'shown:youtube:1',
      'played:youtube:1',
      'hidden:youtube:1',
      'prepared',
      'shown:youtube:2',
      'played:youtube:2',
      'hidden:youtube:2',
    ]);
  });

  it('合成を1回だけ復旧し、2回失敗時は同期表示を通常時間へフォールバックする', async () => {
    const fallback = vi.fn(async () => undefined);
    const synthesize = vi.fn().mockRejectedValue(new Error('engine failed'));
    const controller = new CommentSpeechController(enabledSettings(), {
      synthesizer: { ...fakeSynthesizer(), synthesize },
      player: { play: vi.fn(), stop: vi.fn() },
      synchronizedOverlay: { start: vi.fn(), finish: vi.fn(), fallback, clear: vi.fn() },
    }, true);
    await controller.whenReady();

    controller.accept(makeComment(1));
    await controller.whenIdle();

    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledWith(makeComment(1));
    expect(controller.snapshot().warning).toContain('読み上げられませんでした');
  });

  it('試聴を専用プレイヤーで再生し、本番キューと同期表示を変更しない', async () => {
    const player = { play: vi.fn(async () => undefined), stop: vi.fn() };
    const previewPlayer = { play: vi.fn(async () => undefined), stop: vi.fn() };
    const overlay = { start: vi.fn(), finish: vi.fn(), fallback: vi.fn(), clear: vi.fn() };
    const controller = new CommentSpeechController(enabledSettings(), {
      synthesizer: fakeSynthesizer(),
      player,
      previewPlayer,
      synchronizedOverlay: overlay,
    }, true);
    await controller.whenReady();

    const before = controller.snapshot();
    await controller.preview();

    expect(previewPlayer.play).toHaveBeenCalledWith({
      commentId: 'preview',
      wav: Buffer.from('wav'),
    });
    expect(player.play).not.toHaveBeenCalled();
    expect(overlay.start).not.toHaveBeenCalled();
    expect(overlay.finish).not.toHaveBeenCalled();
    expect(controller.snapshot()).toEqual(before);
  });

  it('システム案内を専用IDで読み上げ、同期OBS表示へ追加しない', async () => {
    const player = { play: vi.fn(async () => undefined), stop: vi.fn() };
    const synthesize = vi.fn(async () => Buffer.from('wav'));
    const overlay = { start: vi.fn(), finish: vi.fn(), fallback: vi.fn(), clear: vi.fn() };
    const controller = new CommentSpeechController(enabledSettings(), {
      synthesizer: { ...fakeSynthesizer(), synthesize },
      player,
      synchronizedOverlay: overlay,
    }, true);
    await controller.whenReady();

    controller.acceptSystemAnnouncement('system:next:game:1:2', '新しいスレを用意しました');
    controller.acceptSystemAnnouncement('system:next:game:1:2', '新しいスレを用意しました');
    await controller.whenIdle();

    expect(synthesize).toHaveBeenCalledOnce();
    expect(synthesize).toHaveBeenCalledWith('新しいスレを用意しました', enabledSettings());
    expect(player.play).toHaveBeenCalledWith(expect.objectContaining({
      commentId: 'system:next:game:1:2',
    }));
    expect(overlay.start).not.toHaveBeenCalled();
    expect(overlay.fallback).not.toHaveBeenCalled();
  });
});

function enabledSettings() {
  return {
    ...createDefaultSettings().commentSpeech,
    enabled: true,
    voice: { speakerUuid: 'speaker', styleId: 1 },
  };
}

function fakeSynthesizer() {
  return {
    prepare: vi.fn(async () => undefined),
    listVoices: vi.fn(async () => [{
      speakerUuid: 'speaker',
      name: '話者',
      styles: [{ id: 1, name: 'ノーマル' }],
    }]),
    synthesize: vi.fn(async () => Buffer.from('wav')),
  };
}
