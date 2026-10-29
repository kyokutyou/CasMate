import { randomUUID } from 'node:crypto';
import type {
  SpeechRecognitionResult,
  SpeechRecognitionSettings,
  SpeechRecognitionState,
} from '../../shared/types';
import { ValidationError } from '../core/validation-error';
import type { RecognitionInputLease, SmartphoneRecognitionInputs } from './smartphone-recognition-input';
import type {
  SpeechRecognitionWorker,
  SpeechRecognitionWorkerEvent,
} from './speech-recognition-worker';

export interface SpeechRecognitionControllerOptions {
  onState: (state: SpeechRecognitionState) => void;
  onResult: (result: SpeechRecognitionResult, previewActive?: boolean) => void;
  onVoiceCaptureAvailability?: (available: boolean) => void;
}

export class SpeechRecognitionController {
  private settings: SpeechRecognitionSettings;
  private state: SpeechRecognitionState = {
    status: 'disabled',
    modelStatus: 'missing',
    modelDownloadProgress: null,
    microphones: [],
    previewActive: false,
    wavSaving: false,
    previewHistory: [],
    sessionId: null,
    warning: null,
  };
  private operationQueue = Promise.resolve();
  private readonly unsubscribe: () => void;
  private shuttingDown = false;
  private aiNeeded = false;
  private smartphoneInputs?: SmartphoneRecognitionInputs;
  private inputUnsubscribe?: () => void;
  private inputLease?: RecognitionInputLease;
  private inputEpoch = 0;
  private lastInputIdentity: string | undefined;
  private startingSession = false;
  private voiceCapturePeriod: string | undefined;
  private voiceCaptureReady = true;

  attachSmartphoneInputs(inputs: SmartphoneRecognitionInputs): void {
    this.inputUnsubscribe?.(); this.smartphoneInputs = inputs;
    this.inputUnsubscribe = inputs.subscribe(() => {
      if (this.settings.inputSource !== 'smartphone' || !this.isNeeded()) return;
      const identity = this.smartphoneInputIdentity();
      if (identity === this.lastInputIdentity) return;
      this.lastInputIdentity = identity;
      this.inputEpoch += 1;
      this.state.sessionId = null;
      this.state.status = 'waitingForInput'; this.notifyState();
      void this.enqueue(async () => { await this.stopSession(true); await this.ensureSession(); });
    });
    void this.enqueue(() => this.ensureSession());
  }

  setAiNeeded(needed: boolean): Promise<void> {
    return this.enqueue(async () => {
      this.aiNeeded = needed;
      if (this.isNeeded()) await this.ensureSession(); else await this.stopSession();
    });
  }

  constructor(
    settings: SpeechRecognitionSettings,
    private readonly worker: SpeechRecognitionWorker,
    private readonly options: SpeechRecognitionControllerOptions,
  ) {
    this.settings = structuredClone(settings);
    this.unsubscribe = worker.subscribe((event) => this.handleWorkerEvent(event));
  }

  snapshot(): SpeechRecognitionState {
    return structuredClone(this.state);
  }

  startOnLaunch(): Promise<void> {
    return this.enqueue(async () => {
      try { await this.worker.initialize(); }
      catch (error) { this.fail(error); }
      await this.refreshMicrophonesInternal();
      if (this.settings.enabled) await this.ensureSession();
    });
  }

  applySettings(settings: SpeechRecognitionSettings): Promise<void> {
    return this.enqueue(async () => {
      const next = structuredClone(settings);
      const previous = this.settings;
      const recognitionChanged = recognitionConfiguration(this.settings) !== recognitionConfiguration(next);
      this.settings = next;
      if (recognitionChanged && (this.state.sessionId || this.inputLease)) {
        const switched = previous.inputSource !== settings.inputSource || previous.smartphoneDeviceId !== settings.smartphoneDeviceId || previous.microphoneId !== settings.microphoneId;
        await this.stopSession(switched || settings.inputSource === 'smartphone');
      }
      if (this.isNeeded()) await this.ensureSession();
      else await this.stopSession();
    });
  }

  startPreview(): Promise<void> {
    return this.enqueue(async () => {
      this.state.previewActive = true;
      this.state.wavSaving = false;
      this.state.previewHistory = [];
      this.notifyState();
      await this.worker.setWavSaving(false);
      await this.refreshMicrophonesInternal();
      await this.ensureSession();
    });
  }

  stopPreview(): Promise<void> {
    return this.enqueue(async () => {
      this.state.previewActive = false;
      this.state.wavSaving = false;
      this.state.previewHistory = [];
      try {
        await this.worker.setWavSaving(false);
      } catch {
        // A broken worker must not keep preview state or its history alive.
      }
      if (!this.isNeeded()) await this.stopSession();
      this.notifyState();
    });
  }

