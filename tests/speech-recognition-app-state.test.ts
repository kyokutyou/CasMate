import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import type {
  SpeechRecognitionWorker,
  SpeechRecognitionWorkerEvent,
} from '../src/main/speech-recognition/speech-recognition-worker';

describe('配信者音声認識のAppState境界', () => {
  it('専用外観だけが専用イベントを更新し、コメント外観と認識セッションへ影響しない', async () => {
    const worker = fakeWorker();
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api, saveSettings: vi.fn(async () => undefined) });
    const events: string[] = [];
    const off = state.subscribe(event => events.push(event.type));
    try {
      await state.startSpeechRecognitionPreview();
      const starts = worker.start.mock.calls.length;
      const initial = state.snapshot().settings;
      await state.updateSettings('commentOverlay', { ...initial.commentOverlay, fontSizePx: 44 });
      expect(events).not.toContain('speechRecognitionOverlay.appearanceChanged');
      expect(state.snapshot().settings.speechRecognitionOverlay).toEqual(initial.speechRecognitionOverlay);
      await state.updateSettings('speechRecognitionOverlay', { ...initial.speechRecognitionOverlay, fontSizePx: 60, displayDurationSeconds: 5 });
      expect(events).toContain('speechRecognitionOverlay.appearanceChanged');
      expect(state.snapshot().settings.commentOverlay.fontSizePx).toBe(44);
      expect(worker.start).toHaveBeenCalledTimes(starts);
    } finally { off(); state.dispose(); }
  });
  it('オフで起動しても配置済みモデルを確認し、認識・取得・設定保存を開始しない', async () => {
    const worker = fakeWorker(); const save = vi.fn(async () => undefined);
    const initialize = vi.spyOn(worker.api, 'initialize').mockImplementation(async () => { worker.emit({ type: 'model', status: 'ready' }); });
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api, saveSettings: save });
    try {
      await state.startSpeechRecognitionOnLaunch();
      expect(state.snapshot().speechRecognition).toMatchObject({ modelStatus: 'ready', status: 'disabled', previewActive: false, sessionId: null });
      expect(initialize).toHaveBeenCalledOnce(); expect(worker.start).not.toHaveBeenCalled();
      expect(worker.api.prepareModel).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
      expect(state.snapshot().settings.speechRecognition.enabled).toBe(false);
    } finally { await state.shutdown(); }
  });
  it.each(['missing', 'failed'] as const)('オフ起動のモデル確認結果=%sでは自動取得や認識開始をしない', async modelStatus => {
    const worker = fakeWorker();
    vi.spyOn(worker.api, 'initialize').mockImplementation(async () => { worker.emit({ type: 'model', status: modelStatus, warning: modelStatus === 'failed' ? 'モデルを読み取れません。' : null }); });
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api });
    try {
      await state.startSpeechRecognitionOnLaunch();
      expect(state.snapshot().speechRecognition).toMatchObject({ modelStatus, status: 'disabled', warning: modelStatus === 'failed' ? 'モデルを読み取れません。' : null });
      expect(worker.api.prepareModel).not.toHaveBeenCalled(); expect(worker.start).not.toHaveBeenCalled();
    } finally { await state.shutdown(); }
  });
  it('モデル確認の通信失敗は音声認識の障害として扱い、起動処理を拒否しない', async () => {
    const worker = fakeWorker(); vi.spyOn(worker.api, 'initialize').mockRejectedValue(new Error('モデル確認の通信失敗'));
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api });
    try {
      await expect(state.startSpeechRecognitionOnLaunch()).resolves.toBeUndefined();
      expect(state.snapshot().speechRecognition).toMatchObject({ status: 'unavailable', warning: 'モデル確認の通信失敗' });
      expect(worker.start).not.toHaveBeenCalled();
    } finally { await state.shutdown(); }
  });
  it('モデルの取得失敗を通知し、再準備成功で解消して準備済みを再取得しない', async () => {
    const worker = fakeWorker();
    const prepare = vi.spyOn(worker.api, 'prepareModel').mockRejectedValueOnce(new Error('モデル取得失敗'));
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api });
    try {
      await expect(state.prepareSpeechRecognitionModel()).rejects.toThrow('モデル取得失敗');
      expect(state.snapshot().speechRecognition).toMatchObject({ modelStatus: 'failed', warning: 'モデル取得失敗', status: 'disabled' });
      await state.prepareSpeechRecognitionModel();
      expect(state.snapshot().speechRecognition).toMatchObject({ modelStatus: 'ready', warning: null, previewActive: false });
      await state.prepareSpeechRecognitionModel();
      expect(prepare).toHaveBeenCalledTimes(2); expect(worker.start).not.toHaveBeenCalled();
    } finally { await state.shutdown(); }
  });
  it('モデルだけの事前準備では本番利用・プレビュー・マイク取得を開始しない', async () => {
    const worker = fakeWorker(); const save = vi.fn(async () => undefined);
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api, saveSettings: save });
    const prepare = vi.spyOn(worker.api, 'prepareModel');
    await state.prepareSpeechRecognitionModel();
    expect(prepare).toHaveBeenCalledOnce();
    expect(worker.start).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(state.snapshot().settings.speechRecognition.enabled).toBe(false);
    expect(state.snapshot().speechRecognition.previewActive).toBe(false);
    expect(state.snapshot().speechRecognition.wavSaving).toBe(false);
    await state.shutdown();
  });
  it('保存済みオフのまま認識設定を編集してもAIの一時利用を解除しない', async () => {
    const worker = fakeWorker(); const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api });
    await state.acquireAiDependencies(); await state.updateSettings('speechRecognition', state.snapshot().settings.speechRecognition);
    expect(worker.stop).not.toHaveBeenCalled(); expect(state.snapshot().speechRecognition.status).toBe('listening');
    await state.releaseAiDependencies(); expect(worker.stop).toHaveBeenCalledOnce(); await state.shutdown();
  });
  it('AIの一時利用で保存済み設定を変更せず、プレビュー利用中ならAI停止で認識を止めない', async () => {
    const worker = fakeWorker(); const save = vi.fn(async () => undefined);
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api, saveSettings: save });
    await state.startSpeechRecognitionPreview(); await state.acquireAiDependencies();
    expect(state.snapshot().settings.speechRecognition.enabled).toBe(false); expect(save).not.toHaveBeenCalled();
    await state.releaseAiDependencies(); expect(worker.stop).not.toHaveBeenCalled();
    await state.stopSpeechRecognitionPreview(); expect(worker.stop).toHaveBeenCalledOnce(); await state.shutdown();
  });
  it('AIだけの取得は停止し、手動で引き継いだ取得はAI停止後も維持する', async () => {
    const settings = createDefaultSettings(); settings.aiListener.participants.twitch.enabled = true;
    settings.sources.twitch.channel = 'channel'; const stop = vi.fn(async () => undefined);
    const state = new AppState(settings, { speechRecognitionWorker: fakeWorker().api, sourceFactory: source => ({ source, start: async () => undefined, stop }) });
    await state.acquireAiDependencies(); expect(state.snapshot().settings.sources.twitch.enabled).toBe(false);
    await state.releaseAiDependencies(); expect(stop).toHaveBeenCalledOnce();
    await state.acquireAiDependencies(); await state.startSource('twitch'); await state.releaseAiDependencies(); expect(stop).toHaveBeenCalledOnce();
    await state.shutdown();
  });
  it('AI専用の取得を再接続しても有効設定を変更せずAI停止で終了する', async () => {
    const settings = createDefaultSettings();
    settings.aiListener.participants.twitch.enabled = true;
    settings.sources.twitch.channel = 'channel';
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const state = new AppState(settings, { speechRecognitionWorker: fakeWorker().api,
      sourceFactory: source => ({ source, start, stop }) });
    try {
      await state.acquireAiDependencies();
      await state.reconnectSource('twitch');
      expect(start).toHaveBeenCalledTimes(2);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(state.snapshot().settings.sources.twitch.enabled).toBe(false);
      await state.releaseAiDependencies();
      expect(stop).toHaveBeenCalledTimes(2);
      expect(state.snapshot().sourceStatuses.twitch.state).toBe('stopped');
    } finally { await state.shutdown(); }
  });

  it('AI停止と再接続が重なっても終了後に取得を残さない', async () => {
    const settings = createDefaultSettings(); settings.aiListener.participants.twitch.enabled = true;
    settings.sources.twitch.channel = 'channel';
    const state = new AppState(settings, { speechRecognitionWorker: fakeWorker().api,
      sourceFactory: source => ({ source, start: async () => undefined, stop: async () => undefined }) });
    try {
      await state.acquireAiDependencies();
      await Promise.all([state.reconnectSource('twitch'), state.releaseAiDependencies()]);
      expect(state.snapshot().sourceStatuses.twitch.state).toBe('stopped');
      await state.acquireAiDependencies();
      await Promise.all([state.releaseAiDependencies(), state.reconnectSource('twitch')]);
      expect(state.snapshot().sourceStatuses.twitch.state).toBe('stopped');
    } finally { await state.shutdown(); }
  });

  it.each(['individual', 'all'] as const)('再接続の停止待ち中に手動停止しても復活しない（%s）', async mode => {
    let finishStop: () => void = () => undefined;
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(() => new Promise<void>(resolve => { finishStop = resolve; }));
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: fakeWorker().api,
      sourceFactory: source => ({ source, start, stop }) });
    try {
      await state.startSource('twitch');
      const reconnect = state.reconnectSource('twitch');
      await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
      if (mode === 'all') await state.stopAllSources();
      else await state.stopSource('twitch');
      finishStop();
      await reconnect;
      expect(start).toHaveBeenCalledOnce();
      expect(state.snapshot().sourceStatuses.twitch.state).toBe('stopped');
    } finally { finishStop(); await state.shutdown(); }
  });

  it('AIだけで取得中の接続先変更後も取得を継続する', async () => {
    const settings = createDefaultSettings(); settings.aiListener.participants.twitch.enabled = true; settings.sources.twitch.channel = 'first';
    const targets: string[] = [];
    const state = new AppState(settings, { speechRecognitionWorker: fakeWorker().api, sourceFactory: (source, sources) => ({ source, start: async () => { targets.push(sources.twitch.channel); }, stop: async () => undefined }) });
    await state.acquireAiDependencies(); await state.updateSettings('sources', { ...settings.sources, twitch: { enabled: false, channel: 'second' } });
    expect(targets).toEqual(['first', 'second']); await state.shutdown();
  });
  it('本番利用とプレビューが一つの音声認識セッションを共有する', async () => {
    const worker = fakeWorker();
    const state = new AppState(createDefaultSettings(), {
      speechRecognitionWorker: worker.api,
      saveSettings: vi.fn(async () => undefined),
    });

    await state.startSpeechRecognitionPreview();
    expect(worker.start).toHaveBeenCalledOnce();
    expect(state.snapshot().speechRecognition.previewActive).toBe(true);
    worker.emit({ type: 'status', status: 'disabled', sessionId: 'old-session' });
    expect(state.snapshot().speechRecognition.status).toBe('listening');

    const settings = state.snapshot().settings.speechRecognition;
    await state.updateSettings('speechRecognition', { ...settings, enabled: true });
    expect(worker.start).toHaveBeenCalledOnce();

    await state.stopSpeechRecognitionPreview();
    expect(worker.stop).not.toHaveBeenCalled();
    await state.updateSettings('speechRecognition', { ...settings, enabled: false });
    expect(worker.stop).toHaveBeenCalledOnce();
    expect(state.snapshot().speechRecognition.status).toBe('disabled');
    state.dispose();
  });

  it('認識結果をイベント発行し、プレビュー履歴を直近50件に制限する', async () => {
    const worker = fakeWorker();
    const state = new AppState(createDefaultSettings(), {
      speechRecognitionWorker: worker.api,
    });
    const events: string[] = [];
    state.subscribe((event) => events.push(event.type));
    await state.startSpeechRecognitionPreview();

    for (let sequence = 1; sequence <= 51; sequence += 1) {
      worker.emit({
        type: 'result',
        result: {
          id: `result-${sequence}`,
          sessionId: 'session-1',
          sequence,
          recognizedAt: '2026-08-28T00:00:00.000Z',
          text: `発話${sequence}`,
          audioDurationMilliseconds: 1000,
          recognitionDurationMilliseconds: 100,
        },
      });
    }

    const history = state.snapshot().speechRecognition.previewHistory;
    expect(history).toHaveLength(50);
    expect(history[0]?.id).toBe('result-2');
    expect(history.at(-1)?.id).toBe('result-51');
    expect(events.filter((type) => type === 'speechRecognition.resultReceived')).toHaveLength(51);
    state.dispose();
  });

  it('本番オン時だけOBS音声認識表示へ結果を渡す', async () => {
    const worker = fakeWorker();
    const state = new AppState(createDefaultSettings(), {
      speechRecognitionWorker: worker.api,
      saveSettings: vi.fn(async () => undefined),
    });
    await state.startSpeechRecognitionPreview();
    worker.emit({ type: 'result', result: {
      id: 'preview', sessionId: 'session-1', sequence: 1,
      recognizedAt: '2026-08-28T00:00:00.000Z', text: 'プレビューだけ',
      audioDurationMilliseconds: 1_000, recognitionDurationMilliseconds: 100,
    } });
    expect(state.snapshot().speechRecognitionOverlay.active).toBeNull();

    const settings = state.snapshot().settings.speechRecognition;
    await state.updateSettings('speechRecognition', { ...settings, enabled: true });
    worker.emit({ type: 'result', result: {
      id: 'production', sessionId: 'session-1', sequence: 2,
      recognizedAt: '2026-08-28T00:00:01.000Z', text: '本番結果',
      audioDurationMilliseconds: 1_000, recognitionDurationMilliseconds: 100,
    } });
    expect(state.snapshot().speechRecognitionOverlay.active?.text).toBe('本番結果');

    await state.updateSettings('speechRecognition', { ...settings, enabled: false });
    expect(state.snapshot().speechRecognitionOverlay.active).toBeNull();
    state.dispose();
  });

  it('プレビューを始めるたびにWAV保存をオフへ戻し履歴を破棄する', async () => {
    const worker = fakeWorker();
    const state = new AppState(createDefaultSettings(), {
      speechRecognitionWorker: worker.api,
    });

    await state.startSpeechRecognitionPreview();
    await state.setSpeechRecognitionWavSaving(true);
    expect(state.snapshot().speechRecognition.wavSaving).toBe(true);
    worker.emit({ type: 'wavSaving', enabled: false, warning: 'WAV保存を継続できません。' });
    expect(state.snapshot().speechRecognition).toMatchObject({
      wavSaving: false,
      warning: 'WAV保存を継続できません。',
    });
    await state.stopSpeechRecognitionPreview();
    expect(state.snapshot().speechRecognition).toMatchObject({
      previewActive: false,
      wavSaving: false,
      previewHistory: [],
    });
    await state.startSpeechRecognitionPreview();
    expect(state.snapshot().speechRecognition.wavSaving).toBe(false);
    state.dispose();
  });

  it('マイク障害後の手動再試行で新しいセッションを開始する', async () => {
    const worker = fakeWorker();
    const settings = createDefaultSettings();
    settings.speechRecognition.enabled = true;
    const state = new AppState(settings, { speechRecognitionWorker: worker.api });
    await state.startSpeechRecognitionOnLaunch();
    worker.emit({ type: 'status', status: 'unavailable', warning: 'マイクを利用できません。' });

    expect(state.snapshot().speechRecognition.sessionId).toBeNull();
    await state.retrySpeechRecognition();

    expect(worker.start).toHaveBeenCalledTimes(2);
    expect(state.snapshot().speechRecognition.status).toBe('listening');
    state.dispose();
  });

  it('開始要求が応答しなくても終了処理をワーカーへ直ちに渡す', async () => {
    const worker = fakeWorker();
    worker.start.mockImplementationOnce(() => new Promise(() => undefined));
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api });
    void state.startSpeechRecognitionPreview();
    await vi.waitFor(() => expect(worker.start).toHaveBeenCalledOnce());

    await expect(state.shutdown()).resolves.toBeUndefined();

    expect(worker.api.shutdown).toHaveBeenCalledOnce();
  });
});

function fakeWorker() {
  let listener: ((event: SpeechRecognitionWorkerEvent) => void) | undefined;
  const start = vi.fn(async () => ({ sessionId: 'session-1' }));
  const stop = vi.fn(async () => undefined);
  const api: SpeechRecognitionWorker = {
    subscribe: (next) => {
      listener = next;
      return () => { listener = undefined; };
    },
    initialize: vi.fn(async () => undefined),
    listMicrophones: vi.fn(async () => [{ id: 'default', name: '既定マイク', isDefault: true }]),
    prepareModel: vi.fn(async () => undefined),
    start,
    stop,
    setWavSaving: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  };
  return { api, start, stop, emit: (event: SpeechRecognitionWorkerEvent) => listener?.(event) };
}
