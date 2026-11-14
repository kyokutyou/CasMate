import { createHash } from 'node:crypto';
import { reactionRecord as record, isReactionDisplay, reactionDisplayGeometry, type ReactionBinding, type ReactionWindow, type ReactionRegion } from '../../shared/listener-reactions';
import type { ObsVisualReader } from '../obs/obs-visual';
import { intersectReactionRect, reactionItemGeometry } from './reaction-geometry';
import type { StoredReactionFrame } from './reaction-frames';
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type ReactionWindowClass = Pick<ReactionWindow, 'processName' | 'className'>;
type ObservedCaptureScene = { name: string; group: boolean; signature: string; itemCount: number; itemIds: unknown[] };
type ObservedCaptureInput = { name: string; signature: string };
type ObservedGeometry = { scene: string; id: unknown; signature: string };
export type ReactionRangeRead = { kind:'read'; type:string; data:Record<string,unknown>; scenes?:ObservedCaptureScene[] };
type CaptureRecovery = { kind:'captures'; scenes:ObservedCaptureScene[]; inputs?:ObservedCaptureInput[]; geometry?:ObservedGeometry[]; filterSource?:string; itemLimit?:boolean };
export type ReactionRangeRecovery = CaptureRecovery | ReactionRangeRead;
export class ReactionRangeError extends Error {
  constructor(message: string, readonly retryable = false, readonly windowClasses?: ReactionWindowClass[],
    readonly recovery?: ReactionRangeRecovery) { super(message); }
}
export class NoReactionCaptureError extends ReactionRangeError {
  constructor(readonly context: string, scenes: ObservedCaptureScene[]) {
    super('このシーンにPC表示に対応するキャプチャがありません。', true, undefined, { kind:'captures', scenes });
  }
}
export interface ReactionDependencies {
  scenes: string[];
  sources: string[];
  candidateSources: string[];
  items: Array<{scene: string; id: number; transform: unknown}>;
  sceneItems?: Array<{scene: string; ids: unknown[]}>;
}
type RangeWatch = (dependencies: ReactionDependencies) => { valid(): boolean; close(): void };
export async function manualReactionBinding(read: ObsVisualReader, frame: StoredReactionFrame): Promise<ReactionBinding> {
  if (!read.valid()) throw new Error('OBS画面が変わりました。');
  return { context: frame.context, scene: frame.scene, item: null, input: null, fingerprint: null };
}
type Node = { scene: string; item: Record<string, unknown> };
type CapturePath = { path: Node[]; settings: Record<string, unknown> };
type CaptureCandidate = CapturePath & { target: ReactionWindow };
type RangeRequest = ObsVisualReader['request'];
const captureKinds = new Set(['window_capture','game_capture','monitor_capture']);
const MAX_SCENE_ITEMS = 64;
const captureSignature = (items: Record<string, unknown>[]) => JSON.stringify(items.filter(item => item.sceneItemEnabled &&
  (item.isGroup || item.sourceType === 'OBS_SOURCE_TYPE_SCENE' || captureKinds.has(String(item.inputKind))))
  .map(item => {
    const transform = record(item.sceneItemTransform) ? item.sceneItemTransform : {};
    return JSON.stringify([item.sceneItemId, item.sourceName, item.sourceUuid, item.inputKind, item.isGroup,
      Number(transform.sourceWidth) > 0 && Number(transform.sourceHeight) > 0]);
  }).sort());
