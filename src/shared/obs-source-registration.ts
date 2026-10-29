export const obsOverlayDefinitions = {
  comments: { title: 'コメント', path: '/overlay/comments' },
  speech: { title: '音声認識', path: '/overlay/speech-recognition' },
  character: { title: 'キャラクター', path: '/overlay/character' },
  effects: { title: '文字演出', path: '/overlay/text-effects' },
} as const;

export type ObsSourceTarget =
  | { kind: 'overlay'; overlay: keyof typeof obsOverlayDefinitions }
  | { kind: 'smartphone'; deviceId: string };

export interface ObsSourceCandidate { uuid: string; name: string }
export interface ObsSourceScene { uuid: string; name: string }
export interface ObsSourceContext {
  target: ObsSourceTarget;
  title: string;
  collection: string;
  scenes: ObsSourceScene[];
  currentSceneUuid: string | null;
  canvas: { width: number; height: number };
  candidates: ObsSourceCandidate[];
  presentInputUuids: string[];
  incompatible: Array<ObsSourceCandidate & { reason: string }>;
}

export interface ObsSourceAddRequest {
  target: ObsSourceTarget;
  collection: string;
  sceneUuid: string;
  inputUuid?: string;
  retryOperationId?: string;
}

export type ObsSourceOperationStatus = 'running' | 'succeeded' | 'failed' | 'incomplete' | 'unknown';
export type ObsSourceOperationPhase = 'checking' | 'creatingInput' | 'addingItem' | 'configuring' | 'verifying' | 'complete';
export interface ObsSourceOperation {
  id: string;
  target: ObsSourceTarget;
  title: string;
  collection: string;
  sceneUuid: string;
  sceneName: string;
  status: ObsSourceOperationStatus;
  phase: ObsSourceOperationPhase;
  result: 'created' | 'reused' | 'alreadyPresent' | null;
  inputUuid: string | null;
  sceneItemId: number | null;
  errorCode: string | null;
  message: string;
}

export interface ObsSourceRegistrationState {
  busy: boolean;
  lastOperation: ObsSourceOperation | null;
  unfinishedOperations?: ObsSourceOperation[];
}
