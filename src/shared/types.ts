import { compatibilityPolicy } from './compatibility-policy.generated';
export type CommentSource = 'youtube' | 'twitch' | 'shitaraba' | 'jpnkn';
export const connectionKeys = ['youtube', 'twitch', 'shitaraba'] as const;
export type ConnectionKey = typeof connectionKeys[number];

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'emote'; id: string; alt: string; url: string };

export interface IncomingComment {
  externalId: string;
  source: CommentSource;
  authorName: string;
  content: ContentPart[];
  initialHistory: boolean;
}

export interface CommonComment extends IncomingComment {
  id: string;
  sequence: number;
  receivedAt: string;
}

export type CommentOverlayMode = 'stack' | 'single';
export type StackDirection = 'newestBottom' | 'newestTop';

export interface DisplayFields {
  showSource: boolean;
  showAuthor: boolean;
  showContent: boolean;
}

export interface CommentOverlaySettings extends DisplayFields {
  design?: import('./obs-design').ObsCommentDesign;
  mode: CommentOverlayMode;
  stackDurationSeconds: number;
  singleDurationSeconds: number;
  stackDirection: StackDirection;
  fontFamily: string;
  fontSizePx: number;
  textColor: string;
  backgroundColor: string;
  paddingPx: number;
  borderRadiusPx: number;
}

export interface TimedOverlayComment {
  comment: CommonComment;
  expiresAt: string;
}

export interface CommentOverlayState {
  active: TimedOverlayComment[];
  queue: CommonComment[];
}

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface SimpleCharacterMotionSettings {
  enabled: boolean;
  verticalAmplitudePercent: number;
  verticalPeriodSeconds: number;
  tiltAmplitudeDegrees: number;
  tiltPeriodSeconds: number;
  breathingAmplitudePercent: number;
  breathingPeriodSeconds: number;
}

export interface SimpleCharacterSettings {
  closedAsset: string | null;
  openAsset: string | null;
  motion: SimpleCharacterMotionSettings;
}

export interface CharacterSettings {
  mode: 'simple';
  simple: SimpleCharacterSettings;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  windowVisible: boolean;
  windowBounds: WindowBounds;
  settingsWindowBounds: WindowBounds;
}

export type CharacterAssetSlot = 'closed' | 'open';

export interface CharacterState {
  mouthShape: 'closed' | 'open';
  motion: SimpleCharacterMotionSettings;
  motionStartedAtMs: number | null;
  assetWarning: string | null;
}

export interface VoiceSelection {
  speakerUuid: string;
  styleId: number;
}

export interface CommentSpeechSettings {
  enabled: boolean;
  readSource: boolean;
  readAuthor: boolean;
  maxTextLength: number;
  voice: VoiceSelection | null;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
}

export interface MobileSpeechSettings {
  /** Effective publication flag supplied by the smartphone controller; never a persisted preference. */
  directEnabled?: boolean;
  lanEnabled: boolean;
  tailscaleEnabled: boolean;
  bitrateKbps: number;
}

export interface SpeechRecognitionSettings {
  enabled: boolean;
  microphoneId: string | null;
  inputSource?: 'microphone' | 'smartphone';
  smartphoneDeviceId?: string | null;
  vadThreshold: number;
  minSpeechDurationSeconds: number;
  minSilenceDurationSeconds: number;
  maxSpeechDurationSeconds: number;
  preRollDurationSeconds: number;
  postRollDurationSeconds: number;
}