  renewVoiceCapturePeriod(): Promise<void> {
    const id = randomUUID();
    // Invalidate synchronously, before queued work or an old listening event can run.
    this.voiceCapturePeriod = id;
    this.voiceCaptureReady = false;
    return this.enqueue(async () => {
      if (!this.state.sessionId) return;
      await this.applyVoiceCapturePeriod(id);
      this.notifyState();
    });
  }

  isCurrentVoiceCapture(result: SpeechRecognitionResult): boolean {
    return this.voiceCaptureReady && (this.voiceCapturePeriod === undefined || result.voiceCapturePeriodId === this.voiceCapturePeriod);
  }

  private async applyVoiceCapturePeriod(id: string): Promise<void> {
    let available = false;
    try {
      if (this.worker.setVoiceCapturePeriod) { await this.worker.setVoiceCapturePeriod(id); available = true; }
    } catch { /* Only OBS voice permission fails; the shared recognition stays alive. */ }
    if (this.voiceCapturePeriod !== id) return;
    this.voiceCaptureReady = available;
    this.options.onVoiceCaptureAvailability?.(available);
  }

  setWavSaving(enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.state.previewActive) {
        throw new ValidationError('WAV保存は音声認識プレビュー中だけ変更できます。');
      }
      await this.worker.setWavSaving(enabled);
      this.state.wavSaving = enabled;
      this.notifyState();
    });
  }

  refreshMicrophones(): Promise<void> {
    return this.enqueue(() => this.refreshMicrophonesInternal());
  }

  retry(): Promise<void> {
    return this.enqueue(async () => {
      this.state.status = 'preparing';
      this.state.warning = null;
      this.notifyState();
      try {
        this.inputEpoch += 1;
        this.state.sessionId = null;
        this.inputLease?.close(); this.inputLease = undefined;
        await this.worker.retry();
        await this.refreshMicrophonesInternal();
        if (this.isNeeded()) await this.ensureSession();
        else {
          this.state.status = 'disabled';
          this.notifyState();
        }
      } catch (error) {
        this.fail(error);
      }
    });
  }

  prepareModel(): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.modelStatus === 'ready') return;
      const failedWarning = this.state.modelStatus === 'failed' ? this.state.warning : null;
      this.state.modelStatus = 'downloading';
      this.state.modelDownloadProgress = null;
      this.notifyState();
      try {
        await this.worker.prepareModel();
        this.state.modelStatus = 'ready';
        this.state.modelDownloadProgress = null;
        if (this.state.warning === failedWarning) this.state.warning = null;
        this.notifyState();
      } catch (error) {
        this.state.modelStatus = 'failed';
        this.state.modelDownloadProgress = null;
        this.state.warning = error instanceof Error ? error.message : '認識モデルを準備できません。';
        this.notifyState();
        throw error;
      }
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.inputUnsubscribe?.();
    this.inputLease?.close(); this.inputLease = undefined;
    this.state.previewActive = false;
    this.state.wavSaving = false;
    this.state.previewHistory = [];
    try {
      await this.worker.shutdown();
    } finally {
      this.state.status = 'disabled';
      this.state.sessionId = null;
      this.notifyState();
    }
  }

  dispose(): void {
    this.inputUnsubscribe?.(); this.inputLease?.close();
    this.unsubscribe();
  }

  private isNeeded(): boolean {
    return this.settings.enabled || this.state.previewActive || this.aiNeeded;
  }

  private async ensureSession(): Promise<void> {
    if (this.shuttingDown || this.state.sessionId || !this.isNeeded()) return;
    const epoch = this.inputEpoch;
    if (this.settings.inputSource === 'smartphone') {
      const id = this.settings.smartphoneDeviceId ?? '';
      this.lastInputIdentity = this.smartphoneInputIdentity();
      if (this.smartphoneInputs && !this.smartphoneInputs.hasDevice(id)) { this.fail(new Error('選択したスマホが見つかりません。入力を選び直してください。')); return; }
      try { this.inputLease = await this.smartphoneInputs?.open(id) ?? undefined; }
      catch (error) { this.fail(error); return; }
      if (!this.inputLease) { this.state.status = 'waitingForInput'; this.state.warning = null; this.notifyState(); return; }
    }
    this.state.status = 'preparing';
    this.state.warning = null;
    this.notifyState();
    const restoreWavSaving = this.state.previewActive && this.state.wavSaving;
    const inputLease = this.inputLease;
    this.startingSession = true;
    try {
      const { sessionId } = await this.worker.start(structuredClone(this.settings), inputLease?.externalInput);
      if (this.voiceCapturePeriod) await this.applyVoiceCapturePeriod(this.voiceCapturePeriod);
      if (this.shuttingDown || epoch !== this.inputEpoch || inputLease && (this.inputLease !== inputLease || !inputLease.enable())) {
        await this.worker.stop(true); this.inputLease?.close(); this.inputLease = undefined;
        if (!this.shuttingDown && epoch === this.inputEpoch) {
          this.fail(new Error('スマホ音声の認識入力を準備できません。再試行してください。'));
        }
        return;
      }
      this.state.sessionId = sessionId;
      if (restoreWavSaving) await this.worker.setWavSaving(true);
      if (this.shuttingDown || epoch !== this.inputEpoch || this.state.sessionId !== sessionId ||
          inputLease && this.inputLease !== inputLease) return;
      this.state.status = 'listening';
      this.notifyState();
    } catch (error) {
      try { await this.worker.stop(true); } catch { /* The failed worker may already be gone. */ }
      if (!this.shuttingDown) this.fail(error);
    } finally {
      this.startingSession = false;
    }
  }

  private async stopSession(discard = false): Promise<void> {
    if (!this.state.sessionId && !this.inputLease && this.state.status === 'disabled') return;
    try {
      if (discard) { this.inputEpoch += 1; this.state.sessionId = null; this.state.status = 'waitingForInput'; this.notifyState(); }
      this.inputLease?.close(); this.inputLease = undefined;
      await this.worker.stop(discard);
    } catch {
      // A broken worker must not prevent AppState from becoming stopped.
    }
    this.state.sessionId = null;
    this.state.status = 'disabled';
    this.state.warning = null;
    this.notifyState();
  }

  private async refreshMicrophonesInternal(): Promise<void> {
    try {
      this.state.microphones = await this.worker.listMicrophones();
      this.notifyState();
    } catch (error) {
      this.fail(error);
    }
  }

  private handleWorkerEvent(event: SpeechRecognitionWorkerEvent): void {
    switch (event.type) {
      case 'status':
        // start retires the worker's previous session before acknowledging the new one.
        if (this.startingSession && !event.sessionId && event.status === 'disabled') return;
        if (event.sessionId && event.sessionId !== this.state.sessionId) return;
        this.state.status = event.status;
        if (event.status === 'unavailable' || event.status === 'disabled') {
          this.inputLease?.close(); this.inputLease = undefined;
          this.state.sessionId = null;
        }
        if (event.warning) this.state.warning = event.warning;
        this.notifyState();
        break;
      case 'model':
        this.state.modelStatus = event.status;
        this.state.modelDownloadProgress = event.progress ?? null;
        this.state.warning = event.warning ?? null;
        this.notifyState();
        break;
      case 'microphones':
        this.state.microphones = structuredClone(event.microphones);
        this.notifyState();
        break;
      case 'wavSaving':
        if (event.sessionId && event.sessionId !== this.state.sessionId) return;
        this.state.wavSaving = event.enabled;
        this.state.warning = event.warning ?? null;
        this.notifyState();
        break;
      case 'result':
        if (event.result.sessionId !== this.state.sessionId) return;
        this.options.onResult(structuredClone(event.result), this.state.previewActive);
        if (this.state.previewActive) {
          this.state.previewHistory.push(structuredClone(event.result));
          if (this.state.previewHistory.length > 50) this.state.previewHistory.shift();
          this.notifyState();
        }
        break;
      case 'fatal':
        this.inputLease?.close(); this.inputLease = undefined;
        this.state.sessionId = null;
        this.state.status = 'unavailable';
        this.state.warning = event.warning;
        this.notifyState();
        break;
    }
  }

  private fail(error: unknown): void {
    this.inputLease?.close(); this.inputLease = undefined;
    this.state.sessionId = null;
    this.state.status = 'unavailable';
    this.state.warning = error instanceof Error
      ? error.message
      : '配信者音声認識を利用できません。';
    this.notifyState();
  }

  private smartphoneInputIdentity(): string {
    const id = this.settings.smartphoneDeviceId ?? '';
    return `${id}:${this.smartphoneInputs?.hasDevice(id) ?? true}:${this.smartphoneInputs?.key(id) ?? ''}`;
  }

  private notifyState(): void {
    this.options.onState(this.snapshot());
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    if (this.shuttingDown) return Promise.resolve();
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function recognitionConfiguration(settings: SpeechRecognitionSettings): string {
  const configuration: Partial<SpeechRecognitionSettings> = { ...settings };
  delete configuration.enabled;
  return JSON.stringify(Object.fromEntries(Object.entries(configuration).sort(([a], [b]) => a.localeCompare(b))));
}
