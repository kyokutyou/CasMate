import { describe, expect, it, vi } from 'vitest';
import { AppState, type SourceAdapterFactory } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import {
  incrementShitarabaTitle,
} from '../src/main/shitaraba/shitaraba-next-thread-controller';
import {
  ShitarabaWriteFailure,
  type ShitarabaWriteAdapter,
} from '../src/main/shitaraba/shitaraba-write-adapter';
import type { SourceCallbacks } from '../src/main/sources/source-adapter';

describe('したらば次スレッド作成のアプリケーション状態', () => {
  it('接続先切替後の初回レスが作成番号に達していれば旧案内の完了後に次の作成を始める', async () => {
    const settings = configuredSettings();
    Object.assign(settings.sources.shitaraba.nextThread, { createAtResponseNumber: 4, switchAtResponseNumber: 6, announceCurrentThread: true });
    const nextUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/';
    const thirdUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/999/';
    let release!: () => void;const delayed = new Promise<void>(resolve => { release = resolve; });
    const callbacks: { value?: SourceCallbacks } = {};
    const createNextThread = vi.fn().mockResolvedValueOnce({ threadUrl: nextUrl }).mockResolvedValue({ threadUrl: thirdUrl });
    const announceNextThread = vi.fn(async () => undefined);
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ createNextThread, announceNextThread,
        fetchThreadContent: vi.fn(async thread => ({ title: thread.threadId === '456' ? '配信09' : '配信10', body: '本文' })),
      }),
      shitarabaWriteDelay: vi.fn().mockReturnValueOnce(delayed).mockResolvedValue(undefined),
      saveSettings: vi.fn(async () => undefined),
      sourceFactory: (source, value, events) => {
        callbacks.value = events;
        return { source, stop: vi.fn(async () => undefined), start: vi.fn(async () => {
          if (value.shitaraba.threadUrl === nextUrl) events.onBoardProgress?.(4);
        }) };
      },
    });
    let creating: Promise<void> | undefined;
    try {
      await state.startSource('shitaraba');creating = state.createShitarabaNextThread();
      await vi.waitFor(() => expect(state.snapshot().shitarabaNextThread.status).toBe('created'));
      callbacks.value!.onBoardProgress?.(6);
      await vi.waitFor(() => expect(state.snapshot().shitarabaNextThread).toMatchObject({ status: 'monitoring', maxResponseNumber: 4 }));
      release();await creating;
      expect(createNextThread).toHaveBeenCalledTimes(2);
      expect(state.snapshot().shitarabaNextThread).toMatchObject({ status: 'created', nextThreadUrl: thirdUrl });
      expect(announceNextThread).toHaveBeenCalledTimes(2);
    } finally { release();await creating?.catch(() => undefined);await state.shutdown(); }
  });

  it('再接続の初回レスが次の切替番号にも達していれば切替完了後に保存と再接続を続ける', async () => {
    const settings = configuredSettings();
    const nextUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/';
    const thirdUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/999/';
    const callbacks: { value?: SourceCallbacks } = {};
    const saveSettings = vi.fn(async () => undefined);const createNextThread = vi.fn();
    const starts: string[] = [];
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ createNextThread,
        findThreadsByTitle: vi.fn(async thread => thread.threadId === '456' ? [nextUrl] : thread.threadId === '789' ? [thirdUrl] : []),
      }), saveSettings,
      sourceFactory: (source, value, events) => {
        callbacks.value = events;
        return { source, stop: vi.fn(async () => undefined), start: vi.fn(async () => {
          starts.push(value.shitaraba.threadUrl);
          if (value.shitaraba.threadUrl === nextUrl) events.onBoardProgress?.(1000);
        }) };
      },
    });
    try {
      await state.startSource('shitaraba');callbacks.value!.onBoardProgress?.(1000);
      await vi.waitFor(() => expect(starts).toEqual([settings.sources.shitaraba.threadUrl, nextUrl, thirdUrl]));
      expect(state.snapshot().settings.sources.shitaraba.threadUrl).toBe(thirdUrl);
      expect(saveSettings).toHaveBeenCalledTimes(2);expect(createNextThread).not.toHaveBeenCalled();
    } finally { await state.shutdown(); }
  });

  it('保存した作成開始番号を現在の最大番号まで下げると新着なしで自動作成する', async () => {
    const settings = configuredSettings();
    const callbacks: { value?: SourceCallbacks } = {};
    const createNextThread = vi.fn(async () => ({ threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/' }));
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ createNextThread }),
      saveSettings: vi.fn(async () => undefined), sourceFactory: capturingSourceFactory(callbacks),
    });
    try {
      await state.initialize();
      await state.startSource('shitaraba');
      callbacks.value!.onBoardProgress?.(900);
      expect(createNextThread).not.toHaveBeenCalled();
      const sources = structuredClone(state.snapshot().settings.sources);
      sources.shitaraba.nextThread.createAtResponseNumber = 900;
      const saved = await state.updateSettings('sources', sources);
      expect(createNextThread).toHaveBeenCalledOnce();
      expect(saved.shitarabaNextThread).toMatchObject({ status: 'created', nextThreadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/' });
    } finally { await state.shutdown(); }
  });

  it('切替番号を現在値まで下げると即時切替し最新の接続先を管理画面へ通知する', async () => {
    const settings = configuredSettings();
    const callbacks: { value?: SourceCallbacks } = {};
    const nextUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/';
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter(),
      saveSettings: vi.fn(async () => undefined), sourceFactory: capturingSourceFactory(callbacks),
    });
    const changes: Array<{ value: typeof settings.sources; settingsRevision: number }> = [];
    const unsubscribe = state.subscribe(event => {
      if (event.type !== 'settings.changed') return;
      const payload = event.payload as { section: string; value: typeof settings.sources; settingsRevision: number };
      if (payload.section === 'sources') changes.push(payload);
    });
    try {
      await state.initialize();
      await state.startSource('shitaraba');
      callbacks.value!.onBoardProgress?.(950);
      await vi.waitFor(() => expect(state.snapshot().shitarabaNextThread.status).toBe('created'));
      expect(state.snapshot().settings.sources.shitaraba.threadUrl).toBe(settings.sources.shitaraba.threadUrl);
      const sources = structuredClone(state.snapshot().settings.sources);
      sources.shitaraba.nextThread.switchAtResponseNumber = 950;
      const saved = await state.updateSettings('sources', sources);
      expect(saved.settings.sources.shitaraba.threadUrl).toBe(nextUrl);
      expect(state.snapshot().settings.sources.shitaraba.threadUrl).toBe(nextUrl);
      expect(changes.length).toBeGreaterThanOrEqual(2);
      expect(changes.at(-1)).toMatchObject({ value: saved.settings.sources, settingsRevision: saved.settingsRevision });
    } finally { unsubscribe(); await state.shutdown(); }
  });

  it.each([
    ['成功', 'created'], ['失敗', 'created'],
    ['成功', 'uncertain'], ['失敗', 'uncertain'],
    ['成功', 'browserRequired'], ['失敗', 'browserRequired'],
    ['成功', 'failed'], ['失敗', 'failed'],
  ] as const)('設定保存中に自動作成が始まっても遅れた取得%sで%sを上書きしない', async (outcome, resultStatus) => {
    const settings = configuredSettings();
    Object.assign(settings.sources.shitaraba.nextThread, {
      titleMode: 'manual', manualTitle: '送信したタイトル', bodyMode: 'manual', manualBody: '送信した本文', announceCurrentThread: false,
    });
    let finishSave!: () => void;
    let finishFind!: (urls: string[]) => void;
    let finishFetch!: (content: { title: string; body: string }) => void;
    let failFetch!: (error: Error) => void;
    const saved = new Promise<void>(resolve => { finishSave = resolve; });
    const found = new Promise<string[]>(resolve => { finishFind = resolve; });
    const fetched = new Promise<{ title: string; body: string }>((resolve, reject) => {
      finishFetch = resolve; failFetch = reject;
    });
    const saveSettings = vi.fn(() => saved);
    const findThreadsByTitle = vi.fn(async () => [] as string[]).mockResolvedValueOnce([])
      .mockImplementationOnce(() => found);
    const fetchThreadContent = vi.fn(() => fetched);
    const createNextThread = vi.fn(async () => {
      if (resultStatus !== 'created') throw new ShitarabaWriteFailure(resultStatus === 'failed' ? 'rejected' : resultStatus, '作成できませんでした');
      return { threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/' };
    });
    const callbacks: { value?: SourceCallbacks } = {};
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ findThreadsByTitle, fetchThreadContent, createNextThread }),
      saveSettings, sourceFactory: capturingSourceFactory(callbacks),
    });
    let updating: Promise<unknown> | undefined;
    try {
      await state.startSource('shitaraba');
      const sources = structuredClone(state.snapshot().settings.sources);
      sources.shitaraba.nextThread.titleMode = 'auto';
      updating = state.updateSettings('sources', sources);
      await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());
      callbacks.value!.onBoardProgress?.(950);
      await vi.waitFor(() => expect(findThreadsByTitle).toHaveBeenCalledTimes(2));
      finishSave();
      await vi.waitFor(() => expect(fetchThreadContent).toHaveBeenCalledOnce());
      finishFind([]);
      await vi.waitFor(() => expect(state.snapshot().shitarabaNextThread).toMatchObject({
        status: resultStatus, plannedTitle: '送信したタイトル', plannedBody: '送信した本文',
        nextThreadUrl: resultStatus === 'created' ? 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/' : null,
      }));
      const expected = state.snapshot().shitarabaNextThread;
      expect(createNextThread).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: '送信したタイトル', body: '送信した本文' }));
      if (outcome === '成功') finishFetch({ title: '別のタイトル09', body: '別の本文' });
      else failFetch(new Error('遅れたプレビュー取得の失敗'));
      await updating;
      expect(state.snapshot().shitarabaNextThread).toMatchObject(expected);
    } finally {
      finishSave(); finishFind([]); finishFetch({ title: '別のタイトル09', body: '別の本文' });
      await updating?.catch(() => undefined);
      await state.shutdown();
    }
  });

  it('終了後に同名確認が完了しても新しいスレッド作成を送信しない', async () => {
    let release!: (urls: string[]) => void;
    const findThreadsByTitle = vi.fn().mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise<string[]>(resolve => { release = resolve; }));
    const createNextThread = vi.fn();
    const state = new AppState(configuredSettings(), {
      shitarabaWriteAdapter: adapter({ findThreadsByTitle, createNextThread }),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    const creating = state.createShitarabaNextThread();
    const rejected = expect(creating).rejects.toThrow();
    await vi.waitFor(() => expect(findThreadsByTitle).toHaveBeenCalledTimes(2));
    await state.shutdown();
    release([]);
    await rejected;
    expect(createNextThread).not.toHaveBeenCalled();
  });

  it('終了後にURL案内の待機が完了しても投稿しない', async () => {
    const settings = configuredSettings();
    settings.sources.shitaraba.nextThread.announceCurrentThread = true;
    let release!: () => void;
    const delay = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const announceNextThread = vi.fn(async () => undefined);
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ announceNextThread }), shitarabaWriteDelay: delay,
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    const creating = state.createShitarabaNextThread();
    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    await state.shutdown();
    release();
    await creating;
    expect(announceNextThread).not.toHaveBeenCalled();
  });

  it('作成予定タイトルが1件あればPOSTせず次スレッドとして採用する', async () => {
    const existingUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/';
    const findThreadsByTitle = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingUrl]);
    const createNextThread = vi.fn();
    const saveSettings = vi.fn(async () => undefined);
    const state = new AppState(configuredSettings(), {
      shitarabaWriteAdapter: adapter({ findThreadsByTitle, createNextThread }),
      saveSettings,
    });
    await state.initialize();
    await state.createShitarabaNextThread();

    expect(findThreadsByTitle).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: '456' }),
      '配信2026 Part 010',
    );
    expect(createNextThread).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      status: 'created',
      nextThreadUrl: existingUrl,
    });
    state.dispose();
  });

  it('自動作成オフでもURL変更時に作成予定内容を更新して手動作成可能にする', async () => {
    const settings = configuredSettings();
    settings.sources.shitaraba.nextThread.enabled = false;
    const fetchThreadContent = vi.fn(async (thread) => ({
      title: thread.threadId === '456' ? '配信09' : '配信10',
      body: thread.threadId === '456' ? '本文09' : '本文10',
    }));
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ fetchThreadContent }),
      saveSettings: vi.fn(async () => undefined),
    });

    await state.initialize();
    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      status: 'manualReady',
      plannedTitle: '配信10',
      plannedBody: '本文09',
    });

    const sources = structuredClone(state.snapshot().settings.sources);
    sources.shitaraba.threadUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/';
    await state.updateSettings('sources', sources);

    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      status: 'manualReady',
      plannedTitle: '配信11',
      plannedBody: '本文10',
    });
    expect(fetchThreadContent).toHaveBeenCalledTimes(2);
    state.dispose();
  });

  it('自動作成がオフでも今すぐ作成で次スレッドを作成できる', async () => {
    const settings = configuredSettings();
    settings.sources.shitaraba.nextThread.enabled = false;
    const findThreadsByTitle = vi.fn(async () => []);
    const createNextThread = vi.fn(async () => ({
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    }));
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ findThreadsByTitle, createNextThread }),
    });
    await state.initialize();

    expect(state.snapshot().shitarabaNextThread.status).toBe('manualReady');
    await state.createShitarabaNextThread();

    expect(findThreadsByTitle).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: '456' }),
      '配信2026 Part 010',
    );
    expect(createNextThread).toHaveBeenCalledOnce();
    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      status: 'created',
      nextThreadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    });
    state.dispose();
  });

  it('自動作成オフで手動作成に失敗した後は、オンにして閾値へ到達しても自動作成しない', async () => {
    const callbacks: { value?: SourceCallbacks } = {};
    const settings = configuredSettings();
    settings.sources.shitaraba.nextThread.enabled = false;
    const createNextThread = vi.fn(async () => {
      throw new ShitarabaWriteFailure('rejected', '作成を拒否されました');
    });
    const state = new AppState(settings, {
      sourceFactory: capturingSourceFactory(callbacks),
      shitarabaWriteAdapter: adapter({ createNextThread }),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    await state.startSource('shitaraba');

    await expect(state.createShitarabaNextThread()).rejects.toThrow('作成を拒否されました');
    expect(createNextThread).toHaveBeenCalledOnce();

    await state.updateSettings('sources', {
      ...settings.sources,
      shitaraba: {
        ...settings.sources.shitaraba,
        nextThread: { ...settings.sources.shitaraba.nextThread, enabled: true },
      },
    });
    callbacks.value?.onShitarabaProgress?.(950);
    await Promise.resolve();

    expect(createNextThread).toHaveBeenCalledOnce();
    expect(state.snapshot().shitarabaNextThread.status).toBe('failed');
    state.dispose();
  });

  it('既定オフでは送信せず、オンで閾値以上の最大レス番号を初めて観測した時だけ作成する', async () => {
    const callbacks: { value?: SourceCallbacks } = {};
    const createNextThread = vi.fn(async () => ({
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    }));
    const saveSettings = vi.fn(async () => undefined);
    const settings = configuredSettings();
    settings.sources.shitaraba.nextThread.enabled = false;
    const state = new AppState(settings, {
      sourceFactory: capturingSourceFactory(callbacks),
      shitarabaWriteAdapter: adapter({ createNextThread }),
      saveSettings,
    });
    await state.initialize();
    await state.startSource('shitaraba');

    callbacks.value?.onShitarabaProgress?.(951);
    await Promise.resolve();
    expect(createNextThread).not.toHaveBeenCalled();

    await state.updateSettings('sources', {
      ...settings.sources,
      shitaraba: {
        ...settings.sources.shitaraba,
        nextThread: { ...settings.sources.shitaraba.nextThread, enabled: true },
      },
    });
    await vi.waitFor(() => expect(state.snapshot().shitarabaNextThread.status).toBe('created'));

    expect(createNextThread).toHaveBeenCalledOnce();
    expect(createNextThread).toHaveBeenCalledWith(expect.objectContaining({
      title: '配信2026 Part 010',
      body: '案内本文',
    }));
    expect(saveSettings).toHaveBeenCalledOnce();
    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      maxResponseNumber: 951,
      remainingResponses: 0,
      nextThreadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    });

    callbacks.value?.onShitarabaProgress?.(999);
    await Promise.resolve();
    expect(createNextThread).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('送信後の結果不明は自動再試行せず、未作成確認後も手動操作まで待つ', async () => {
    const callbacks: { value?: SourceCallbacks } = {};
    const createNextThread = vi.fn()
      .mockRejectedValueOnce(new ShitarabaWriteFailure('uncertain', '結果不明'))
      .mockResolvedValueOnce({ threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/790/' });
    const state = new AppState(configuredSettings(), {
      sourceFactory: capturingSourceFactory(callbacks),
      shitarabaWriteAdapter: adapter({ createNextThread }),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    await state.startSource('shitaraba');

    callbacks.value?.onShitarabaProgress?.(950);
    await vi.waitFor(() => expect(state.snapshot().shitarabaNextThread.status).toBe('uncertain'));
    callbacks.value?.onShitarabaProgress?.(960);
    await expect(state.createShitarabaNextThread()).rejects.toThrow();
    expect(createNextThread).toHaveBeenCalledOnce();

    await state.resolveShitarabaNextThread({ outcome: 'notCreated' });
    expect(state.snapshot().shitarabaNextThread.status).toBe('inputRequired');
    callbacks.value?.onShitarabaProgress?.(970);
    await Promise.resolve();
    expect(createNextThread).toHaveBeenCalledOnce();

    await state.createShitarabaNextThread();
    expect(createNextThread).toHaveBeenCalledTimes(2);
    expect(state.snapshot().shitarabaNextThread.status).toBe('created');
    state.dispose();
  });

  it('手動作成の結果不明は成功応答にせず、状態を結果不明として保持する', async () => {
    const createNextThread = vi.fn(async () => {
      throw new ShitarabaWriteFailure('uncertain', '結果不明');
    });
    const state = new AppState(configuredSettings(), {
      shitarabaWriteAdapter: adapter({ createNextThread }),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();

    await expect(state.createShitarabaNextThread()).rejects.toThrow('作成を確認できません');

    expect(state.snapshot().shitarabaNextThread.status).toBe('uncertain');
    expect(createNextThread).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('掲示板の同名確認に失敗したら送信せず自動再試行もしない', async () => {
    const callbacks: { value?: SourceCallbacks } = {};
    const createNextThread = vi.fn();
    const findThreadsByTitle = vi.fn()
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('subject.txt unavailable'));
    const settings = configuredSettings();
    const state = new AppState(settings, {
      sourceFactory: capturingSourceFactory(callbacks),
      shitarabaWriteAdapter: adapter({ createNextThread, findThreadsByTitle }),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    await state.startSource('shitaraba');

    callbacks.value?.onShitarabaProgress?.(950);
    await vi.waitFor(() => expect(state.snapshot().shitarabaNextThread.status).toBe('failed'));
    callbacks.value?.onShitarabaProgress?.(951);
    await Promise.resolve();
    await state.updateSettings('sources', {
      ...settings.sources,
      shitaraba: {
        ...settings.sources.shitaraba,
        nextThread: { ...settings.sources.shitaraba.nextThread, authorName: '確認済み' },
      },
    });
    await Promise.resolve();

    expect(findThreadsByTitle).toHaveBeenCalledTimes(2);
    expect(createNextThread).not.toHaveBeenCalled();
    expect(state.snapshot().shitarabaNextThread.status).toBe('failed');
    state.dispose();
  });

  it('入力不足を設定で直しても自動作成せず今すぐ作成を待つ', async () => {
    const callbacks: { value?: SourceCallbacks } = {};
    const createNextThread = vi.fn(async () => ({
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    }));
    const settings = configuredSettings();
    const state = new AppState(settings, {
      sourceFactory: capturingSourceFactory(callbacks),
      shitarabaWriteAdapter: adapter({
        fetchThreadContent: vi.fn(async () => {
          throw new Error('unavailable');
        }),
        createNextThread,
      }),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    await state.startSource('shitaraba');
    callbacks.value?.onShitarabaProgress?.(950);

    const sources = structuredClone(state.snapshot().settings.sources);
    sources.shitaraba.nextThread = {
      ...sources.shitaraba.nextThread,
      titleMode: 'manual',
      manualTitle: '次タイトル',
      bodyMode: 'manual',
      manualBody: '次本文',
    };
    await state.updateSettings('sources', sources);

    expect(createNextThread).not.toHaveBeenCalled();
    expect(state.snapshot().shitarabaNextThread.status).toBe('inputRequired');
    await state.createShitarabaNextThread();
    expect(createNextThread).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('作成済みで切替番号に到達するとしたらばだけを次スレッドへ再接続する', async () => {
    const callbacks: { value?: SourceCallbacks } = {};
    const starts: string[] = [];
    const stops: string[] = [];
    const state = new AppState(configuredSettings(), {
      sourceFactory: (source, _settings, sourceCallbacks) => {
        if (source === 'shitaraba') callbacks.value = sourceCallbacks;
        return {
          source,
          start: async () => { starts.push(source); },
          stop: async () => { stops.push(source); },
        };
      },
      shitarabaWriteAdapter: adapter(),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    await state.startAllSources();

    callbacks.value?.onShitarabaProgress?.(1000);
    await vi.waitFor(() => expect(
      state.snapshot().settings.sources.shitaraba.threadUrl,
    ).toBe('https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/'));

    expect(starts.filter((source) => source === 'shitaraba')).toHaveLength(2);
    expect(stops).toEqual(['shitaraba']);
    expect(starts).not.toContain('youtube');
    state.dispose();
  });

  it('次スレッドへの自動切替に成功すると移動したことを読み上げる', async () => {
    const callbacks: { value?: SourceCallbacks } = {};
    const settings = configuredSettings();
    settings.commentSpeech.enabled = true;
    settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    const synthesize = vi.fn(async () => Buffer.from('wav'));
    const play = vi.fn(async () => undefined);
    const state = new AppState(settings, {
      sourceFactory: capturingSourceFactory(callbacks),
      shitarabaWriteAdapter: adapter(),
      saveSettings: vi.fn(async () => undefined),
      speechSynthesizer: {
        prepare: vi.fn(async () => undefined),
        listVoices: vi.fn(async () => [{
          speakerUuid: 'speaker', name: '話者', styles: [{ id: 1, name: '通常' }],
        }]),
        synthesize,
      },
      audioPlayer: { play, stop: vi.fn() },
    });
    await state.initialize();
    await vi.waitFor(() => expect(state.snapshot().commentSpeech.engineStatus).toBe('ready'));
    await state.startSource('shitaraba');

    callbacks.value?.onShitarabaProgress?.(1000);

    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));
    expect(synthesize).toHaveBeenNthCalledWith(1, '新しいスレを用意しました', settings.commentSpeech);
    expect(synthesize).toHaveBeenNthCalledWith(2, '次スレに移動しました', settings.commentSpeech);
    expect(state.snapshot().settings.sources.shitaraba.threadUrl)
      .toBe('https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/');
    state.dispose();
  });

  it('後発の自動切替中に設定を更新しても新しい接続先を旧URLへ戻さない', async () => {
    const callbacks: { value?: SourceCallbacks } = {};
    let finishSwitchSave!: () => void;
    const switchSaveBlocked = new Promise<void>((resolve) => {
      finishSwitchSave = resolve;
    });
    const saveSettings = vi.fn(async () => {
      if (saveSettings.mock.calls.length === 1) await switchSaveBlocked;
    });
    const settings = configuredSettings();
    const state = new AppState(settings, {
      sourceFactory: capturingSourceFactory(callbacks),
      shitarabaWriteAdapter: adapter(),
      saveSettings,
    });
    await state.initialize();
    await state.startSource('shitaraba');
    await state.createShitarabaNextThread();

    callbacks.value?.onShitarabaProgress?.(1000);
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());
    const settingsUpdate = state.updateSettings('sources', {
      ...settings.sources,
      shitaraba: {
        ...settings.sources.shitaraba,
        nextThread: { ...settings.sources.shitaraba.nextThread, createAtResponseNumber: 900 },
      },
    });
    finishSwitchSave();
    await settingsUpdate;

    expect(state.snapshot().settings.sources.shitaraba.threadUrl)
      .toBe('https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/');
    state.dispose();
  });

  it('同名タイトルが複数ある結果不明には同じ掲示板の別スレッドURLだけ登録できる', async () => {
    const createNextThread = vi.fn();
    const state = new AppState(configuredSettings(), {
      shitarabaWriteAdapter: adapter({
        findThreadsByTitle: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
            'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/790/',
          ]),
        createNextThread,
      }),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    await expect(state.createShitarabaNextThread()).rejects.toThrow('複数');
    expect(createNextThread).not.toHaveBeenCalled();

    await expect(state.resolveShitarabaNextThread({
      outcome: 'created',
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/999/789/',
    })).rejects.toThrow();
    await expect(state.resolveShitarabaNextThread({
      outcome: 'created',
      threadUrl: 'http://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    })).rejects.toThrow();
    await state.resolveShitarabaNextThread({
      outcome: 'created',
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    });

    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      status: 'created',
      nextThreadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    });
    state.dispose();
  });

  it('URLを変更して元へ戻した場合は掲示板を再確認して同名スレッドを採用する', async () => {
    let originalCreated = false;
    const createNextThread = vi.fn(async () => {
      originalCreated = true;
      return {
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
      };
    });
    const findThreadsByTitle = vi.fn(async (
      thread: Parameters<ShitarabaWriteAdapter['findThreadsByTitle']>[0],
    ) => (
      thread.threadId === '456' && originalCreated
        ? ['https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/']
        : []
    ));
    const settings = configuredSettings();
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ createNextThread, findThreadsByTitle }),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    await state.createShitarabaNextThread();

    const otherSources = structuredClone(state.snapshot().settings.sources);
    otherSources.shitaraba.threadUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/999/';
    await state.updateSettings('sources', otherSources);
    expect(state.snapshot().shitarabaNextThread.status).toBe('monitoring');
    await state.createShitarabaNextThread();

    const originalSources = structuredClone(state.snapshot().settings.sources);
    originalSources.shitaraba.threadUrl = settings.sources.shitaraba.threadUrl;
    await state.updateSettings('sources', originalSources);

    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      status: 'created',
      nextThreadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    });
    expect(createNextThread).toHaveBeenCalledTimes(2);
    state.dispose();
  });

  it('再起動後は作成済み状態を復元せず掲示板の同名スレッドを採用する', async () => {
    const existingUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/';
    const firstSave = vi.fn(async () => undefined);
    const first = new AppState(configuredSettings(), {
      shitarabaWriteAdapter: adapter(),
      saveSettings: firstSave,
    });
    await first.initialize();
    await first.createShitarabaNextThread();
    expect(firstSave).not.toHaveBeenCalled();
    first.dispose();

    const createNextThread = vi.fn();
    const announceNextThread = vi.fn(async () => undefined);
    const restartedSettings = configuredSettings();
    restartedSettings.sources.shitaraba.nextThread.announceCurrentThread = true;
    const restarted = new AppState(restartedSettings, {
      shitarabaWriteAdapter: adapter({
        findThreadsByTitle: vi.fn(async () => [existingUrl]),
        createNextThread,
        announceNextThread,
      }),
      shitarabaWriteDelay: vi.fn(async () => undefined),
    });
    await restarted.initialize();
    expect(createNextThread).not.toHaveBeenCalled();
    expect(announceNextThread).not.toHaveBeenCalled();
    expect(restarted.snapshot().shitarabaNextThread).toMatchObject({
      status: 'created',
      nextThreadUrl: existingUrl,
    });
    restarted.dispose();
  });

  it('送信結果不明後の再確認で同名タイトルが1件なら作成成功として扱う', async () => {
    const existingUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/';
    const findThreadsByTitle = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingUrl]);
    const createNextThread = vi.fn(async () => {
      throw new ShitarabaWriteFailure('uncertain', '応答を確認できません');
    });
    const state = new AppState(configuredSettings(), {
      shitarabaWriteAdapter: adapter({ findThreadsByTitle, createNextThread }),
    });
    await state.initialize();

    await expect(state.createShitarabaNextThread()).resolves.toBeUndefined();

    expect(findThreadsByTitle).toHaveBeenCalledTimes(3);
    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      status: 'created',
      nextThreadUrl: existingUrl,
    });
    state.dispose();
  });

  it('作成成功から5秒待ってURLを案内し、案内失敗でも作成成功状態を保つ', async () => {
    const settings = configuredSettings();
    settings.sources.shitaraba.nextThread = {
      ...settings.sources.shitaraba.nextThread,
      titleMode: 'manual',
      manualTitle: '次タイトル',
      bodyMode: 'manual',
      manualBody: '次本文',
      announceCurrentThread: true,
      authorName: '配信者',
      email: 'sage',
    };
    const order: string[] = [];
    const createNextThread = vi.fn(async () => {
      order.push('create');
      return {
        threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
      };
    });
    const shitarabaWriteDelay = vi.fn(async (milliseconds: number) => {
      order.push(`delay:${milliseconds}`);
    });
    const announceNextThread = vi.fn(async () => {
      order.push('announce');
      throw new ShitarabaWriteFailure('rejected', '案内失敗');
    });
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ createNextThread, announceNextThread }),
      shitarabaWriteDelay,
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();

    await state.createShitarabaNextThread();

    expect(createNextThread).toHaveBeenCalledWith(expect.objectContaining({
      authorName: '配信者',
      email: 'sage',
    }));
    expect(announceNextThread).toHaveBeenCalledWith(expect.objectContaining({
      message: '次スレッドはこちらです。\nhttps://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
      authorName: '配信者',
      email: 'sage',
    }));
    expect(shitarabaWriteDelay).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(order).toEqual(['create', 'delay:5000', 'announce']);
    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      status: 'created',
      nextThreadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
      message: expect.stringContaining('URL'),
    });
    state.dispose();
  });

  it('URL案内の5秒待機中でも到達済みの接続先切替を待たせない', async () => {
    const callbacks: { value?: SourceCallbacks } = {};
    const settings = configuredSettings();
    settings.sources.shitaraba.nextThread.announceCurrentThread = true;
    let releaseDelay!: () => void;
    const delay = new Promise<void>((resolve) => {
      releaseDelay = resolve;
    });
    const announceNextThread = vi.fn(async () => undefined);
    const state = new AppState(settings, {
      sourceFactory: capturingSourceFactory(callbacks),
      shitarabaWriteAdapter: adapter({ announceNextThread }),
      shitarabaWriteDelay: vi.fn(async () => delay),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.initialize();
    await state.startSource('shitaraba');

    callbacks.value?.onShitarabaProgress?.(1000);

    await vi.waitFor(() => expect(
      state.snapshot().settings.sources.shitaraba.threadUrl,
    ).toBe('https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/'));
    expect(announceNextThread).not.toHaveBeenCalled();

    releaseDelay();
    await vi.waitFor(() => expect(announceNextThread).toHaveBeenCalledOnce());
    state.dispose();
  });

  it('作成成功のシステム案内を読み上げるが、共通コメントとキャラクター反応に追加しない', async () => {
    const settings = configuredSettings();
    settings.sources.shitaraba.nextThread = {
      ...settings.sources.shitaraba.nextThread,
      titleMode: 'manual',
      manualTitle: '次タイトル',
      bodyMode: 'manual',
      manualBody: '次本文',
    };
    settings.commentSpeech.enabled = true;
    settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    const synthesize = vi.fn(async () => Buffer.from('wav'));
    const play = vi.fn(async () => undefined);
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter(),
      saveSettings: vi.fn(async () => undefined),
      speechSynthesizer: {
        prepare: vi.fn(async () => undefined),
        listVoices: vi.fn(async () => [{
          speakerUuid: 'speaker', name: '話者', styles: [{ id: 1, name: '通常' }],
        }]),
        synthesize,
      },
      audioPlayer: { play, stop: vi.fn() },
    });
    await state.initialize();
    await vi.waitFor(() => expect(state.snapshot().commentSpeech.engineStatus).toBe('ready'));

    await state.createShitarabaNextThread();
    await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());

    expect(synthesize).toHaveBeenCalledWith('新しいスレを用意しました', settings.commentSpeech);
    expect(state.snapshot().comments).toEqual([]);
    expect(state.snapshot().commentOverlay).toEqual({ active: [], queue: [] });
    expect(state.snapshot().character.mouthShape).toBe('closed');
    state.dispose();
  });

  it('次スレッド設定だけの変更でしたらば取得を再接続しない', async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const settings = configuredSettings();
    const state = new AppState(settings, {
      sourceFactory: (source) => ({
        source,
        start: async () => { starts.push(source); },
        stop: async () => { stops.push(source); },
      }),
      shitarabaWriteAdapter: adapter(),
      saveSettings: vi.fn(async () => undefined),
    });
    await state.startSource('shitaraba');

    await state.updateSettings('sources', {
      ...settings.sources,
      shitaraba: {
        ...settings.sources.shitaraba,
        nextThread: {
          ...settings.sources.shitaraba.nextThread,
          createAtResponseNumber: 900,
        },
      },
    });

    expect(starts).toEqual(['shitaraba']);
    expect(stops).toEqual([]);
    state.dispose();
  });

  it('設定保存中に次スレッドを作成しても追加の設定保存を行わない', async () => {
    let releaseFirstSave!: () => void;
    const firstSaveBlocked = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const savedSettings: ReturnType<typeof configuredSettings>[] = [];
    const saveSettings = vi.fn(async (settings) => {
      savedSettings.push(structuredClone(settings));
      if (savedSettings.length === 1) await firstSaveBlocked;
    });
    const settings = configuredSettings();
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter(),
      saveSettings,
    });
    await state.initialize();

    const settingsUpdate = state.updateSettings('application', {
      ...settings.application,
      port: settings.application.port + 1,
    });
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());
    const creation = state.createShitarabaNextThread();
    releaseFirstSave();
    await Promise.all([settingsUpdate, creation]);

    expect(savedSettings).toHaveLength(1);
    expect(savedSettings[0]!.application.port).toBe(settings.application.port + 1);
    state.dispose();
  });

  it('作成後に接続先を変更すると旧URLの一時状態を破棄する', async () => {
    let finishCreation!: () => void;
    const creationBlocked = new Promise<void>((resolve) => {
      finishCreation = resolve;
    });
    const createNextThread = vi.fn(async () => {
      await creationBlocked;
      return { threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/' };
    });
    const saveSettings = vi.fn(async () => undefined);
    const settings = configuredSettings();
    const state = new AppState(settings, {
      shitarabaWriteAdapter: adapter({ createNextThread }),
      saveSettings,
    });
    await state.initialize();

    const creation = state.createShitarabaNextThread();
    await vi.waitFor(() => expect(createNextThread).toHaveBeenCalledOnce());
    const settingsUpdate = state.updateSettings('sources', {
      ...settings.sources,
      shitaraba: {
        ...settings.sources.shitaraba,
        threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/999/',
      },
    });
    finishCreation();
    await Promise.all([creation, settingsUpdate]);

    expect(state.snapshot().settings.sources.shitaraba.threadUrl)
      .toBe('https://jbbs.shitaraba.net/bbs/read.cgi/game/123/999/');
    expect(state.snapshot().shitarabaNextThread).toMatchObject({
      status: 'monitoring',
      nextThreadUrl: null,
    });
    expect(saveSettings).toHaveBeenCalledOnce();
    state.dispose();
  });
});

