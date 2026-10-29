import type { ObsSourceTarget } from './obs-source-registration';
import type { CommentOverlaySettings, SimpleCharacterSettings, SpeechRecognitionOverlayAppearance, TextEffectsSettings } from './types';

export interface ObsSourceTestRequest {
  target: Extract<ObsSourceTarget, { kind: 'overlay' }>;
  collection: string;
  sceneUuid: string;
  inputUuid: string;
}
export interface ObsSourceTestContext { available: boolean; message: string }
export interface ObsSourceTestOperation extends ObsSourceTestRequest {
  id: string;
  title: string;
  phase: 'preparing' | 'sending' | 'stopping' | 'complete' | 'unknown';
  startedAt: number | null;
  expiresAt: number | null;
  message: string;
  needsAttention: boolean;
}
export interface ObsSourceTestState {
  busy: boolean;
  current: ObsSourceTestOperation | null;
  warnings: ObsSourceTestOperation[];
}
// The dedicated display channel contains no OBS identifiers or management state.
export type ObsTestDisplayData =
  | { kind: 'comments'; appearance: CommentOverlaySettings }
  | { kind: 'speech'; appearance: SpeechRecognitionOverlayAppearance }
  | { kind: 'effects'; appearance: Pick<TextEffectsSettings, 'fontSizePx' | 'fallDurationSeconds'> }
  | { kind: 'character'; appearance: SimpleCharacterSettings };
export interface ObsTestDisplay {
  testId: string;
  startedAt: number;
  expiresAt: number;
  data: ObsTestDisplayData;
}
export interface ObsTestDisplaySnapshot { revision: number; display: ObsTestDisplay | null }
