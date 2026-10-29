import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AppSettings,
  AppSnapshot,
  ConnectionKey,
  IncomingComment,
  RealtimeEvent,
  SettingsSection,
  SpeechRecognitionControlState,
  SpeechRecognitionInputView,
} from '../../shared/types';
import type { SmartphoneRecognitionInputs } from '../speech-recognition/smartphone-recognition-input';
import { SourceConnections, connectionService, type SourceAdapterFactory } from '../sources/source-connections';
import { createBoardWriteAdapter, type BoardWriteAdapter } from '../board/board-write-adapter';
import type { NormalizedBoardThread } from '../sources/source-inputs';
export type { SourceAdapterFactory } from '../sources/source-connections';
import {
  CommentSpeechController,
  type PcAudioPlayer,
  type SpeechSynthesizer,
} from '../speech/comment-speech-controller';
import {
  MobileSpeechController,
  type AudioTranscoder,
  type MobileAudioReady,
} from '../speech/mobile-speech-controller';
import {
  ShitarabaNextThreadController,
  type ResolveShitarabaNextThread,
} from '../shitaraba/shitaraba-next-thread-controller';
import {
  type ShitarabaWriteAdapter,
} from '../shitaraba/shitaraba-write-adapter';
import { SpeechRecognitionController } from '../speech-recognition/speech-recognition-controller';
import {
  type SpeechRecognitionWorker,
  unavailableSpeechRecognitionWorker,
} from '../speech-recognition/speech-recognition-worker';
import { CharacterController } from './character-controller';
import { blocksComment } from './comment-filter';
import { CommentOverlayController } from './comment-overlay-controller';
import { CommentStore } from './comment-store';
import { SpeechRecognitionOverlayController } from './speech-recognition-overlay-controller';
import { validateSettingsSection, validateSimpleCharacterMotionSettings } from './settings';
import { createTextEffectPayload, matchTextEffects, testItemsForRule } from './text-effects';
import { ValidationError } from './validation-error';
import { addSavedObsDesign, emptySavedObsDesigns, removeSavedObsDesign } from '../../shared/saved-obs-designs';
import { commentDesignFromSettings } from '../../shared/obs-design';
import type { ObsControlController } from '../obs/obs-control-controller';
import type { ObsControlView } from '../../shared/obs-control';
import type { AiController } from '../ai/ai-controller';
import type { AiView } from '../../shared/ai-listener';
import type { UpdateNoticeStore } from './update-notice-store';
import type { InitialSetupStore } from './initial-setup-store';

const characterMotionSaveWarning = '簡易キャラクターの微動設定を保存できませんでした。最後に保存できた設定へ戻しました。';

export interface AppStateOptions {
  sourceFactory?: SourceAdapterFactory;
  saveSettings?: (settings: AppSettings) => Promise<void>;
  shitarabaWriteAdapter?: ShitarabaWriteAdapter;
  boardWriteAdapter?: Pick<BoardWriteAdapter, 'fetchThreadContent' | 'findThreadsByTitle' | 'createNextThread' | 'announceNextThread'>;
  shitarabaWriteDelay?: (milliseconds: number) => Promise<void>;
  warning?: string;
  updateNotices?: UpdateNoticeStore;
  initialSetup?: InitialSetupStore;
  speechSynthesizer?: SpeechSynthesizer;
  audioPlayer?: PcAudioPlayer;
  previewAudioPlayer?: PcAudioPlayer;
  speechDelay?: (milliseconds: number) => Promise<void>;
  audioTranscoder?: AudioTranscoder;
  onMobileAudioReady?: (clientId: string, audio: MobileAudioReady) => void;
  onMobileAudioDiscard?: (clientId: string, audioId: string) => void;
  speechRecognitionWorker?: SpeechRecognitionWorker;
  obsControl?: ObsControlController;
}

