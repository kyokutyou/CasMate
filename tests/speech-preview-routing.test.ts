import { smartphoneView } from './fixtures/smartphone-view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication } from '../src/main/server/local-server';
import { createMobileHttpApplication } from '../src/main/server/mobile-lan-server';
import type { MobileAudioReady } from '../src/main/speech/mobile-speech-controller';

const states: AppState[] = [];
afterEach(async () => { await Promise.all(states.splice(0).map(state => state.shutdown())); });

async function setup(enabled = true) {
  const settings = createDefaultSettings();
  settings.commentSpeech.enabled = enabled;
  settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
  settings.mobileSpeech.lanEnabled = true;
  const synthesize = vi.fn(async () => Buffer.from('preview-wav'));
  const play = vi.fn(async () => undefined);
  const previewPlay = vi.fn(async () => undefined);
  const transcode = vi.fn(async (_wav: Buffer, _bitrate: number) => Buffer.from('preview-m4a'));
  const ready = vi.fn<(clientId: string, audio: MobileAudioReady) => void>();
  const state = new AppState(settings, {
    speechSynthesizer: {
      prepare: async () => undefined,
      listVoices: async () => [{ speakerUuid: 'speaker', name: '話者', styles: [{ id: 1, name: '通常' }] }],
      synthesize,
    },
    audioPlayer: { play, stop: vi.fn() },
    previewAudioPlayer: { play: previewPlay, stop: vi.fn() },
    audioTranscoder: { available: () => true, transcode },
    onMobileAudioReady: ready,
  });
  state.setSmartphoneState(smartphoneView);
  states.push(state);
  await state.listSpeechVoices();
  return { state, settings, synthesize, play, previewPlay, transcode, ready };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

describe('試聴音声のPC・スマホ配信', () => {
  it('管理APIの試聴を同じWAVからスマホへ配信し、表示・口パク・PC待ちキューへ追加しない', async () => {
    const { state, settings, synthesize, play, previewPlay, transcode, ready } = await setup();
    expect(state.startMobileSpeech('android')).toBe(true);
    const before = state.snapshot();
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    const mobile = createMobileHttpApplication({ state, port: 3000, address: '192.168.1.20' });

    const response = await request(app).post('/api/speech/preview').set({
      Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret',
    });
    expect(response.status).toBe(200);
    expect(synthesize).toHaveBeenCalledExactlyOnceWith('これはコメント読み上げのテストです', settings.commentSpeech);
    expect(previewPlay).toHaveBeenCalledExactlyOnceWith({ commentId: 'preview', wav: Buffer.from('preview-wav') });
    expect(transcode).toHaveBeenCalledExactlyOnceWith(Buffer.from('preview-wav'), 64);
    expect(ready).toHaveBeenCalledExactlyOnceWith('android', { audioId: expect.any(String), commentId: expect.stringMatching(/^preview:/), expiresInMs: expect.any(Number) });
    expect(play).not.toHaveBeenCalled();
    const after = state.snapshot();
    expect(after.comments).toEqual(before.comments);
    expect(after.commentSpeech).toEqual(before.commentSpeech);
    expect(after.commentOverlay).toEqual(before.commentOverlay);
    expect(after.character).toEqual(before.character);
    const audioId = ready.mock.calls[0][1].audioId;
    const audio = await request(mobile).get(`/mobile/audio/${audioId}.m4a`).set('Host', '192.168.1.20:3000');
    expect(audio.status).toBe(404);
    expect(state.mobileAudio(audioId)).toEqual(Buffer.from('preview-m4a'));
    expect((await request(mobile).post('/api/speech/preview').set('Host', '192.168.1.20:3000')).status).toBe(404);
    state.finishMobileAudio('android', audioId);
    expect(state.mobileAudio(audioId)).toBeNull();
  });

  it.each([true, false])('購読なしではPCだけで試聴する（読み上げオン=%s）', async enabled => {
    const { state, synthesize, previewPlay, transcode, ready } = await setup(enabled);
    if (!enabled) expect(state.startMobileSpeech('android')).toBe(false);
    await state.previewSpeech();
    expect(synthesize).toHaveBeenCalledOnce();
    expect(previewPlay).toHaveBeenCalledOnce();
    expect(transcode).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(state.snapshot().settings.commentSpeech.enabled).toBe(enabled);
  });

  it.each(['途中開始', '同じ端末の再開', '別端末への交代', '読み上げオフ'] as const)(
    '合成中の%sへ遅れた試聴を送らない', async change => {
      const { state, settings, synthesize, transcode, ready, previewPlay } = await setup();
      if (change !== '途中開始') expect(state.startMobileSpeech('android')).toBe(true);
      const synthesis = deferred<Buffer>();
      synthesize.mockReturnValueOnce(synthesis.promise);
      const preview = state.previewSpeech();
      await vi.waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
      if (change === '読み上げオフ') {
        await state.updateSettings('commentSpeech', { ...settings.commentSpeech, enabled: false });
      } else {
        state.stopMobileSpeech('android');
        expect(state.startMobileSpeech(change === '別端末への交代' ? 'browser' : 'android')).toBe(true);
      }
      synthesis.resolve(Buffer.from('late-wav'));
      await preview;
      expect(previewPlay).toHaveBeenCalledOnce();
      expect(transcode).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
    },
  );

  it('スマホ変換中でもPC試聴は完了し、停止・再開後に遅れた変換結果を送らない', async () => {
    const { state, transcode, ready, previewPlay } = await setup();
    state.startMobileSpeech('android');
    const conversion = deferred<Buffer>();
    transcode.mockReturnValueOnce(conversion.promise);
    await state.previewSpeech();
    expect(previewPlay).toHaveBeenCalledOnce();
    expect(transcode).toHaveBeenCalledOnce();
    state.stopMobileSpeech('android');
    state.startMobileSpeech('android');
    conversion.resolve(Buffer.from('late-m4a'));
    await conversion.promise;
    expect(ready).not.toHaveBeenCalled();
    expect(state.snapshot().mobileSpeech.currentCommentId).toBeNull();
  });

  it('コメントと連続試聴を別IDで順番に送り、後から変えた音声設定で試聴を再合成しない', async () => {
    const { state, settings, synthesize, ready, transcode } = await setup();
    state.startMobileSpeech('android');
    state.acceptComment({ source: 'twitch', externalId: 'first', authorName: '視聴者', content: [{ type: 'text', text: 'コメント' }], initialHistory: false });
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    synthesize.mockResolvedValueOnce(Buffer.from('preview-one')).mockResolvedValueOnce(Buffer.from('preview-two'));
    await state.previewSpeech();
    await state.previewSpeech();
    expect(state.snapshot().mobileSpeech.queueLength).toBe(2);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
    await state.updateSettings('commentSpeech', { ...settings.commentSpeech, speedScale: 1.5 });
    state.finishMobileAudio('android', ready.mock.calls[0][1].audioId);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(3));
    expect(transcode).toHaveBeenNthCalledWith(2, Buffer.from('preview-one'), 64);
    state.finishMobileAudio('android', ready.mock.calls[1][1].audioId);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(3));
    expect(transcode).toHaveBeenNthCalledWith(3, Buffer.from('preview-two'), 64);
    expect(new Set(ready.mock.calls.map(([, audio]) => audio.commentId)).size).toBe(3);
    expect(synthesize).toHaveBeenCalledTimes(3);
  });

  it('試聴も待ち上限10件を共用し、超えた最古未再生だけを破棄する', async () => {
    const { state, synthesize, transcode, ready } = await setup();
    state.startMobileSpeech('android');
    for (let i = 0; i < 12; i += 1) {
      synthesize.mockResolvedValueOnce(Buffer.from(`preview-${i}`));
      await state.previewSpeech();
    }
    expect(state.snapshot().mobileSpeech).toMatchObject({ queueLength: 10, droppedCount: 1 });
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(3));
    expect(state.mobileAudio(ready.mock.calls[1][1].audioId)).toBeNull();
    expect(transcode).toHaveBeenNthCalledWith(3, Buffer.from('preview-2'), 64);
    state.finishMobileAudio('android', ready.mock.calls[0][1].audioId);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(4));
    expect(transcode).toHaveBeenNthCalledWith(4, Buffer.from('preview-3'), 64);
    state.stopMobileSpeech('android');
    expect(state.snapshot().mobileSpeech).toMatchObject({ queueLength: 0, currentCommentId: null });
  });

  it('変換失敗でPC試聴を失敗させない', async () => {
    const { state, transcode, previewPlay, ready } = await setup();
    state.startMobileSpeech('android');
    transcode.mockRejectedValueOnce(new Error('conversion failed'));
    await expect(state.previewSpeech()).resolves.toBeUndefined();
    expect(previewPlay).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
    expect(state.snapshot().mobileSpeech.warning).toContain('FFmpeg');
  });

  it('PC再生失敗でもスマホ配信を継続する', async () => {
    const { state, previewPlay, ready } = await setup();
    state.startMobileSpeech('android');
    previewPlay.mockRejectedValueOnce(new Error('PC playback failed'));
    await expect(state.previewSpeech()).rejects.toThrow('PC playback failed');
    expect(ready).toHaveBeenCalledOnce();
  });

  it('合成失敗ではどちらも再生せず、後続の試聴は配信できる', async () => {
    const { state, synthesize, previewPlay, transcode, ready } = await setup();
    state.startMobileSpeech('android');
    synthesize.mockRejectedValueOnce(new Error('synthesis failed'));
    await expect(state.previewSpeech()).rejects.toThrow('synthesis failed');
    expect(previewPlay).not.toHaveBeenCalled();
    expect(transcode).not.toHaveBeenCalled();
    await state.previewSpeech();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
  });
});
