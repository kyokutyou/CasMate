import { version } from '../../package.json';
import type { CommentSource } from './types';

// The standalone editor's saved format defines its own sample/color set.
type PreviewSource = Extract<CommentSource, 'youtube' | 'twitch' | 'shitaraba'>;

export type Target = 'comments' | 'speech';
export const obsPresets = [
  { id: 'standard', label: '標準', summary: 'いつもの基本デザイン' },
  { id: 'light', label: '明るいカード', summary: '白い背景と柔らかな影' },
  { id: 'transparent', label: '背景なし', summary: '映像を生かす軽い文字の影' },
  { id: 'dark', label: 'ダークカード', summary: '濃いグレーの落ち着いたカード' },
  { id: 'outlined', label: 'くっきり縁取り', summary: '白い文字を黒い輪郭で強調' },
  { id: 'pastel', label: 'パステル', summary: '淡いピンクと大きな角丸' },
  { id: 'neon', label: 'ネオン', summary: '濃紺にシアンの光と細枠' },
  { id: 'terminal', label: 'レトロ端末', summary: '黒と緑の等幅文字' },
  { id: 'japanese', label: '和風', summary: '生成りと墨色、明朝体の文字' },
  { id: 'highContrast', label: '高視認性', summary: '黒背景に大きな太い白文字' },
] as const;
export type PresetName = typeof obsPresets[number]['id'];

export interface Shadow {
  enabled: boolean;
  color: string;
  opacity: number;
  blur: number;
  x: number;
  y: number;
}

export interface CommonDesign {
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  paddingX: number;
  paddingY: number;
  radius: number;
  lineHeight: number;
  edge: number;
  border: { enabled: boolean; color: string; opacity: number; width: number };
  textShadow: Shadow;
  cardShadow: Shadow;
  outline: { enabled: boolean; color: string; width: number };
}

export interface CommentDesign extends CommonDesign {
  showSource: boolean;
  showAuthor: boolean;
  authorColor: string;
  sourceColor: string;
  sourceBackgroundColor: string;
  sourceBackgroundOpacity: number;
  metaScale: number;
  gap: number;
  emoteScale: number;
  serviceColorsEnabled: boolean;
  badgeColors: Record<PreviewSource, string>;
}

export interface SpeechDesign extends CommonDesign {
  horizontal: 'left' | 'center' | 'right';
  vertical: 'top' | 'center' | 'bottom';
  textAlign: 'left' | 'center' | 'right';
  maxWidth: number | null;
}

export interface CommonPreview {
  width: number;
  height: number;
  background: 'checker' | 'white' | 'black';
}

export interface CommentPreview extends CommonPreview {
  mode: 'single' | 'stack';
  stackDirection: 'newestTop' | 'newestBottom';
  source: 'all' | PreviewSource;
  author: string;
  text: string;
  emotes: boolean;
}

export interface SpeechPreview extends CommonPreview { text: string }

export interface EditorDocument {
  formatVersion: 1;
  appVersion: string;
  designs: { comments: CommentDesign; speech: SpeechDesign };
  previews: { comments: CommentPreview; speech: SpeechPreview };
}

function defaultCommonDesign(): CommonDesign {
  return {
    fontFamily: 'Yu Gothic UI', fontSize: 32, fontWeight: 600,
    textColor: '#ffffff', backgroundColor: '#101420', backgroundOpacity: 78,
    paddingX: 16, paddingY: 12, radius: 14, lineHeight: 1.5, edge: 12,
    border: { enabled: true, color: '#ffffff', opacity: 25, width: 1 },
    textShadow: { enabled: true, color: '#000000', opacity: 80, blur: 3, x: 0, y: 2 },
    cardShadow: { enabled: false, color: '#000000', opacity: 40, blur: 8, x: 0, y: 3 },
    outline: { enabled: false, color: '#000000', width: 2 },
  };
}

export function createDefaultDocument(): EditorDocument {
  return {
    formatVersion: 1,
    appVersion: version,
    designs: {
      comments: {
        ...defaultCommonDesign(), showSource: true, showAuthor: true,
        authorColor: '#a9e5ff', sourceColor: '#ffffff', sourceBackgroundColor: '#ffffff',
        sourceBackgroundOpacity: 16, metaScale: 0.75, gap: 8, emoteScale: 1.45,
        serviceColorsEnabled: false,
        badgeColors: { youtube: '#f25d72', twitch: '#a37bff', shitaraba: '#58d6af' },
      },
      speech: {
        ...defaultCommonDesign(), fontSize: 40, fontWeight: 700, paddingX: 20,
        horizontal: 'left', vertical: 'bottom', textAlign: 'left', maxWidth: null,
      },
    },
    previews: {
      comments: {
        width: 600, height: 800, background: 'checker', mode: 'stack',
        stackDirection: 'newestBottom', source: 'all', author: '見本のリスナー',
        text: '配信を楽しんでいます！\n色や余白を変えてみてください。', emotes: true,
      },
      speech: { width: 1600, height: 300, background: 'checker', text: 'これは音声認識の見本です。\n読みやすい字幕に調整できます。' },
    },
  };
}