export class AppState {
  private speechSettingsRevision = 1;
  private stopping = false;
  private initialization?: Promise<void>;
  private ai?: AiController;
  private shutdownAiConnections?: () => Promise<void>;
  private aiView?: AiView;
  private aiOwnedSources = new Set<ConnectionKey>();
  private aiManualSources = new Set<ConnectionKey>();
  private aiSpeechBlocked = false;
  private aiSpeechUsing = false;
  private aiDependencyQueue = Promise.resolve();
  private sourceSettingsBarrier?: Promise<void>;
  private sourceStopGeneration: Record<ConnectionKey, number> = { youtube: 0, twitch: 0, shitaraba: 0 };
  private youtubeVideo = '';
  attachAi(controller: AiController, shutdownConnections?: () => Promise<void>) { this.ai = controller; this.shutdownAiConnections = shutdownConnections; this.syncAiConnections(); }
  setAiView(view: AiView) { this.aiView = view; this.emit('aiListener.stateChanged', view); }
  private syncAiConnections() {
    this.ai?.connection('youtube', this.youtubeVideo, this.sources.state('youtube') === 'connected');
    this.ai?.connection('twitch', this.settings.sources.twitch.channel, this.sources.state('twitch') === 'connected');
    const service = connectionService('shitaraba', this.settings.sources);
    for (const board of ['shitaraba', 'jpnkn'] as const) {
      this.ai?.connection(board, service === board ? this.settings.sources.shitaraba.threadUrl : '',
        service === board && this.sources.state('shitaraba') === 'connected');
    }
  }
  private aiParticipantEnabled(source: ConnectionKey, sources = this.settings.sources): boolean {
    const service = connectionService(source, sources);
    return service !== undefined && this.settings.aiListener.participants[service].enabled;
  }
  acquireAiDependencies(): Promise<void> {
    // Wait outside the resource queue: controller settings can initiate a
    // next-thread switch which needs that same queue before this barrier ends.
    if (this.sourceSettingsBarrier) return this.sourceSettingsBarrier.then(() => this.acquireAiDependencies());
    const operation = this.aiDependencyQueue.then(() => this.acquireAiResources());
    this.aiDependencyQueue = operation.catch(() => undefined); return operation;
  }
  private async acquireAiResources() {
    for (const source of ['youtube', 'twitch', 'shitaraba'] as const) {
      if (!this.aiParticipantEnabled(source)) {
        if (this.aiOwnedSources.delete(source)) await this.stopSource(source, false);
        continue;
      }
      if (!this.sources.hasConnection(source) && !this.aiManualSources.has(source)) {
        if (!this.settings.sources[source].enabled) this.aiOwnedSources.add(source);
        await this.startSource(source, false).catch(() => undefined);
      }
    }
    if (!this.aiSpeechBlocked) { this.aiSpeechUsing = true; await this.speechRecognition.setAiNeeded(true); const recognition = this.speechRecognition.snapshot(); this.ai?.recognition(['listening', 'speechDetected', 'recognizing'].includes(recognition.status), recognition.status); }
  }
  releaseAiDependencies(): Promise<void> {
    if (this.sourceSettingsBarrier) return this.sourceSettingsBarrier.then(() => this.releaseAiDependencies());
    const operation = this.aiDependencyQueue.then(() => this.releaseAiResources());
    this.aiDependencyQueue = operation.catch(() => undefined); return operation;
  }
  private async releaseAiResources() {
    this.aiSpeechUsing = false; this.ai?.recognition(false);
    await this.speechRecognition.setAiNeeded(false);
    for (const source of this.aiOwnedSources) await this.stopSource(source, false);
    this.aiOwnedSources.clear(); this.aiManualSources.clear(); this.aiSpeechBlocked = false;
  }
  private readonly comments = new CommentStore();
  private readonly overlay: CommentOverlayController;
  private readonly character: CharacterController;
  private readonly speech: CommentSpeechController;
  private readonly mobileSpeech: MobileSpeechController;
  private readonly shitarabaNextThread: ShitarabaNextThreadController;
  private readonly speechRecognition: SpeechRecognitionController;
  private readonly speechRecognitionOverlay: SpeechRecognitionOverlayController;
  private readonly events = new EventEmitter();
  private readonly sources: SourceConnections;
  private settings: AppSettings;
  private revision = 0;
  private initialSetupSignature = '';
  private smartphone?: import('../../shared/smartphone').SmartphoneView;
  setSmartphoneState(value: import('../../shared/smartphone').SmartphoneView): void {
    const changed = !this.smartphone || this.smartphone.settings.activeNetwork !== value.settings.activeNetwork;
    this.smartphone = structuredClone(value);
    if (changed) this.mobileSpeech.updateSettings(this.settings.commentSpeech, this.effectiveMobileSettings());
    this.emit('smartphone.stateChanged', this.smartphone);
    this.emit('speechRecognition.stateChanged', { ...this.speechRecognition.snapshot(), settingsRevision: this.speechSettingsRevision,
      inputs: this.speechRecognitionInputs() });
  }
  private effectiveMobileSettings() {
    const mobile = this.settings.mobileSpeech;
    return { ...mobile,
      lanEnabled: this.smartphone?.settings.activeNetwork === 'lan',
      tailscaleEnabled: this.smartphone?.settings.activeNetwork === 'tailscale',
      directEnabled: this.smartphone?.settings.activeNetwork === 'direct',
    };
  }
  private obsControl?: ObsControlView;
  private obsSourceRegistration?: import('../../shared/obs-source-registration').ObsSourceRegistrationState;
  private obsSourceTest?: import('../../shared/obs-source-test').ObsSourceTestState;
  setObsSourceTestState(value: import('../../shared/obs-source-test').ObsSourceTestState): void {
    this.obsSourceTest = structuredClone(value);
    this.emit('obsSourceTest.stateChanged', this.obsSourceTest);
  }
  setObsSourceRegistrationState(value: import('../../shared/obs-source-registration').ObsSourceRegistrationState): void {
    this.obsSourceRegistration = structuredClone(value);
    this.emit('obsSourceRegistration.stateChanged', this.obsSourceRegistration);
  }
  invalidateObsSourceContext(): void { this.emit('obsSourceRegistration.contextInvalidated', {}); }
  private obsControlEnabled?: boolean;
  private obsControlVoiceEnabled?: boolean;



  setObsControlState(value: ObsControlView) {
    const captureBoundaryChanged =
      (this.obsControlEnabled === false && value.enabled) ||
      (this.obsControlVoiceEnabled === false && value.voiceEnabled);
    this.obsControlEnabled = value.enabled;
    this.obsControlVoiceEnabled = value.voiceEnabled;
    this.obsControl = structuredClone(value);
    void this.ai?.observeObs(value.connection === 'connected', value.stream).catch(() => undefined);
    if (captureBoundaryChanged) {
      this.options.obsControl?.invalidateVoiceCapturePeriod();
      void this.speechRecognition.renewVoiceCapturePeriod().catch(() => undefined);
    }
    this.emit('obsControl.stateChanged', this.obsControl);
  }
  private settingsRevision = 1;
  private settingsUpdateQueue = Promise.resolve();
  private runtimeWarning: string | undefined;
  private persistenceQueue = Promise.resolve();
  private readonly speechAudio = new Map<string, Promise<Buffer>>();
  private readonly speechSynthesizer: SpeechSynthesizer;

