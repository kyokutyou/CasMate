// In-memory sample state only. Never import this module into the product.
export const variants = [
  { id: 'A', name: '操作を上部に集約', description: 'コメントのすぐ上に、いつもの3操作。状態も一列にまとめます。' },
  { id: 'B', name: '操作を左に常設', description: '操作と状態を左、コメントを右へ。視線の行き先を分けます。' },
  { id: 'C', name: 'コメントを広く、操作は下へ', description: 'コメントの高さを優先。いつもの操作を画面下に常設します。' },
] as const;
export type Variant = typeof variants[number]['id'];
export const sources = ['YouTube Live', 'Twitch', '掲示板'] as const;
export type Source = typeof sources[number];
export type Operation = 'speech' | 'ai' | 'recognition';
export type Scenario = 'normal' | 'offline' | 'attention' | 'empty';
export interface SampleComment { id: number; source: Source; author: string; text: string; time: string }
export interface PreviewState {
  operations: Record<Operation, boolean>;
  aiAttention: boolean;
  connections: Record<Source, 'connected' | 'stopped' | 'error'>;
  comments: SampleComment[];
  follow: boolean;
  flowing: boolean;
  obs: 'streaming' | 'stopped';
  previewActive: boolean;
  windows: { comments: boolean; character: boolean };
  latestAction: string;
}
const phrases = [
  ['こはる', 'こんばんは！今日も配信楽しみにしていました'],
  ['みずき', '声、ちゃんと聞こえていますよ'],
  ['たけ', '今の場面、すごくよかった！'],
  ['なつ', 'この色の組み合わせ好きだな'],
  ['しお', '途中から来ました。何を作っているところですか？'],
  ['あお', 'ゆっくりで大丈夫ですよ'],
  ['はる', 'そういう使い方もできるんですね'],
  ['りん', 'さっきの話、もう少し聞きたいです'],
  ['ゆう', 'なるほど、分かりやすい！'],
  ['そら', '作業のお供に見ています。お疲れさまです'],
] as const;
export function commentAt(id: number, source: Source = sources[id % 2]): SampleComment {
  const [author, text] = phrases[id % phrases.length];
  return { id, source, author, text, time: `21:${String(12 + Math.floor(id / 60)).padStart(2, '0')}:${String(id % 60).padStart(2, '0')}` };
}
export function initialState(): PreviewState {
  return { operations: { speech: true, ai: true, recognition: false }, aiAttention: false,
    connections: { 'YouTube Live': 'connected', Twitch: 'connected', '掲示板': 'stopped' },
    comments: Array.from({ length: 24 }, (_, index) => commentAt(index)), follow: true, flowing: false,
    obs: 'streaming', previewActive: false, windows: { comments: false, character: false }, latestAction: '操作を試してください' };
}
export function applyScenario(state: PreviewState, scenario: Scenario): PreviewState {
  const base = { ...state, latestAction: `見本の状態を変更：${scenario}`, flowing: false };
  if (scenario === 'empty') return { ...base, comments: [], follow: true, aiAttention: false,
    operations: { ...state.operations, ai: false }, connections: { 'YouTube Live': 'stopped', Twitch: 'stopped', '掲示板': 'stopped' } };
  if (scenario === 'offline') return { ...base, aiAttention: false, connections: { ...state.connections, Twitch: 'error' } };
  if (scenario === 'attention') return { ...base, aiAttention: true, operations: { ...state.operations, ai: false } };
  return { ...base, aiAttention: false, connections: { 'YouTube Live': 'connected', Twitch: 'connected', '掲示板': 'stopped' },
    comments: state.comments.length ? state.comments : initialState().comments };
}
