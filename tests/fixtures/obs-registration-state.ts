import { createDefaultSettings } from '../../src/main/core/settings';
import type { AppSnapshot } from '../../src/shared/types';
import type { ObsSourceContext, ObsSourceOperation, ObsSourceTarget } from '../../src/shared/obs-source-registration';
import { smartphoneMobileState, smartphoneView } from './smartphone-view';

export function obsRegistrationSnapshot(): AppSnapshot {
  const stopped = (source: 'youtube' | 'twitch' | 'shitaraba') => ({ source, state: 'stopped' as const, message: null, updatedAt: new Date(0).toISOString() });
  return {
    settings: createDefaultSettings(), settingsRevision: 1, comments: [],
    sourceStatuses: { youtube: stopped('youtube'), twitch: stopped('twitch'), shitaraba: stopped('shitaraba') },
    commentOverlay: { active: [], queue: [] }, character: { mouthShape: 'closed', assetWarning: null },
    commentSpeech: { engineStatus: 'disabled', currentCommentId: null, queueLength: 0, droppedCount: 0, warning: null },
    mobileSpeech: structuredClone(smartphoneMobileState), smartphone: structuredClone(smartphoneView),
    shitarabaNextThread: { status: 'disabled', maxResponseNumber: null, remainingResponses: null, plannedTitle: null, plannedBody: null, nextThreadUrl: null, message: null, updatedAt: new Date(0).toISOString() },
    speechRecognition: { status: 'disabled', modelStatus: 'missing', modelDownloadProgress: null, microphones: [], previewActive: false, wavSaving: false, previewHistory: [], sessionId: null, warning: null },
    speechRecognitionOverlay: { active: null },
    obsControl: { epoch: 'obs', revision: 1, enabled: true, connection: 'connected', voiceEnabled: false, androidEnabled: false,
      obsPort: 4455, passwordConfigured: true, phrases: { startCommand: '配信開始', stopCommand: '配信終了', startConfirm: '開始を実行', stopConfirm: '終了を実行' },
      stream: 'stopped', busy: false, confirmation: null, lastOperation: null, error: null,
      publication: { lanEnabled: false, tailscaleEnabled: false, port: 3002, ready: false, registered: false, registrationId: null, revision: null, endpoints: [], warning: null } },
    obsSourceRegistration: { busy: false, lastOperation: null },
  };
}

export function obsRegistrationContext(target: ObsSourceTarget = { kind: 'overlay', overlay: 'comments' }): ObsSourceContext {
  return { target, title: target.kind === 'overlay' ? { comments: 'コメント', speech: '音声認識', character: 'キャラクター', effects: '文字演出' }[target.overlay] : 'スマホA・家庭内LAN',
    collection: '配信', scenes: [{ uuid: 'scene-other', name: '待機' }, { uuid: 'scene-live', name: '本番' }],
    currentSceneUuid: 'scene-live', canvas: { width: 1920, height: 1080 }, candidates: [], presentInputUuids: [], incompatible: [] };
}

export function obsRegistrationOperation(target: ObsSourceTarget = { kind: 'overlay', overlay: 'comments' }): ObsSourceOperation {
  return { id: 'registration-1', target, title: obsRegistrationContext(target).title, collection: '配信', sceneUuid: 'scene-live', sceneName: '本番',
    status: 'succeeded', phase: 'complete', result: 'created', inputUuid: 'source-created', sceneItemId: 3, errorCode: null, message: 'OBSへの登録設定を確認しました。' };
}
