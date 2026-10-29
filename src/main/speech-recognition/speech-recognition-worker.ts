import type {
  SpeechRecognitionMicrophone,
  SpeechRecognitionModelStatus,
  SpeechRecognitionResult,
  SpeechRecognitionRuntimeStatus,
  SpeechRecognitionSettings,
} from '../../shared/types';

export type SpeechRecognitionWorkerEvent =
  | { type: 'status'; status: SpeechRecognitionRuntimeStatus; sessionId?: string | null; warning?: string | null }
  | { type: 'model'; status: SpeechRecognitionModelStatus; progress?: number | null; warning?: string | null }
  | { type: 'microphones'; microphones: SpeechRecognitionMicrophone[] }
  | { type: 'wavSaving'; enabled: boolean; sessionId?: string | null; warning?: string | null }
  | { type: 'result'; result: SpeechRecognitionResult }
  | { type: 'fatal'; warning: string };

export interface SpeechRecognitionWorker {
  subscribe(listener: (event: SpeechRecognitionWorkerEvent) => void): () => void;
  initialize(): Promise<void>;
  listMicrophones(): Promise<SpeechRecognitionMicrophone[]>;
  prepareModel(): Promise<void>;
  start(settings: SpeechRecognitionSettings, externalInput?: SpeechRecognitionExternalInput): Promise<{ sessionId: string }>;
  stop(discard?: boolean): Promise<void>;
  setWavSaving(enabled: boolean): Promise<void>;
  setVoiceCapturePeriod?(id: string): Promise<void>;
  retry(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface SpeechRecognitionExternalInput { udpPort: number; ffmpegPath: string; generation: string; }

export const unavailableSpeechRecognitionWorker: SpeechRecognitionWorker = {
  subscribe: () => () => undefined,
  initialize: async () => undefined,
  listMicrophones: async () => [],
  prepareModel: async () => { throw new Error('音声認識ワーカーを利用できません。'); },
  start: async () => { throw new Error('音声認識ワーカーを利用できません。'); },
  stop: async () => undefined,
  setWavSaving: async () => undefined,
  retry: async () => undefined,
  shutdown: async () => undefined,
};
