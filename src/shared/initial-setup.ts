import { smartphoneDeviceDataReceiving } from './smartphone';
import type { AppSnapshot } from './types';

export const setupFeatures = [
  ['sources', 'コメントをまとめて見る', 'YouTube・Twitch・掲示板のコメントを取得します。'],
  ['commentSpeech', 'コメントを読み上げる', 'VOICEVOXの声で新着コメントを聞けます。'],
  ['commentOverlay', 'コメントをOBSに表示', '配信画面にコメントを重ねます。'],
  ['speechRecognition', '配信者の声を文字にする', 'PC内で音声認識し、字幕にも使えます。'],
  ['smartphone', 'スマホと連携する', 'コメント・読み上げ・カメラやマイクを使います。'],
  ['aiListener', 'AIリスナーを使う', '配信の会話に参加するAIを準備します。'],
  ['textEffects', 'コメントで文字演出', '反応ワードに合わせて文字や絵文字を出します。'],
  ['character', 'キャラクターを表示', '画像を表示し、読み上げに合わせて口を動かします。'],
] as const;
export type SetupFeature = typeof setupFeatures[number][0];
export const setupStepIds = ['sources', 'commentSpeech', 'smartphone', 'speechRecognition', 'obsControl', 'aiListener', 'textEffects', 'character', 'obsDisplay'] as const;
export type SetupStep = typeof setupStepIds[number];
export type SetupPosition = 'welcome' | 'features' | SetupStep | 'summary';
export const smartphoneUses = ['comments', 'speech', 'video'] as const;
export type SmartphoneUse = typeof smartphoneUses[number];
export interface InitialSetupRecord {
  version: 1;
  revision: number;
  autoShow: boolean;
  started: boolean;
  completed: boolean;
  selected: SetupFeature[];
  smartphoneUses: SmartphoneUse[];
  position: SetupPosition;
  deferred: SetupStep[];
  confirmations: Partial<Record<SetupStep, string>>;
}
export interface InitialSetupView extends InitialSetupRecord {
  fingerprints: Record<SetupStep, string>;
  warning?: string;
}
export type InitialSetupAction =
  { action: 'open' | 'finish' | 'reload' } |
  { action: 'select'; selected: SetupFeature[]; smartphoneUses: SmartphoneUse[] } |
  { action: 'move'; position: SetupPosition } |
  { action: 'defer'; step: SetupStep } |
  { action: 'unconfirm'; step: SetupStep } |
  { action: 'confirm'; step: SetupStep; fingerprint: string }
;
export type InitialSetupCommand = { revision: number } & InitialSetupAction;
export const setupStepLabels: Record<SetupStep, string> = {
  sources: 'コメントの接続', commentSpeech: 'コメント読み上げ', smartphone: 'スマホ連携',
  speechRecognition: '配信者音声認識', obsControl: 'OBSの接続', aiListener: 'AIリスナー',
  textEffects: 'コメント文字演出', character: 'キャラクター', obsDisplay: 'OBSの表示確認',
};
export function initialSetupSteps(record: Pick<InitialSetupRecord, 'selected' | 'smartphoneUses'>): SetupStep[] {
  const has = (feature: SetupFeature) => record.selected.includes(feature);
  const ai = has('aiListener');
  const displays = has('commentOverlay') || has('textEffects') || has('character') || has('speechRecognition');
  return setupStepIds.filter(step => ({
    sources: has('sources') || ai || has('commentSpeech') || has('commentOverlay') || has('textEffects') || has('smartphone') && record.smartphoneUses.some(use => use === 'comments' || use === 'speech'),
    commentSpeech: has('commentSpeech') || has('smartphone') && record.smartphoneUses.includes('speech'),
    smartphone: has('smartphone'), speechRecognition: has('speechRecognition') || ai,
    obsControl: displays || ai,
    aiListener: ai, textEffects: has('textEffects'), character: has('character'), obsDisplay: displays,
  })[step]);
}
export function setupConfigured(step: SetupStep, s: AppSnapshot, uses: SmartphoneUse[] = s.initialSetup?.smartphoneUses ?? []): boolean {
  switch (step) {
    case 'sources': return Boolean(s.settings.sources.youtube.target.trim() || s.settings.sources.twitch.channel.trim() || s.settings.sources.shitaraba.threadUrl.trim());
    case 'commentSpeech': return Boolean(s.settings.commentSpeech.voice) && s.commentSpeech.engineStatus === 'ready';
    case 'smartphone': {
      if (!s.smartphone?.devices.length) return false;
      if (!uses.includes('video')) return true;
      const phone = s.smartphone;
      const network = phone.settings.activeNetwork;
      return Boolean(phone.available && network && phone.devices.some(device => smartphoneDeviceDataReceiving(device, network, network)));
    }
    case 'speechRecognition': return s.speechRecognition.modelStatus === 'ready' && (s.settings.speechRecognition.inputSource !== 'smartphone' || Boolean(s.settings.speechRecognition.smartphoneDeviceId));
    case 'obsControl': return Boolean(s.obsControl?.passwordConfigured);
    case 'aiListener': {
      const participants = Object.entries(s.settings.aiListener.participants).filter(([, p]) => p.enabled);
      return Boolean(s.aiListener?.hasKey && participants.length && participants.every(([source, p]) => s.settings.aiListener.personas.some(persona => persona.id === p.personaId) && (source === 'shitaraba' || source === 'jpnkn' || s.aiListener?.services[source as 'youtube' | 'twitch'].account)));
    }
    case 'textEffects': return s.settings.textEffects.rules.length > 0;
    case 'character': return Boolean(s.settings.character.simple.closedAsset);
    case 'obsDisplay': return true; // Registration and real visibility require the explicit personal check.
  }
}
export function setupProgressLabel(step: SetupStep, view: InitialSetupView, snapshot: AppSnapshot): string {
  if (view.confirmations[step] === view.fingerprints[step]) return step === 'aiListener' ? '前回の利用準備確認済み' : '前回の動作確認済み';
  if (view.deferred.includes(step)) return '後回し';
  return setupConfigured(step, snapshot) ? '設定済み・動作未確認' : '未確認・準備が必要';
}