  constructor(settings: AppSettings, private readonly options: AppStateOptions = {}) {
    this.settings = clone(settings);
    this.settings.sources = validateSettingsSection('sources', this.settings.sources);
    this.speechSynthesizer = options.speechSynthesizer ?? unavailableSynthesizer;
    this.sources = new SourceConnections({
      factory: options.sourceFactory,
      settings: () => this.settings.sources,
      initializeShitaraba: () => this.initialize(),
      callbacks: {
        onYouTubeVideo: video => { this.youtubeVideo = video; this.syncAiConnections(); },
        onRawAuthor: (source, id, name) => this.ai?.observeRaw(source, id, name),
        onBoardBatch: comments => {
          const service = connectionService('shitaraba', this.settings.sources);
          if (service === 'shitaraba' || service === 'jpnkn') this.ai?.observeBoardBatch(comments, service);
        },
        onComment: comment => this.acceptComment(comment),
        onStatus: status => { this.syncAiConnections(); this.emit('source.statusChanged', status); },
        onBoardProgress: maximum => {
          const service = connectionService('shitaraba', this.settings.sources);
          if (service === 'shitaraba' || service === 'jpnkn') this.ai?.observeBoardProgress(service, maximum);
          this.shitarabaNextThread.observeResponseNumber(maximum);
        },
      },
    });
    this.overlay = new CommentOverlayController(this.settings.commentOverlay, (state) => {
      this.emit('commentOverlay.stateChanged', state);
    });
    this.character = new CharacterController(this.settings.character, (state) => {
      this.emit('character.stateChanged', state);
    });
    this.speech = new CommentSpeechController(
      this.settings.commentSpeech,
      {
        synthesizer: this.speechSynthesizer,
        player: options.audioPlayer ?? unavailablePlayer,
        previewPlayer: options.previewAudioPlayer,
        synchronizedOverlay: {
          start: (comment) => this.overlay.startSynchronized(comment),
          finish: (commentId) => this.overlay.finishSynchronized(commentId),
          fallback: (comment) => this.overlay.fallbackSynchronized(comment),
          clear: () => this.overlay.clearDisplay(),
        },
        onState: (speechState) => this.emit('commentSpeech.stateChanged', speechState),
        onSpeechStart: (commentId) => this.character.startSpeech(commentId),
        onMouthShape: (commentId, shape) => this.character.applyMouthShape(commentId, shape),
        onSpeechStop: (commentId) => this.character.stopSpeech(commentId),
        delay: options.speechDelay,
        getWav: (itemId, text, speechSettings) =>
          this.getSharedSpeechAudio(itemId, text, speechSettings),
      },
      this.isSynchronizedSpeech(),
    );
    this.mobileSpeech = new MobileSpeechController(
      this.settings.commentSpeech,
      this.effectiveMobileSettings(),
      {
        synthesizer: this.speechSynthesizer,
        transcoder: options.audioTranscoder ?? unavailableTranscoder,
        onState: (mobileState) => this.emit('mobileSpeech.stateChanged', mobileState),
        onAudioReady: options.onMobileAudioReady,
        onAudioDiscard: options.onMobileAudioDiscard,
        getWav: (itemId, text, speechSettings) =>
          this.getSharedSpeechAudio(itemId, text, speechSettings),
      },
    );
    this.shitarabaNextThread = new ShitarabaNextThreadController(
      this.settings.sources.shitaraba,
      {
        writer: options.boardWriteAdapter ?? (options.shitarabaWriteAdapter
          ? legacyShitarabaWriter(options.shitarabaWriteAdapter) : createBoardWriteAdapter()),
        onState: (state) => this.emit('shitarabaNextThread.stateChanged', state),
        onCreatedAnnouncement: (recordKey) => {
          const opaqueRecordId = createHash('sha256').update(recordKey).digest('base64url');
          const itemId = `system:shitaraba-next-thread:${opaqueRecordId}`;
          const text = '新しいスレを用意しました';
          this.speech.acceptSystemAnnouncement(itemId, text);
          this.mobileSpeech.acceptSystemAnnouncement(itemId, text);
        },
        onSwitchedAnnouncement: (recordKey) => {
          const opaqueRecordId = createHash('sha256').update(recordKey).digest('base64url');
          const itemId = `system:shitaraba-next-thread-switched:${opaqueRecordId}`;
          const text = '次スレに移動しました';
          this.speech.acceptSystemAnnouncement(itemId, text);
          this.mobileSpeech.acceptSystemAnnouncement(itemId, text);
        },
        switchThread: (threadUrl) => this.switchShitarabaThread(threadUrl),
        delay: options.shitarabaWriteDelay,
      },
    );
    this.speechRecognitionOverlay = new SpeechRecognitionOverlayController(
      this.settings.speechRecognition.enabled,
      (state) => this.emit('speechRecognitionOverlay.stateChanged', state),
      this.settings.speechRecognitionOverlay.displayDurationSeconds,
    );
    this.speechRecognition = new SpeechRecognitionController(
      this.settings.speechRecognition,
      options.speechRecognitionWorker ?? unavailableSpeechRecognitionWorker,
      {
        onVoiceCaptureAvailability: available => this.options.obsControl?.setVoiceCaptureAvailable(available),
        onState: (speechRecognitionState) => {
          this.ai?.recognition(this.aiSpeechUsing && !this.aiSpeechBlocked && ['listening', 'speechDetected', 'recognizing'].includes(speechRecognitionState.status), speechRecognitionState.status);
          this.options.obsControl?.handleSpeechRecognitionState(speechRecognitionState.status, speechRecognitionState.sessionId);
          this.emit('speechRecognition.stateChanged', { ...speechRecognitionState, settingsRevision: this.speechSettingsRevision,
            inputs: this.speechRecognitionInputs(speechRecognitionState.microphones) });
        },
        onResult: (result) => {
          if (this.aiSpeechUsing) this.ai?.speech(result.text, result.id);
          this.speechRecognitionOverlay.accept(result);
          if (this.settings.speechRecognition.enabled && this.speechRecognition.isCurrentVoiceCapture(result)) this.options.obsControl?.handleSpeechResult(result);
          this.emit('speechRecognition.resultReceived', result);
        },
      },
    );
  }

  subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  snapshot(): AppSnapshot {
    const mobileSpeech = this.mobileSpeech.snapshot();
    mobileSpeech.audioAvailable = mobileSpeech.audioAvailable && this.speech.available();
    const mobileSettings: AppSettings['mobileSpeech'] & { directEnabled?: boolean } = this.effectiveMobileSettings(); delete mobileSettings.directEnabled;
    const snapshot: AppSnapshot = {
      settings: { ...clone(this.settings), mobileSpeech: mobileSettings },
      ...(this.options.updateNotices ? { updateNotices: this.options.updateNotices.pending() } : {}),
      ...(this.smartphone ? { smartphone: structuredClone(this.smartphone) } : {}),
      ...(this.obsControl ? { obsControl: structuredClone(this.obsControl) } : {}),
      ...(this.obsSourceRegistration ? { obsSourceRegistration: structuredClone(this.obsSourceRegistration) } : {}),
      ...(this.obsSourceTest ? { obsSourceTest: structuredClone(this.obsSourceTest) } : {}),
      ...(this.aiView ? { aiListener: structuredClone(this.aiView) } : {}),
      settingsRevision: this.settingsRevision,
      comments: this.comments.snapshot(),
      sourceStatuses: this.sources.snapshot(),
      commentOverlay: this.overlay.snapshot(),
      character: this.character.snapshot(),
      commentSpeech: this.speech.snapshot(),
      mobileSpeech,
      shitarabaNextThread: this.shitarabaNextThread.snapshot(),
      speechRecognition: { ...this.speechRecognition.snapshot(), settingsRevision: this.speechSettingsRevision, inputs: this.speechRecognitionInputs() },
      speechRecognitionOverlay: this.speechRecognitionOverlay.snapshot(),
      ...(this.runtimeWarning || this.options.warning || this.options.updateNotices?.warning
        ? { warning: this.runtimeWarning ?? this.options.warning ?? this.options.updateNotices?.warning }
        : {}),
    };
    if (this.options.initialSetup) snapshot.initialSetup = this.options.initialSetup.view(snapshot);
    return snapshot;
  }

  snapshotEvent(): RealtimeEvent<AppSnapshot> {
    return { type: 'state.snapshot', revision: this.revision, payload: this.snapshot() };
  }

  async acknowledgeUpdateNotice(id: string): Promise<void> {
    if (!this.options.updateNotices) throw new Error('更新案内を確認できません。');
    await this.options.updateNotices.acknowledge(id);
    this.emit('state.snapshot', this.snapshot());
  }

