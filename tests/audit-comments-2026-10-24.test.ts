import { describe, expect, it, vi } from 'vitest';
import { parseShitarabaRaw } from '../src/main/sources/shitaraba-source';
import { buildSpeechText } from '../src/main/speech/speech-text';
import { CommentSpeechController } from '../src/main/speech/comment-speech-controller';
import { createDefaultSettings } from '../src/main/core/settings';
import type { CommonComment, VoicevoxSpeaker } from '../src/shared/types';

describe('全体調査で確認したコメント経路の回帰', () => {
  it('不正な数値文字参照のあるしたらばコメントで他の行と進捗を失わない', () => {
    const raw = [
      '1<>名前<>sage<>date<>通常コメント<>タイトル',
      '2<>名前<>sage<>date<>&#x110000;<>タイトル',
      '3<>名前<>sage<>date<>後続コメント<>タイトル',
    ].join('\n');
    const parsed = parseShitarabaRaw(raw, false, 'game:123:456');
    expect(parsed.maxResponseNumber).toBe(3);
    expect(parsed.comments.map(comment => comment.externalId)).toEqual(['game:123:456:1', 'game:123:456:3']);
  });

  it('分割された本文を空白を追加せず連結しURL全体を置換する', () => {
    const comment: CommonComment = {
      id: 'youtube:1', externalId: '1', sequence: 1, source: 'youtube', authorName: '投稿者',
      receivedAt: '2026-10-24T00:00:00.000Z', initialHistory: false,
      content: [{ type: 'text', text: '参照https://exam' }, { type: 'text', text: 'ple.com/path' }],
    };
    expect(buildSpeechText(comment, { ...createDefaultSettings().commentSpeech, readAuthor: false })).toBe('参照URL');
  });

  it('話者一覧を更新すると準備済みでもエンジンの現在の一覧を取得する', async () => {
    const original: VoicevoxSpeaker[] = [{ speakerUuid: 'one', name: '声1', styles: [{ id: 1, name: '通常' }] }];
    const updated: VoicevoxSpeaker[] = [{ speakerUuid: 'two', name: '声2', styles: [{ id: 2, name: '通常' }] }];
    const listVoices = vi.fn().mockResolvedValueOnce(original).mockResolvedValue(updated);
    const controller = new CommentSpeechController(createDefaultSettings().commentSpeech, {
      synthesizer: { prepare: async () => undefined, listVoices, synthesize: async () => Buffer.from('wav') },
      player: { play: async () => undefined, stop: () => undefined },
    });
    await expect(controller.listVoices()).resolves.toEqual(original);
    await expect(controller.listVoices()).resolves.toEqual(updated);
    await controller.shutdown();
  });

  it('一覧更新の同時要求を共有し、更新失敗後は読み上げを開始せず再更新できる', async () => {
    const voices: VoicevoxSpeaker[] = [{ speakerUuid: 'one', name: '声1', styles: [{ id: 1, name: '通常' }] }];
    let fail = false;
    const listVoices = vi.fn(async () => { if (fail) throw new Error('offline'); return voices; });
    const settings = { ...createDefaultSettings().commentSpeech, enabled: true, voice: { speakerUuid: 'one', styleId: 1 } };
    const controller = new CommentSpeechController(settings, {
      synthesizer: { prepare: async () => undefined, listVoices, synthesize: async () => Buffer.from('wav') },
      player: { play: async () => undefined, stop: () => undefined },
    });
    try {
      await controller.whenReady();
      fail = true;
      const first = controller.listVoices(); const second = controller.listVoices();
      await expect(first).rejects.toThrow('VOICEVOX'); await expect(second).rejects.toThrow('VOICEVOX');
      expect(listVoices).toHaveBeenCalledTimes(2);
      expect(controller.available()).toBe(false);
      fail = false;
      await expect(controller.listVoices()).resolves.toEqual(voices);
      expect(controller.available()).toBe(true);
    } finally { await controller.shutdown(); }
  });

  it('終了前に始めた話者更新の遅延結果を採用しない', async () => {
    let finish!: (voices: VoicevoxSpeaker[]) => void;
    const controller = new CommentSpeechController(createDefaultSettings().commentSpeech, {
      synthesizer: { prepare: async () => undefined, listVoices: () => new Promise(resolve => { finish = resolve; }), synthesize: async () => Buffer.from('wav') },
      player: { play: async () => undefined, stop: () => undefined },
    });
    const result = controller.listVoices().catch((error: unknown) => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await controller.shutdown(); finish([]);
    expect(await result).toBeInstanceOf(Error);
    expect(controller.snapshot().engineStatus).not.toBe('ready');
  });
});