const geometrySignature = (transform: unknown) => JSON.stringify(reactionItemGeometry(transform));
const observeGeometry = (node: Node): ObservedGeometry => ({ scene:node.scene,id:node.item.sceneItemId,signature:geometrySignature(node.item.sceneItemTransform) });
const inputSignature = (value: unknown) => {
  const settings = record(value) ? value : {};
  return JSON.stringify([settings.window,settings.capture_mode,settings.capture_any_fullscreen,settings.monitor_id]);
};
const supportedFilter = (filter: Record<string, unknown>) => !filter.filterEnabled || ['color_filter','color_filter_v2'].includes(String(filter.filterKind));
export async function rangeRecoveryChanged(read: ObsVisualReader, recovery: ReactionRangeRecovery): Promise<'configuration' | 'ready' | false> {
  const watchingItemLimit = recovery.kind === 'captures' && recovery.itemLimit;
  for (const scene of recovery.scenes ?? []) {
    const { sceneItems } = await read.request(scene.group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName:scene.name });
    if (!read.valid() || !Array.isArray(sceneItems)) return false;
    if (sceneItems.length > MAX_SCENE_ITEMS) {
      if (watchingItemLimit) continue;
      return false;
    }
    if (!sceneItems.every(record)) return false;
    if (watchingItemLimit && sceneItems.length < scene.itemCount) return 'configuration';
    if (captureSignature(sceneItems) !== scene.signature) return 'configuration';
    if (recovery.kind === 'captures' && recovery.geometry?.some(item => item.scene === scene.name &&
      geometrySignature(sceneItems.find(candidate => candidate.sceneItemId === item.id)?.sceneItemTransform) !== item.signature)) return 'configuration';
  }
  if (recovery.kind === 'read') {
    await read.request(recovery.type, recovery.data);
    return read.valid() && 'ready';
  }
  for (const input of recovery.inputs ?? []) {
    const { inputSettings } = await read.request('GetInputSettings', { inputName:input.name });
    if (!read.valid()) return false;
    if (inputSignature(inputSettings) !== input.signature) return 'configuration';
  }
  if (recovery.filterSource) {
    const { filters } = await read.request('GetSourceFilterList', { sourceName:recovery.filterSource });
    if (read.valid() && Array.isArray(filters) && filters.every(filter => record(filter) && supportedFilter(filter))) return 'configuration';
  }
  return false;
}

async function observeContext(request: RangeRequest) {
  const scene = await request('GetCurrentProgramScene');
  const collection = await request('GetSceneCollectionList');
  const video = await request('GetVideoSettings');
  return {
    name: String(scene.currentProgramSceneName),
    key: JSON.stringify([collection.currentSceneCollectionName, scene.currentProgramSceneUuid ?? scene.currentProgramSceneName, video.baseWidth, video.baseHeight]),
  };
}

async function observeCapturePaths(request: RangeRequest, root: string, observedScenes: Map<string, ObservedCaptureScene>) {
  let count = 0;
  observedScenes.clear();
  const scenes = new Set<string>();
  const candidateSources = new Set<string>();
  const captureInputs = new Map<string, ObservedCaptureInput>();
  const captures: CapturePath[] = [];
  const walk = async (name: string, group: boolean, path: Node[], ancestors: string[]) => {
    if (ancestors.includes(name) || path.length > 8) {
      throw new ReactionRangeError('シーンの循環または入れ子の深さ上限を超えています。',
        false, undefined, { kind:'captures', scenes:[...observedScenes.values()] });
    }
    scenes.add(name);
    const { sceneItems } = await request(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName:name });
    if (!Array.isArray(sceneItems) || sceneItems.length <= MAX_SCENE_ITEMS && !sceneItems.every(record)) {
      throw new ReactionRangeError('自動判定の対象数を超えています。手動で指定してください。');
    }
    const itemCount = sceneItems.length;
    const signature = itemCount <= MAX_SCENE_ITEMS ? captureSignature(sceneItems) : '';
    const itemIds = itemCount <= MAX_SCENE_ITEMS ? sceneItems.map(item => item.sceneItemId) : [];
    observedScenes.set(JSON.stringify([group, name]), { name, group, signature, itemCount, itemIds });
    count += itemCount;
    if (count > MAX_SCENE_ITEMS) {
      throw new ReactionRangeError('自動判定の対象数を超えています。手動で指定してください。',
        false, undefined, { kind:'captures', scenes:[...observedScenes.values()], itemLimit:true });
    }
    for (const item of sceneItems) {
      if (!item.sceneItemEnabled) continue;
      const next = [...path, { scene:name, item }];
      if (item.isGroup || item.sourceType === 'OBS_SOURCE_TYPE_SCENE') {
        await walk(String(item.sourceName), !!item.isGroup, next, [...ancestors, name]);
        continue;
      }
      if (!captureKinds.has(String(item.inputKind))) continue;
      candidateSources.add(String(item.sourceName));
      candidateSources.add(String(item.sourceUuid ?? item.sourceName));
      const settings = await request('GetInputSettings', { inputName:item.sourceName });
      if (typeof item.sourceName === 'string') {
        captureInputs.set(item.sourceName, { name:item.sourceName, signature:inputSignature(settings.inputSettings) });
      }
      captures.push({ path:next, settings });
    }
  };
  await walk(root, false, [], []);
  return { captures, scenes:[...scenes], candidateSources:[...candidateSources],
    captureScenes:[...observedScenes.values()], captureInputs:[...captureInputs.values()] };
}