  async updateInitialSetup(command: unknown): Promise<void> {
    if (!this.options.initialSetup) throw new Error('初回設定を利用できません。');
    try { await this.options.initialSetup.update(command, () => this.snapshot()); }
    finally { this.emit('state.snapshot', this.snapshot()); }
  }

  acceptComment(incoming: IncomingComment): void {
    let blocked: boolean;
    try {
      blocked = blocksComment(incoming, this.settings.commentFilter);
    } catch {
      this.comments.markSeen(incoming);
      return;
    }
    if (blocked) {
      this.comments.markSeen(incoming);
      return;
    }
    const result = this.comments.accept(incoming);
    if (result.duplicate) return;
    this.ai?.comment(result.comment);
    this.emit('comment.received', result.comment);
    if (result.removed) this.emit('comment.removed', { id: result.removed.id });
    if (!result.comment.initialHistory) {
      try {
        const items = matchTextEffects(result.comment, this.settings.textEffects);
        if (items.length > 0) this.emit('textEffects.triggered', createTextEffectPayload(items));
      } catch {
        // 文字演出の障害はコメント表示・読み上げから分離する。
        this.reportTextEffectError();
      }
      if (!this.isSynchronizedSpeech()) this.overlay.accept(result.comment);
      this.speech.accept(result.comment);
      this.mobileSpeech.accept(result.comment);
    }
  }

  testTextEffectRule(ruleId: string): void {
    const rule = this.settings.textEffects.rules.find((candidate) => candidate.id === ruleId);
    if (!rule) throw new ValidationError('文字演出ルールが見つかりません。');
    this.emit('textEffects.triggered', createTextEffectPayload(testItemsForRule(rule)));
  }

  reportTextEffectError(): void {
    const warning = 'コメント文字演出で問題が発生しました。OBS文字演出ビューを再読み込みしてください。';
    if (this.runtimeWarning === warning) return;
    this.runtimeWarning = warning;
    this.emit('state.snapshot', this.snapshot());
  }

