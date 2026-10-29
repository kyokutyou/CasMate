// Throwaway: fictional settings only; no production API or persisted settings.
export const categories = [
  { id: 'comments', name: 'コメント', icon: 'chat', description: '接続先・フィルター・次スレッド' },
  { id: 'audio', name: '音声', icon: 'audio', description: '読み上げ・配信者音声認識' },
  { id: 'ai', name: 'AIリスナー', icon: 'spark', description: '人格・参加設定・発言の間隔' },
  { id: 'display', name: '表示・演出', icon: 'display', description: 'OBS表示・キャラクター・文字演出' },
  { id: 'mobile', name: 'スマホ・外配信', icon: 'phone', description: 'スマホ接続・Android外配信' },
  { id: 'app', name: '接続・アプリ', icon: 'settings', description: 'OBS連携・画面URL' },
] as const;
export type Category = typeof categories[number]['id'];
export type Field = { key: string; label: string; kind?: 'toggle' | 'number' | 'select' | 'textarea'; options?: string[]; min?: number; max?: number; step?: number; help?: string };
export type Feature = { id: string; category: Category; name: string; description: string; fields: Field[]; preview?: boolean; guide?: boolean };
export const features: Feature[] = [
  { id: 'sources', category: 'comments', name: 'コメント取得', description: 'YouTube Live・Twitch・したらばの接続先', fields: [
    { key: 'youtube', label: 'YouTube Live 接続先' }, { key: 'twitch', label: 'Twitch 接続先' }, { key: 'shitaraba', label: 'したらば 接続先' },
    { key: 'interval', label: 'したらば 取得間隔（秒）', kind: 'number', min: 1 }, { key: 'autoConnect', label: '起動時に自動接続', kind: 'toggle' },
  ] },
  { id: 'filter', category: 'comments', name: 'コメントフィルター', description: '表示と読み上げから除外する条件', fields: [
    { key: 'ngWords', label: 'NGワード（1行に1件）', kind: 'textarea' }, { key: 'asciiFilter', label: '複数行アスキーアートを除外', kind: 'toggle' },
  ] },
  { id: 'nextThread', category: 'comments', name: 'したらば次スレッド作成', description: '作成条件と次スレッドの内容', fields: [
    { key: 'nextEnabled', label: '次スレッドを自動作成', kind: 'toggle' }, { key: 'nextAt', label: '作成するレス番号', kind: 'number', min: 1 }, { key: 'nextTitle', label: '次スレッドのタイトル' },
  ] },
  { id: 'speech', category: 'audio', name: 'コメント読み上げ', description: '声・速度・音量を調整', fields: [
    { key: 'speechOn', label: 'コメントを読み上げる', kind: 'toggle' }, { key: 'voice', label: '話者・スタイル', kind: 'select', options: ['ずんだもん / ノーマル', '四国めたん / ノーマル', '春日部つむぎ / ノーマル'] },
    { key: 'speed', label: '読み上げ速度', kind: 'number', min: 0.5, max: 2, step: 0.1 }, { key: 'volume', label: '音量', kind: 'number', min: 0, max: 2, step: 0.1 },
  ] },
  { id: 'recognition', category: 'audio', name: '配信者音声認識', description: 'マイク選択と認識結果の確認', preview: true, fields: [
    { key: 'recognitionOn', label: '配信者音声認識を使用', kind: 'toggle' }, { key: 'mic', label: '入力マイク', kind: 'select', options: ['既定のマイク', 'USBマイク（サンプル）'] },
  ] },
  { id: 'ai', category: 'ai', name: 'AIリスナー', description: '人格・参加先・発言ペースを設定', fields: [
    { key: 'aiOn', label: 'AIリスナーを稼働', kind: 'toggle' }, { key: 'persona', label: '人格の名前' }, { key: 'personality', label: '性格・話し方', kind: 'textarea' },
    { key: 'aiSource', label: '参加するコメントソース', kind: 'select', options: ['YouTube Live', 'Twitch', 'したらば'] }, { key: 'aiWait', label: '発言待ち時間（秒）', kind: 'number', min: 10 },
  ] },
  { id: 'overlay', category: 'display', name: 'OBSコメント表示', description: '配信画面に出すコメントの見た目', preview: true, fields: [
    { key: 'overlayMode', label: '表示方法', kind: 'select', options: ['1件ずつ', '積み上げ'] }, { key: 'fontSize', label: '文字サイズ（px）', kind: 'number', min: 8, max: 200 }, { key: 'showAuthor', label: '投稿者名を表示', kind: 'toggle' },
  ] },
  { id: 'effects', category: 'display', name: 'コメント文字演出', description: '反応ワードに合わせて文字を表示', preview: true, fields: [
    { key: 'effectsOn', label: '文字演出を使用', kind: 'toggle' }, { key: 'trigger', label: '反応ワード' }, { key: 'effectText', label: '表示する文字' },
  ] },
  { id: 'character', category: 'display', name: 'キャラクター', description: '独立ウィンドウと表示方法', preview: true, fields: [
    { key: 'characterOn', label: '独立ウィンドウを表示', kind: 'toggle' }, { key: 'onTop', label: '常に最前面', kind: 'toggle' }, { key: 'clickThrough', label: 'クリック透過', kind: 'toggle' },
  ] },
  { id: 'commentList', category: 'display', name: 'コメント一覧', description: '手元で確認するコメントの見た目', preview: true, fields: [
    { key: 'listOn', label: '独立ウィンドウを表示', kind: 'toggle' }, { key: 'listFontSize', label: '文字サイズ（px）', kind: 'number', min: 8, max: 200 }, { key: 'direction', label: '積み上げ方向', kind: 'select', options: ['新着を下へ', '新着を上へ'] },
  ] },
  { id: 'mobile', category: 'mobile', name: 'スマホ音声再生', description: '接続案内・LAN・Tailscale', guide: true, fields: [
    { key: 'lan', label: 'LAN公開', kind: 'toggle' }, { key: 'tailscale', label: 'Tailscale公開', kind: 'toggle' }, { key: 'bitrate', label: 'AAC目標ビットレート（kbps）', kind: 'number', min: 16, max: 128 },
  ] },
  { id: 'outdoor', category: 'mobile', name: 'Android外配信', description: '外配信用の登録とOBS受信設定', guide: true, fields: [
    { key: 'outdoorOn', label: 'Android外配信を使用', kind: 'toggle' }, { key: 'srtPort', label: 'SRT受信ポート', kind: 'number', min: 1024, max: 65535 },
  ] },
  { id: 'obs', category: 'app', name: 'OBS操作', description: '接続設定・音声操作・Android操作', fields: [
    { key: 'obsOn', label: 'OBS連携を使用', kind: 'toggle' }, { key: 'obsHost', label: 'OBS接続先' }, { key: 'obsPort', label: 'WebSocketポート', kind: 'number', min: 1024, max: 65535 },
    { key: 'voiceControl', label: '音声操作を使用', kind: 'toggle' }, { key: 'androidControl', label: 'Android操作を使用', kind: 'toggle' },
  ] },
  { id: 'urls', category: 'app', name: '画面URL', description: '各表示画面のURL・アプリ設定', fields: [
    { key: 'overlayUrl', label: 'OBSコメント表示URL（サンプル）' }, { key: 'appPort', label: 'バックエンドポート', kind: 'number', min: 1024, max: 65535 },
  ] },
];
export type Values = Record<string, string | boolean>;
export const initialValues: Values = {
  youtube: 'https://www.youtube.com/watch?v=DEMO_ONLY', twitch: 'casmate_demo', shitaraba: 'https://jbbs.shitaraba.net/bbs/read.cgi/demo/123/456/', interval: '5', autoConnect: true,
  ngWords: '', asciiFilter: true, nextEnabled: false, nextAt: '950', nextTitle: 'のんびり雑談配信 その2',
  speechOn: true, voice: 'ずんだもん / ノーマル', speed: '1.0', volume: '1.0', recognitionOn: true, mic: '既定のマイク',
  aiOn: false, persona: 'こはる', personality: '穏やかで聞き上手。配信者の話題に短く自然に反応する。', aiSource: 'YouTube Live', aiWait: '60',
  overlayMode: '1件ずつ', fontSize: '28', showAuthor: true, effectsOn: true, trigger: 'おつかれ', effectText: 'おつかれさま！',
  characterOn: false, onTop: true, clickThrough: false, listOn: true, listFontSize: '16', direction: '新着を下へ',
  lan: true, tailscale: false, bitrate: '48', outdoorOn: false, srtPort: '9000', obsOn: true, obsHost: '127.0.0.1', obsPort: '4455', voiceControl: false, androidControl: true,
  overlayUrl: 'http://127.0.0.1:3900/overlay/comments', appPort: '3900',
};
export const scenarios = ['コメントの接続先を変更', '読み上げの声と速度を変更', 'AIリスナーの人格を編集', 'OBSコメントの文字サイズを変更', 'スマホ接続の案内を開く', '接続エラーから設定へ移動'];
export const variants = ['A', 'B', 'C', 'C1', 'C2', 'C3', 'V1', 'V2', 'V3', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'] as const;
export type Variant = typeof variants[number];
export type HomeVariant = 'A1' | 'A2' | 'A3';
export type DerivedVariant = 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3';
export const variantNames: Record<Variant, string> = {
  A: 'ホーム＋設定', B: '左メニュー', C: '用途別タブ',
  C1: '用途 × 3つの分類', C2: '用途 × 設定ナビ', C3: '用途 × 一覧と検索',
  V1: '縦長・手順ガイド', V2: '縦長・下部タブ', V3: '縦長・その場で編集',
  A1: '基本ホーム', A2: '下部タブのホーム', A3: '操作バー付きホーム', A4: 'A改良案',
  A5: '元のAを磨く', A6: '操作と設定を左右に', A7: '必要な部分を開く',
};
export const variantGroups = [
  { id: 'original', label: '元の3案', variants: ['A', 'B', 'C'] },
  { id: 'composed', label: 'Aを見直す3案', variants: ['A5', 'A6', 'A7'] },
  { id: 'refined', label: 'A改良案', variants: ['A4'] },
  { id: 'derived', label: 'Cからの3案', variants: ['C1', 'C2', 'C3'] },
  { id: 'portrait', label: '縦長の3案', variants: ['V1', 'V2', 'V3'] },
  { id: 'homePortrait', label: 'Aの縦長3案', variants: ['A1', 'A2', 'A3'] },
] as const;
export function parseVariant(value: string | null): Variant { return variants.find(v => v === value) ?? 'A'; }
export function isHomeVariant(value: Variant): value is HomeVariant { return value === 'A1' || value === 'A2' || value === 'A3'; }
export function isDerivedVariant(value: Variant): value is DerivedVariant { return value.startsWith('C') && value !== 'C' || value.startsWith('V'); }
export function isPortraitVariant(value: Variant): boolean { return value.startsWith('V') || isHomeVariant(value); }
export function adjacentVariant(value: Variant, direction: number): Variant {
  return variants[(variants.indexOf(value) + direction + variants.length) % variants.length];
}
export const purposeFeatures = {
  '配信準備': ['sources', 'speech', 'recognition', 'ai', 'filter', 'nextThread', 'overlay', 'effects', 'character', 'commentList', 'obs', 'urls'],
  '配信中': ['speech', 'ai', 'sources', 'obs', 'recognition', 'commentList', 'character', 'nextThread', 'effects', 'filter', 'overlay', 'urls'],
  '外配信': ['mobile', 'outdoor', 'obs', 'sources', 'speech'],
};
