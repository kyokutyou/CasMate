import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { SpeechRecognitionController } from '../src/main/speech-recognition/speech-recognition-controller';
import type { RecognitionInputLease, SmartphoneRecognitionInputs } from '../src/main/speech-recognition/smartphone-recognition-input';
import type { SpeechRecognitionExternalInput, SpeechRecognitionWorker, SpeechRecognitionWorkerEvent } from '../src/main/speech-recognition/speech-recognition-worker';
import type { AppSettings, SpeechRecognitionResult, SpeechRecognitionSettings, SpeechRecognitionState } from '../src/shared/types';
import type { SmartphoneView } from '../src/shared/smartphone';

export const phoneId = '11111111-1111-4111-8111-111111111111';
export const otherPhoneId = '22222222-2222-4222-8222-222222222222';
export function smartphoneView(): SmartphoneView {
  const network = { address: null, commentsUrl: null, registrationReady: false, invitationRevision: 1, videoReady: false, obsReady: false, warning: null };
  const profile = { registered: true, obsPort: 10000, revision: 1, report: null, stale: true };
  return { available: true, settings: { activeNetwork: 'lan', statusPorts: { lan: 3001, tailscale: 3001, direct: 3001 } },
    networks: { lan: { ...network }, tailscale: { ...network } }, warning: null,
    devices: [phoneId, otherPhoneId].map((id, index) => ({ id, name: `スマホ${index + 1}`, obsRevision: 1,
      profiles: { lan: { ...profile }, tailscale: { ...profile } } })) };
}