function matchCapturePaths(captures: CapturePath[], windows: ReactionWindow[], target: ReactionWindow | null, manualDisplay: boolean) {
  const candidates: CaptureCandidate[] = [];
  const windowClasses: ReactionWindowClass[] = [];
  let unsupportedMode = false, ambiguous = false, missingDisplay = false;
  for (const capture of captures) {
    const item = capture.path.at(-1)!.item;
    const settings = capture.settings.inputSettings;
    const raw = record(settings) ? settings : {};
    if (item.inputKind === 'monitor_capture') {
      windowClasses.push({ processName:'@display', className:'@display' });
      const id = typeof raw.monitor_id === 'string' ? raw.monitor_id.toLowerCase() : '';
      const matches = windows.filter(w => isReactionDisplay(w) && id && (w.title.toLowerCase() === id || w.displayName?.toLowerCase() === id));
      const legacy = !id || /^\d+$/u.test(id);
      if (!matches.length && legacy && manualDisplay && target && isReactionDisplay(target)) {
        candidates.push({ ...capture, target });
        continue;
      }
      if (matches.length > 1) ambiguous = true;
      if (matches.length === 1 && (!target || matches[0].id === target.id)) candidates.push({ ...capture, target:matches[0] });
      else if (!matches.length) missingDisplay = true;
      continue;
    }
    const mode = raw.capture_mode ?? (raw.capture_any_fullscreen === false ? 'window' : 'any_fullscreen');
    if (item.inputKind === 'game_capture' && mode !== 'window') { unsupportedMode = true; continue; }
    const parts = typeof raw.window === 'string' ? raw.window.split(':').map(x => x.replaceAll('#3A', ':').replaceAll('#22', '#')) : [];
    if (parts.length === 3) windowClasses.push({ processName:parts[2].toLowerCase(), className:parts[1] });
    const similar = parts.length === 3 ? windows.filter(w => w.processName.toLowerCase() === parts[2].toLowerCase() && w.className === parts[1]) : [];
    const exact = similar.filter(w => w.title === parts[0]);
    const matched = exact.length === 1 ? exact[0] : similar.length === 1 ? similar[0] : undefined;
    if (!matched && similar.length > 1) ambiguous = true;
    if (matched && (!target || matched.id === target.id && matched.pid === target.pid)) candidates.push({ ...capture, target:matched });
  }
  return { candidates, windowClasses, unsupportedMode, ambiguous, missingDisplay };
}

function candidateSignature(candidates: CaptureCandidate[]) {
  // Saved bindings depend on the order and serialization of these values.
  return JSON.stringify(candidates.map(({ path, settings, target }) => [
    path.map(({ scene, item }) => [scene, item.sceneItemId, item.sourceUuid, item.sourceName, item.inputKind, item.sceneItemTransform]),
    settings, target.id, target.pid, ...(isReactionDisplay(target) ? [reactionDisplayGeometry(target)] : []),
  ]));
}

async function observeFilters(request: RangeRequest, names: string[], recovery: CaptureRecovery) {
  const values = [];
  for (const name of names) {
    const value = await request('GetSourceFilterList', { sourceName:name });
    if (!Array.isArray(value.filters) || value.filters.some(f => !record(f) || !supportedFilter(f))) {
      throw new ReactionRangeError('位置・寸法が変わる、または未対応のフィルターがあります。手動で指定してください。', false, undefined, { ...recovery, filterSource:name });
    }
    values.push(value);
  }
  return values;
}

