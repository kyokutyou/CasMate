import { createContext, type ReactNode } from 'react';
import type { ConnectionKey } from '../shared/types';
import type { SmartphoneNetwork } from '../shared/smartphone';
import { initialSetupSteps, type InitialSetupRecord, type SetupPosition, type SmartphoneUse } from '../shared/initial-setup';

export const managementPages = [
  ['home', 'ホーム', '配信のホーム'],
  ['live', '配信中', 'コメントと、いつもの操作'],
  ['settings', '設定', '設定'],
] as const;
export type ManagementPage = typeof managementPages[number][0];
export const isSetupWorkspace = (position: SetupPosition) => ['sources', 'commentSpeech', 'smartphone', 'speechRecognition', 'obsControl', 'aiListener', 'textEffects', 'character', 'obsDisplay'].includes(position);
export const SetupPresentation = createContext<{ source: ConnectionKey; selectSource(source: ConnectionKey): void; confirmation?: ReactNode; obsDisplayPlanned?: boolean; effectExample?: string; setEffectExample?(value: string): void; effectRuleId?: string; setEffectRuleId?(id: string): void; characterMouth?: 'closed' | 'open'; setCharacterMouth?(shape: 'closed' | 'open'): void; obsRegistration?: ReactNode; smartphoneCommentsReady?: boolean; smartphoneSpeechEnabled?: boolean; smartphoneSpeechReady?: boolean; smartphoneUses?: SmartphoneUse[]; selectSmartphoneUses?(uses: SmartphoneUse[]): void; selectionPending?: boolean; smartphoneNetwork?: SmartphoneNetwork; selectSmartphoneNetwork?(network: SmartphoneNetwork): void }>({ source: 'youtube', selectSource: () => undefined });

export const managementSections = [
  { group: 'コメント', items: [['sources', 'コメント取得', '接続先・自動接続', '◉'], ['commentFilter', 'コメントフィルター', 'NGワード・アスキーアート', '◇'], ['nextThread', '掲示板の次スレッド作成', '作成条件・案内・復旧', '↗']] },
  { group: '音声・AI', items: [['commentSpeech', 'コメント読み上げ', '話者・速度・VOICEVOX', '♫'], ['speechRecognition', '配信者音声認識', 'マイク・認識設定・OBS表示', '♩'], ['aiListener', 'AIリスナー', '人格・参加設定・記憶・連携', '✦']] },
  { group: '表示・演出', items: [['textEffects', 'コメント文字演出', '反応ワード・ルール・テスト', '✧'], ['character', 'キャラクター', '画像・微動・ウィンドウ', '♧'], ['commentList', 'コメント一覧', '外観・表示項目', '☷']] },
  { group: 'OBS', items: [['commentOverlay', 'OBSコメント表示', '表示方法・表示項目・デザイン', '▤'], ['speechRecognitionOverlay', 'OBS音声認識表示', '表示時間・別窓でデザイン編集', '♩'], ['obsControl', 'OBS操作', 'OBS接続・音声とAndroidの操作設定', '◎'], ['urls', 'OBSにソースを追加', 'OBSへの追加・URL', '↗']] },
  { group: 'スマホ連携', items: [['smartphone', 'スマホ連携', 'コメント・読み上げ・映像送信', '▯']] },
  { group: 'アプリ', items: [['application', 'アプリ設定', '配色・文字サイズ・ポート・バージョン', '⚙']] },
] as const;
export type ManagementEditor = typeof managementSections[number]['items'][number][0] | 'mobileSpeech' | 'outdoor';
export function setupEditor(position: SetupPosition, selected?: InitialSetupRecord['selected']): ManagementEditor | null {
  return position === 'obsDisplay' ? !selected || selected.includes('commentOverlay') ? 'commentOverlay' : selected.includes('speechRecognition') ? 'speechRecognitionOverlay' : selected.includes('textEffects') ? 'textEffects' : selected.includes('character') ? 'character' : 'commentOverlay'
    : ['welcome', 'features', 'summary'].includes(position) ? null : position as ManagementEditor;
}
// Validation follows the selected steps and their independent display editors.
// Keeping this separate from the visible editor preserves the minimal setup UI.
export function setupValidationEditors(view: Pick<InitialSetupRecord, 'selected' | 'smartphoneUses' | 'deferred'>, position: SetupPosition): ManagementEditor[] {
  const positions = position === 'summary' ? initialSetupSteps(view).filter(step => !view.deferred.includes(step)) : [position];
  return [...new Set(positions.flatMap(step => {
    if (step === 'obsDisplay') return [
      'obsControl' as const,
      ...(view.selected.includes('commentOverlay') ? ['commentOverlay' as const] : []),
      ...(view.selected.includes('speechRecognition') ? ['speechRecognitionOverlay' as const] : []),
    ];
    const editor = setupEditor(step);
    return editor ? [editor] : [];
  }))];
}
export const isSmartphoneEditor = (editor: ManagementEditor | null) => editor === 'smartphone' || editor === 'mobileSpeech' || editor === 'outdoor';
export const ManagementNavigation = createContext<{
  editor: ManagementEditor | null;
  page?: ManagementPage;
  initialSetup?: boolean;
  initialSetupPending?: boolean;
  setupPosition?: SetupPosition;
  initialSetupEntry?: { resume: boolean; open(): void };
  isHistoryNavigation?(): boolean;
  go?(page: ManagementPage): void;
  open(editor: ManagementEditor, entry: HTMLElement, target?: string): void;
  reportError(id: string, error: string | undefined): void;
} | null>(null);