export function createPreset(target: 'comments', name: PresetName): CommentDesign;
export function createPreset(target: 'speech', name: PresetName): SpeechDesign;
export function createPreset(target: Target, name: PresetName): CommentDesign | SpeechDesign;
export function createPreset(target: Target, name: PresetName): CommentDesign | SpeechDesign {
  const design = createDefaultDocument().designs[target];
  if (name === 'light') {
    Object.assign(design, { textColor: '#182236', backgroundColor: '#ffffff', backgroundOpacity: 95 });
    design.border.color = '#182236';
    design.border.opacity = 15;
    design.textShadow.enabled = false;
    Object.assign(design.cardShadow, { enabled: true, opacity: 18, blur: 12 });
    if ('authorColor' in design) {
      Object.assign(design, { authorColor: '#17658a', sourceColor: '#182236', sourceBackgroundColor: '#182236', sourceBackgroundOpacity: 12 });
    }
  }
  if (name === 'transparent' || name === 'outlined') {
    design.backgroundOpacity = 0;
    design.border.enabled = false;
    design.cardShadow.enabled = false;
    design.radius = 0;
  }
  if (name === 'outlined') {
    design.textShadow.enabled = false;
    design.outline.enabled = true;
    design.outline.width = 3;
    design.fontWeight = 700;
  }
  if (name === 'transparent' || name === 'outlined') {
    if ('authorColor' in design) Object.assign(design, { authorColor: '#ffffff', sourceColor: '#ffffff', sourceBackgroundOpacity: 0 });
  }
  if (name === 'dark') {
    Object.assign(design, { backgroundColor: '#171b24', backgroundOpacity: 94, radius: 10 });
    design.border.opacity = 12;
    design.textShadow.enabled = false;
  }
  if (name === 'pastel') {
    Object.assign(design, { textColor: '#583d52', backgroundColor: '#f9e4ec', backgroundOpacity: 98, radius: 24 });
    design.border.enabled = false;
    design.textShadow.enabled = false;
    Object.assign(design.cardShadow, { enabled: true, color: '#a85a79', opacity: 18, blur: 12 });
    if ('authorColor' in design) Object.assign(design, { authorColor: '#8c355c', sourceColor: '#583d52', sourceBackgroundColor: '#8c355c', sourceBackgroundOpacity: 10 });
  }
  if (name === 'neon') {
    Object.assign(design, { textColor: '#e8fbff', backgroundColor: '#071827', backgroundOpacity: 88, radius: 8 });
    Object.assign(design.border, { color: '#45e5ff', opacity: 90, width: 2 });
    Object.assign(design.cardShadow, { enabled: true, color: '#45e5ff', opacity: 40, blur: 12, x: 0, y: 0 });
    Object.assign(design.textShadow, { color: '#45e5ff', opacity: 50, blur: 3, x: 0, y: 0 });
    if ('authorColor' in design) Object.assign(design, { authorColor: '#71f5dd', sourceColor: '#e8fbff', sourceBackgroundColor: '#45e5ff', sourceBackgroundOpacity: 12 });
  }
  if (name === 'terminal') {
    Object.assign(design, { fontFamily: 'Consolas', fontSize: target === 'comments' ? 30 : 38, fontWeight: 400, textColor: '#8aff9b', backgroundColor: '#050b06', backgroundOpacity: 96, radius: 0, lineHeight: 1.6 });
    Object.assign(design.border, { color: '#5aa868', opacity: 50 });
    design.textShadow.enabled = false;
    if ('authorColor' in design) Object.assign(design, { authorColor: '#c1ffd0', sourceColor: '#8aff9b', sourceBackgroundColor: '#5aa868', sourceBackgroundOpacity: 10 });
  }
  if (name === 'japanese') {
    Object.assign(design, { fontFamily: 'Yu Mincho', fontWeight: 600, textColor: '#302a24', backgroundColor: '#f7eedb', backgroundOpacity: 96, radius: 2 });
    Object.assign(design.border, { color: '#9b3c32', opacity: 80 });
    design.textShadow.enabled = false;
    if ('authorColor' in design) Object.assign(design, { authorColor: '#8c342b', sourceColor: '#302a24', sourceBackgroundColor: '#9b3c32', sourceBackgroundOpacity: 10 });
  }
  if (name === 'highContrast') {
    Object.assign(design, { fontSize: target === 'comments' ? 44 : 52, fontWeight: 700, backgroundColor: '#000000', backgroundOpacity: 100, paddingX: 20, paddingY: 16, radius: 0 });
    design.border.enabled = false;
    design.textShadow.enabled = false;
    if ('authorColor' in design) Object.assign(design, { authorColor: '#ffffff', sourceColor: '#ffffff', sourceBackgroundOpacity: 0 });
  }
  return design;
}

