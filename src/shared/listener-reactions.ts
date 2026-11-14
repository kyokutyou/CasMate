import type { ReactionStickerId } from './reaction-stickers';
import type { ReactionPointIntent } from './reaction-point';
import type { ReactionArrowPoint } from './reaction-arrow';
export type ReactionKind = 'heart' | 'clap' | 'point' | 'area' | 'arrow' | 'cheer' | 'sticker';
export const REACTION_MANAGEMENT_POLL_INTERVAL_MS = 500;
export const REACTION_MANAGEMENT_POLL_TIMEOUT_MS = 5000;
export const REACTION_WINDOW_INVENTORY_MAX_AGE_MS = 1500;
export interface ReactionRegion { x: number; y: number; width: number; height: number }
export interface ReactionDesktopMarker { x: number; y: number; canvasWidth: number; region: ReactionRegion; intent?: ReactionPointIntent; at?: number }
export interface ReactionInsets { left: number; top: number; right: number; bottom: number }
export interface ReactionWindowHint { title: string; processName: string; className: string }
export interface ReactionWindow extends ReactionWindowHint { id: string; pid: number; x: number; y: number; width: number; height: number; minimized: boolean; label?: string; displayName?: string }
/** Reserved identity for native monitor targets; never use fuzzy window restoration. */
export const isReactionDisplay = (target: ReactionWindowHint | null | undefined) => target?.processName === '@display' && target.className === '@display';
export const reactionDisplayGeometry = (target: ReactionWindow) => JSON.stringify([target.x,target.y,target.width,target.height,target.displayName]);
export interface ReactionBinding { context: string; scene: string; input: string | null; item: number | null; fingerprint: string | null }
export interface ReactionPreviewSettings { mode: 'obs' | 'twitch' | 'youtube'; twitchChannel: string; youtubeVideoId: string; youtubeTarget?: string }
export interface ReactionSettings { schema: 4; target: ReactionWindowHint | null; region: ReactionRegion; insets: ReactionInsets; foregroundOnly: boolean; binding: ReactionBinding | null; autoStartOnPublish: boolean; publishOnStartup: boolean; preview: ReactionPreviewSettings }
export interface ReactionFrame { id: string; capturedAt: number; validForMs: number; width: number; height: number; canvasWidth: number; canvasHeight: number; generation: number; url: string }
export interface ReactionSnapshot { instance: string; sequence: number; counts: Record<'heart' | 'clap' | 'point', number> & { area?: number; arrow?: number; cheer?: number; sticker?: number }; accepting: boolean; pointingEnabled: true; frameGeneration: number; frame: ReactionFrame | null }
export interface ReactionEvent extends ReactionSnapshot { kind: ReactionKind; intent?: ReactionPointIntent; sticker?: ReactionStickerId; stickerPlacement?: ReactionRegion; at: number; x?: number; y?: number; frameId?: string; area?: ReactionRegion; shape?: 'ellipse' | 'rectangle'; from?: ReactionArrowPoint; to?: ReactionArrowPoint }
export interface ReactionDesktopEvent extends ReactionEvent { clip?: ReactionRegion }
export interface ReactionPublicationState { status: 'off' | 'starting' | 'online' | 'reconnecting' | 'stopping' | 'error'; url: string | null; message: string }
export interface ReactionNamedShareView { revision: number; enrolled: boolean; name: string | null; url: string | null; expiresAt: number; message: string }
export interface ReactionManagementSnapshot { instance: string; revision: number; available: boolean; error: string | null; settings: ReactionSettings; windows: ReactionWindow[]; selectedId: string; frame: ReactionFrame | null; publication: ReactionPublicationState; namedShare?: ReactionNamedShareView; desktop: { enabled: boolean; showing: boolean; message: string; preparing?: boolean; operationToken?: string; resume?: 'editing' | 'confirmation' | 'scene'; editToken?: string }; generation: number }
const defaultReactionPreviewSettings = (): ReactionPreviewSettings => ({ mode: 'obs', twitchChannel: '', youtubeVideoId: '' });
export const defaultReactionSettings = (): ReactionSettings => ({ schema: 4, target: null, region: { x: 0, y: 0, width: 1, height: 1 }, insets: { left: 0, top: 0, right: 0, bottom: 0 }, foregroundOnly: false, binding: null, autoStartOnPublish: false, publishOnStartup: false, preview: defaultReactionPreviewSettings() });
export function reactionRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function validReactionRegion(value: unknown): value is ReactionRegion {
  if (!reactionRecord(value)) return false;
  if (Object.keys(value).sort().join(',') !== 'height,width,x,y') return false;
  const { x, y, width, height } = value;
  return [x, y, width, height].every(v => typeof v === 'number' && Number.isFinite(v)) && Number(x) >= 0 && Number(y) >= 0 && Number(width) > 0 && Number(height) > 0 && Number(x) + Number(width) <= 1.000001 && Number(y) + Number(height) <= 1.000001;
}
export function validReactionPreviewSettings(value: unknown): value is ReactionPreviewSettings {
  if (!reactionRecord(value) || Object.keys(value).filter(key => key !== 'youtubeTarget').sort().join(',') !== 'mode,twitchChannel,youtubeVideoId') return false;
  const { mode, twitchChannel, youtubeVideoId } = value;
  if (value.youtubeTarget !== undefined && (typeof value.youtubeTarget !== 'string' || !/^(@[^\s/?#]{3,30}|UC[\w-]{22})$/u.test(value.youtubeTarget) || youtubeVideoId !== '')) return false;
  return (mode === 'obs' || mode === 'twitch' || mode === 'youtube') &&
    typeof twitchChannel === 'string' && (twitchChannel === '' || /^[a-z0-9_]{1,25}$/u.test(twitchChannel)) &&
    typeof youtubeVideoId === 'string' && (youtubeVideoId === '' || /^[A-Za-z0-9_-]{11}$/u.test(youtubeVideoId));
}
export function validReactionSettings(value: unknown): value is ReactionSettings {
  if (!reactionRecord(value) || value.schema !== 4 || !validReactionRegion(value.region) || !reactionRecord(value.insets) || typeof value.foregroundOnly !== 'boolean' || typeof value.autoStartOnPublish !== 'boolean' || typeof value.publishOnStartup !== 'boolean' || !validReactionPreviewSettings(value.preview)) return false;
  if (Object.keys(value).sort().join(',') !== 'autoStartOnPublish,binding,foregroundOnly,insets,preview,publishOnStartup,region,schema,target') return false;
  if (Object.keys(value.insets).sort().join(',') !== 'bottom,left,right,top') return false;
  if (!['left','top','right','bottom'].every(key => Number.isInteger(value.insets && reactionRecord(value.insets) ? value.insets[key] : undefined) && Number((value.insets as Record<string, unknown>)[key]) >= 0 && Number((value.insets as Record<string, unknown>)[key]) <= 8192)) return false;
  if (value.target !== null && (!reactionRecord(value.target) || Object.keys(value.target).sort().join(',') !== 'className,processName,title' || !['title','processName','className'].every(key => typeof (value.target as Record<string, unknown>)[key] === 'string' && String((value.target as Record<string, unknown>)[key]).length <= 1024))) return false;
  return value.binding === null || reactionRecord(value.binding) && Object.keys(value.binding).sort().join(',') === 'context,fingerprint,input,item,scene' && typeof value.binding.context === 'string' && value.binding.context.length <= 4096 && typeof value.binding.scene === 'string' && value.binding.scene.length <= 1024 && (value.binding.input === null || typeof value.binding.input === 'string' && value.binding.input.length <= 1024) && (value.binding.item === null || Number.isSafeInteger(value.binding.item) && Number(value.binding.item) >= 0) && (value.binding.fingerprint === null || typeof value.binding.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.binding.fingerprint));
}
const legacyReactionSettingsKeys = {
  1: 'binding,foregroundOnly,insets,region,schema,target',
  2: 'autoStartOnPublish,binding,foregroundOnly,insets,region,schema,target',
  3: 'autoStartOnPublish,binding,foregroundOnly,insets,publishOnStartup,region,schema,target',
};
export function readReactionSettings(value: unknown): ReactionSettings | null {
  if (validReactionSettings(value)) return value;
  if (!reactionRecord(value)) return null;
  const { schema } = value;
  if (schema !== 1 && schema !== 2 && schema !== 3) return null;
  if (Object.keys(value).sort().join(',') !== legacyReactionSettingsKeys[schema]) return null;
  const migrated = {
    ...value, schema: 4,
    autoStartOnPublish: schema === 1 ? false : value.autoStartOnPublish,
    publishOnStartup: schema === 3 ? value.publishOnStartup : false,
    preview: defaultReactionPreviewSettings(),
  };
  return validReactionSettings(migrated) ? migrated : null;
}
