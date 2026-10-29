import { createDefaultDocument, createPreset, parseCommentDesign, parseSpeechDesign } from './obs-style';
import type { CommentDesign, SpeechDesign, Target, PresetName } from './obs-style';
import type { CommentOverlaySettings, SpeechRecognitionOverlayAppearance } from './types';
import { defaultCommentOverlayAppearance } from './comment-overlay-theme';

export interface ObsCommentDesign { style: CommentDesign; variant: 'paper' | 'card'; paperColors: boolean; textOpacity: number }
export interface ObsSpeechDesign { style: SpeechDesign; textOpacity: number }
export type ObsDesigns = { comments: ObsCommentDesign; speech: ObsSpeechDesign };
export const defaultSpeechOverlayAppearance = { fontFamily: 'Yu Gothic UI', fontSizePx: 32, textColor: '#ffffffff', backgroundColor: '#00000099', paddingPx: 8, borderRadiusPx: 8 };

function opacity(color: string) { return Number.parseInt(color.slice(7) || 'ff', 16) / 255 * 100; }
function legacyStyle(value: Omit<SpeechRecognitionOverlayAppearance, 'design'>) {
  return { fontFamily: value.fontFamily || 'system-ui', fontSize: value.fontSizePx,
    textColor: value.textColor.slice(0, 7), backgroundColor: value.backgroundColor.slice(0, 7),
    backgroundOpacity: opacity(value.backgroundColor), paddingY: value.paddingPx, radius: value.borderRadiusPx };
}
export function commentDesignFromSettings(value: Omit<SpeechRecognitionOverlayAppearance, 'design'> & Pick<CommentOverlaySettings, 'design'>): ObsCommentDesign {
  if (value.design) return structuredClone(value.design);
  const style = createDefaultDocument().designs.comments;
  Object.assign(style, legacyStyle(value), { paddingX: value.paddingPx * 1.5, fontWeight: 500, lineHeight: 1.55,
    authorColor: value.textColor.slice(0, 7), sourceColor: value.textColor.slice(0, 7), sourceBackgroundOpacity: 0, metaScale: 0.58 });
  style.border.enabled = false; style.textShadow.enabled = false;
  Object.assign(style.cardShadow, { enabled: true, color: '#203a32', opacity: 32 / 255 * 100, x: 1, y: 3, blur: 3 });
  return { style, variant: 'paper', paperColors: value.backgroundColor.toLowerCase() === defaultCommentOverlayAppearance.backgroundColor, textOpacity: opacity(value.textColor) };
}
export function speechDesignFromSettings(value: SpeechRecognitionOverlayAppearance): ObsSpeechDesign {
  if (value.design) return structuredClone(value.design);
  const style = createDefaultDocument().designs.speech;
  Object.assign(style, legacyStyle(value), { paddingX: value.paddingPx, fontWeight: 400, lineHeight: 1.45 });
  style.border.enabled = false; style.textShadow.enabled = false;
  return { style, textOpacity: opacity(value.textColor) };
}
export function createObsDesignPreset(target: 'comments', name: PresetName): ObsCommentDesign;
export function createObsDesignPreset(target: 'speech', name: PresetName): ObsSpeechDesign;
export function createObsDesignPreset(target: Target, name: PresetName): ObsCommentDesign | ObsSpeechDesign;
export function createObsDesignPreset(target: Target, name: PresetName): ObsCommentDesign | ObsSpeechDesign {
  if (target === 'comments') return name === 'standard'
    ? commentDesignFromSettings(defaultCommentOverlayAppearance)
    : { style: createPreset('comments', name), variant: 'card', paperColors: false, textOpacity: 100 };
  return name === 'standard' ? speechDesignFromSettings(defaultSpeechOverlayAppearance) : { style: createPreset('speech', name), textOpacity: 100 };
}
export function validateObsDesign<T extends Target>(target: T, input: unknown): ObsDesigns[T] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('デザインの形式が正しくありません。');
  const data = input as Record<string, unknown>;
  const keys = target === 'comments' ? ['style', 'variant', 'paperColors', 'textOpacity'] : ['style', 'textOpacity'];
  if (Object.keys(data).length !== keys.length || keys.some(key => !Object.hasOwn(data, key))) throw new Error('デザインの項目が正しくありません。');
  if (typeof data.textOpacity !== 'number' || !Number.isFinite(data.textOpacity) || data.textOpacity < 0 || data.textOpacity > 100) throw new Error('文字の不透明度は0～100%で指定してください。');
  if (target === 'speech') return { style: parseSpeechDesign(data.style, true), textOpacity: data.textOpacity } as ObsDesigns[T];
  if ((data.variant !== 'paper' && data.variant !== 'card') || typeof data.paperColors !== 'boolean') throw new Error('付箋のデザインが正しくありません。');
  const style = parseCommentDesign(data.style, true);
  if (!style.showSource || !style.showAuthor) throw new Error('表示項目はOBSコメント表示で変更してください。');
  return { style, textOpacity: data.textOpacity, variant: data.variant, paperColors: data.paperColors } as ObsDesigns[T];
}