const commonDesignKeys = [
  'fontFamily', 'fontSize', 'fontWeight', 'textColor', 'backgroundColor', 'backgroundOpacity',
  'paddingX', 'paddingY', 'radius', 'lineHeight', 'edge', 'border', 'textShadow', 'cardShadow', 'outline',
];

function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} の形式が正しくありません。`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new Error(`${path} に未対応の項目があります。`);
  if (keys.some((key) => !Object.hasOwn(record, key))) throw new Error(`${path} に不足している項目があります。`);
  return record;
}

function number(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${path} は ${min}〜${max} の数値にしてください。`);
  return value;
}

function string(value: unknown, max: number, path: string, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${path} は${required ? '空でない' : ''}${max}文字以内の文字列にしてください。`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} は有効・無効の値にしてください。`);
  return value;
}

function enumeration<T extends string | number>(value: unknown, choices: readonly T[], path: string): T {
  const selected = choices.find((choice) => choice === value);
  if (selected === undefined) throw new Error(`${path} の選択肢が正しくありません。`);
  return selected;
}

function color(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${path} は #rrggbb 形式の色にしてください。`);
  return value;
}

function shadow(value: unknown, path: string): Shadow {
  const data = object(value, ['enabled', 'color', 'opacity', 'blur', 'x', 'y'], path);
  return {
    enabled: boolean(data.enabled, `${path}.enabled`), color: color(data.color, `${path}.color`),
    opacity: number(data.opacity, 0, 100, `${path}.opacity`), blur: number(data.blur, 0, 64, `${path}.blur`),
    x: number(data.x, -64, 64, `${path}.x`), y: number(data.y, -64, 64, `${path}.y`),
  };
}

function commonDesign(data: Record<string, unknown>, path: string, application = false): CommonDesign {
  const border = object(data.border, ['enabled', 'color', 'opacity', 'width'], `${path}.border`);
  const outline = object(data.outline, ['enabled', 'color', 'width'], `${path}.outline`);
  return {
    fontFamily: string(data.fontFamily, 200, `${path}.fontFamily`, true),
    fontSize: number(data.fontSize, 8, 200, `${path}.fontSize`),
    fontWeight: enumeration(data.fontWeight, application ? [400, 500, 600, 700] as const : [400, 600, 700] as const, `${path}.fontWeight`),
    textColor: color(data.textColor, `${path}.textColor`), backgroundColor: color(data.backgroundColor, `${path}.backgroundColor`),
    backgroundOpacity: number(data.backgroundOpacity, 0, 100, `${path}.backgroundOpacity`),
    paddingX: number(data.paddingX, 0, application ? 96 : 64, `${path}.paddingX`), paddingY: number(data.paddingY, 0, 64, `${path}.paddingY`),
    radius: number(data.radius, 0, 64, `${path}.radius`), lineHeight: number(data.lineHeight, 1, 3, `${path}.lineHeight`),
    edge: number(data.edge, 0, 64, `${path}.edge`),
    border: {
      enabled: boolean(border.enabled, `${path}.border.enabled`), color: color(border.color, `${path}.border.color`),
      opacity: number(border.opacity, 0, 100, `${path}.border.opacity`), width: number(border.width, 0, 12, `${path}.border.width`),
    },
    textShadow: shadow(data.textShadow, `${path}.textShadow`), cardShadow: shadow(data.cardShadow, `${path}.cardShadow`),
    outline: {
      enabled: boolean(outline.enabled, `${path}.outline.enabled`), color: color(outline.color, `${path}.outline.color`),
      width: number(outline.width, 0, 8, `${path}.outline.width`),
    },
  };
}