class Inputs implements SmartphoneRecognitionInputs {
  private readonly devices = new Set([phoneId, otherPhoneId]);
  private readonly sources = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  readonly leases: { key: string; close: ReturnType<typeof vi.fn>; enable: ReturnType<typeof vi.fn> }[] = [];
  hasDevice(id: string) { return this.devices.has(id); }
  key(id: string) { return this.sources.get(id) ?? null; }
  async open(id: string): Promise<RecognitionInputLease | null> {
    const key = this.key(id); if (!key) return null;
    let closed = false;
    const lease = { key, close: vi.fn(() => { closed = true; }), enable: vi.fn(() => !closed && this.key(id) === key) };
    this.leases.push(lease);
    return { ...lease, externalInput: { udpPort: 18000 + this.leases.length, ffmpegPath: 'C:\\CasMate\\ffmpeg.exe', generation: key } };
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  connect(id: string, key: string) { this.sources.set(id, key); this.notify(); }
  disconnect(id: string) { this.sources.delete(id); this.notify(); }
  remove(id: string) { this.devices.delete(id); this.sources.delete(id); this.notify(); }
  notify() { for (const listener of this.listeners) listener(); }
}

function workerFixture() {
  let listener: ((event: SpeechRecognitionWorkerEvent) => void) | undefined;
  let sequence = 0;
  const start = vi.fn(async (_settings: SpeechRecognitionSettings, _input?: SpeechRecognitionExternalInput) => ({ sessionId: `session-${++sequence}` }));
  const stop = vi.fn(async (_discard?: boolean) => undefined);
  const setWavSaving = vi.fn(async (_enabled: boolean) => undefined);
  const retry = vi.fn(async () => undefined);
  const api: SpeechRecognitionWorker = {
    subscribe: next => { listener = next; return () => { listener = undefined; }; },
    initialize: vi.fn(async () => undefined),
    listMicrophones: vi.fn(async () => [{ id: 'pc-mic', name: 'PCマイク', isDefault: true }]),
    prepareModel: vi.fn(async () => undefined), start, stop, setWavSaving, retry, shutdown: vi.fn(async () => undefined),
  };
  return { api, start, stop, setWavSaving, retry, emit: (event: SpeechRecognitionWorkerEvent) => listener?.(event) };
}
function result(sessionId: string, text: string): SpeechRecognitionResult {
  return { id: text, sessionId, sequence: 1, recognizedAt: '2026-10-08T00:00:00Z', text,
    audioDurationMilliseconds: 1000, recognitionDurationMilliseconds: 100 };
}
function phoneSettings(enabled = true): SpeechRecognitionSettings {
  return { ...createDefaultSettings().speechRecognition, enabled, inputSource: 'smartphone', smartphoneDeviceId: phoneId, microphoneId: 'pc-mic' };
}

describe('受信したスマホ音声の認識と設定境界', () => {
  it('開始前の旧セッション停止通知で準備したスマホ音声分岐を閉じない', async () => {
    const worker = workerFixture(); const inputs = new Inputs(); inputs.connect(phoneId, 'receiving');
    worker.start.mockImplementationOnce(async () => {
      worker.emit({ type: 'status', status: 'disabled' });
      worker.emit({ type: 'status', status: 'preparing' });
      return { sessionId: 'new-session' };
    });
    const controller = new SpeechRecognitionController(phoneSettings(), worker.api, {
      onState: () => undefined, onResult: () => undefined });
    controller.attachSmartphoneInputs(inputs);
    try {
      await controller.startOnLaunch();
      expect(inputs.leases[0]?.enable).toHaveBeenCalledOnce();
      expect(inputs.leases[0]?.close).not.toHaveBeenCalled();
      expect(controller.snapshot()).toMatchObject({ status: 'listening', sessionId: 'new-session' });
    } finally { await controller.shutdown(); }
  });

  it('WAV設定の復元応答待ちに受信が切れても認識中へ戻さない', async () => {
    const worker = workerFixture(); const inputs = new Inputs(); inputs.connect(phoneId, 'first');
    const statuses: string[] = [];
    const controller = new SpeechRecognitionController(phoneSettings(false), worker.api, {
      onState: state => { statuses.push(state.status); }, onResult: () => undefined });
    controller.attachSmartphoneInputs(inputs);
    let finish: () => void = () => undefined;
    try {
      await controller.startPreview(); await controller.setWavSaving(true);
      inputs.disconnect(phoneId); await controller.applySettings(phoneSettings(false));
      worker.setWavSaving.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
      inputs.connect(phoneId, 'second');
      await vi.waitFor(() => expect(worker.setWavSaving).toHaveBeenCalledTimes(3));
      inputs.disconnect(phoneId); statuses.length = 0; finish();
      await controller.applySettings(phoneSettings(false));
      expect(controller.snapshot()).toMatchObject({ status: 'waitingForInput', sessionId: null });
      expect(statuses).not.toContain('listening');
    } finally { finish(); await controller.shutdown(); }
  });

  it('WAV設定の復元待ちに認識障害が届いたら利用不可を維持する', async () => {
    const worker = workerFixture(); const inputs = new Inputs(); inputs.connect(phoneId, 'first');
    const controller = new SpeechRecognitionController(phoneSettings(false), worker.api, {
      onState: () => undefined, onResult: () => undefined });
    controller.attachSmartphoneInputs(inputs);
    let finish: () => void = () => undefined;
    try {
      await controller.startPreview(); await controller.setWavSaving(true);
      inputs.disconnect(phoneId); await controller.applySettings(phoneSettings(false));
      worker.setWavSaving.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
      inputs.connect(phoneId, 'second');
      await vi.waitFor(() => expect(worker.setWavSaving).toHaveBeenCalledTimes(3));
      worker.emit({ type: 'status', status: 'unavailable', sessionId: 'session-2', warning: '復号が停止しました' });
      finish(); await controller.refreshMicrophones();
      expect(controller.snapshot()).toMatchObject({ status: 'unavailable', sessionId: null, warning: '復号が停止しました' });
    } finally { finish(); await controller.shutdown(); }
  });

  it('未送信を待ち、同端末の開始・断復帰で旧結果を捨てWAV設定を新セッションへ戻す', async () => {
    const worker = workerFixture(); const inputs = new Inputs(); const onResult = vi.fn();
    const controller = new SpeechRecognitionController(phoneSettings(false), worker.api, { onState: () => undefined, onResult });
    controller.attachSmartphoneInputs(inputs);
    try {
      await controller.startPreview();
      expect(controller.snapshot()).toMatchObject({ status: 'waitingForInput', sessionId: null, previewActive: true });
      expect(worker.start).not.toHaveBeenCalled();
      inputs.connect(phoneId, 'receive-one');
      await vi.waitFor(() => expect(controller.snapshot().sessionId).toBe('session-1'));
      expect(worker.start.mock.calls[0]?.[1]?.generation).toBe('receive-one');
      await controller.setWavSaving(true);
      inputs.disconnect(phoneId);
      worker.emit({ type: 'result', result: result('session-1', '断後の古い発話') });
      expect(onResult).not.toHaveBeenCalled();
      await controller.applySettings(phoneSettings(false));
      expect(controller.snapshot().status).toBe('waitingForInput');
      expect(worker.stop).toHaveBeenLastCalledWith(true);
      inputs.connect(phoneId, 'receive-two');
      await vi.waitFor(() => expect(controller.snapshot().sessionId).toBe('session-2'));
      expect(worker.start.mock.calls[1]?.[1]?.generation).toBe('receive-two');
      expect(worker.setWavSaving.mock.calls.filter(([enabled]) => enabled)).toHaveLength(2);
      expect(controller.snapshot().wavSaving).toBe(true);
      worker.emit({ type: 'result', result: result('session-1', '遅れて届いた古い発話') });
      worker.emit({ type: 'result', result: result('session-2', '現在の発話') });
      expect(onResult).toHaveBeenCalledOnce(); expect(controller.snapshot().previewHistory.map(value => value.text)).toEqual(['現在の発話']);
    } finally { await controller.shutdown(); }
  });

  it('同一受信の通知では再起動せず、手動再試行は新セッションと新しい分岐を使う', async () => {
    const worker = workerFixture(); const inputs = new Inputs(); const onResult = vi.fn();
    inputs.connect(phoneId, 'receive-one');
    const controller = new SpeechRecognitionController(phoneSettings(), worker.api, { onState: () => undefined, onResult });
    controller.attachSmartphoneInputs(inputs);
    try {
      await controller.startOnLaunch(); inputs.notify(); inputs.notify(); await controller.applySettings(phoneSettings());
      expect(worker.start).toHaveBeenCalledOnce(); expect(worker.stop).not.toHaveBeenCalled();
      await controller.retry();
      expect(worker.retry).toHaveBeenCalledOnce(); expect(worker.start).toHaveBeenCalledTimes(2);
      expect(controller.snapshot().sessionId).toBe('session-2'); expect(inputs.leases[0]?.close).toHaveBeenCalledOnce();
      worker.emit({ type: 'result', result: result('session-1', '再試行前の発話') });
      expect(onResult).not.toHaveBeenCalled();
    } finally { await controller.shutdown(); }
  });

  it('選択端末の登録削除を利用不可にし、別の受信端末やPCマイクへ変更しない', async () => {
    const worker = workerFixture(); const inputs = new Inputs(); inputs.connect(phoneId, 'selected'); inputs.connect(otherPhoneId, 'other');
    const controller = new SpeechRecognitionController(phoneSettings(), worker.api, { onState: () => undefined, onResult: () => undefined });
    controller.attachSmartphoneInputs(inputs);
    try {
      await controller.startOnLaunch(); inputs.remove(phoneId);
      await vi.waitFor(() => expect(controller.snapshot().status).toBe('unavailable'));
      expect(controller.snapshot().warning).toContain('選び直し'); expect(worker.start).toHaveBeenCalledOnce();
      await controller.retry(); expect(worker.start).toHaveBeenCalledOnce();
      expect(worker.start.mock.calls[0]?.[0]).toMatchObject({ inputSource: 'smartphone', smartphoneDeviceId: phoneId });
    } finally { await controller.shutdown(); }
  });

  it('後続の本番ONが同時に保存された入力・VAD値を保ち、入力選択だけではONにしない', async () => {
    const worker = workerFixture(); const save = vi.fn(async (_settings: AppSettings) => undefined); const inputs = new Inputs();
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api, saveSettings: save });
    state.setSmartphoneState(smartphoneView()); state.attachSmartphoneRecognitionInputs(inputs);
    try {
      const settings = { ...phoneSettings(false), vadThreshold: 0.6, minSilenceDurationSeconds: 0.8 };
      const apply = state.applySpeechRecognitionSettings({ revision: 1, settings });
      const enable = state.setSpeechRecognitionEnabled(true);
      await apply; await enable;
      expect(save.mock.calls[0]?.[0].speechRecognition).toMatchObject({ enabled: false, inputSource: 'smartphone' });
      expect(state.snapshot().settings.speechRecognition).toEqual({ ...settings, enabled: true });
      expect(save.mock.calls[1]?.[0].speechRecognition).toEqual({ ...settings, enabled: true });
      expect(state.remoteSpeechRecognitionState()).toMatchObject({ revision: 3, enabled: true, status: 'waitingForInput' });
      expect(worker.start).not.toHaveBeenCalled();
    } finally { await state.shutdown(); }
  });