  updateSettings<K extends SettingsSection>(
    section: K,
    value: unknown,
  ): Promise<AppSnapshot> {
    const operation = this.settingsUpdateQueue.then(() => {
      // The editor window owns its bounds. A queued management form may have
      // captured application settings before a concurrent window close saved them.
      const next = section === 'application' && value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value, managementWindow: this.settings.application.managementWindow,
            commentListWindow: this.settings.application.commentListWindow,
            commentListWindowVisible: this.settings.application.commentListWindowVisible,
            obsDesignWindow: this.settings.application.obsDesignWindow, obsSavedDesigns: this.settings.application.obsSavedDesigns }
        : value;
      return this.applySettingsUpdate(section, next);
    });
    this.settingsUpdateQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  updateCharacterMotion(value: unknown): Promise<AppSnapshot> {
    const operation = this.settingsUpdateQueue.then(() => {
      const motion = validateSimpleCharacterMotionSettings(value);
      const character = this.settings.character;
      return this.applySettingsUpdate('character', {
        ...character,
        simple: { ...character.simple, motion },
      });
    });
    this.settingsUpdateQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  updateCharacterOptions(value: unknown): Promise<AppSnapshot> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['alwaysOnTop', 'clickThrough', 'windowBounds', 'windowVisible', 'settingsWindowBounds'].includes(key))) return Promise.reject(new ValidationError('キャラクター表示設定の項目が正しくありません。'));
    const operation = this.settingsUpdateQueue.then(() => this.applySettingsUpdate('character', { ...this.settings.character, ...value }));
    this.settingsUpdateQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  updateCharacterAsset(slot: 'closed' | 'open', asset: string | null, dimensions: (asset: string) => Promise<{ width: number; height: number } | null>): Promise<AppSnapshot> {
    const operation = this.settingsUpdateQueue.then(async () => {
      const character = this.settings.character;
      const simple = { ...character.simple, [slot === 'open' ? 'openAsset' : 'closedAsset']: asset };
      let warning: string | null = null;
      if (slot === 'closed' && !asset) simple.openAsset = null;
      if (asset && simple.openAsset) {
        const [closed, open] = await Promise.all([simple.closedAsset ? dimensions(simple.closedAsset) : null, dimensions(simple.openAsset)]);
        if (!closed || !open || closed.width !== open.width || closed.height !== open.height) {
          if (slot === 'open') throw new ValidationError('口開き素材は対応する閉口素材と幅・高さを一致させてください。');
          simple.openAsset = null; warning = '口開き素材を寸法不一致のため解除しました。';
        }
      }
      await this.applySettingsUpdate('character', { ...character, simple });
      this.setCharacterAssetWarning(warning);
      return this.snapshot();
    });
    this.settingsUpdateQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  updateObsDesign(target: 'comments' | 'speech', value: unknown, optionsOnly = false): Promise<AppSnapshot> {
    const section = target === 'comments' ? 'commentOverlay' : 'speechRecognitionOverlay';
    const operation = this.settingsUpdateQueue.then(() => {
      if (optionsOnly) {
        const keys = target === 'comments'
          ? ['mode', 'stackDurationSeconds', 'singleDurationSeconds', 'stackDirection', 'showSource', 'showAuthor', 'showContent', 'fontSizePx']
          : ['displayDurationSeconds'];
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new ValidationError('表示設定の項目が正しくありません。');
        if (target === 'comments' && 'fontSizePx' in value) {
          const fontSize = value.fontSizePx;
          if (typeof fontSize !== 'number' || !Number.isInteger(fontSize) || fontSize < 8 || fontSize > 200) throw new ValidationError('文字サイズは8～200の整数で指定してください。');
          const design = commentDesignFromSettings(this.settings.commentOverlay);
          design.style.fontSize = fontSize;
          return this.applySettingsUpdate('commentOverlay', { ...this.settings.commentOverlay, ...value, design });
        }
        return this.applySettingsUpdate(section, { ...this.settings[section], ...value });
      }
      if (value === undefined) throw new ValidationError('デザインの形式が正しくありません。');
      return this.applySettingsUpdate(section, { ...this.settings[section], design: value });
    });
    this.settingsUpdateQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  updateObsDesignWindowBounds(bounds: AppSettings['application']['managementWindow']): Promise<AppSnapshot> {
    const operation = this.settingsUpdateQueue.then(() => this.applySettingsUpdate('application', { ...this.settings.application, obsDesignWindow: bounds }));
    this.settingsUpdateQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  updateApplicationWindowState(value: Partial<Pick<AppSettings['application'], 'managementWindow' | 'commentListWindow' | 'commentListWindowVisible'>>): Promise<AppSnapshot> {
    const patch = clone(value);
    const operation = this.settingsUpdateQueue.then(() => this.applySettingsUpdate('application', { ...this.settings.application, ...patch }));
    this.settingsUpdateQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  updateSavedObsDesign(target: 'comments' | 'speech', operation: 'add' | 'remove', value: unknown): Promise<AppSnapshot> {
    const pending = this.settingsUpdateQueue.then(() => {
      const current = this.settings.application.obsSavedDesigns ?? emptySavedObsDesigns();
      let library;
      try { library = operation === 'add' ? addSavedObsDesign(current, target, value) : removeSavedObsDesign(current, target, value); }
      catch (error) { throw new ValidationError(error instanceof Error ? error.message : '保存したデザインを確認してください。'); }
      if (JSON.stringify(current) === JSON.stringify(library)) return this.snapshot();
      return this.applySettingsUpdate('application', { ...this.settings.application, obsSavedDesigns: library });
    });
    this.settingsUpdateQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async applySettingsUpdate<K extends SettingsSection>(
    section: K,
    value: unknown,
  ): Promise<AppSnapshot> {
    let validated = validateSettingsSection(section, value);
    if (section === 'mobileSpeech') {
      validated = { ...this.effectiveMobileSettings(), bitrateKbps: (validated as AppSettings['mobileSpeech']).bitrateKbps } as typeof validated;
    }
    if (section === 'aiListener') {
      const submitted = validated as AppSettings['aiListener'];
      const usedIds = Object.values(this.settings.aiListener.participants).map(p => p.personaId).filter(Boolean);
      if (usedIds.some(id => !submitted.personas.some(p => p.id === id))) throw new ValidationError('割当中の人格は先に割当を解除してください。');
      if (JSON.stringify(submitted) !== JSON.stringify(this.settings.aiListener)) this.ai?.invalidate();
    }
    let sourcesToRestart: ConnectionKey[] = [];
    let sourcesToRestore: ConnectionKey[] = [];
    const stopGenerations = { ...this.sourceStopGeneration };
    let finishSourceUpdate: (() => void) | undefined;
    try {
      if (section === 'sources') {
        const threadUrlBeforeWait = this.settings.sources.shitaraba.threadUrl;
        await this.initialize();
        await this.shitarabaNextThread.waitForIdle();
        let release!: () => void;
        const barrier = new Promise<void>(resolve => { release = resolve; });
        this.sourceSettingsBarrier = barrier;
        finishSourceUpdate = () => {
          if (this.sourceSettingsBarrier === barrier) this.sourceSettingsBarrier = undefined;
          release();
        };
        await this.aiDependencyQueue;
        const submitted = validated as AppSettings['sources'];
        const next = this.settings.sources.shitaraba.threadUrl !== threadUrlBeforeWait &&
          submitted.shitaraba.threadUrl === threadUrlBeforeWait
          ? {
              ...submitted,
              shitaraba: {
                ...submitted.shitaraba,
                threadUrl: this.settings.sources.shitaraba.threadUrl,
              },
            }
          : submitted;
        validated = next as typeof validated;
        const changed = (['youtube', 'twitch', 'shitaraba'] as const).filter(
          (source) => sourceConnectionChanged(source, this.settings.sources, next),
        );
        sourcesToRestore = changed.filter(
          (source) => this.sources.state(source) !== 'stopped' && (this.settings.sources[source].enabled || this.aiOwnedSources.has(source)),
        );
        sourcesToRestart = changed.filter(
          (source) => this.sources.state(source) !== 'stopped' && (next[source].enabled || this.aiOwnedSources.has(source) && this.aiParticipantEnabled(source, next)),
        );
        if (changed.includes('youtube')) this.youtubeVideo = '';
        this.ai?.invalidate();
        await Promise.allSettled(changed.map((source) => this.stopSource(source, false)));
      }
      const speechWasEnabled = this.settings.speechRecognition.enabled;
      try {
        await this.persistSettingsSection(section, validated);
      } catch (error) {
        if (section === 'character') {
          this.character.restoreSavedMotion();
          this.runtimeWarning = characterMotionSaveWarning;
          this.emit('state.snapshot', this.snapshot());
        }
        await Promise.allSettled(sourcesToRestore
          .filter(source => stopGenerations[source] === this.sourceStopGeneration[source])
          .map((source) => this.startSource(source, false)));
        throw error;
      }
      if (section === 'speechRecognition') {
        this.speechSettingsRevision += 1;
        if (speechWasEnabled !== this.settings.speechRecognition.enabled) {
          this.options.obsControl?.invalidateVoiceCapturePeriod();
          if (this.settings.speechRecognition.enabled) await this.speechRecognition.renewVoiceCapturePeriod();
        }
      }
      if (section === 'aiListener') await this.ai?.configure(this.settings.aiListener);
      if (section === 'sources') {
        for (const source of ['youtube', 'twitch', 'shitaraba'] as const) {
          if (this.settings.sources[source].enabled || !this.aiParticipantEnabled(source)) this.aiOwnedSources.delete(source);
        }
        this.sources.refreshServices();
        this.syncAiConnections();
      }
      if (section === 'sources') {
        await this.shitarabaNextThread.updateSettings(this.settings.sources.shitaraba);
      }
      if (section === 'commentOverlay') {
        this.overlay.updateSettings(validated as AppSettings['commentOverlay']);
      }
      if (section === 'speechRecognitionOverlay') {
        this.speechRecognitionOverlay.updateDuration(this.settings.speechRecognitionOverlay.displayDurationSeconds);
        this.emit(
          'speechRecognitionOverlay.appearanceChanged',
          speechRecognitionOverlayAppearance(this.settings.speechRecognitionOverlay),
        );
      }
      if (section === 'character') {
        this.character.updateSettings(validated as AppSettings['character']);
      }
      if (section === 'commentOverlay' || section === 'commentSpeech') {
        this.speech.updateSettings(this.settings.commentSpeech, this.isSynchronizedSpeech());
      }
      if (section === 'commentSpeech' || section === 'mobileSpeech') {
        this.mobileSpeech.updateSettings(this.settings.commentSpeech, this.effectiveMobileSettings());
      }
      if (section === 'speechRecognition') {
        if (speechWasEnabled && !this.settings.speechRecognition.enabled) this.aiSpeechBlocked = true;
        else if (this.settings.speechRecognition.enabled) this.aiSpeechBlocked = false;
        if (this.aiSpeechBlocked) { this.aiSpeechUsing = false; this.ai?.recognition(false); await this.speechRecognition.setAiNeeded(false); }
        else if (this.aiView && this.aiView.status !== 'stopped') { this.aiSpeechUsing = true; await this.speechRecognition.setAiNeeded(true); }
        this.speechRecognitionOverlay.updateEnabled(this.settings.speechRecognition.enabled);
        await this.speechRecognition.applySettings(this.settings.speechRecognition);
        this.emit('speechRecognition.stateChanged', { ...this.speechRecognition.snapshot(), settingsRevision: this.speechSettingsRevision,
          inputs: this.speechRecognitionInputs() });
      }
      this.settingsRevision += 1;
      this.emit('settings.changed', {
        section,
        // Applying source settings can immediately switch a completed next thread.
        value: section === 'sources' ? clone(this.settings.sources) : clone(validated),
        settingsRevision: this.settingsRevision,
      });
      if (section === 'character' && this.runtimeWarning === characterMotionSaveWarning) {
        this.runtimeWarning = undefined;
        this.emit('state.snapshot', this.snapshot());
      }
      await Promise.allSettled(sourcesToRestart
        .filter(source => stopGenerations[source] === this.sourceStopGeneration[source] &&
          (this.settings.sources[source].enabled || this.aiOwnedSources.has(source) && this.aiParticipantEnabled(source)))
        .map((source) => this.startSource(source, false)));
      finishSourceUpdate?.();
      if (section === 'sources' && this.aiView?.requested) await this.acquireAiDependencies();
      return this.snapshot();
    } finally { finishSourceUpdate?.(); }
  }

  previewCharacterMotion(value: unknown): void {
    this.character.previewMotion(validateSimpleCharacterMotionSettings(value));
  }

  async startAllSources(): Promise<void> {
    const enabled = (['youtube', 'twitch', 'shitaraba'] as const).filter(
      (source) => this.settings.sources[source].enabled,
    );
    await Promise.allSettled(enabled.map((source) => this.startSource(source)));
  }

  async startSourcesOnLaunch(): Promise<void> {
    if (this.stopping) return;
    const generations = { ...this.sourceStopGeneration };
    await this.initialize();
    if (this.stopping || !this.settings.sources.autoConnect) return;
    await Promise.allSettled((['youtube', 'twitch', 'shitaraba'] as const)
      .filter(source => this.settings.sources[source].enabled && generations[source] === this.sourceStopGeneration[source])
      .map(source => this.startSource(source)));
  }

  async stopAllSources(): Promise<void> {
    await Promise.allSettled(
      (['youtube', 'twitch', 'shitaraba'] as const).map((source) =>
        this.stopSource(source),
      ),
    );
    this.overlay.clearDisplay();
  }

  async startSource(source: ConnectionKey, manual = true): Promise<void> {
    const generation = this.sourceStopGeneration[source];
    if (manual && this.sourceSettingsBarrier) await this.sourceSettingsBarrier;
    if (generation !== this.sourceStopGeneration[source]) return;
    if (this.stopping) return;
    if (manual) { this.aiManualSources.delete(source); this.aiOwnedSources.delete(source); }
    await this.sources.start(source);
  }

  async stopSource(source: ConnectionKey, manual = true): Promise<void> {
    if (manual) this.sourceStopGeneration[source] += 1;
    if (manual) { this.aiManualSources.add(source); this.aiOwnedSources.delete(source); }
    await this.sources.stop(source);
  }

  reconnectSource(source: ConnectionKey): Promise<void> {
    // Serialize with AI resource acquisition/release so reconnect cannot outlive its owner.
    const generation = this.sourceStopGeneration[source];
    if (this.sourceSettingsBarrier) return this.sourceSettingsBarrier.then(() =>
      generation === this.sourceStopGeneration[source] ? this.reconnectSource(source) : undefined);
    const operation = this.aiDependencyQueue.then(async () => {
      if (this.sources.state(source) === 'stopped' || generation !== this.sourceStopGeneration[source]) return;
      await this.stopSource(source, false);
      if (generation !== this.sourceStopGeneration[source]) return;
      await this.startSource(source, false);
    });
    this.aiDependencyQueue = operation.catch(() => undefined);
    return operation;
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    this.shitarabaNextThread.dispose();
    // Invalidate pending starts before another service's shutdown can await I/O.
    const sourcesStopping = this.stopAllSources();
    // Audio cancellation must not wait for AI generation or result persistence.
    const speechStopping = stopService(() => this.speech.shutdown());
    const mobileSpeechStopping = stopService(() => this.mobileSpeech.shutdown());
    // Each owned service must be released even if another service fails to stop.
    // Keep the order so AI can finish its result log before closing its connections.
    await stopService(() => this.ai?.shutdown());
    await stopService(() => this.shutdownAiConnections?.());
    this.emit('application.stopping', null);
    for (const stop of [
      () => this.speechRecognition.shutdown(),
      () => this.options.obsControl?.stop(),
    ]) await stopService(stop);
    await Promise.allSettled([sourcesStopping, speechStopping, mobileSpeechStopping]);
    this.dispose();
  }

  dispose(): void {
    this.stopping = true;
    this.shitarabaNextThread.dispose();
    this.speech.clear();
    this.overlay.dispose();
    this.character.dispose();
    this.comments.clear();
    this.speechAudio.clear();
    this.speechRecognition.dispose();
    this.speechRecognitionOverlay.dispose();
    this.events.removeAllListeners();
  }

  listSpeechVoices() {
    return this.speech.listVoices();
  }

  previewSpeech(): Promise<void> {
    return this.speech.preview(this.mobileSpeech.createPreviewReceiver());
  }

  startSpeechRecognitionOnLaunch(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return this.speechRecognition.startOnLaunch();
  }

  attachSmartphoneRecognitionInputs(inputs: SmartphoneRecognitionInputs): void { this.speechRecognition.attachSmartphoneInputs(inputs); }

  private speechRecognitionInputs(availableMicrophones = this.speechRecognition.snapshot().microphones): SpeechRecognitionInputView[] {
    const microphones = availableMicrophones.map(mic => ({ id: mic.id, name: mic.name, inputSource: 'microphone' as const,
      microphoneId: mic.id, smartphoneDeviceId: null, available: true }));
    const network = this.smartphone?.settings.activeNetwork;
    const smartphones = (this.smartphone?.devices ?? []).map(device => ({ id: `smartphone:${device.id}`, name: device.name, inputSource: 'smartphone' as const,
      microphoneId: null, smartphoneDeviceId: device.id, available: Boolean(network && device.profiles[network]?.receiver?.state === 'receiving') }));
    return [{ id: 'microphone:default', name: 'PCの既定マイク', inputSource: 'microphone',
      microphoneId: null, smartphoneDeviceId: null, available: microphones.length > 0 }, ...microphones, ...smartphones];
  }

  remoteSpeechRecognitionState(): SpeechRecognitionControlState {
    const settings = this.settings.speechRecognition; const state = this.speechRecognition.snapshot();
    return { revision: this.speechSettingsRevision, enabled: settings.enabled, inputSource: settings.inputSource ?? 'microphone',
      microphoneId: settings.inputSource === 'smartphone' ? null : settings.microphoneId,
      smartphoneDeviceId: settings.inputSource === 'smartphone' ? settings.smartphoneDeviceId ?? null : null, inputs: this.speechRecognitionInputs(),
      status: state.status, message: state.warning };
  }

  setSpeechRecognitionEnabled(enabled: boolean): Promise<AppSnapshot> {
    if (typeof enabled !== 'boolean') return Promise.reject(new ValidationError('音声認識のON/OFFが正しくありません。'));
    return this.queueSpeechSettings(() => this.applySettingsUpdate('speechRecognition', { ...this.settings.speechRecognition, enabled }));
  }

  selectSpeechRecognitionInput(payload: unknown): Promise<AppSnapshot> {
    return this.queueSpeechSettings(() => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ValidationError('音声認識の入力指定が正しくありません。');
      const value = payload as Record<string, unknown>;
      this.checkSpeechRevision(value.revision);
      if (!['microphone', 'smartphone'].includes(String(value.inputSource)) ||
        Object.keys(value).some(key => !['revision', 'inputSource', 'microphoneId', 'smartphoneDeviceId'].includes(key))) throw new ValidationError('音声認識の入力指定が正しくありません。');
      const inputs = this.speechRecognitionInputs();
      if (value.inputSource === 'smartphone' && !inputs.some(input => input.smartphoneDeviceId === value.smartphoneDeviceId)) throw new ValidationError('登録済みのスマホを選択してください。');
      if (value.inputSource === 'microphone' && value.microphoneId !== null && !inputs.some(input => input.microphoneId === value.microphoneId)) throw new ValidationError('マイク一覧を更新し、入力を選び直してください。');
      return this.applySettingsUpdate('speechRecognition', { ...this.settings.speechRecognition, inputSource: value.inputSource,
        ...(value.inputSource === 'microphone' ? { microphoneId: value.microphoneId, smartphoneDeviceId: null } : { smartphoneDeviceId: value.smartphoneDeviceId }) });
    });
  }

  applySpeechRecognitionSettings(payload: unknown): Promise<AppSnapshot> {
    return this.queueSpeechSettings(() => {
      if (!payload || typeof payload !== 'object') throw new ValidationError('音声認識設定を確認してください。');
      const { revision, settings } = payload as { revision?: unknown; settings?: unknown };
      this.checkSpeechRevision(revision);
      return this.applySettingsUpdate('speechRecognition', settings);
    });
  }
  private checkSpeechRevision(revision: unknown): void {
    if (revision !== this.speechSettingsRevision) throw new SpeechRecognitionConflict();
  }
  private queueSpeechSettings(operation: () => Promise<AppSnapshot>): Promise<AppSnapshot> {
    const result = this.settingsUpdateQueue.then(operation); this.settingsUpdateQueue = result.then(() => undefined, () => undefined); return result;
  }

  startSpeechRecognitionPreview(): Promise<void> {
    return this.speechRecognition.startPreview();
  }

  stopSpeechRecognitionPreview(): Promise<void> {
    return this.speechRecognition.stopPreview();
  }

  setSpeechRecognitionWavSaving(enabled: boolean): Promise<void> {
    return this.speechRecognition.setWavSaving(enabled);
  }

  refreshSpeechRecognitionMicrophones(): Promise<void> {
    return this.speechRecognition.refreshMicrophones();
  }

  retrySpeechRecognition(): Promise<void> {
    return this.speechRecognition.retry();
  }

  prepareSpeechRecognitionModel(): Promise<void> {
    return this.speechRecognition.prepareModel();
  }

  initialize(): Promise<void> {
    return this.initialization ??= this.shitarabaNextThread.initialize();
  }

  async createShitarabaNextThread(): Promise<void> {
    await this.initialize();
    if (this.stopping) return;
    await this.shitarabaNextThread.createNow();
  }

  async resolveShitarabaNextThread(outcome: ResolveShitarabaNextThread): Promise<void> {
    await this.initialize();
    if (this.stopping) return;
    await this.shitarabaNextThread.resolve(outcome);
  }

  startMobileSpeech(clientId: string): boolean {
    return this.speech.available() && this.mobileSpeech.start(clientId);
  }

  stopMobileSpeech(clientId: string): void {
    this.mobileSpeech.stop(clientId);
  }

  finishMobileAudio(clientId: string, audioId: string): void {
    this.mobileSpeech.audioEnded(clientId, audioId);
  }

  startMobileAudio(clientId: string, audioId: string): void {
    this.mobileSpeech.audioStarted(clientId, audioId);
  }

  mobileAudio(audioId: string): Buffer | null {
    return this.mobileSpeech.audio(audioId);
  }

  setMobileUrls(urls: AppSnapshot['mobileSpeech']['urls']): void {
    this.mobileSpeech.setUrls(urls);
  }

  setMobileLanWarning(warning: string | null): void {
    this.mobileSpeech.setLanWarning(warning);
  }

  setMobileTailscaleStatus(status: AppSnapshot['mobileSpeech']['tailscaleStatus']): void {
    this.mobileSpeech.setTailscaleStatus(status);
  }

  setCharacterAssetWarning(warning: string | null): void {
    this.character.setAssetWarning(warning);
  }

  private async persistSettingsSection<K extends SettingsSection>(section: K, value: AppSettings[K]): Promise<void> {
    const nextValue = clone(value);
    const operation = this.enqueuePersistence(async () => {
      // Merge and commit under the same queue so a next-thread switch cannot
      // overwrite another setting saved while its connection was stopping.
      const nextSettings = { ...this.settings, [section]: nextValue };
      await this.options.saveSettings?.(clone(nextSettings));
      this.settings = nextSettings;
    });
    await operation;
  }

  private enqueuePersistence(operation: () => Promise<void>): Promise<void> {
    const result = this.persistenceQueue.then(operation);
    this.persistenceQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private switchShitarabaThread(threadUrl: string): Promise<void> {
    const currentUrl = this.settings.sources.shitaraba.threadUrl;
    const generation = this.sourceStopGeneration.shitaraba;
    const operation = this.aiDependencyQueue.then(async () => {
      if (this.stopping) return;
      if (currentUrl !== this.settings.sources.shitaraba.threadUrl) {
        throw new ValidationError('掲示板の接続先が変更されたため切替を中止しました。');
      }
      const shouldRestart = this.sources.state('shitaraba') !== 'stopped';
      this.ai?.invalidate();
      if (shouldRestart) await this.stopSource('shitaraba', false);
      const sources = clone(this.settings.sources);
      sources.shitaraba.threadUrl = threadUrl;
      try { await this.persistSettingsSection('sources', sources); }
      catch (error) {
        if (shouldRestart && generation === this.sourceStopGeneration.shitaraba) await this.startSource('shitaraba', false);
        throw error;
      }
      this.sources.refreshServices();
      this.syncAiConnections();
      this.settingsRevision += 1;
      this.emit('settings.changed', {
        section: 'sources',
        value: clone(this.settings.sources),
        settingsRevision: this.settingsRevision,
      });
      await this.shitarabaNextThread.updateSettings(this.settings.sources.shitaraba);
      if (shouldRestart && generation === this.sourceStopGeneration.shitaraba && !this.stopping &&
        (sources.shitaraba.enabled || this.aiOwnedSources.has('shitaraba') && this.aiParticipantEnabled('shitaraba'))) {
        await this.startSource('shitaraba', false);
      }
    });
    this.aiDependencyQueue = operation.catch(() => undefined);
    return operation;
  }

  private isSynchronizedSpeech(): boolean {
    return this.settings.commentOverlay.mode === 'single' && this.settings.commentSpeech.enabled;
  }

  private getSharedSpeechAudio(
    commentId: string,
    text: string,
    speechSettings: AppSettings['commentSpeech'],
  ): Promise<Buffer> {
    const key = `${commentId}:${JSON.stringify(speechSettings)}`;
    const cached = this.speechAudio.get(key);
    if (cached) return cached.then((wav) => Buffer.from(wav));
    const synthesis = this.speechSynthesizer.synthesize(text, speechSettings);
    this.speechAudio.set(key, synthesis);
    void synthesis.catch(() => {
      if (this.speechAudio.get(key) === synthesis) this.speechAudio.delete(key);
    });
    const expiry = setTimeout(() => {
      if (this.speechAudio.get(key) === synthesis) this.speechAudio.delete(key);
    }, 60_000);
    expiry.unref();
    return synthesis.then((wav) => Buffer.from(wav));
  }

  private emit<T>(type: RealtimeEvent<T>['type'], payload: T): void {
    this.revision += 1;
    this.events.emit('event', { type, revision: this.revision, payload });
    if (this.options.initialSetup && ['settings.changed', 'smartphone.stateChanged', 'obsControl.stateChanged', 'aiListener.stateChanged', 'obsSourceRegistration.stateChanged'].includes(type)) {
      // Fingerprints depend on configuration, never comment history or live audio buffers.
      const mobileSpeech: AppSettings['mobileSpeech'] & { directEnabled?: boolean } = this.effectiveMobileSettings();
      delete mobileSpeech.directEnabled;
      const view = this.options.initialSetup.view({ settings: { ...this.settings, mobileSpeech },
        smartphone: this.smartphone, obsControl: this.obsControl, aiListener: this.aiView,
        obsSourceRegistration: this.obsSourceRegistration });
      const signature = JSON.stringify(view);
      if (signature !== this.initialSetupSignature) {
        this.initialSetupSignature = signature;
        this.revision++;
        this.events.emit('event', { type: 'initialSetup.stateChanged', revision: this.revision, payload: view });
      }
    }
  }
}

export function speechRecognitionOverlayAppearance(
  settings: AppSettings['speechRecognitionOverlay'],
) {
  const {
    fontFamily,
    fontSizePx,
    textColor,
    backgroundColor,
    paddingPx,
    borderRadiusPx,
  } = settings;
  return { fontFamily, fontSizePx, textColor, backgroundColor, paddingPx, borderRadiusPx, ...(settings.design ? { design: settings.design } : {}) };
}

const unavailableSynthesizer: SpeechSynthesizer = {
  prepare: async () => { throw new Error('VOICEVOXを利用できません。'); },
  listVoices: async () => [],
  synthesize: async () => { throw new Error('VOICEVOXを利用できません。'); },
};

const unavailablePlayer: PcAudioPlayer = {
  play: async () => { throw new Error('PC音声プレイヤーを利用できません。'); },
  stop: () => undefined,
};

const unavailableTranscoder: AudioTranscoder = {
  available: () => false,
  transcode: async () => { throw new Error('FFmpegを利用できません。'); },
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Retains the existing Shitaraba-only injection contract for local integrations. */
function legacyShitarabaWriter(writer: ShitarabaWriteAdapter): NonNullable<AppStateOptions['boardWriteAdapter']> {
  const shitaraba = (thread: NormalizedBoardThread) => {
    if (thread.service !== 'shitaraba') throw new ValidationError('この投稿アダプターはしたらば専用です。');
    return thread;
  };
  return {
    fetchThreadContent: thread => writer.fetchThreadContent(shitaraba(thread)),
    findThreadsByTitle: (thread, title) => writer.findThreadsByTitle(shitaraba(thread), title),
    createNextThread: request => writer.createNextThread({ ...request, currentThread: shitaraba(request.currentThread) }),
    announceNextThread: request => writer.announceNextThread({ ...request, currentThread: shitaraba(request.currentThread) }),
  };
}

async function stopService(stop: () => Promise<void> | undefined): Promise<void> {
  try { await stop(); }
  catch { /* A failed service stop must not prevent the remaining shutdown work. */ }
}

export class SpeechRecognitionConflict extends Error {
  readonly status = 409;
  readonly code = 'SPEECH_SETTINGS_CONFLICT';
  constructor() { super('音声認識設定が別の操作で変更されました。最新の入力を確認してから適用してください。'); }
}

function sourceConnectionChanged(
  source: ConnectionKey,
  current: AppSettings['sources'],
  next: AppSettings['sources'],
): boolean {
  if (source !== 'shitaraba') return !sameValue(current[source], next[source]);
  return !sameValue(
    {
      enabled: current.shitaraba.enabled,
      threadUrl: current.shitaraba.threadUrl,
      pollIntervalSeconds: current.shitaraba.pollIntervalSeconds,
    },
    {
      enabled: next.shitaraba.enabled,
      threadUrl: next.shitaraba.threadUrl,
      pollIntervalSeconds: next.shitaraba.pollIntervalSeconds,
    },
  );
}