export function parseCommentDesign(value: unknown, application = false): CommentDesign {
  const path = 'designs.comments';
  const data = object(value, [...commonDesignKeys, 'showSource', 'showAuthor', 'authorColor', 'sourceColor',
    'sourceBackgroundColor', 'sourceBackgroundOpacity', 'metaScale', 'gap', 'emoteScale', 'serviceColorsEnabled', 'badgeColors'], path);
  const badges = object(data.badgeColors, ['youtube', 'twitch', 'shitaraba'], `${path}.badgeColors`);
  return {
    ...commonDesign(data, path, application), showSource: boolean(data.showSource, `${path}.showSource`), showAuthor: boolean(data.showAuthor, `${path}.showAuthor`),
    authorColor: color(data.authorColor, `${path}.authorColor`), sourceColor: color(data.sourceColor, `${path}.sourceColor`),
    sourceBackgroundColor: color(data.sourceBackgroundColor, `${path}.sourceBackgroundColor`),
    sourceBackgroundOpacity: number(data.sourceBackgroundOpacity, 0, 100, `${path}.sourceBackgroundOpacity`),
    metaScale: number(data.metaScale, 0.5, 1.5, `${path}.metaScale`), gap: number(data.gap, 0, 64, `${path}.gap`),
    emoteScale: number(data.emoteScale, 0.5, 3, `${path}.emoteScale`), serviceColorsEnabled: boolean(data.serviceColorsEnabled, `${path}.serviceColorsEnabled`),
    badgeColors: { youtube: color(badges.youtube, `${path}.badgeColors.youtube`), twitch: color(badges.twitch, `${path}.badgeColors.twitch`), shitaraba: color(badges.shitaraba, `${path}.badgeColors.shitaraba`) },
  };
}

export function parseSpeechDesign(value: unknown, application = false): SpeechDesign {
  const path = 'designs.speech';
  const data = object(value, [...commonDesignKeys, 'horizontal', 'vertical', 'textAlign', 'maxWidth'], path);
  return {
    ...commonDesign(data, path, application), horizontal: enumeration(data.horizontal, ['left', 'center', 'right'] as const, `${path}.horizontal`),
    vertical: enumeration(data.vertical, ['top', 'center', 'bottom'] as const, `${path}.vertical`),
    textAlign: enumeration(data.textAlign, ['left', 'center', 'right'] as const, `${path}.textAlign`),
    maxWidth: data.maxWidth === null ? null : number(data.maxWidth, 1, 3840, `${path}.maxWidth`),
  };
}

function commonPreview(data: Record<string, unknown>, path: string): CommonPreview {
  return {
    width: number(data.width, 1, 7680, `${path}.width`), height: number(data.height, 1, 7680, `${path}.height`),
    background: enumeration(data.background, ['checker', 'white', 'black'] as const, `${path}.background`),
  };
}

function commentPreview(value: unknown): CommentPreview {
  const path = 'previews.comments';
  const data = object(value, ['width', 'height', 'background', 'mode', 'stackDirection', 'source', 'author', 'text', 'emotes'], path);
  return {
    ...commonPreview(data, path), mode: enumeration(data.mode, ['single', 'stack'] as const, `${path}.mode`),
    stackDirection: enumeration(data.stackDirection, ['newestTop', 'newestBottom'] as const, `${path}.stackDirection`),
    source: enumeration(data.source, ['all', 'youtube', 'twitch', 'shitaraba'] as const, `${path}.source`),
    author: string(data.author, 200, `${path}.author`), text: string(data.text, 20000, `${path}.text`),
    emotes: boolean(data.emotes, `${path}.emotes`),
  };
}

function speechPreview(value: unknown): SpeechPreview {
  const path = 'previews.speech';
  const data = object(value, ['width', 'height', 'background', 'text'], path);
  return { ...commonPreview(data, path), text: string(data.text, 20000, `${path}.text`) };
}

export function parseDocument(text: string): EditorDocument {
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error('設定ファイルは1MiB以内にしてください。');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('設定ファイルのJSONを読み取れません。'); }
  const data = object(parsed, ['formatVersion', 'appVersion', 'designs', 'previews'], '設定ファイル');
  if (data.formatVersion !== 1) throw new Error('この保存形式には対応していません。保存形式1の設定を読み込んでください。');
  const designs = object(data.designs, ['comments', 'speech'], 'designs');
  const previews = object(data.previews, ['comments', 'speech'], 'previews');
  return {
    formatVersion: 1, appVersion: string(data.appVersion, 200, 'appVersion', true),
    designs: { comments: parseCommentDesign(designs.comments), speech: parseSpeechDesign(designs.speech) },
    previews: { comments: commentPreview(previews.comments), speech: speechPreview(previews.speech) },
  };
}