  it('入力・PC一括適用の古い編集リビジョンを409で拒否し保存・再起動しない', async () => {
    const worker = workerFixture(); const save = vi.fn(async (_settings: AppSettings) => undefined);
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api, saveSettings: save });
    state.setSmartphoneState(smartphoneView());
    try {
      await state.selectSpeechRecognitionInput({ revision: 1, inputSource: 'smartphone', smartphoneDeviceId: phoneId });
      expect(state.snapshot().settings.speechRecognition.enabled).toBe(false);
      await expect(state.selectSpeechRecognitionInput({ revision: 1, inputSource: 'smartphone', smartphoneDeviceId: otherPhoneId }))
        .rejects.toMatchObject({ status: 409, code: 'SPEECH_SETTINGS_CONFLICT' });
      await expect(state.applySpeechRecognitionSettings({ revision: 1, settings: { ...phoneSettings(false), vadThreshold: 0.7 } }))
        .rejects.toMatchObject({ status: 409, code: 'SPEECH_SETTINGS_CONFLICT' });
      expect(save).toHaveBeenCalledOnce(); expect(worker.start).not.toHaveBeenCalled(); expect(worker.stop).not.toHaveBeenCalled();
      expect(state.snapshot().settings.speechRecognition.smartphoneDeviceId).toBe(phoneId);
    } finally { await state.shutdown(); }
  });

  it('保存失敗で入力とリビジョンを進めず認識を再起動しない', async () => {
    const worker = workerFixture(); const save = vi.fn(async () => { throw new Error('保存失敗'); });
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker.api, saveSettings: save });
    state.setSmartphoneState(smartphoneView());
    try {
      await expect(state.selectSpeechRecognitionInput({ revision: 1, inputSource: 'smartphone', smartphoneDeviceId: phoneId })).rejects.toThrow('保存失敗');
      expect(state.remoteSpeechRecognitionState()).toMatchObject({ revision: 1, enabled: false, inputSource: 'microphone', smartphoneDeviceId: null });
      expect(worker.start).not.toHaveBeenCalled(); expect(worker.stop).not.toHaveBeenCalled();
    } finally { await state.shutdown(); }
  });

  it('最小状態の非選択IDをnullにし、通常状態通知でも入力一覧と編集リビジョンを維持する', async () => {
    const worker = workerFixture(); const settings = createDefaultSettings(); settings.speechRecognition = phoneSettings(false);
    const state = new AppState(settings, { speechRecognitionWorker: worker.api });
    const notifications: SpeechRecognitionState[] = [];
    state.subscribe(event => { if (event.type === 'speechRecognition.stateChanged') notifications.push(event.payload as SpeechRecognitionState); });
    try {
      state.setSmartphoneState(smartphoneView()); await state.refreshSpeechRecognitionMicrophones();
      worker.emit({ type: 'model', status: 'ready' }); worker.emit({ type: 'status', status: 'waitingForInput' });
      const minimal = state.remoteSpeechRecognitionState();
      expect(minimal).toMatchObject({ inputSource: 'smartphone', microphoneId: null, smartphoneDeviceId: phoneId });
      expect(Object.keys(minimal).sort()).toEqual(['enabled', 'inputSource', 'inputs', 'message', 'microphoneId', 'revision', 'smartphoneDeviceId', 'status'].sort());
      expect(minimal.inputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ inputSource: 'microphone', microphoneId: null, name: 'PCの既定マイク' }),
        expect.objectContaining({ id: `smartphone:${phoneId}`, smartphoneDeviceId: phoneId }),
        expect.objectContaining({ id: `smartphone:${otherPhoneId}`, smartphoneDeviceId: otherPhoneId }),
      ]));
      for (const notification of notifications) {
        expect(notification.settingsRevision).toBe(1); expect(notification.inputs).toEqual(expect.arrayContaining([
          expect.objectContaining({ smartphoneDeviceId: phoneId }), expect.objectContaining({ smartphoneDeviceId: otherPhoneId }),
        ]));
      }
      expect(notifications.length).toBeGreaterThan(2);
      await state.selectSpeechRecognitionInput({ revision: 1, inputSource: 'microphone', microphoneId: 'pc-mic' });
      expect(state.remoteSpeechRecognitionState()).toMatchObject({ inputSource: 'microphone', microphoneId: 'pc-mic', smartphoneDeviceId: null, revision: 2 });
      const changed = smartphoneView(); changed.devices.pop(); state.setSmartphoneState(changed);
      expect(notifications.at(-1)?.settingsRevision).toBe(2);
      expect(notifications.at(-1)?.inputs?.filter(value => value.inputSource === 'smartphone')).toHaveLength(1);
    } finally { await state.shutdown(); }
  });
});