export interface SpeechRecognitionMicrophone {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface SpeechRecognitionResult {
  id: string;
  sessionId: string;
  sequence: number;
  /** Identifies the recognition capture period that produced this result. */
  capturePeriodId?: string;
  /** OBS voice permission when this utterance's audio was captured. */
  voiceCapturePeriodId?: string;
  recognizedAt: string;
  text: string;
  audioDurationMilliseconds: number;
  recognitionDurationMilliseconds: number;
}

export interface SpeechRecognitionOverlayItem {
  id: string;
  text: string;
  expiresAt: string;
}

export interface SpeechRecognitionOverlayState {
  active: SpeechRecognitionOverlayItem | null;
}

export type SpeechRecognitionOverlayAppearance = { design?: import('./obs-design').ObsSpeechDesign } & Pick<
  CommentOverlaySettings,
  | 'fontFamily'
  | 'fontSizePx'
  | 'textColor'
  | 'backgroundColor'
  | 'paddingPx'
  | 'borderRadiusPx'
>;

export interface SpeechRecognitionOverlayBootstrap {
  state: SpeechRecognitionOverlayState;
  appearance: SpeechRecognitionOverlayAppearance;
}

export interface SpeechRecognitionOverlaySettings extends SpeechRecognitionOverlayAppearance {
  displayDurationSeconds: number;
}

export type SpeechRecognitionRuntimeStatus =
  | 'disabled'
  | 'waitingForInput'
  | 'preparing'
  | 'listening'
  | 'speechDetected'
  | 'recognizing'
  | 'unavailable';

export type SpeechRecognitionModelStatus =
  | 'missing'
  | 'downloading'
  | 'extracting'
  | 'validating'
  | 'ready'
  | 'failed';

export interface SpeechRecognitionState {
  settingsRevision?: number;
  inputs?: SpeechRecognitionInputView[];
  status: SpeechRecognitionRuntimeStatus;
  modelStatus: SpeechRecognitionModelStatus;
  modelDownloadProgress: number | null;
  microphones: SpeechRecognitionMicrophone[];
  previewActive: boolean;
  wavSaving: boolean;
  previewHistory: SpeechRecognitionResult[];
  sessionId: string | null;
  warning: string | null;
}

export interface SpeechRecognitionInputView {
  id: string;
  name: string;
  inputSource: 'microphone' | 'smartphone';
  microphoneId: string | null;
  smartphoneDeviceId: string | null;
  available: boolean;
}

export interface SpeechRecognitionControlState {
  revision: number;
  enabled: boolean;
  inputSource: 'microphone' | 'smartphone';
  microphoneId: string | null;
  smartphoneDeviceId: string | null;
  inputs: SpeechRecognitionInputView[];
  status: SpeechRecognitionRuntimeStatus;
  message: string | null;
}

export interface VoicevoxStyle {
  id: number;
  name: string;
}

export interface VoicevoxSpeaker {
  speakerUuid: string;
  name: string;
  styles: VoicevoxStyle[];
}

export interface CommentSpeechState {
  engineStatus: 'disabled' | 'preparing' | 'ready' | 'unavailable';
  currentCommentId: string | null;
  queueLength: number;
  droppedCount: number;
  warning: string | null;
}

export type MobilePublicationKind = 'lan' | 'tailscale';

export interface MobileSpeechUrlState {
  kind: MobilePublicationKind;
  url: string;
  available: boolean;
}

export type TailscalePublicationStatus =
  | 'disabled'
  | 'ready'
  | 'notInstalled'
  | 'serviceStopped'
  | 'loginRequired'
  | 'ipUnavailable'
  | 'listenFailed';

export interface MobileSpeechState {
  urls: MobileSpeechUrlState[];
  tailscaleStatus: TailscalePublicationStatus;
  activeClient: boolean;
  clientCount: number;
  currentCommentId: string | null;
  queueLength: number;
  droppedCount: number;
  audioAvailable: boolean;
  warning: string | null;
}

export interface ApplicationSettings {
  obsSavedDesigns?: import('./saved-obs-designs').SavedObsDesigns;
  obsDesignWindow?: WindowBounds;
  port: number;
  managementTheme?: import('./management-theme').ManagementThemeId;
  managementTextSize?: import('./management-text-size').ManagementTextSizeId;
  managementWindow: WindowBounds;
  commentListWindow: WindowBounds;
  commentListWindowVisible: boolean;
}

export interface YouTubeSourceSettings {
  enabled: boolean;
  target: string;
}

export interface TwitchSourceSettings {
  enabled: boolean;
  channel: string;
}

export interface ShitarabaSourceSettings {
  enabled: boolean;
  threadUrl: string;
  pollIntervalSeconds: number;
  nextThread: ShitarabaNextThreadSettings;
}

export interface ShitarabaNextThreadSettings {
  enabled: boolean;
  createAtResponseNumber: number;
  switchAtResponseNumber: number;
  titleMode: 'auto' | 'manual';
  manualTitle: string;
  bodyMode: 'auto' | 'manual';
  manualBody: string;
  announceCurrentThread: boolean;
  announcementTemplate: string;
  authorName: string;
  email: string;
}

export interface ShitarabaNextThreadState {
  status:
    | 'disabled'
    | 'manualReady'
    | 'monitoring'
    | 'inputRequired'
    | 'creating'
    | 'created'
    | 'uncertain'
    | 'browserRequired'
    | 'failed';
  maxResponseNumber: number | null;
  remainingResponses: number | null;
  plannedTitle: string | null;
  plannedBody: string | null;
  nextThreadUrl: string | null;
  message: string | null;
  updatedAt: string;
}

export interface SourcesSettings {
  autoConnect: boolean;
  youtube: YouTubeSourceSettings;
  twitch: TwitchSourceSettings;
  shitaraba: ShitarabaSourceSettings;
}

export interface CommentListSettings extends DisplayFields {
  stackDirection: StackDirection;
  fontFamily: string;
  fontSizePx: number;
  textColor: string;
  backgroundColor: string;
}

export interface CommentFilterSettings {
  ngWords: string[];
  asciiArtEnabled: boolean;
}

export interface TextEffectRuleBase {
  id: string;
  enabled: boolean;
  trigger: string;
  displayText: string;
  color: string;
}

export type TextEffectRule =
  | (TextEffectRuleBase & { countMode: 'fixed'; fixedCount: number })
  | (TextEffectRuleBase & { countMode: 'consecutive'; minimumConsecutiveCount: number });

export interface TextEffectsSettings {
  enabled: boolean;
  fontSizePx: number;
  fallDurationSeconds: number;
  maxActiveItems: number;
  rules: TextEffectRule[];
}

export interface TextEffectItem {
  text: string;
  color: string;
}

export interface TextEffectTriggeredPayload {
  eventId: string;
  occurredAt: string;
  seed: string;
  items: TextEffectItem[];
}

export interface AppSettings {
  aiListener: import('./ai-listener').AiSettings;
  schemaVersion: typeof compatibilityPolicy.contracts.pcSettings.current;
  application: ApplicationSettings;
  sources: SourcesSettings;
  commentOverlay: CommentOverlaySettings;
  speechRecognitionOverlay: SpeechRecognitionOverlaySettings;
  commentList: CommentListSettings;
  commentFilter: CommentFilterSettings;
  character: CharacterSettings;
  commentSpeech: CommentSpeechSettings;
  mobileSpeech: MobileSpeechSettings;
  speechRecognition: SpeechRecognitionSettings;
  textEffects: TextEffectsSettings;
}

export type SettingsSection = Exclude<keyof AppSettings, 'schemaVersion'>;

export interface SourceStatusView {
  source: ConnectionKey;
  service?: CommentSource;
  state: 'stopped' | 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error';
  message: string | null;
  updatedAt: string;
}

export interface AppSnapshot {
  initialSetup?: import('./initial-setup').InitialSetupView;
  updateNotices?: import('./update-notices').UpdateNotice[];
  aiListener?: import('./ai-listener').AiView;
  smartphone?: import('./smartphone').SmartphoneView;
  obsControl?: import('./obs-control').ObsControlView;
  obsSourceRegistration?: import('./obs-source-registration').ObsSourceRegistrationState;
  obsSourceTest?: import('./obs-source-test').ObsSourceTestState;
  settings: AppSettings;
  settingsRevision: number;
  comments: CommonComment[];
  sourceStatuses: Record<ConnectionKey, SourceStatusView>;
  commentOverlay: CommentOverlayState;
  character: CharacterState;
  commentSpeech: CommentSpeechState;
  mobileSpeech: MobileSpeechState;
  shitarabaNextThread: ShitarabaNextThreadState;
  speechRecognition: SpeechRecognitionState;
  speechRecognitionOverlay: SpeechRecognitionOverlayState;
  warning?: string;
}

export interface RealtimeEvent<T = unknown> {
  type:
    | 'aiListener.stateChanged'
    | 'smartphone.stateChanged'
    | 'obsControl.stateChanged'
    | 'obsSourceRegistration.stateChanged'
    | 'obsSourceRegistration.contextInvalidated'
    | 'obsSourceTest.stateChanged'
    | 'initialSetup.stateChanged'
    | 'state.snapshot'
    | 'comment.received'
    | 'comment.removed'
    | 'source.statusChanged'
    | 'settings.changed'
    | 'commentOverlay.stateChanged'
    | 'character.stateChanged'
    | 'commentSpeech.stateChanged'
    | 'mobileSpeech.stateChanged'
    | 'shitarabaNextThread.stateChanged'
    | 'speechRecognition.stateChanged'
    | 'speechRecognition.resultReceived'
    | 'speechRecognitionOverlay.stateChanged'
    | 'speechRecognitionOverlay.appearanceChanged'
    | 'textEffects.triggered'
    | 'application.stopping';
  revision: number;
  payload: T;
}

export type SpeechRecognitionOverlayRealtimeEvent =
  | { type: 'speechRecognitionOverlay.snapshot'; revision: number; payload: SpeechRecognitionOverlayBootstrap }
  | { type: 'speechRecognitionOverlay.stateChanged'; revision: number; payload: SpeechRecognitionOverlayState }
  | { type: 'speechRecognitionOverlay.appearanceChanged'; revision: number; payload: SpeechRecognitionOverlayAppearance }
  | { type: 'application.stopping'; revision: number; payload: null };

export interface MobileCommentsBootstrap {
  protocolVersion: typeof compatibilityPolicy.contracts.mobileProtocol.current;
  comments: CommonComment[];
  sourcesRunning: boolean;
  mobilePublished: boolean;
  audioAvailable: boolean;
  commentList: CommentListSettings;
}

export const MOBILE_PROTOCOL_VERSION = compatibilityPolicy.contracts.mobileProtocol.current;

export type MobileCommentsRealtimeEvent =
  | { type: 'mobile.snapshot'; payload: MobileCommentsBootstrap }
  | { type: 'comment.received'; revision: number; payload: CommonComment }
  | { type: 'comment.removed'; revision: number; payload: { id: string } }
  | { type: 'mobile.subscription'; payload: { status: 'started' | 'busy' } }
  | { type: 'mobile.audioReady'; payload: { audioId: string; commentId: string } }
  | { type: 'mobile.audioAvailabilityChanged'; payload: { audioAvailable: boolean } }
  | { type: 'source.activityChanged'; payload: { sourcesRunning: boolean } }
  | { type: 'commentList.settingsChanged'; payload: CommentListSettings };