describe('次スレッドタイトルの自動生成', () => {
  it.each([
    ['配信2026 Part 009', '配信2026 Part 010'],
    ['配信０９', '配信１０'],
    ['配信99', '配信100'],
  ])('%s の最後の数字列だけを増やす', (title, expected) => {
    expect(incrementShitarabaTitle(title)).toBe(expected);
  });

  it.each(['', '数字なし', '配信1２'])('%j を自動生成できないと判定する', (title) => {
    expect(incrementShitarabaTitle(title)).toBeNull();
  });
});

function configuredSettings() {
  const settings = createDefaultSettings();
  settings.sources.shitaraba = {
    ...settings.sources.shitaraba,
    enabled: true,
    threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/',
    nextThread: {
      ...settings.sources.shitaraba.nextThread,
      enabled: true,
      createAtResponseNumber: 950,
      switchAtResponseNumber: 1000,
    },
  };
  return settings;
}

function adapter(overrides: Partial<ShitarabaWriteAdapter> = {}): ShitarabaWriteAdapter {
  return {
    fetchThreadContent: vi.fn(async () => ({ title: '配信2026 Part 009', body: '案内本文' })),
    findThreadsByTitle: vi.fn(async () => []),
    createNextThread: vi.fn(async () => ({
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    })),
    announceNextThread: vi.fn(async () => undefined),
    ...overrides,
  };
}

function capturingSourceFactory(target: { value?: SourceCallbacks }): SourceAdapterFactory {
  return (source, _settings, callbacks) => {
    if (source === 'shitaraba') target.value = callbacks;
    return { source, start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
  };
}
