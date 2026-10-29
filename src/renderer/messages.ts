import type { ConnectionKey, SourceStatusView } from '../shared/types';
export const messages = {
  appName: 'きゃすメイト',
  version: 'v0.5.0',
  loading: '起動状態を読み込んでいます…',
  notifications: '通知',
  openDetails: '詳細を開く',
  closeDetails: '閉じる',
  windowControls: '独立ウィンドウ',
  previewRunning: '音声認識プレビュー実行中',
  checkDetails: '詳細の入力内容を確認してください。',
  backendDisconnected: 'ローカルバックエンドとの接続が切れています。再接続を待っています。',
  settingsSaveFailed: '設定を保存できませんでした。',
  noComments: 'コメントはまだありません。',
  autoScroll: '自動スクロール',
  alwaysOnTop: '最前面表示',
  on: 'オン',
  off: 'オフ',
  startAll: '有効なソースを一括開始',
  stopAll: 'すべて停止',
  copy: 'コピー',
  open: '開く',
  uploadClosed: '閉口素材を選択',
  uploadOpen: '口開き素材を選択',
  showIndependentWindow: '独立窓を表示',
  hideIndependentWindow: '独立窓を非表示',
  shitarabaPollInterval: 'コメント取得間隔（秒）',
  characterWindowShown: 'キャラクター窓を表示しました。',
  characterWindowHidden: 'キャラクター窓を非表示にしました。',
  commentListWindowShown: 'コメント一覧窓を表示しました。',
  commentListWindowHidden: 'コメント一覧窓を非表示にしました。',
} as const;

export const sourceLabels = {
  youtube: 'YouTube Live',
  twitch: 'Twitch',
  shitaraba: 'したらば',
  jpnkn: 'jpnkn',
} as const;

export const statusLabels = {
  stopped: '停止中',
  connecting: '接続中',
  waiting: '配信開始待ち',
  connected: '接続済み',
  reconnecting: '再接続中',
  error: 'エラー',
} as const;

export const connectionLabels = { youtube: 'YouTube Live', twitch: 'Twitch', shitaraba: '掲示板' };
export function connectionLabel(source: ConnectionKey, status?: SourceStatusView): string {
  return status?.service ? sourceLabels[status.service] : connectionLabels[source];
}