function mapCapturePath(path: Node[], frame: StoredReactionFrame, windowClasses: ReactionWindowClass[], recovery: CaptureRecovery, geometryRecovery: CaptureRecovery) {
  const canvas = { x:0, y:0, width:frame.metadata.canvasWidth, height:frame.metadata.canvasHeight };
  let mapping = { x:0, y:0, width:1, height:1 };
  let clip: ReactionRegion | null = canvas;
  for (const node of path) {
    const transform = node.item.sceneItemTransform;
    if (record(transform) && (transform.sourceWidth === 0 || transform.sourceHeight === 0)) {
      throw new ReactionRangeError('キャプチャ映像の準備を待っています。', true, windowClasses, recovery);
    }
    const geometry = reactionItemGeometry(transform);
    if (!geometry) {
      throw new ReactionRangeError('この切抜き・変形には未対応です。手動で範囲を指定してください。', false, undefined, { ...recovery, geometry:[observeGeometry(node)] });
    }
    // The current mapping is in pixels per source pixel, starting with identity at the root.
    const map = (r: ReactionRegion) => ({ x:mapping.x + r.x * mapping.width, y:mapping.y + r.y * mapping.height,
      width:r.width * mapping.width, height:r.height * mapping.height });
    const full = map(geometry.full), visible = map(geometry.visible);
    clip = clip && intersectReactionRect(clip, visible);
    mapping = { x:full.x, y:full.y, width:full.width / geometry.sourceWidth, height:full.height / geometry.sourceHeight };
  }
  if (!clip) throw new ReactionRangeError('キャプチャが画面内にありません。', false, undefined, geometryRecovery);
  const leaf = reactionItemGeometry(path.at(-1)!.item.sceneItemTransform)!;
  const full = { x:mapping.x, y:mapping.y, width:mapping.width * leaf.sourceWidth, height:mapping.height * leaf.sourceHeight };
  const normalize = (r: ReactionRegion) => ({ x:r.x / canvas.width, y:r.y / canvas.height, width:r.width / canvas.width, height:r.height / canvas.height });
  return { region:normalize(clip), captureRegion:normalize(full) };
}

