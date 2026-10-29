import { smartphoneView } from './fixtures/smartphone-view';
import { describe, expect, it, vi } from 'vitest';
import { AppState, type SourceAdapterFactory } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import type { IncomingComment } from '../src/shared/types';
import { unavailableSpeechRecognitionWorker } from '../src/main/speech-recognition/speech-recognition-worker';
import { ObsControlController } from '../src/main/obs/obs-control-controller';

const comment = (externalId: string, initialHistory: boolean): IncomingComment => ({
  externalId,
  source: 'youtube',
  authorName: '視聴者',
  content: [{ type: 'text', text: externalId }],
  initialHistory,
});

describe('AppState', () => {
  it('窓状態とアプリ設定を同時保存しても互いの最新値を巻き戻さない', async () => {
    const settings = createDefaultSettings();
    const state = new AppState(settings);
    const bounds = { x: 40, y: 50, width: 800, height: 600 };
    try {
      await Promise.all([
        state.updateApplicationWindowState({ commentListWindow: bounds, commentListWindowVisible: true }),
        state.updateSettings('application', { ...settings.application, managementTheme: 'pearl', port: 4000 }),
      ]);
      expect(state.snapshot().settings.application).toMatchObject({ commentListWindow: bounds, commentListWindowVisible: true, managementTheme: 'pearl', port: 4000 });
      await Promise.all([
        state.updateSettings('application', { ...settings.application, managementTheme: 'ivory', port: 5000 }),
        state.updateApplicationWindowState({ managementWindow: bounds }),
      ]);
      expect(state.snapshot().settings.application).toMatchObject({ managementWindow: bounds, commentListWindow: bounds, commentListWindowVisible: true, managementTheme: 'ivory', port: 5000 });
    } finally { state.dispose(); }
  });

  it('音声認識ワーカーの終了失敗でもOBSと購読・履歴を解放する', async () => {
    const shutdown = vi.fn(async () => { throw new Error('worker shutdown failed'); });
    const unsubscribe = vi.fn();
    const obs = new ObsControlController({ store: { load: async () => null, save: async () => undefined } });
    const stopObs = vi.spyOn(obs, 'stop').mockResolvedValue();
    const state = new AppState(createDefaultSettings(), {
      speechRecognitionWorker: { ...unavailableSpeechRecognitionWorker, shutdown, subscribe: () => unsubscribe },
      obsControl: obs,
    });
    const events = vi.fn();
    state.subscribe(events);
    state.acceptComment(comment('before-shutdown', false));
    try {
      await expect(state.shutdown()).resolves.toBeUndefined();
      expect(shutdown).toHaveBeenCalledOnce();
      expect(stopObs).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(state.snapshot().comments).toEqual([]);
      const count = events.mock.calls.length;
      state.reportTextEffectError();
      expect(events).toHaveBeenCalledTimes(count);
    } finally { state.dispose(); }
  });

  it('再接続の停止待ち中に手動停止したソースを再開しない', async () => {
    let finishStop!: () => void;
    const stopping = new Promise<void>(resolve => { finishStop = resolve; });
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(() => stopping);
    const state = new AppState(createDefaultSettings(), {
      sourceFactory: source => ({ source, start, stop }),
    });
    try {
      await state.startSource('twitch');
      const reconnect = state.reconnectSource('twitch');
      await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
      await state.stopSource('twitch');
      finishStop();
      await reconnect;

      expect(start).toHaveBeenCalledOnce();
      expect(state.snapshot().sourceStatuses.twitch.state).toBe('stopped');
    } finally {
      finishStop();
      state.dispose();
    }
  });

  it('一つの停止処理が失敗しても残りを停止し、次の開始を受け付ける', async () => {
    const stops: string[] = [];
    const start = vi.fn(async () => undefined);
    const state = new AppState(createDefaultSettings(), {
      sourceFactory: source => ({ source, start, stop: async () => {
        stops.push(source);
        if (source === 'youtube') throw new Error('stop failed');
      } }),
    });
    try {
      await state.startSource('youtube');
      await state.startSource('twitch');
      await state.stopAllSources();
      expect(stops).toEqual(['youtube', 'twitch']);
      expect(Object.values(state.snapshot().sourceStatuses).every(status => status.state === 'stopped')).toBe(true);
      await state.startSource('youtube');
      expect(start).toHaveBeenCalledTimes(3);
    } finally { state.dispose(); }
  });

  it('微動の一時プレビューを配信し保存失敗時は保存済み値へ戻す', async () => {
    const settings = createDefaultSettings();
    settings.character.simple.closedAsset = '/assets/closed.png';
    const state = new AppState(settings, { saveSettings: async () => { throw new Error('保存失敗'); } });
    const preview = { ...settings.character.simple.motion, verticalAmplitudePercent: 2.5 };

    state.previewCharacterMotion(preview);
    expect(state.snapshot().character.motion.verticalAmplitudePercent).toBe(2.5);

    await expect(state.updateCharacterMotion(preview)).rejects.toThrow('保存失敗');
    expect(state.snapshot().character.motion.verticalAmplitudePercent).toBe(0.5);
    expect(state.snapshot().warning).toContain('微動設定を保存できませんでした');
    state.dispose();
  });

  it('微動の正式保存は直前に更新された他のキャラクター設定を維持する', async () => {
    const settings = createDefaultSettings();
    const state = new AppState(settings, { saveSettings: async () => undefined });
    const motion = { ...settings.character.simple.motion, tiltAmplitudeDegrees: 1.5 };

    await Promise.all([
      state.updateSettings('character', { ...settings.character, alwaysOnTop: false }),
      state.updateCharacterMotion(motion),
    ]);

    expect(state.snapshot().settings.character.alwaysOnTop).toBe(false);
    expect(state.snapshot().settings.character.simple.motion.tiltAmplitudeDegrees).toBe(1.5);
    state.dispose();
  });

  it('NGワードとアスキーアートに該当するコメントを全ての配信先から除外する', () => {
    const settings = createDefaultSettings();
    settings.commentFilter = { ngWords: ['禁止語'], asciiArtEnabled: true };
    settings.commentSpeech.enabled = true;
    const state = new AppState(settings);
    const eventTypes: string[] = [];
    state.subscribe((event) => eventTypes.push(event.type));

    state.acceptComment({
      ...comment('history', true),
      authorName: '禁止語を含む投稿者',
    });
    state.acceptComment({
      ...comment('new', false),
      content: [{ type: 'text', text: '  /\\_/\\\n ( o.o )\n  > ^ <' }],
    });

    expect(state.snapshot().comments).toEqual([]);
    expect(state.snapshot().commentOverlay).toEqual({ active: [], queue: [] });
    expect(state.snapshot().commentSpeech.queueLength).toBe(0);
    expect(state.snapshot().mobileSpeech.queueLength).toBe(0);
    expect(eventTypes).not.toContain('comment.received');
    state.dispose();
  });

  it('コメントフィルター設定は保存後の受信だけに適用し除外済みIDを復活させない', async () => {
    const settings = createDefaultSettings();
    const state = new AppState(settings, { saveSettings: async () => undefined });

    state.acceptComment(comment('禁止語を含む既存コメント', false));
    await state.updateSettings('commentFilter', {
      ngWords: ['禁止語'],
      asciiArtEnabled: false,
    });
    state.acceptComment(comment('禁止語を含む除外コメント', false));

    expect(state.snapshot().comments.map((item) => item.externalId)).toEqual([
      '禁止語を含む既存コメント',
    ]);

    await state.updateSettings('commentFilter', { ngWords: [], asciiArtEnabled: false });
    state.acceptComment(comment('禁止語を含む除外コメント', false));

    expect(state.snapshot().comments.map((item) => item.externalId)).toEqual([
      '禁止語を含む既存コメント',
    ]);
    state.dispose();
  });

  it('コメントフィルターで判定できない不正コメントだけを破棄して次の受信を継続する', () => {
    const state = new AppState(createDefaultSettings());
    const invalid = {
      ...comment('invalid', false),
      authorName: undefined,
    } as unknown as IncomingComment;

    expect(() => state.acceptComment(invalid)).not.toThrow();
    state.acceptComment(comment('valid', false));

    expect(state.snapshot().comments.map((item) => item.externalId)).toEqual(['valid']);
    state.dispose();
  });

  it('初回履歴は一覧だけ、新着はOBSへ伝播しキャラクターの口形を変えない', () => {
    const state = new AppState(createDefaultSettings());
    state.acceptComment(comment('history', true));
    expect(state.snapshot().comments).toHaveLength(1);
    expect(state.snapshot().commentOverlay.active).toHaveLength(0);
    expect(state.snapshot().character.mouthShape).toBe('closed');

    state.acceptComment(comment('new', false));
    expect(state.snapshot().comments).toHaveLength(2);
    expect(state.snapshot().commentOverlay.active[0]?.comment.externalId).toBe('new');
    expect(state.snapshot().character.mouthShape).toBe('closed');
    state.dispose();
  });

  it('NG判定後の重複でない新着コメントだけから文字演出を発火する', () => {
    const settings = createDefaultSettings();
    settings.commentFilter.ngWords = ['禁止'];
    const state = new AppState(settings);
    const triggers: unknown[] = [];
    state.subscribe((event) => {
      if (event.type === 'textEffects.triggered') triggers.push(event.payload);
    });

    state.acceptComment({ ...comment('history', true), content: [{ type: 'text', text: 'ww' }] });
    state.acceptComment({ ...comment('blocked', false), content: [{ type: 'text', text: '禁止ww' }] });
    state.acceptComment({ ...comment('new', false), content: [{ type: 'text', text: 'www' }] });
    state.acceptComment({ ...comment('new', false), content: [{ type: 'text', text: 'wwww' }] });

    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ items: Array(3).fill({ text: '草', color: '#66cc66ff' }) });
    state.dispose();
  });

  it('無効状態に関係なく保存済みルールを最低数でテスト再生する', () => {
    const settings = createDefaultSettings();
    settings.textEffects.enabled = false;
    settings.textEffects.rules[0].enabled = false;
    const state = new AppState(settings);
    const events: unknown[] = [];
    state.subscribe((event) => { if (event.type === 'textEffects.triggered') events.push(event.payload); });

    state.testTextEffectRule('default-grass');

    expect(events[0]).toMatchObject({ items: [{ text: '草' }, { text: '草' }] });
    expect(state.snapshot()).not.toHaveProperty('textEffects');
    state.dispose();
  });

  it('文字演出の障害を他機能から分離し管理画面の警告へ反映する', () => {
    const state = new AppState(createDefaultSettings());
    const warnings: unknown[] = [];
    state.subscribe((event) => {
      if (event.type === 'state.snapshot') warnings.push(event.payload);
    });

    state.reportTextEffectError();
    state.acceptComment(comment('after-error', false));

    expect(warnings).toHaveLength(1);
    expect(state.snapshot().warning).toContain('コメント文字演出');
    expect(state.snapshot().comments).toHaveLength(1);
    state.dispose();
  });

  it('1ソースの開始失敗が別ソースの開始を止めない', async () => {
    const starts: string[] = [];
    const factory: SourceAdapterFactory = (source) => ({
      source,
      start: async () => {
        starts.push(source);
        if (source === 'youtube') throw new Error('YouTube failure');
      },
      stop: vi.fn(),
    });
    const settings = createDefaultSettings();
    settings.sources.youtube = { enabled: true, target: 'abcdefghijk' };
    settings.sources.twitch = { enabled: true, channel: 'channel' };
    const state = new AppState(settings, { sourceFactory: factory });

    await state.startAllSources();

    expect(starts).toEqual(['youtube', 'twitch']);
    expect(state.snapshot().sourceStatuses.youtube.state).toBe('error');
    state.dispose();
  });

  it('自動接続がオンなら起動時に有効な3ソースをすべて開始する', async () => {
    const starts: string[] = [];
    const settings = createDefaultSettings();
    settings.sources.autoConnect = true;
    settings.sources.youtube = { enabled: true, target: 'abcdefghijk' };
    settings.sources.twitch = { enabled: true, channel: 'channel' };
    settings.sources.shitaraba = {
      ...settings.sources.shitaraba,
      enabled: true,
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/radio/1/2/',
      pollIntervalSeconds: 5,
    };
    const state = new AppState(settings, {
      sourceFactory: (source) => ({
        source,
        start: async () => { starts.push(source); },
        stop: vi.fn(),
      }),
    });

    await state.startSourcesOnLaunch();

    expect(starts).toEqual(['youtube', 'twitch', 'shitaraba']);
    state.dispose();
  });

  it('自動接続がオフなら起動時に有効なソースを開始しない', async () => {
    const start = vi.fn();
    const settings = createDefaultSettings();
    settings.sources.twitch = { enabled: true, channel: 'channel' };
    const state = new AppState(settings, {
      sourceFactory: (source) => ({ source, start, stop: vi.fn() }),
    });

    await state.startSourcesOnLaunch();

    expect(start).not.toHaveBeenCalled();
    state.dispose();
  });

  it('終了処理は接続中の全コメントソースを停止して一時履歴を破棄する', async () => {
    const stops: string[] = [];
    const settings = createDefaultSettings();
    settings.sources.youtube = { enabled: true, target: 'abcdefghijk' };
    settings.sources.twitch = { enabled: true, channel: 'channel' };
    settings.sources.shitaraba.enabled = true;
    settings.sources.shitaraba.threadUrl =
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/';
    const state = new AppState(settings, {
      sourceFactory: (source) => ({
        source,
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => { stops.push(source); }),
      }),
    });
    await state.startAllSources();
    state.acceptComment(comment('temporary', false));

    await state.shutdown();

    expect(stops).toHaveLength(3);
    expect(stops).toEqual(expect.arrayContaining(['youtube', 'twitch', 'shitaraba']));
    expect(state.snapshot().comments).toEqual([]);
  });

  it('設定更新は検証・保存されリビジョンを進める', async () => {
    const save = vi.fn();
    const state = new AppState(createDefaultSettings(), { saveSettings: save });
    const current = state.snapshot().settings.commentList;

    await state.updateSettings('commentList', { ...current, showSource: false });

    expect(state.snapshot().settingsRevision).toBe(2);
    expect(state.snapshot().settings.commentList.showSource).toBe(false);
    expect(save).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('並行する設定更新をバックエンドで直列化して先行変更を失わない', async () => {
    let finishFirst: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => { finishFirst = resolve; });
    const save = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined);
    const state = new AppState(createDefaultSettings(), { saveSettings: save });
    const current = state.snapshot().settings;

    const firstUpdate = state.updateSettings('commentList', {
      ...current.commentList,
      showSource: false,
    });
    const secondUpdate = state.updateSettings('character', {
      ...current.character,
      alwaysOnTop: false,
    });
    await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1); });

    finishFirst?.();
    await Promise.all([firstUpdate, secondUpdate]);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      commentList: { showSource: false },
      character: { alwaysOnTop: false },
    });
    expect(state.snapshot().settings).toMatchObject({
      commentList: { showSource: false },
      character: { alwaysOnTop: false },
    });
    state.dispose();
  });

  it('設定の永続化に失敗した場合はバックエンドの設定と制御状態を変更しない', async () => {
    const save = vi.fn().mockRejectedValue(new Error('保存できません。'));
    const state = new AppState(createDefaultSettings(), { saveSettings: save });
    const current = state.snapshot().settings.character;

    await expect(state.updateSettings('character', {
      ...current,
      alwaysOnTop: false,
    })).rejects.toThrow('保存できません。');

    expect(state.snapshot().settings.character.alwaysOnTop).toBe(true);
    expect(state.snapshot().settingsRevision).toBe(1);
    state.dispose();
  });

  it('接続先変更では変更したソースだけを再接続する', async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const settings = createDefaultSettings();
    settings.sources.youtube = { enabled: true, target: 'abcdefghijk' };
    settings.sources.twitch = { enabled: true, channel: 'channel' };
    const state = new AppState(settings, {
      sourceFactory: (source) => ({
        source,
        start: async () => { starts.push(source); },
        stop: async () => { stops.push(source); },
      }),
    });
    await state.startAllSources();

    await state.updateSettings('sources', {
      ...settings.sources,
      youtube: { ...settings.sources.youtube, target: 'lmnopqrstuv' },
    });

    expect(starts).toEqual(['youtube', 'twitch', 'youtube']);
    expect(stops).toEqual(['youtube']);
    state.dispose();
  });

  it('したらばの取得間隔変更ではしたらばだけを再接続する', async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const settings = createDefaultSettings();
    settings.sources.youtube = { enabled: true, target: 'abcdefghijk' };
    settings.sources.shitaraba = {
      ...settings.sources.shitaraba,
      enabled: true,
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/radio/1/2/',
      pollIntervalSeconds: 5,
    };
    const state = new AppState(settings, {
      sourceFactory: (source) => ({
        source,
        start: async () => { starts.push(source); },
        stop: async () => { stops.push(source); },
      }),
    });
    await state.startAllSources();

    await state.updateSettings('sources', {
      ...settings.sources,
      shitaraba: { ...settings.sources.shitaraba, pollIntervalSeconds: 12 },
    });

    expect(starts).toEqual(['youtube', 'shitaraba', 'shitaraba']);
    expect(stops).toEqual(['shitaraba']);
    state.dispose();
  });

  it('接続設定の永続化に失敗した場合は保存済み設定で接続を復元する', async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const settings = createDefaultSettings();
    settings.sources.twitch = { enabled: true, channel: 'saved-channel' };
    const state = new AppState(settings, {
      saveSettings: vi.fn().mockRejectedValue(new Error('保存できません。')),
      sourceFactory: (source) => ({
        source,
        start: async () => { starts.push(source); },
        stop: async () => { stops.push(source); },
      }),
    });
    await state.startAllSources();

    await expect(state.updateSettings('sources', {
      ...settings.sources,
      twitch: { ...settings.sources.twitch, channel: 'unsaved-channel' },
    })).rejects.toThrow('保存できません。');

    expect(state.snapshot().settings.sources.twitch.channel).toBe('saved-channel');
    expect(starts).toEqual(['twitch', 'twitch']);
    expect(stops).toEqual(['twitch']);
    state.dispose();
  });

  it('一括停止でOBS表示中コメントと待ちキューをクリアする', async () => {
    const settings = createDefaultSettings();
    settings.commentOverlay.mode = 'single';
    const state = new AppState(settings);
    state.acceptComment(comment('one', false));
    state.acceptComment(comment('two', false));
    expect(state.snapshot().commentOverlay.queue).toHaveLength(1);

    await state.stopAllSources();

    expect(state.snapshot().commentOverlay).toEqual({ active: [], queue: [] });
    state.dispose();
  });

  it('同期1件表示は音声準備完了後だけOBSへ表示し、音声終了後2秒間残す', async () => {
    let finishSynthesis: ((wav: Buffer) => void) | undefined;
    let finishPlayback: (() => void) | undefined;
    let finishHold: (() => void) | undefined;
    const speechDelay = vi.fn(() => new Promise<void>((resolve) => { finishHold = resolve; }));
    const settings = createDefaultSettings();
    settings.commentOverlay.mode = 'single';
    settings.commentSpeech.enabled = true;
    settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    const state = new AppState(settings, {
      speechSynthesizer: {
        prepare: vi.fn(async () => undefined),
        listVoices: vi.fn(async () => [{ speakerUuid: 'speaker', name: '話者', styles: [{ id: 1, name: '通常' }] }]),
        synthesize: vi.fn(() => new Promise((resolve) => { finishSynthesis = resolve; })),
      },
      audioPlayer: {
        play: vi.fn(() => new Promise<void>((resolve) => { finishPlayback = resolve; })),
        stop: vi.fn(),
      },
      speechDelay,
    });

    state.acceptComment(comment('sync', false));
    await vi.waitFor(() => expect(finishSynthesis).toBeTypeOf('function'));
    expect(state.snapshot().commentOverlay.active).toEqual([]);

    finishSynthesis?.(Buffer.from('wav'));
    await vi.waitFor(() => expect(state.snapshot().commentOverlay.active[0]?.comment.externalId).toBe('sync'));
    finishPlayback?.();
    await vi.waitFor(() => expect(speechDelay).toHaveBeenCalledWith(2_000));
    expect(state.snapshot().commentOverlay.active[0]?.comment.externalId).toBe('sync');

    finishHold?.();
    await vi.waitFor(() => expect(state.snapshot().commentOverlay.active).toEqual([]));
    state.dispose();
  });

  it('旧公開フラグだけではスマホ購読を開始せず、現行台帳の選択から有効状態を導く', async () => {
    const settings = createDefaultSettings(); settings.commentSpeech.enabled = true;
    settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    settings.mobileSpeech.lanEnabled = true; settings.mobileSpeech.tailscaleEnabled = true;
    const state = new AppState(settings, { audioTranscoder: { available: () => true, transcode: async () => Buffer.from('m4a') },
      speechSynthesizer: { prepare: async () => undefined, listVoices: async () => [{ speakerUuid: 'speaker', name: '話者', styles: [{ id: 1, name: '通常' }] }], synthesize: async () => Buffer.from('wav') } });
    await state.listSpeechVoices();
    try {
      expect(state.snapshot().settings.mobileSpeech).toMatchObject({ lanEnabled: false, tailscaleEnabled: false });
      expect(state.startMobileSpeech('phone')).toBe(false);
      await state.updateSettings('mobileSpeech', settings.mobileSpeech);
      expect(state.snapshot().settings.mobileSpeech).toMatchObject({ lanEnabled: false, tailscaleEnabled: false });
      expect(state.startMobileSpeech('phone')).toBe(false);
      state.setSmartphoneState(smartphoneView);
      expect(state.snapshot().settings.mobileSpeech).toMatchObject({ lanEnabled: true, tailscaleEnabled: false });
      expect(state.startMobileSpeech('phone')).toBe(true);
    } finally { state.dispose(); }
  });
  it('PCとスマホが同じコメント・音声設定のVOICEVOX合成結果を共有する', async () => {
    const settings = createDefaultSettings();
    settings.commentSpeech.enabled = true;
    settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    settings.mobileSpeech.lanEnabled = true;
    const synthesize = vi.fn(async () => Buffer.from('same-wav'));
    const mobileReady = vi.fn();
    const state = new AppState(settings, {
      speechSynthesizer: {
        prepare: vi.fn(async () => undefined),
        listVoices: vi.fn(async () => [{ speakerUuid: 'speaker', name: '話者', styles: [{ id: 1, name: '通常' }] }]),
        synthesize,
      },
      audioPlayer: { play: vi.fn(async () => undefined), stop: vi.fn() },
      audioTranscoder: {
        available: () => true,
        transcode: vi.fn(async (wav) => {
          expect(wav).toEqual(Buffer.from('same-wav'));
          return Buffer.from('m4a');
        }),
      },
      onMobileAudioReady: mobileReady,
    });
    await vi.waitFor(() => expect(state.snapshot().mobileSpeech.audioAvailable).toBe(true));
    state.setSmartphoneState(smartphoneView);
    expect(state.startMobileSpeech('phone')).toBe(true);

    state.acceptComment(comment('shared', false));
    await vi.waitFor(() => expect(mobileReady).toHaveBeenCalledOnce());

    expect(synthesize).toHaveBeenCalledOnce();
    state.dispose();
  });
});
