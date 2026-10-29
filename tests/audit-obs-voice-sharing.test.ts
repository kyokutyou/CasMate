import { expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import { defaultObsControlSettings } from '../src/main/obs/obs-control-store';
import type { SpeechRecognitionWorkerEvent, SpeechRecognitionWorker } from '../src/main/speech-recognition/speech-recognition-worker';
import type { ObsWebsocketConnection } from '../src/main/obs/obs-websocket-client';

it.each([true, false])('配信利用=%sで共有認識のOBS音声操作を判定する', async enabled => {
  let listener: ((event: SpeechRecognitionWorkerEvent) => void) | undefined;
  const worker: SpeechRecognitionWorker = {
    subscribe: next => { listener = next; return () => { listener = undefined; }; },
    initialize: async () => undefined, listMicrophones: async () => [], prepareModel: async () => undefined,
    start: async () => ({ sessionId: 's1' }), stop: async () => undefined,
    setWavSaving: async () => undefined, retry: async () => undefined, shutdown: async () => undefined,
  };
  const connection: ObsWebsocketConnection = {
    request: vi.fn(async () => ({ requestStatus: { result: true, code: 100 } })),
    getStreamStatus: async () => ({ outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' }),
    startStream: vi.fn(async () => ({ requestStatus: { result: true, code: 100 } })),
    stopStream: vi.fn(async () => ({ requestStatus: { result: true, code: 100 } })),
    subscribe: () => () => undefined, onDisconnect: () => () => undefined, close: async () => undefined,
  };
  const obs = new ObsControlController({
    store: { resetNotice: null, load: async () => ({ version: 1, settings: { ...defaultObsControlSettings(), enabled: true, voiceEnabled: true, password: 'secret' }, registration: null }), save: async () => undefined },
    transport: { connect: async () => connection },
  });
  const settings = createDefaultSettings(); settings.speechRecognition.enabled = enabled;
  const app = new AppState(settings, { speechRecognitionWorker: worker, obsControl: obs });
  try {
    await obs.start(); await obs.retry();
    if (enabled) await app.startSpeechRecognitionPreview();
    else await app.acquireAiDependencies();
    listener?.({ type: 'result', result: { id: 'r1', sessionId: 's1', sequence: 1, text: 'きゃすメイト、配信開始', recognizedAt: new Date().toISOString(), audioDurationMilliseconds: 100, recognitionDurationMilliseconds: 10 } });
    expect(obs.view().confirmation !== null).toBe(enabled);
  } finally { await app.shutdown(); await obs.stop(); }
});

async function sharingBoundary() {
  let listener: ((event: SpeechRecognitionWorkerEvent) => void) | undefined;
  let sessionNumber = 0;
  let voiceCapturePeriodId = 'initial-period';
  let boundaryWait: Promise<void> | undefined;
  const setVoiceCapturePeriod = vi.fn(async (id: string) => { await boundaryWait; voiceCapturePeriodId = id; });
  const start = vi.fn(async () => ({ sessionId: `session-${++sessionNumber}` }));
  const worker: SpeechRecognitionWorker = {
    subscribe: next => { listener = next; return () => { listener = undefined; }; },
    initialize: async () => undefined, listMicrophones: async () => [], prepareModel: async () => undefined,
    start, stop: async () => undefined, setWavSaving: async () => undefined, setVoiceCapturePeriod,
    retry: async () => undefined, shutdown: async () => undefined,
  };
  const connection: ObsWebsocketConnection = {
    request: async () => ({ requestStatus: { result: true, code: 100 } }),
    getStreamStatus: async () => ({ outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' }),
    startStream: vi.fn(async () => ({ requestStatus: { result: true, code: 100 } })),
    stopStream: vi.fn(async () => ({ requestStatus: { result: true, code: 100 } })),
    subscribe: () => () => undefined, onDisconnect: () => () => undefined, close: async () => undefined,
  };
  const obs = new ObsControlController({
    store: { resetNotice: null, load: async () => ({ version: 1, settings: { ...defaultObsControlSettings(), enabled: true, voiceEnabled: true, password: 'secret' }, registration: null }), save: async () => undefined },
    transport: { connect: async () => connection }, onState: value => app?.setObsControlState(value),
  });
  const settings = createDefaultSettings(); settings.speechRecognition.enabled = true;
  const app = new AppState(settings, { speechRecognitionWorker: worker, obsControl: obs });
  await obs.start(); await obs.retry(); await app.startSpeechRecognitionPreview();
  const emit = (id: string, text = 'きゃすメイト、配信開始', sequence = 1, period = 'initial-period') => listener?.({ type: 'result', result: {
    id, sessionId: 'session-1', capturePeriodId: 'same-audio', voiceCapturePeriodId: period, sequence, text, recognizedAt: new Date().toISOString(), audioDurationMilliseconds: 100, recognitionDurationMilliseconds: 10,
  } });
  return { app, obs, emit, start, setVoiceCapturePeriod, currentPeriod: () => voiceCapturePeriodId,
    holdBoundary: (wait: Promise<void>) => { boundaryWait = wait; },
    listening: () => listener?.({ type: 'status', status: 'listening', sessionId: 'session-1' }) };
}

it('プレビューを共有しても配信利用OFFで未送信の音声確認を取り消す', async () => {
  const { app, obs, emit } = await sharingBoundary();
  try {
    emit('before-off'); expect(obs.view().confirmation?.source).toBe('voice');
    await app.updateSettings('speechRecognition', { ...app.snapshot().settings.speechRecognition, enabled: false });
    expect(app.snapshot().speechRecognition.previewActive).toBe(true);
    expect(obs.view().confirmation).toBeNull();
  } finally { await app.shutdown(); await obs.stop(); }
});

it('同じプレビューで配信利用を再有効化しても旧取得期間の遅延発話を使わずセッションを継続する', async () => {
  const { app, obs, emit, start, currentPeriod } = await sharingBoundary();
  try {
    await app.updateSettings('speechRecognition', { ...app.snapshot().settings.speechRecognition, enabled: false });
    await app.updateSettings('speechRecognition', { ...app.snapshot().settings.speechRecognition, enabled: true });
    emit('late-before-enable');
    expect(obs.view().confirmation).toBeNull();
    expect(start).toHaveBeenCalledOnce();
    emit('after-enable', 'きゃすメイト、配信開始', 2, currentPeriod());
    expect(obs.view().confirmation?.source).toBe('voice');
  } finally { await app.shutdown(); await obs.stop(); }
});

it('取得期間の更新待ち中は旧listeningと旧発話を受けてもOBS確認を開始しない', async () => {
  const { app, obs, emit, start, holdBoundary, setVoiceCapturePeriod, listening } = await sharingBoundary();
  let finish!: () => void;
  try {
    await app.setSpeechRecognitionEnabled(false);
    holdBoundary(new Promise<void>(resolve => { finish = resolve; }));
    const saving = app.setSpeechRecognitionEnabled(true);
    await vi.waitFor(() => expect(setVoiceCapturePeriod).toHaveBeenCalledOnce());
    listening(); emit('late-during-enable');
    expect(obs.view().confirmation).toBeNull();
    finish(); await saving;
    expect(start).toHaveBeenCalledOnce();
  } finally { finish?.(); await app.shutdown(); await obs.stop(); }
});

it('取得期間の更新失敗はOBS音声だけを止め、プレビューを継続して再操作で復旧する', async () => {
  const { app, obs, emit, start, setVoiceCapturePeriod, currentPeriod, listening } = await sharingBoundary();
  try {
    await app.setSpeechRecognitionEnabled(false);
    setVoiceCapturePeriod.mockRejectedValueOnce(new Error('worker command failed'));
    await app.setSpeechRecognitionEnabled(true);
    listening(); emit('old-after-failure');
    emit('matching-but-unacknowledged', 'きゃすメイト、配信開始', 2, setVoiceCapturePeriod.mock.calls[0][0]);
    expect(obs.view().confirmation).toBeNull();
    expect(obs.view().error).toContain('取得期間を更新できません');
    expect(app.snapshot().speechRecognition).toMatchObject({ previewActive: true, status: 'listening', sessionId: 'session-1' });
    expect(app.snapshot().speechRecognition.previewHistory).toHaveLength(2);
    await app.setSpeechRecognitionEnabled(false); await app.setSpeechRecognitionEnabled(true);
    emit('after-recovery', 'きゃすメイト、配信開始', 3, currentPeriod());
    expect(obs.view().confirmation?.source).toBe('voice');
    expect(start).toHaveBeenCalledOnce();
  } finally { await app.shutdown(); await obs.stop(); }
});