export async function detectReactionRange(read: ObsVisualReader, target: ReactionWindow | null, windows: ReactionWindow[], frame: StoredReactionFrame, signal: AbortSignal, watch?: RangeWatch, manualDisplay = false, onRead?: (request: ReactionRangeRead, pending: boolean) => void) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  const observedScenes = new Map<string, ObservedCaptureScene>();
  let pendingRead: ReactionRangeRead | undefined;
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new ReactionRangeError('自動判定を取り消しました。', true, undefined, signal.aborted ? undefined : pendingRead));
    deadline.addEventListener('abort', abort, { once: true });
  });
  let observer: ReturnType<RangeWatch> | undefined;
  const request = async (type: string, data: Record<string, unknown> = {}) => {
    deadline.throwIfAborted();
    if (!read.valid()) throw new ReactionRangeError('OBS画面が変わりました。', true);
    const requestState: ReactionRangeRead = { kind:'read',type,data,scenes:[...observedScenes.values()] };
    pendingRead = requestState;
    onRead?.(requestState,true);
    try {
      const value = await read.request(type, data);
      deadline.throwIfAborted();
      if (!read.valid()) throw new ReactionRangeError('OBS画面が変わりました。', true);
      return value;
    } catch (error) {
      if (!deadline.aborted && error instanceof Error) {
        if (error.message === 'OBS_CAPTURE_CHANGED') throw new ReactionRangeError('OBS画面が変わりました。', true);
        if (['OBS_VISUAL_UNAVAILABLE','OBS_UNAVAILABLE','OBS_WEBSOCKET_TIMEOUT','OBS_WEBSOCKET_ERROR','OBS_WEBSOCKET_UNAVAILABLE','BUSY'].includes(error.message)) {
          throw new ReactionRangeError('OBSの構成と接続を再確認しています。', true, undefined, pendingRead);
        }
      }
      throw error;
    } finally { pendingRead = undefined; onRead?.(requestState,false); }
  };
  const changed = () => new ReactionRangeError('判定中にOBS画面が変わりました。もう一度確認しています。', true);
  const detect = async () => {
    const first = await observeContext(request);
    if (first.key !== frame.context || first.name !== frame.scene) throw new ReactionRangeError('最新画像を待ってください。', true);
    const scan = () => observeCapturePaths(request, first.name, observedScenes);
    const before = await scan();
    if (!before.captures.length) {
      observer = watch?.({ scenes:before.scenes, sources:[], candidateSources:[], items:[] });
      const confirmed = await scan();
      const after = await observeContext(request);
      if (observer?.valid() === false || confirmed.captures.length || JSON.stringify(confirmed.scenes) !== JSON.stringify(before.scenes) ||
          after.key !== first.key || after.name !== first.name) throw changed();
      throw new NoReactionCaptureError(frame.context, confirmed.captureScenes);
    }

    const { candidates, windowClasses, unsupportedMode, ambiguous, missingDisplay } = matchCapturePaths(before.captures, windows, target, manualDisplay);
    const recovery: CaptureRecovery = { kind:'captures', scenes:before.captureScenes, inputs:before.captureInputs };
    if (ambiguous || candidates.length > 1) {
      throw new ReactionRangeError('対応するソース・ウィンドウが複数あります。手動で指定してください。', false, windowClasses, recovery);
    }
    if (!candidates.length && missingDisplay) {
      throw new ReactionRangeError('画面キャプチャの対象モニターを特定できません。接続を確認するか、モニターを選び手動で範囲を指定してください。', false, windowClasses, recovery);
    }
    if (!candidates.length) {
      const message = unsupportedMode ? 'ゲームキャプチャを「特定のウィンドウ」に設定するか、手動で範囲を指定してください。' :
        'キャプチャに対応する対象ウィンドウが不在です。起動と最新画像を待っています。';
      throw new ReactionRangeError(message, !unsupportedMode, windowClasses, recovery);
    }

    const { path, target:selected } = candidates[0];
    const leaf = path.at(-1)!;
    const geometryRecovery = { ...recovery, geometry:path.map(observeGeometry) };
    if (isReactionDisplay(selected)) {
      const geometry = reactionItemGeometry(leaf.item.sceneItemTransform);
      if (!geometry || Math.abs(geometry.sourceWidth - selected.width) > 1 || Math.abs(geometry.sourceHeight - selected.height) > 1) {
        throw new ReactionRangeError('モニターの解像度とOBS画像を再確認しています。', true, windowClasses, geometryRecovery);
      }
    }
    const dependencies: ReactionDependencies = {
      scenes:before.scenes,
      sources:[first.name, ...path.flatMap(({ item }) => [String(item.sourceName), String(item.sourceUuid ?? item.sourceName)])],
      candidateSources:before.candidateSources,
      items:path.map(({ scene, item }) => ({ scene, id:Number(item.sceneItemId), transform:structuredClone(item.sceneItemTransform) })),
    };
    const signature = candidateSignature(candidates);
    // The second scan checks changes before registration. The observer checks changes during and after that scan.
    observer = watch?.(dependencies);
    const sources = [first.name, ...path.map(({ item }) => String(item.sourceName))];
    const filters = await observeFilters(request, sources, recovery);
    const mapping = mapCapturePath(path, frame, windowClasses, recovery, geometryRecovery);

    const after = await scan();
    const confirmed = matchCapturePaths(after.captures, windows, target, manualDisplay);
    const confirmedSignature = candidateSignature(confirmed.candidates);
    const lastFilters = await observeFilters(request, sources, recovery);
    const last = await observeContext(request);
    if (observer?.valid() === false || confirmed.ambiguous || JSON.stringify([...after.scenes].sort()) !== JSON.stringify([...before.scenes].sort()) ||
        confirmedSignature !== signature || JSON.stringify(confirmed.windowClasses) !== JSON.stringify(windowClasses) ||
        JSON.stringify(after.candidateSources) !== JSON.stringify(before.candidateSources) ||
        JSON.stringify(after.captureInputs) !== JSON.stringify(before.captureInputs) ||
        JSON.stringify(filters) !== JSON.stringify(lastFilters) || last.key !== first.key || last.name !== first.name) throw changed();

    const binding: ReactionBinding = {
      context:frame.context, scene:frame.scene, input:String(leaf.item.sourceUuid ?? leaf.item.sourceName),
      item:Number(leaf.item.sceneItemId), fingerprint:fingerprint([signature, filters]),
    };
    const sceneItems = after.captureScenes.map(({ name, itemIds }) => ({ scene:name, ids:itemIds }));
    return { target:selected, windowClasses, ...mapping, dependencies:{ ...dependencies, sceneItems }, recovery:geometryRecovery, binding };
  };
  try {
    return await Promise.race([cancelled, detect()]);
  } finally {
    observer?.close();
    deadline.removeEventListener('abort', abort);
  }
}
