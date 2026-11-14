import { resolveYouTubeLiveTarget } from '../sources/youtube-source';
import { reactionSticker } from '../../shared/reaction-stickers';
import { validReactionPointIntent, type ReactionPointIntent } from '../../shared/reaction-point';
import { validArrowPoint } from '../../shared/reaction-arrow';
import { ReactionStickerPlacement } from './reaction-sticker-placement';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { defaultReactionSettings, validReactionPreviewSettings, validReactionSettings, validReactionRegion, type ReactionKind, type ReactionDesktopEvent, reactionRecord as record, type ReactionRegion, type ReactionPreviewSettings, type ReactionSettings, type ReactionManagementSnapshot, type ReactionSnapshot, type ReactionEvent, type ReactionDesktopMarker, type ReactionWindow, type ReactionPublicationState } from '../../shared/listener-reactions';
import type { ObsVisualReader } from '../obs/obs-visual';
import { ReactionFrames, type StoredReactionFrame } from './reaction-frames';
import type { ReactionPersistence } from './reaction-store';
import type { ReactionPublication } from './reaction-publication';
import { detectReactionRange, manualReactionBinding, NoReactionCaptureError, rangeRecoveryChanged, ReactionRangeError,
  type ReactionDependencies, type ReactionRangeRead, type ReactionRangeRecovery, type ReactionWindowClass } from './reaction-range';
import { reactionCanvasViewport } from './reaction-geometry';
import { isReactionDisplay, reactionDisplayGeometry, REACTION_MANAGEMENT_POLL_INTERVAL_MS, REACTION_MANAGEMENT_POLL_TIMEOUT_MS, REACTION_WINDOW_INVENTORY_MAX_AGE_MS } from '../../shared/listener-reactions';
import { ReactionDesktopSession, type AutomaticStart, type AutomaticStartOptions, type EditResume, type FollowOrigin,
  type MonitorPin, type RecoveryEvidence, type RecoveryWait } from './reaction-desktop-session';

export class ReactionError extends Error {
  constructor(readonly status: number, message: string, readonly retiredFrame?: { generation?: number }) { super(message); }
}
type AutomaticRange = Pick<Awaited<ReturnType<typeof detectReactionRange>>, 'target' | 'region' | 'binding' | 'recovery'>;
type ProgramScene = Pick<StoredReactionFrame, 'context' | 'scene'>;
type PreparedSave = { verify: () => Promise<void>; activate: () => void; restored?: () => void };
const PROGRAM_CHECK_INTERVAL = 1000;
const LOCAL_FRAME_REFRESH = 8000;
const RECOVERY_CAPTURE_INTERVAL = 2000;
const RECOVERY_PROBE_INTERVAL = 2000;
// Leave a scheduling margin after a full preview request and its next poll interval.
const MANAGEMENT_PREVIEW_LEASE = REACTION_MANAGEMENT_POLL_TIMEOUT_MS + 2 * REACTION_MANAGEMENT_POLL_INTERVAL_MS;
const rangeInputEvents = new Set(['InputCreated', 'InputRemoved', 'InputNameChanged', 'InputSettingsChanged']);
// OBS image contexts store [collection, program scene identity, canvas width, canvas height].
const programIdentity = (context: string) => {
  const [collection, scene] = JSON.parse(context) as [string, string, number, number];
  return [collection, scene] as const;
};
const sameProgramScene = (a: string, b: string) => JSON.stringify(programIdentity(a)) === JSON.stringify(programIdentity(b));
const monitorDisconnected = '対象モニターが切断されました。選択し直してください。';
class MonitorDisconnectedError extends ReactionError {
  constructor() { super(409, monitorDisconnected); }
}
class ViewportUnavailableError extends ReactionError {
  constructor(readonly ready: (windows: ReactionWindow[]) => boolean, readonly recovery?: ReactionRangeRecovery) {
    super(409, 'PC表示の範囲が不正、または大きすぎます。赤枠と余白を確認してください。');
  }
}
const findMonitor = (windows: ReactionWindow[], monitor: MonitorPin) => windows.find(w => w.id === monitor.id && isReactionDisplay(w));
const matchesWindowHint = (window: ReactionWindow, hint: Pick<ReactionWindow,'title'|'className'|'processName'>) =>
  window.title === hint.title && window.className === hint.className && window.processName.toLowerCase() === hint.processName.toLowerCase();
const windowSignature = (windows: ReactionWindow[], classes: ReactionWindowClass[]) => JSON.stringify(windows
  .filter(window => classes.some(c => c.className === window.className && c.processName.toLowerCase() === window.processName.toLowerCase()))
  .map(window => JSON.stringify([window.id, window.pid, window.title, window.minimized, ...(isReactionDisplay(window) ? [reactionDisplayGeometry(window)] : [])])).sort());
export interface ReactionDesktop {
  inventory(): { windows: ReactionWindow[]; foreground: string; observedAt: number; observedMonotonicAt?: number };
  subscribeInventory?(listener: () => void): () => void;
  demand(value: boolean): void;
  prepare(): Promise<void>;
  render(bounds: { x: number; y: number; width: number; height: number } | null): void;
  marker(data: ReactionDesktopMarker): void;
  reaction(data: ReactionDesktopEvent): void;
  clear(): void;
  close(): void | Promise<void>;
}
export class ReactionController {
  readonly instance = randomUUID();
  private settings = defaultReactionSettings();
  private available = false;
  private error: string | null = null;
  private online = false;
  private publicationGeneration = 0;
  private closed = false;
  private managementRevision = 0;
  private sequence = 0;
  private counts = { heart: 0, clap: 0, point: 0, area: 0, arrow: 0, cheer: 0, sticker: 0 };
  private readonly stickerPlacement = new ReactionStickerPlacement();
  private readonly session: ReactionDesktopSession;
  private monitorConfirmation: {id:string; geometry:string} | null = null;
  private showing = false;
  private rangeChecks = new Set<{ dependencies: ReactionDependencies; changed: boolean }>();
  private rangeDiscoveries = 0;
  private dependencies: ReactionDependencies | null = null;
  private message = '';
  private previewUntil = 0;
  private lastCapture = -Infinity;
  private frameGeneration = 0;
  private timer: ReturnType<typeof setInterval>;
  private auto?: AbortController;
  private autoBusy = false;
  private confirmingPublishRange?: number;
  private saving: Promise<void> = Promise.resolve();
  private awaitingPublishEpoch?: number;
  private program?: ProgramScene;
  private programRevision = 0;
  private programCheckRequested = false;
  private programCheckBusy = false;
  private recoveryProbeBusy = false;
  private lastProgramCheck = -Infinity;
  private startupAttempted = false;
  private obsObserved = false;
  private initialObsPublicationEpoch?: number;
  private initialObsWait?: { epoch: number; start: () => void };
  private readonly listeners = new Set<(event: 'snapshot' | 'reaction' | 'shutdown', data: ReactionSnapshot | ReactionEvent) => void>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeInventory?: () => void;
  constructor(private readonly store: ReactionPersistence, readonly frames: ReactionFrames, private readonly read: () => ObsVisualReader, private readonly desktop: ReactionDesktop, private readonly now = Date.now) {
    this.session = new ReactionDesktopSession(() => frames.monotonicNow());
    this.unsubscribe = frames.subscribe(() => {
      const frame = frames.latest();
      const changedProgram = frames.program && this.observeProgram(frames.program);
      if (this.frameGeneration !== frames.generation || changedProgram) {
        this.stickerPlacement.clear();
        this.frameGeneration = frames.generation;
        this.pauseForObs('映像が変わりました。範囲を確認してください。');
      }
      if (frame) this.tryPublishStart();
      this.changed();
    });
    this.unsubscribeInventory = desktop.subscribeInventory?.(() => this.tryPublishStart());
    this.timer = setInterval(() => this.tick(), 250); this.timer.unref?.();
  }
  private get epoch() { return this.session.epoch; }
  private get enabled() { return !!this.session.display; }
  private get runningTarget() { return this.session.display?.target; }
  private get captureRegion() { return this.session.display?.region; }
  private desktopCanvas(frame = this.frames.latest()) {
    return frame?.metadata ?? (!this.online && !this.session.follow ? this.session.display?.canvas : undefined);
  }
  private get publishStart() { return this.session.attempt; }
  private get editResume() { return this.session.edit?.resume; }
  async initialize() { try { this.settings = await this.store.load(); if(isReactionDisplay(this.settings.target) && this.settings.binding && !this.settings.binding.fingerprint) this.settings.binding={...this.settings.binding,context:'invalid'}; this.available = true; } catch (error) { this.error = error instanceof Error ? error.message : '設定を読み込めません。'; } }
  private confirmDisplay(target: ReactionWindow) { this.monitorConfirmation=isReactionDisplay(target)?{id:target.id,geometry:reactionDisplayGeometry(target)}:null; }
  private displayChanged(target: ReactionWindow) {
    if (!isReactionDisplay(target) || this.monitorConfirmation?.id!==target.id || this.monitorConfirmation.geometry===reactionDisplayGeometry(target)) return false;
    this.monitorConfirmation=null;
    if(this.settings.binding)this.settings.binding={...this.settings.binding,context:'invalid'};
    this.frames.invalidate('モニターの位置・解像度が変わりました。範囲を再確認してください。');return true;
  }
  subscribe(listener: (event: 'snapshot' | 'reaction' | 'shutdown', data: ReactionSnapshot | ReactionEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed() { const snapshot = this.publicView(); for (const listener of this.listeners) listener('snapshot', snapshot); }
  isAvailable() { return this.available && !this.closed; }
  private previewLookup?: AbortController;
  private previewChange = 0;
  private resolvedPreview?: {target:string; id:string};
  cancelPreviewLookup() { this.previewLookup?.abort(); }
  listenerPreview(): ReactionPreviewSettings {
    const {youtubeTarget, ...preview} = this.settings.preview;
    if (youtubeTarget) preview.youtubeVideoId = this.resolvedPreview?.target === youtubeTarget ? this.resolvedPreview.id : '';
    return preview;
  }
  publicView(): ReactionSnapshot { return { instance: this.instance, sequence: this.sequence, counts: { ...this.counts }, accepting: this.online && this.isAvailable(), pointingEnabled: true, frameGeneration: this.frames.publicGeneration, frame: this.online ? this.frames.publicMetadata() : null }; }
  setOnline(value: boolean) {
    if (!value) this.stickerPlacement.clear();
    this.publicationGeneration++;
    this.online = value && this.isAvailable();
    if (this.online) this.changed();
    else {
      this.frames.invalidatePublic();
      this.stopDesktop('公開は停止中です。');
    }
  }
  preview() { if (this.isAvailable()) { this.previewUntil = this.frames.monotonicNow() + MANAGEMENT_PREVIEW_LEASE; this.desktop.demand(true); } }
  private inventoryAge(inventory: ReturnType<ReactionDesktop['inventory']>) {
    return inventory.observedMonotonicAt === undefined ? this.now() - inventory.observedAt : this.frames.monotonicNow() - inventory.observedMonotonicAt;
  }
  private selected(windows = this.desktop.inventory().windows) {
    const hint = this.settings.target; if (!hint) return undefined;
    const similar = windows.filter(w => w.processName.toLowerCase() === hint.processName.toLowerCase() && w.className === hint.className);
    const exact = similar.filter(w => w.title === hint.title);
    return exact.length === 1 ? exact[0] : !isReactionDisplay(hint) && similar.length === 1 ? similar[0] : undefined;
  }
  private targetKey(target = this.settings.target) { return JSON.stringify(target ? [target.title,target.processName,target.className] : null); }
  private editToken() { return this.session.edit?.kind === 'editing' ? this.operationToken() : undefined; }
  private operationToken() { return `${this.instance}:${this.epoch}`; }
  view(publication: ReactionPublicationState): ReactionManagementSnapshot {
    if (this.previewLookup && !this.previewLookup.signal.aborted) publication = {status: 'starting', url:null, message:'YouTubeのライブ配信を探しています…'};
    const preparing = this.session.preparingManually || !this.enabled && (!!this.initialObsWait || !!this.publishStart || publication.status === 'starting' && this.awaitingPublishEpoch === this.epoch);
    const resume = this.session.recovery ? 'scene' : this.session.edit?.kind;
    const windows = this.desktop.inventory().windows;
    const running = this.runningTarget;
    const selected = running ? windows.find(w => w.id === running.id && w.pid === running.pid) : this.selected(windows);
    return { instance: this.instance, revision: ++this.managementRevision, available: this.isAvailable(), error: this.error, settings: structuredClone(this.settings), windows, selectedId: selected?.id ?? '', frame: this.frames.metadata(), publication, desktop: { enabled: this.enabled, showing: this.showing, message: this.message, preparing, operationToken: this.operationToken(), ...(resume ? {resume} : {}), editToken: this.editToken() }, generation: this.frames.generation };
  }
  async runDesktopPreparation(prepare: () => Promise<void>, expectedToken: unknown) {
    if (expectedToken !== undefined && expectedToken !== this.operationToken()) throw new ReactionError(409, '操作条件が変わりました。再試行してください。');
    if (this.session.preparingManually) throw new ReactionError(409, 'PC表示を準備中です。');
    const work = prepare();
    const finish = this.session.markManualPreparation();
    try { await work; }
    finally { finish(); }
  }
  private tick() {
    if (this.closed) return;
    this.checkInitialObsWait();
    const now = this.frames.monotonicNow();
    const preview = now < this.previewUntil;
    const frame = this.frames.latest();
    const frameAge = frame ? now - frame.observedAt : Infinity;
    if ((this.tracksProgram() || this.online && frame) &&
        (this.programCheckRequested || !this.online || frameAge >= PROGRAM_CHECK_INTERVAL)) void this.checkProgram();
    const follow = this.session.follow;
    const recovering = this.session.recovery;
    const evidence = recovering?.wait.evidence;
    const watchWindows = !!(evidence?.inputs || evidence?.target || evidence?.viewport || evidence?.range?.classes.length || evidence?.work || recovering?.wait.observedRecovery);
    this.desktop.demand(preview || this.enabled || this.session.edit?.kind === 'editing' || !!this.publishStart || !!follow?.monitor || watchWindows);
    const frequentCapture = preview || this.online || this.publishStart;
    // Leave time for a similarly slow capture to finish before the image expires.
    const localRefreshAt = frame ? frame.requestedAt + LOCAL_FRAME_REFRESH - (frame.observedAt - frame.requestedAt) : -Infinity;
    const refreshLocalFrame = follow && this.enabled && now >= localRefreshAt;
    const recoverImage = !frame && !!(evidence?.inputs || recovering?.wait.observedRecovery || recovering?.wait.windowsReady || evidence?.work?.outcome === 'ready');
    if ((frequentCapture || refreshLocalFrame || recoverImage) && now - this.lastCapture >= (frequentCapture ? 500 : RECOVERY_CAPTURE_INTERVAL)) {
      this.lastCapture = now; void this.frames.tick();
    }
    const inventory = this.desktop.inventory(), selected = this.enabled ? inventory.windows.find(w => w.id === this.runningTarget?.id && w.pid === this.runningTarget.pid) : this.selected();
    const edit = this.session.edit, inventoryAge = this.inventoryAge(inventory);
    const freshInventory = inventoryAge >= 0 && inventoryAge < REACTION_WINDOW_INVENTORY_MAX_AGE_MS;
    if (edit?.kind === 'editing' && this.targetKey() === edit.resume.targetKey && freshInventory && !inventory.windows.some(w => w.id === edit.resume.targetId && w.pid === edit.resume.pid)) this.stopDesktop('対象が閉じられました。選択し直してPC表示を開始してください。');
    if (edit?.kind === 'editing' && this.session.edit === edit && !frame) {
      this.session.editRange(edit.resume, 'confirmation');
      this.message = '画像の期限が切れました。最新画像と範囲を確認して再開してください。';
      this.changed();
    }
    if (follow?.monitor && freshInventory && !findMonitor(inventory.windows, follow.monitor)) {
      this.stopDesktop(monitorDisconnected);
    } else if (this.enabled && freshInventory && (!selected || follow && selected.minimized)) {
      if (this.runningTarget?.displayGeometry) this.stopDesktop(monitorDisconnected);
      else if (follow && this.runningTarget) this.waitForRecovery(follow, '対象ウィンドウを表示できません。', { target: this.runningTarget });
      else this.stopDesktop('対象ウィンドウが閉じられました。選択し直してください。');
    } else if (follow && this.enabled && !frame) {
      this.waitForRecovery(follow, 'OBSの最新画像を待っています。', { inputs: true });
    }
    if (this.session.recovery) this.tryFollowRecovery(this.session.recovery, frame, inventory.windows, freshInventory);
    if (selected && this.displayChanged(selected)) return;
    const canvas = this.desktopCanvas(frame);
    const visible = this.enabled && selected && canvas && !selected.minimized && (isReactionDisplay(selected) || !this.settings.foregroundOnly || inventory.foreground === selected.id) && freshInventory;
    const bounds = visible ? reactionCanvasViewport(selected, isReactionDisplay(selected)?{left:0,top:0,right:0,bottom:0}:this.settings.insets, canvas.canvasWidth, canvas.canvasHeight, this.captureRegion ?? this.settings.region) : null;
    this.desktop.render(bounds); this.showing = !!bounds;
    if (!bounds) this.desktop.clear();
    this.tryPublishStart();
  }
  private resetDesktop(message: string) {
    this.initialObsPublicationEpoch = undefined;
    this.initialObsWait = undefined;
    this.session.stop();
    this.auto?.abort();
    this.dependencies = null;
    this.showing = false;
    this.message = message;
    this.desktop.render(null);
    this.desktop.clear();
  }
  stopDesktop(message = 'PC表示を停止しました。') {
    this.resetDesktop(message);
    this.changed();
  }
  pauseEditing() {
    const target=this.selected(),running=this.runningTarget;
    const kind = this.session.edit?.kind ?? 'editing';
    const resume = this.editResume ?? (this.enabled ? { generation:this.frames.generation,targetKey:this.targetKey(),targetId:running?.id??target?.id,pid:running?.pid??target?.pid,geometry:running?.displayGeometry??(target&&isReactionDisplay(target)?reactionDisplayGeometry(target):undefined),dependencies:this.dependencies ?? undefined,fingerprint:running?.fingerprint } : undefined);
    this.resetDesktop('PC表示を停止しました。');
    if (resume) {
      this.session.editRange(resume, kind);
      this.message = kind === 'editing' ? '編集中です。保存・確認後にPC表示を再開します。' : '範囲を確認してPC表示を再開してください。';
    }
    this.changed();
  }
  async cancelEditing(token: unknown) {
    if (typeof token === 'string' && token === this.editToken()) await this.resumeEditedDesktop(this.epoch);
  }
  private async resumeEditedDesktop(epoch: number) {
    const edit = this.session.edit;
    if (edit?.kind !== 'editing' || epoch !== this.epoch) return;
    const resume = edit.resume;
    try {
      const inventory=this.desktop.inventory(),selected=this.selected(),target=selected?{...selected}:undefined,age=this.inventoryAge(inventory);
      if(resume.generation!==this.frames.generation)throw new ReactionError(409,'映像が変わりました。赤枠を再確認してください。');
      if(!target || target.minimized || age<0 || age>=REACTION_WINDOW_INVENTORY_MAX_AGE_MS)throw new ReactionError(409,'対象と最新画像を確認してください。');
      if(this.targetKey()===resume.targetKey && (target.id!==resume.targetId || target.pid!==resume.pid || resume.geometry && reactionDisplayGeometry(target)!==resume.geometry))throw new ReactionError(409,'対象が変わりました。範囲を再確認してください。');
      await this.session.prepareEditedRange(edit, current => this.startDesktop(false, epoch, () =>
        current() && resume.generation === this.frames.generation && this.selected()?.id === target.id && this.selected()?.pid === target.pid &&
        (!isReactionDisplay(target) || reactionDisplayGeometry(this.selected()!) === reactionDisplayGeometry(target))),
      () => new ReactionError(409, 'PC表示の再開が時間切れになりました。範囲を確認してください。'));
    } catch(error) {
      if (this.closed || epoch !== this.epoch || this.session.edit !== edit) return;
      this.session.editRange(resume, 'confirmation');
      this.message = `設定は保存されています。${error instanceof Error ? error.message : '範囲を確認してください。'}`;
      this.changed();
    }
  }
  private wantsPublishStart() {
    return this.settings.autoStartOnPublish && !this.enabled && !this.session.follow && !this.publishStart && !this.initialObsWait;
  }
  private observeObsConnection() {
    try {
      if (this.read().valid()) { this.obsObserved = true; return true; }
    } catch { /* OBS may not have started yet. */ }
    return false;
  }
  private checkInitialObsWait() {
    if (!this.initialObsWait && this.initialObsPublicationEpoch === undefined) return;
    const connected = this.observeObsConnection(), pending = this.initialObsWait;
    if (!pending || !connected) return;
    this.initialObsWait = undefined;
    if (pending.epoch === this.epoch && this.online && !this.closed) pending.start();
  }
  preparePublishStart(waitForInitialObs = false): () => void {
    const epoch = this.epoch;
    const requested = this.wantsPublishStart();
    if (requested && waitForInitialObs && !this.observeObsConnection() && !this.obsObserved) this.initialObsPublicationEpoch = epoch;
    return () => {
      if (this.initialObsPublicationEpoch === epoch) this.initialObsPublicationEpoch = undefined;
      if (this.awaitingPublishEpoch === epoch) this.awaitingPublishEpoch = undefined;
      if (!requested || !this.wantsPublishStart() || this.closed || !this.online || epoch !== this.epoch) return;
      const target = this.settings.target;
      const monitor = target && isReactionDisplay(target) ? { id: `display:${target.title}` } : undefined;
      const start = () => this.queueStart(!target || !!this.settings.binding?.fingerprint, true, { monitor });
      const connected = this.observeObsConnection();
      if (waitForInitialObs && !connected && !this.obsObserved) {
        this.initialObsWait = {epoch, start};
        this.message = 'OBS接続待ちです。接続後に対象と範囲を確認してPC表示を開始します。';
        this.changed();
      } else start();
    };
  }
  async requestPublication(publication: Pick<ReactionPublication, 'start'>, waitForInitialObs = false) {
    this.cancelPreviewLookup();
    const lookup = new AbortController();
    const preview = this.settings.preview;
    if (preview.mode === 'youtube' && preview.youtubeTarget) {
      this.previewLookup = lookup;
      this.resolvedPreview = undefined;
      try {
        const id = await resolveYouTubeLiveTarget(preview.youtubeTarget, AbortSignal.any([lookup.signal, AbortSignal.timeout(15000)]));
        lookup.signal.throwIfAborted();
        if (this.closed) throw new Error('終了しています。');
        this.resolvedPreview = {target:preview.youtubeTarget,id};
      } catch (error) { throw new ReactionError(409, lookup.signal.aborted ? 'ライブ検索を取り消しました。' : error instanceof Error ? error.message : 'ライブ配信を確認できません。'); }
      finally { if (this.previewLookup === lookup) this.previewLookup = undefined; }
    }
    const epoch = this.epoch, requested = this.wantsPublishStart();
    return publication.start(this.preparePublishStart(waitForInitialObs), () => {
      if (requested) this.awaitingPublishEpoch = epoch;
    });
  }
  private queueStart(automaticRange: boolean, needsOnline: boolean, options: AutomaticStartOptions, follow?: FollowOrigin) {
    this.session.begin(automaticRange, needsOnline, this.programRevision, options, follow, attempt => this.expireStart(attempt));
    this.message = 'PC表示の対象と範囲を自動確認しています。'; this.changed();
    this.desktop.demand(true); this.tryPublishStart();
  }
  private observeProgram(next: ProgramScene) {
    const previous = this.program;
    const changed = !!previous && (previous.context !== next.context || previous.scene !== next.scene);
    this.program = { context:next.context, scene:next.scene };
    if (changed) this.programRevision++;
    return changed;
  }
  private async readProgram(read: ObsVisualReader, start?: AutomaticStart): Promise<ProgramScene | undefined> {
    const request = async (type: string) => {
      if (!start) return read.request(type);
      if (!this.session.current(start) || !read.valid()) throw new ReactionRangeError('OBSの構成を再確認しています。', true);
      const pending: ReactionRangeRead = { kind:'read',type,data:{} };
      start.pendingRead = pending;
      try { return await read.request(type); }
      catch { throw new ReactionRangeError('OBSの構成を再確認しています。', true, undefined, read.valid() ? pending : undefined); }
      finally {
        // When the timer is late, expiry still needs to know which read blocked this attempt.
        if (start.pendingRead === pending && this.session.current(start)) start.pendingRead = undefined;
      }
    };
    const types = ['GetCurrentProgramScene','GetSceneCollectionList','GetVideoSettings'];
    const [program, collections, video] = start
      ? [await request(types[0]),await request(types[1]),await request(types[2])]
      : await Promise.all(types.map(request));
    const scene = program.currentProgramSceneName, uuid = program.currentProgramSceneUuid;
    const collection = collections.currentSceneCollectionName, width = Number(video.baseWidth), height = Number(video.baseHeight);
    if (typeof scene !== 'string' || !scene || typeof collection !== 'string' ||
        !Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > 32768 || height > 32768) return;
    return { scene, context:JSON.stringify([collection, uuid ?? scene, width, height]) };
  }
  private tracksProgram() {
    return this.enabled || !!this.session.follow || !!this.publishStart || this.session.edit?.kind === 'editing';
  }
  private async checkProgram() {
    const now = this.frames.monotonicNow();
    if (this.programCheckBusy || now - this.lastProgramCheck < PROGRAM_CHECK_INTERVAL) return;
    this.lastProgramCheck = now;
    this.programCheckBusy = true;
    this.programCheckRequested = false;
    const epoch = this.epoch, generation = this.frames.generation;
    try {
      const observation = this.frames.beginProgramObservation();
      const read = this.read();
      const current = () => (this.tracksProgram() || this.online) && this.epoch === epoch && this.frames.generation === generation && read.valid();
      const first = await this.readProgram(read);
      if (!first || !current()) return;
      const next = await this.readProgram(read);
      if (!next || first.context !== next.context || first.scene !== next.scene || !current()) return;
      if (this.frames.acceptProgramObservation(observation, next)) this.observeProgram(next);
      else this.programCheckRequested = true;
    } catch {
      // A transition or a busy OBS connection can interrupt a sample. The next tick can retry.
      this.programCheckRequested = this.tracksProgram() || this.online;
    } finally {
      this.programCheckBusy = false;
    }
  }
  private waitForRecovery(follow: FollowOrigin, message: string, evidence: RecoveryEvidence) {
    const next = Object.values(evidence).some(Boolean) ? '条件が整い次第、範囲を再判定します。' : '次のシーンで範囲を再判定します。';
    this.resetDesktop(`${message} ${next}`);
    this.session.wait(follow, this.programRevision, evidence, RECOVERY_PROBE_INTERVAL);
    this.changed();
  }
  private resumeFollow(follow: FollowOrigin) {
    this.queueStart(true, false, { monitor:follow.monitor }, follow);
  }
  private tryFollowRecovery({ follow, wait }: { follow: FollowOrigin; wait: RecoveryWait }, frame: StoredReactionFrame | null,
    windows: ReactionWindow[], freshInventory: boolean) {
    const evidence = wait.evidence;
    const { target, range, read, viewport } = evidence;
    const hint = this.settings.target;
    const windowsReady = freshInventory && !!(viewport?.(windows) || range?.classes.length && windowSignature(windows, range.classes) !== range.signature ||
      target && windows.some(window => !window.minimized && (window.id === target.id && window.pid === target.pid || hint && matchesWindowHint(window, hint))));
    const action = this.session.recoveryAction(wait, !!frame && freshInventory, windowsReady, !this.recoveryProbeBusy, RECOVERY_PROBE_INTERVAL);
    if (action === 'resume') this.resumeFollow(follow);
    else if (action === 'probe') void this.probeRangeRecovery(wait, range?.obs, read);
  }
  private async probeRangeRecovery(wait: RecoveryWait, recovery?: ReactionRangeRecovery, pendingRead?: ReactionRangeRead) {
    this.recoveryProbeBusy = true;
    const current = () => this.session.recovery?.wait === wait;
    try {
      const read = this.read();
      const reader = { request:(type: string, data?: Record<string, unknown>) => read.request(type,data), valid:() => current() && read.valid() };
      // An earlier successful RPC cannot establish that the current RPC recovered.
      const prior = pendingRead && recovery?.kind === 'read' ? undefined : recovery;
      for (const probe of [prior, pendingRead]) {
        if (!probe || !reader.valid()) continue;
        const changed = await rangeRecoveryChanged(reader, probe).catch(() => false as const);
        if (changed && reader.valid()) {
          wait.observedRecovery = true;
          break;
        }
      }
    } catch {
      // The OBS read has not recovered; leave the previous range and wait intact.
    } finally { this.recoveryProbeBusy = false; }
  }
  private finishStart(operation: AutomaticStart, message: string, endFollow = false, evidence: RecoveryEvidence = {}) {
    if (this.publishStart !== operation) return;
    const follow = this.session.follow;
    if (follow?.monitor) {
      const inventory = this.desktop.inventory(), age = this.inventoryAge(inventory);
      if (age >= 0 && age < REACTION_WINDOW_INVENTORY_MAX_AGE_MS && !findMonitor(inventory.windows, follow.monitor)) {
        this.stopDesktop(monitorDisconnected);
        return;
      }
    }
    if (!follow || endFollow) {
      this.stopDesktop(`${this.online ? '公開中ですが、' : ''}PC表示は開始していません。${message}`);
      return;
    }
    this.waitForRecovery(follow, message, evidence);
  }
  private pauseForObs(message: string) {
    if (this.initialObsWait || this.initialObsPublicationEpoch === this.epoch) return;
    const follow = this.session.follow;
    const recovery = this.session.recovery;
    if (recovery) {
      if (recovery.wait.revision !== this.programRevision) this.resumeFollow(recovery.follow);
      return;
    }
    const target=this.selected();
    const editResume: EditResume | undefined = this.editResume ?? (this.enabled && !this.settings.binding?.fingerprint ? {generation:this.frames.generation,targetKey:this.targetKey(),targetId:target?.id,pid:target?.pid} : undefined);
    const pending = this.publishStart;
    const resume = !!follow || !!pending?.automaticRange;
    const needsOnline = pending?.needsOnline ?? false;
    const newProgram = !!follow && pending?.programRevision !== this.programRevision;
    // A missing frame while waiting is expected; keep the original bounded wait.
    if (pending?.automaticRange && pending.phase === 'inputs' && !newProgram) { this.desktop.render(null); this.desktop.clear(); return; }
    this.resetDesktop(message);
    if (editResume) { this.session.editRange(editResume, 'confirmation'); this.changed(); return; }
    if (resume && !this.closed && (!needsOnline || this.online)) {
      this.queueStart(true, needsOnline, { deadline:newProgram ? undefined : pending?.deadline,
        waitUntil:newProgram ? undefined : pending?.waitUntil, monitor:follow?.monitor ?? pending?.monitor }, follow);
    } else this.changed();
  }
  private async prepareAutomaticRange(operation: AutomaticStart) {
    const { epoch, monitor } = operation;
    const frame = this.frames.latest();
    if (!frame) throw new ReactionError(409, '最新画像を待ってください。');
    const controller = new AbortController(), read = this.read();
    this.auto = controller; this.autoBusy = true;
    try {
      const rangeInventory = (classes?: ReactionWindowClass[]) => {
        const inventory = this.desktop.inventory(), age = this.inventoryAge(inventory);
        if (age < 0 || age >= REACTION_WINDOW_INVENTORY_MAX_AGE_MS) {
          throw new ReactionRangeError('対象ウィンドウの準備を待っています。', true, classes);
        }
        return inventory.windows;
      };
      const initialWindows = structuredClone(rangeInventory());
      const pinned = monitor && findMonitor(initialWindows, monitor);
      if (monitor && !pinned) throw new MonitorDisconnectedError();
      const result = await this.detectRange(read, monitor?.context === undefined ? pinned ?? null : null, initialWindows, frame, controller.signal, false, operation);
      if (monitor) {
        if (isReactionDisplay(result.target) && result.target.id !== monitor.id) throw new ReactionRangeError('OBSソースが変わりました。自動判定をやり直してください。', false, undefined, result.recovery);
        if (!isReactionDisplay(result.target) && monitor.context === frame.context) throw new ReactionRangeError('対象モニターに対応する画面キャプチャを待っています。', true, undefined, result.recovery);
      }
      const peers = (all: ReactionWindow[]) => JSON.stringify(all.filter(w => result.windowClasses.some(c => c.processName === w.processName.toLowerCase() && c.className === w.className)).map(w => [w.id,w.pid,w.title,...(isReactionDisplay(w)?[reactionDisplayGeometry(w)]:[])]).sort());
      const expected = peers(initialWindows);
      const valid = () => {
        if (this.closed || epoch !== this.epoch || !this.session.current(operation) || controller.signal.aborted || !read.valid()) return false;
        const windows = rangeInventory(result.windowClasses);
        if (monitor && !findMonitor(windows, monitor)) throw new MonitorDisconnectedError();
        if (peers(windows) !== expected || !this.frames.get(frame.metadata.id) || result.target.minimized || !windows.some(w => w.id === result.target.id && w.pid === result.target.pid && w.title === result.target.title && w.className === result.target.className && w.processName === result.target.processName && !w.minimized)) throw new ReactionRangeError('対象ウィンドウと最新画像の準備を待っています。', true, result.windowClasses);
        return true;
      };
      if (!valid()) throw new ReactionError(409, '操作が取り消されました。');
      this.dependencies = result.dependencies;
      // Keep the previous mapping until the new target passes the start checks.
      return { range: result, valid };
    } finally { if (this.auto === controller) { this.auto = undefined; this.autoBusy = false; } }
  }
  private saveAutomaticRange({ target, region, binding }: AutomaticRange, valid: () => boolean, prepared: PreparedSave) {
    return this.commit(current => ({ ...current, target: { title: target.title, className: target.className, processName: target.processName }, region, binding }), valid, false, prepared);
  }
  async publishAtStartup(publication: Pick<ReactionPublication, 'start'>): Promise<void> {
    if (this.startupAttempted) return;
    this.startupAttempted = true;
    if (!this.isAvailable() || !this.settings.publishOnStartup) return;
    const epoch = this.epoch;
    try { await this.requestPublication(publication, true); }
    catch {
      if (this.initialObsPublicationEpoch === epoch) this.initialObsPublicationEpoch = undefined;
      if (!this.closed && epoch === this.epoch) { this.message = '起動時公開を開始できませんでした。公開状態と接続設定を確認して再試行してください。'; this.changed(); }
    }
  }
  async configureStartupPublication(enabled: unknown): Promise<void> {
    if (typeof enabled !== 'boolean') throw new ReactionError(400, '起動時公開の設定を確認してください。');
    await this.commit(current => ({ ...current, publishOnStartup: enabled }), () => true, true);
  }
  private recoveryEvidence(operation: AutomaticStart, inputs: boolean): RecoveryEvidence {
    return {
      inputs,
      range: operation.recovery,
      read: operation.pendingRead,
      work: operation.pendingWork,
    };
  }
  private expireStart(operation: AutomaticStart) {
    const age = this.inventoryAge(this.desktop.inventory());
    const inputs = !this.frames.latest() || age < 0 || age >= REACTION_WINDOW_INVENTORY_MAX_AGE_MS;
    this.finishStart(operation, 'PC表示の自動準備が時間切れになりました。対象と範囲を確認してください。', false, this.recoveryEvidence(operation, inputs));
  }
  private tryPublishStart() {
    const operation = this.publishStart;
    if (!operation || operation.phase !== 'inputs' || operation.needsOnline && !this.online || this.closed) return;
    const now = this.frames.monotonicNow();
    if (now >= operation.deadline) { this.expireStart(operation); return; }
    const fail = (message: string) => this.finishStart(operation, message);
    if (!operation.automaticRange && !this.settings.target) { fail('対象ウィンドウを設定してください。'); return; }
    if (!operation.automaticRange && (!this.settings.binding || this.settings.binding.context === 'invalid')) { fail('範囲の再確認が必要です。赤枠を確認してPC表示を手動開始してください。'); return; }
    const inventory = this.desktop.inventory();
    const age = this.inventoryAge(inventory);
    const fresh = age >= 0 && age < REACTION_WINDOW_INVENTORY_MAX_AGE_MS;
    if (fresh && operation.monitor && !findMonitor(inventory.windows, operation.monitor)) {
      this.finishStart(operation, monitorDisconnected, true);
      return;
    }
    const frame = operation.needsOnline ? this.frames.latestPublic() : this.frames.latest();
    const imageAt = frame && frame.observedAt > operation.waitUntil ? this.frames.latestAt(operation.waitUntil, operation.needsOnline)?.observedAt ?? frame.observedAt : frame?.observedAt;
    const haveInputs = frame && fresh && (operation.automaticRange || this.selected());
    if (!haveInputs || !this.session.canBeginRange(operation, frame.metadata.generation, imageAt ?? frame.observedAt, inventory.observedMonotonicAt ?? now - age)) {
      if (now > operation.waitUntil && (!haveInputs || operation.readyGeneration !== frame.metadata.generation)) {
        this.finishStart(operation, '最新画像または一意な対象ウィンドウを取得できません。', false, this.recoveryEvidence(operation, true));
      }
      return;
    }
    void (async () => {
      const candidate = operation.automaticRange ? await this.prepareAutomaticRange(operation) : undefined;
      if (this.publishStart !== operation) return;
      await this.startDesktop(true, operation.epoch, candidate?.valid, candidate?.range);
    })().catch(error => {
      if (this.publishStart !== operation) return;
      if (!this.session.current(operation)) { this.expireStart(operation); return; }
      if (error instanceof MonitorDisconnectedError) {
        this.finishStart(operation, error.message, true);
        return;
      }
      if (error instanceof ViewportUnavailableError) {
        const range = error.recovery && { classes: [], signature: '[]', obs: error.recovery };
        this.finishStart(operation, error.message, false, { viewport: error.ready, range });
        return;
      }
      const follow = this.session.follow;
      const noCaptureInNewScene = follow && error instanceof NoReactionCaptureError && !sameProgramScene(follow.context, error.context);
      if (operation.automaticRange && error instanceof ReactionRangeError) {
        const classes = error.windowClasses ?? operation.recovery?.classes ?? [];
        const range = { classes, signature:windowSignature(inventory.windows, classes), obs:error.recovery ?? operation.recovery?.obs };
        if (!error.retryable || noCaptureInNewScene) {
          const canRecheck = !!error.recovery || !!error.windowClasses?.length;
          this.finishStart(operation, error.message, false, canRecheck ? { range } : undefined);
          return;
        }
        this.session.retry(operation, range);
        this.message = error.message;
        this.changed();
      }
      else fail(error instanceof Error ? error.message : '対象・OBS接続・範囲を確認して手動開始してください。');
    });
  }
  async configurePublishStart(enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new ReactionError(400, '自動開始の設定を確認してください。');
    this.stopDesktop(); const epoch = this.epoch; await this.saving;
    const target = this.selected(), frame = this.frames.latest();
    const monitorGeometry=target && isReactionDisplay(target)?reactionDisplayGeometry(target):null;
    const displayValid=()=>!monitorGeometry || this.desktop.inventory().windows.some(w=>w.id===target?.id && reactionDisplayGeometry(w)===monitorGeometry);
    let binding = this.settings.binding;
    let confirmation: ObsVisualReader | undefined;
    const automaticRange = !this.settings.target || !!binding?.fingerprint;
    try {
      if (enabled && !automaticRange) {
        if (target && this.displayChanged(target)) throw new ReactionError(409,'モニターの範囲を再確認してください。');
        if (!target || !frame) throw new ReactionError(409, '対象ウィンドウと最新画像の赤枠を確認してください。');
        if (binding && (binding.context !== frame.context || binding.scene !== frame.scene)) throw new ReactionError(409, '範囲を設定し直してから自動開始を有効にしてください。');
        if (epoch === this.epoch) this.confirmingPublishRange = epoch;
        confirmation = this.read();
        if (!binding && isReactionDisplay(target)) {
          const fresh=await this.detectRange(confirmation,target,this.desktop.inventory().windows,frame,new AbortController().signal,true);
          binding={...fresh.binding,fingerprint:null};this.dependencies=fresh.dependencies;
        } else binding ??= await manualReactionBinding(confirmation, frame);
      }
      await this.commit({ ...this.settings, autoStartOnPublish: enabled, binding }, () => epoch === this.epoch && (!enabled || automaticRange || displayValid() && confirmation?.valid() === true && !!frame && !!this.frames.get(frame.metadata.id) && this.selected()?.id === target?.id));
    } finally {
      if (this.confirmingPublishRange === epoch) this.confirmingPublishRange = undefined;
    }
    if(enabled && !automaticRange && target)this.confirmDisplay(target);
    this.message = enabled ? '公開時のPC自動開始を有効にしました。' : '公開時のPC自動開始はOFFです。'; this.changed();
  }
  private commit(settings: ReactionSettings | ((current: ReactionSettings) => ReactionSettings), valid: () => boolean = () => true, startupChange = false, prepared?: PreparedSave): Promise<void> {
    const candidate = typeof settings === 'function' ? settings : structuredClone(settings);
    const work = this.saving.then(async () => {
      if (!this.isAvailable()) throw new ReactionError(503, 'リアクションを利用できません。');
      if (!valid()) throw new ReactionError(409, '操作が取り消されました。');
      // A full desktop candidate retains the latest independent publication preferences.
      const resolve = () => structuredClone(typeof candidate === 'function' ? candidate(this.settings) : { ...candidate, publishOnStartup: this.settings.publishOnStartup, preview: this.settings.preview });
      let saved = resolve();
      let written = false, guarded = false;
      try {
        if (startupChange) { await this.store.beginStartupChange?.(); guarded = true; }
        for (;;) {
          await this.store.save(saved); written = true;
          if (!valid()) throw new ReactionError(409, '操作が取り消されました。');
          if (prepared) {
            await prepared.verify();
            if (!valid()) throw new ReactionError(409, '操作が取り消されました。');
          }
          // OBS may invalidate a binding while a preference write is pending.
          // Rebase patches onto that latest state and persist it before reporting success.
          if (typeof candidate === 'function') {
            const latest = resolve();
            if (JSON.stringify(latest) !== JSON.stringify(saved)) { saved = latest; continue; }
          }
          if (guarded) {
            this.store.completeStartupChange?.(); guarded = false;
          }
          this.settings = saved;
          this.error = null;
          prepared?.activate();
          break;
        }
      } catch (failure) {
        let restored = true;
        if (written) {
          try { await this.store.save(this.settings); prepared?.restored?.(); }
          catch { restored = false; }
        }
        if (guarded && restored) { try { this.store.completeStartupChange?.(); } catch { restored = false; } }
        if (!restored) {
          this.available = false; this.error = '設定保存の復元に失敗し、保存状態が不明です。リアクションの受付を停止しました。設定ファイルと未完了ファイルを保持しています。';
          this.setOnline(false);
        }
        throw failure;
      }
      this.changed();
    });
    this.saving = work.catch(() => undefined); return work;
  }
  async configureListenerPreview(value: unknown): Promise<void> {
    if (!validReactionPreviewSettings(value)) throw new ReactionError(400, '配信映像の設定を確認してください。');
    this.cancelPreviewLookup();
    const change = ++this.previewChange;
    const preview = { ...value }, lookup = new AbortController(), generation = this.publicationGeneration;
    const resolveNow = this.online && preview.mode === 'youtube' && !!preview.youtubeTarget;
    let resolved: {target:string; id:string} | undefined;
    if (resolveNow) this.previewLookup = lookup;
    try {
      if (resolveNow && preview.youtubeTarget) {
        const id = await resolveYouTubeLiveTarget(preview.youtubeTarget, AbortSignal.any([lookup.signal, AbortSignal.timeout(15000)]));
        resolved = {target:preview.youtubeTarget,id};
      }
      await this.commit(current => ({ ...current, preview }), () => change === this.previewChange && !lookup.signal.aborted &&
        (!resolveNow || this.online && generation === this.publicationGeneration));
      this.cancelPreviewLookup();
      this.resolvedPreview = resolved;
    } catch (error) {
      throw error instanceof ReactionError ? error : new ReactionError(409, lookup.signal.aborted ? 'ライブ検索を取り消しました。' : error instanceof Error ? error.message : 'ライブ配信を確認できません。');
    } finally { if (this.previewLookup === lookup) this.previewLookup = undefined; }
  }
  async update(value: unknown) {
    this.pauseEditing(); const epoch=this.epoch;
    if (!validReactionSettings(value)) throw new ReactionError(400, '対象・範囲・余白を確認してください。');
    if (value.autoStartOnPublish !== this.settings.autoStartOnPublish) throw new ReactionError(409, '自動開始の設定を再取得してから保存してください。');
    if (value.publishOnStartup !== this.settings.publishOnStartup) throw new ReactionError(409, '起動時公開の設定を再取得してから保存してください。');
    await this.commit(current => ({ ...value, binding: current.binding?.fingerprint && current.binding.context!=='invalid' && this.targetKey(current.target)===this.targetKey(value.target) && (['x','y','width','height'] as const).every(key=>current.region[key]===value.region[key]) ? current.binding : null, autoStartOnPublish: current.autoStartOnPublish, publishOnStartup: current.publishOnStartup, preview: current.preview }));
    this.monitorConfirmation=null;
    await this.resumeEditedDesktop(epoch);
  }
  async detect(targetId: unknown) {
    if (this.autoBusy) throw new ReactionError(409, '判定の完了を待ってください。');
    const windows = structuredClone(this.desktop.inventory().windows);
    const target = windows.find(w => w.id === targetId), frame = this.frames.latest();
    if (!target || !frame) throw new ReactionError(409, '対象と最新画像を確認してください。');
    this.pauseEditing(); const epoch = this.epoch; const controller = new AbortController(); this.auto = controller; this.autoBusy = true;
    const geometry = isReactionDisplay(target) ? reactionDisplayGeometry(target) : null;
    try {
      const result = await this.detectRange(this.read(), target, windows, frame, controller.signal);
      const expected = windowSignature(windows, result.windowClasses);
      const valid = () => {
        const current = this.desktop.inventory().windows;
        return epoch === this.epoch && !this.closed && !controller.signal.aborted && !!this.frames.get(frame.metadata.id) &&
          windowSignature(current, result.windowClasses) === expected &&
          current.some(w => w.id === target.id && w.pid === target.pid && w.title === target.title && (!geometry || reactionDisplayGeometry(w) === geometry));
      };
      if (!valid()) throw new ReactionError(409, '判定対象が変わりました。');
      const previousDependencies = this.dependencies;
      this.dependencies = result.dependencies;
      let activated = false;
      try {
        await this.saveAutomaticRange(result, valid, {
          verify: async () => { await this.verifyCandidate(this.read(), frame, result, target, controller.signal); },
          activate: () => {
            this.confirmDisplay(target);
            this.message = '赤枠を確認してPC表示を開始してください。';
            activated = true;
          },
        });
      } finally {
        if (!activated && this.dependencies === result.dependencies) this.dependencies = previousDependencies;
      }
    } catch (error) {
      if (epoch === this.epoch && this.editResume) {
        this.session.editRange(this.editResume, 'confirmation');
        this.message = '自動判定できませんでした。範囲を確認してPC表示を再開してください。';
        this.changed();
      }
      throw error;
    } finally { if (this.auto === controller) { this.auto = undefined; this.autoBusy = false; } }
    await this.resumeEditedDesktop(epoch);
  }
  private async verifyCandidate(read: ObsVisualReader, frame: StoredReactionFrame, candidate: AutomaticRange,
    target: ReactionWindow | null, signal: AbortSignal, start?: AutomaticStart) {
    const windows = structuredClone(this.desktop.inventory().windows);
    const fresh = await this.detectRange(read, target, windows, frame, signal, false, start);
    if (fresh.binding.fingerprint !== candidate.binding.fingerprint || fresh.target.id !== candidate.target.id || fresh.target.pid !== candidate.target.pid) {
      throw new ReactionRangeError('OBSの対応範囲が変わりました。最新画像と範囲を確認してください。', true);
    }
    if (windowSignature(this.desktop.inventory().windows, fresh.windowClasses) !== windowSignature(windows, fresh.windowClasses)) {
      throw new ReactionRangeError('対象候補の変化を再確認しています。', true);
    }
  }
  async startDesktop(automatic = false, epoch = this.epoch, resumeValid: () => boolean = () => true, candidate?: AutomaticRange) {
    if (!automatic && (this.initialObsWait || this.initialObsPublicationEpoch === this.epoch || this.publishStart || this.session.recovery)) { this.stopDesktop(); epoch = this.epoch; }
    if (this.autoBusy) throw new ReactionError(409, '自動判定の完了を待ってください。');
    const start = automatic && this.publishStart?.epoch === epoch ? this.publishStart : undefined;
    const contextChanged = () => new ReactionRangeError('OBSの構成と接続を再確認しています。', true);
    const valid = (read?: ObsVisualReader, frame?: StoredReactionFrame) => {
      if (this.closed || epoch !== this.epoch || start && !this.session.current(start)) return false;
      if (!resumeValid() || read?.valid() === false || frame && !this.frames.get(frame.metadata.id)) {
        if (candidate) throw contextChanged();
        return false;
      }
      return true;
    };
    await this.session.awaitWork(this.saving, start, 'saving');
    if (!valid()) throw new ReactionError(409, '開始を取り消しました。');
    const currentCandidate = () => candidate && this.desktop.inventory().windows.find(w => w.id === candidate.target.id && w.pid === candidate.target.pid);
    const target = candidate ? currentCandidate() : this.selected();
    const frame = this.frames.latest();
    if (!target || !frame) throw new ReactionError(409, '対象と最新画像を確認してください。');
    const resumingEdit = !automatic && this.session.edit?.kind === 'editing';
    const canReopenRead = resumingEdit || automatic && !candidate;
    if (this.displayChanged(target)) throw new ReactionError(409,'モニターの範囲を再確認してください。');
    let read = this.read();
    const withCurrentRead = async <T>(verify: () => Promise<T>): Promise<T> => {
      for (;;) {
        if (canReopenRead && !read.valid() && valid(undefined, frame)) read = this.read();
        try { return await verify(); }
        catch (error) {
          // The edit token also checks the original preparation deadline.
          if (!canReopenRead || read.valid() || !valid(undefined, frame)) throw error;
        }
      }
    };
    const binding = candidate?.binding ?? (!automatic && this.session.edit?.kind === 'confirmation' && !this.settings.binding?.fingerprint ? null : this.settings.binding);
    if (automatic && (!binding || target.minimized)) throw new ReactionError(409, '範囲が未確認、または対象ウィンドウが最小化されています。');
    if (binding && (binding.context !== frame.context || binding.scene !== frame.scene)) throw new ReactionError(409, 'OBS画面が変わりました。範囲を設定し直してください。');
    const displayGeometry = isReactionDisplay(target) ? reactionDisplayGeometry(target) : undefined;
    const displayValid = () => !displayGeometry || this.desktop.inventory().windows.some(w=>w.id===target.id && reactionDisplayGeometry(w)===displayGeometry);
    let startWindowsValid = displayValid;
    let verifiedFingerprint: string | null = null;
    let captureRegion = candidate?.region ?? this.settings.region, dependencies: ReactionDependencies | null = null, monitorBinding: ReactionSettings['binding'] = null;
    let rangeRecovery = candidate?.recovery;
    if (binding?.fingerprint || isReactionDisplay(target)) {
      const windows = structuredClone(this.desktop.inventory().windows);
      const monitor = this.publishStart?.monitor;
      const pinned = monitor?.id === target.id && monitor.context === undefined;
      const fresh = await withCurrentRead(() => this.detectRange(read, automatic && binding?.fingerprint && !pinned ? null : target,
        windows, frame, new AbortController().signal, isReactionDisplay(target) && !binding?.fingerprint, start));
      verifiedFingerprint = fresh.binding.fingerprint;
      const peers = (all: ReactionWindow[]) => JSON.stringify(all.filter(w => fresh.windowClasses.some(c => c.processName === w.processName.toLowerCase() && c.className === w.className)).map(w => [w.id,w.pid,w.title,w.minimized,...(isReactionDisplay(w)?[reactionDisplayGeometry(w)]:[])]).sort());
      const expected = peers(windows);
      startWindowsValid = () => displayValid() && peers(this.desktop.inventory().windows) === expected;
      if (fresh.target.id !== target.id || fresh.target.pid !== target.pid || binding?.fingerprint && (fresh.binding.fingerprint !== binding.fingerprint || fresh.binding.input !== binding.input || fresh.binding.item !== binding.item) || !binding?.fingerprint && binding?.input && fresh.binding.input!==binding.input) throw new ReactionError(409, 'OBSソースが変わりました。自動判定をやり直してください。');
      if(isReactionDisplay(target) && !binding?.fingerprint){
        const r=this.settings.region,v=fresh.region;
        if(r.x<v.x-1e-6 || r.y<v.y-1e-6 || r.x+r.width>v.x+v.width+1e-6 || r.y+r.height>v.y+v.height+1e-6)throw new ReactionError(409,'赤枠を画面キャプチャの表示範囲内に指定してください。');
        monitorBinding={...fresh.binding,fingerprint:null};
      }
      captureRegion = fresh.captureRegion; dependencies = fresh.dependencies; rangeRecovery = fresh.recovery;
    }
    const viewport = (window: ReactionWindow) => {
      const insets = isReactionDisplay(window) ? { left:0, top:0, right:0, bottom:0 } : this.settings.insets;
      return reactionCanvasViewport(window, insets, frame.metadata.canvasWidth, frame.metadata.canvasHeight, captureRegion);
    };
    const checkViewport = (window: ReactionWindow) => {
      if (!viewport(window)) throw new ViewportUnavailableError(windows => windows.some(current => !current.minimized &&
        (current.id === window.id && current.pid === window.pid || !isReactionDisplay(window) && matchesWindowHint(current, window)) && !!viewport(current)), rangeRecovery);
    };
    const viewportTarget = candidate ? currentCandidate() : target;
    if (!viewportTarget) throw new ReactionRangeError('対象候補の変化を再確認しています。', true);
    checkViewport(viewportTarget);
    if (!valid(read, frame)) throw new ReactionError(409, '表示条件が変わりました。');
    const verifyProgramContext = async () => {
      const program = await this.readProgram(read, start);
      if (program?.context !== frame.context || program.scene !== frame.scene) throw new ReactionError(409, '映像が変わりました。赤枠を再確認してください。');
    };
    const verifyExistingRange = async () => {
      await verifyProgramContext();
      const original = resumingEdit && !binding && this.editResume?.targetKey === this.targetKey() ? this.editResume?.fingerprint : undefined;
      const fingerprint = original ?? verifiedFingerprint;
      if (fingerprint) {
        const fresh = await this.detectRange(read, target, this.desktop.inventory().windows, frame, new AbortController().signal,
          isReactionDisplay(target) && !binding?.fingerprint, start);
        if (fresh.binding.fingerprint !== fingerprint) throw new ReactionError(409, 'OBSの対応範囲が変わりました。赤枠を再確認してください。');
        dependencies = fresh.dependencies;
        verifiedFingerprint = fresh.binding.fingerprint;
      } else {
        // The scene, collection and canvas replies may straddle a silent switch.
        await verifyProgramContext();
      }
      if (!read.valid()) throw new ReactionError(409, '表示条件が変わりました。');
    };
    const confirmExistingRange = async () => {
      if (!valid(undefined, frame)) throw new ReactionError(409, '表示条件が変わりました。');
      await withCurrentRead(verifyExistingRange);
    };
    this.dependencies = dependencies;
    await this.session.awaitWork(this.desktop.prepare(), start, 'native');
    if (!startWindowsValid()) throw new ReactionRangeError('対象候補の変化を再確認しています。', true);
    if (!candidate) await confirmExistingRange();
    if (!valid(read, frame)) throw new ReactionError(409, '表示条件が変わりました。');
    const manual = binding ?? monitorBinding ?? await manualReactionBinding(read, frame);
    if (!valid(read, frame) || !candidate && this.selected()?.id !== target.id) throw new ReactionError(409, '表示条件が変わりました。');
    const activate = () => {
      if (!binding) this.settings = { ...this.settings, binding: manual };
      this.dependencies = dependencies;
      const monitor = isReactionDisplay(target) ? { id: target.id, context: frame.context } : candidate ? this.session.follow?.monitor : undefined;
      const follow = binding?.fingerprint ? { context: frame.context, monitor } : undefined;
      const { canvasWidth, canvasHeight } = frame.metadata;
      this.session.show({ id: target.id, pid: target.pid, displayGeometry, fingerprint: verifiedFingerprint ?? undefined },
        { ...captureRegion }, { canvasWidth, canvasHeight }, follow);
      this.confirmDisplay(target);
      this.message = isReactionDisplay(target) ? '対象モニターに表示します。' : this.settings.foregroundOnly ? '対象が前面のとき表示します。' : '対象が背面でも表示します。';
    };
    const checkStart = () => {
      if (!valid(read, frame)) throw new ReactionError(409, '表示条件が変わりました。');
      if (!startWindowsValid()) throw new ReactionRangeError('対象候補の変化を再確認しています。', true);
    };
    if (candidate) {
      const verifyProgram = async () => {
        const currentProgram = await this.readProgram(read, start);
        if (currentProgram?.context !== frame.context || currentProgram.scene !== frame.scene) throw contextChanged();
      };
      await verifyProgram();
      let compensated = false;
      const saving = this.saveAutomaticRange(candidate, () => {
        if (!valid(read, frame)) return false;
        const current = currentCandidate();
        if (!current || !startWindowsValid()) throw new ReactionRangeError('対象候補の変化を再確認しています。', true);
        checkViewport(current);
        return true;
      }, {
        verify: async () => {
          await verifyProgram();
          const current = currentCandidate();
          if (!current) throw contextChanged();
          const pinned = start?.monitor?.id === current.id && start.monitor.context === undefined;
          await this.verifyCandidate(read, frame, candidate, pinned ? current : null, new AbortController().signal, start);
        },
        activate,
        restored: () => { compensated = true; },
      });
      await this.session.awaitWork(saving, start, 'saving', () => compensated);
    } else if (!binding && this.settings.autoStartOnPublish) {
      await this.commit(current => ({ ...current, binding: manual }), () => {
        if (!valid(resumingEdit ? undefined : read, frame) || this.selected()?.id !== target.id || !displayValid()) return false;
        if (!startWindowsValid()) throw new ReactionRangeError('対象候補の変化を再確認しています。', true);
        return true;
      }, false, { verify: confirmExistingRange, activate });
    } else {
      checkStart();
      activate();
    }
    this.tick();
    this.changed();
  }
  testDesktop() {
    this.tick();
    if (!this.enabled) throw new ReactionError(409, '先にPC表示を開始してください。');
    const { x, y, width, height } = this.settings.region;
    if (!this.deliverPoint(x + width / 2, y + height / 2, { intent: 'look', at: this.now() })) {
      if (this.enabled && this.runningTarget && this.settings.foregroundOnly && !isReactionDisplay(this.settings.target) &&
          this.desktopCanvas() && this.selected()?.minimized === false &&
          this.desktop.inventory().foreground !== this.runningTarget.id) {
        throw new ReactionError(409, 'テスト表示できません。表示先を前面にするか、前面限定をオフにしてください。');
      }
      throw new ReactionError(409, 'テスト表示できません。表示先とOBS映像を確認してください。');
    }
  }
  private deliverPoint(x: number, y: number, details?: { intent: ReactionPointIntent; at: number }) {
    const visible = this.settings.region, r = this.captureRegion ?? visible, canvas = this.desktopCanvas();
    if (x < visible.x - 1e-9 || x > visible.x + visible.width + 1e-9 || y < visible.y - 1e-9 || y > visible.y + visible.height + 1e-9) return false;
    const px = (x - r.x) / r.width, py = (y - r.y) / r.height;
    if (!this.showing || !canvas || !(px >= -1e-9 && px <= 1.000000001 && py >= -1e-9 && py <= 1.000000001)) return false;
    this.desktop.marker({ x: Math.max(0, Math.min(1, px)), y: Math.max(0, Math.min(1, py)), canvasWidth: canvas.canvasWidth * r.width, region: r, ...details });
    return true;
  }
  private relevantRangeChange(deps: ReactionDependencies, type: string, data: Record<string, unknown>, pathOnly = false) {
    if (/CurrentProgramScene|SceneCollection|VideoSettings|Disconnected|Disabled/.test(type)) return true;
    if (type === 'SceneNameChanged') return deps.items.some(i => i.scene === data.oldSceneName);
    if (/SceneItem/.test(type)) {
      if (data.sceneName && !deps.scenes.includes(String(data.sceneName))) return false;
      if (data.sceneName && data.sceneItemId !== undefined) {
        const item = deps.items.find(i => i.scene === data.sceneName && i.id === data.sceneItemId);
        if (type === 'SceneItemTransformChanged') {
          return !!item && !(record(data.sceneItemTransform) && isDeepStrictEqual(data.sceneItemTransform, item.transform));
        }
        if (pathOnly && /^(SceneItemEnableStateChanged|SceneItemRemoved)$/u.test(type)) return !!item;
      }
      if (pathOnly && type === 'SceneItemCreated') return false;
      return true;
    }
    if (/Input|SourceFilter/.test(type)) {
      const ids = [data.inputUuid,data.sourceUuid,data.inputName,data.sourceName].filter(x => typeof x === 'string');
      const sources = !pathOnly && /Input/.test(type) ? [...deps.sources,...deps.candidateSources] : deps.sources;
      return !ids.length || ids.some(x => sources.includes(String(x)));
    }
    return /SceneRemoved/.test(type) && (!data.sceneName || deps.scenes.includes(String(data.sceneName)));
  }
  private sameReindexedItems(deps: ReactionDependencies, data: Record<string, unknown>) {
    const knownIds = deps.sceneItems?.find(({ scene }) => scene === data.sceneName)?.ids;
    const items = data.sceneItems;
    if (!knownIds || !Array.isArray(items) || knownIds.length !== items.length ||
        !deps.items.some(item => item.scene === data.sceneName)) return false;
    const ids = new Set<number>(), indexes = new Set<number>();
    for (const item of items) {
      if (!record(item)) return false;
      const { sceneItemId:id, sceneItemIndex:index } = item;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || !knownIds.includes(id) ||
          typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= items.length) return false;
      ids.add(id);
      indexes.add(index);
    }
    return ids.size === items.length && indexes.size === items.length;
  }
  private async detectRange(read: ObsVisualReader, target: ReactionWindow | null, windows: ReactionWindow[], frame: StoredReactionFrame, signal: AbortSignal, manualDisplay = false, start?: AutomaticStart) {
    const reader = start ? { request: read.request.bind(read), valid: () => this.session.current(start) && read.valid() } : read;
    this.rangeDiscoveries++;
    try {
      return await detectReactionRange(reader, target, windows, frame, signal, dependencies => {
        const check = { dependencies, changed: false }; this.rangeChecks.add(check);
        return { valid: () => !check.changed, close: () => { this.rangeChecks.delete(check); } };
      }, manualDisplay, start ? (request, pending) => {
        if (pending) start.pendingRead = request;
        else if (start.pendingRead === request && this.session.current(start)) start.pendingRead = undefined;
      } : undefined);
    } finally { this.rangeDiscoveries--; }
  }
  obsChanged(type: string, data: Record<string, unknown> = {}) {
    if (type === 'CurrentPreviewSceneChanged' || type === 'SceneListChanged' ||
        type === 'SceneItemSelected' || type === 'SceneItemLockStateChanged') return;
    if (type.startsWith('Input') && !rangeInputEvents.has(type)) return;
    if (/Disconnected|Disabled/.test(type)) {
      const waitingForFirstConnection = !this.obsObserved && (!!this.initialObsWait || this.initialObsPublicationEpoch === this.epoch);
      if (type !== 'Disconnected' || !waitingForFirstConnection) this.stopDesktop('OBS接続が停止しました。');
      this.frames.invalidate(); return;
    }
    if (/CurrentProgramScene|SceneCollection|VideoSettings/.test(type)) {
      this.programCheckRequested = true;
      return;
    }
    for (const check of this.rangeChecks) if (this.relevantRangeChange(check.dependencies,type,data)) check.changed = true;
    if (this.session.recovery) {
      // Recovery probes recheck the capture paths. The saved binding may refer
      // to a different scene and must not invalidate the current program image.
      if (type === 'SceneNameChanged') this.programCheckRequested = true;
      return;
    }
    const binding = this.settings.binding;
    const edit = this.editResume;
    const editDeps = this.session.edit?.kind === 'editing' && edit && this.targetKey() === edit.targetKey ? edit.dependencies : undefined;
    const deps = this.dependencies ?? editDeps;
    const renamed = type === 'SceneNameChanged' && typeof data.oldSceneName === 'string' ? data.oldSceneName : undefined;
    const programScene = this.frames.latest()?.scene;
    if (renamed && programScene === renamed && binding?.scene !== renamed && !deps?.scenes.includes(renamed)) {
      this.frames.invalidate();
      return;
    }
    const manualDisplayBinding = isReactionDisplay(this.settings.target) && !!binding && !binding.fingerprint;
    // Discovery verifies two scans and watches only their relevant dependencies.
    if (!deps && this.rangeDiscoveries && /Scene|Input|SourceFilter/.test(type)) return;
    const pathOnly = !binding?.fingerprint && !this.publishStart?.automaticRange;
    const preparingRange = this.rangeDiscoveries > 0 || !!this.publishStart || this.session.preparingManually ||
      this.session.edit?.kind === 'editing' || this.autoBusy || this.confirmingPublishRange === this.epoch;
    // Reindexing doesn't move an established capture path, but the range scans
    // above still watch for changes while establishing a new path.
    if (type === 'SceneItemListReindexed' && deps && !preparingRange && this.sameReindexedItems(deps, data)) return;
    if (deps && !this.relevantRangeChange(deps,type,data,pathOnly)) return;
    const validatingRange = this.tracksProgram() || !!this.session.edit || this.session.preparingManually ||
      this.autoBusy || this.confirmingPublishRange === this.epoch;
    if (!binding) {
      const { x, y, width, height } = this.settings.region;
      const adjustedRange = x !== 0 || y !== 0 || width !== 1 || height !== 1;
      if ((adjustedRange || validatingRange) && (this.settings.target || this.publishStart?.automaticRange) &&
          /Scene|Input|SourceFilter/.test(type)) this.frames.invalidate();
      return;
    }
    if (type === 'SceneNameChanged') {
      if ((!manualDisplayBinding || deps) && data.oldSceneName !== binding.scene && !deps?.scenes.includes(String(data.oldSceneName))) return;
    } else {
      if (!/SceneItem|Input|SourceFilter|SceneRemoved/.test(type)) return;
      if (!manualDisplayBinding && data.sceneName && data.sceneName !== binding.scene && !deps?.scenes.includes(String(data.sceneName))) return;
      if (!binding.fingerprint && !manualDisplayBinding && binding.input && (data.inputUuid || data.sourceUuid) && data.inputUuid !== binding.input && data.sourceUuid !== binding.input) return;
      if (!binding.fingerprint && !manualDisplayBinding && binding.item !== null && data.sceneItemId !== undefined && data.sceneItemId !== binding.item) return;
    }
    this.settings = { ...this.settings, binding: { ...binding, context: 'invalid' } };
    if (!(renamed && programScene && renamed !== programScene && !validatingRange)) {
      this.frames.invalidate('OBSの対応範囲が変わりました。最新画像を待っています。');
    }
    this.changed();
  }
  async react(value: unknown) {
    if (!this.online || !this.isAvailable()) throw new ReactionError(503, '受付を停止しています。');
    if (!record(value) || typeof value.kind !== 'string' || !['heart','clap','point','area','arrow','cheer','sticker'].includes(value.kind)) throw new ReactionError(400, 'リアクションを確認してください。');
    const publicationGeneration = this.publicationGeneration;
    const publicGeneration = this.frames.publicGeneration;
    const kind = value.kind as ReactionKind;
    const placement = kind === 'point' || kind === 'area' || kind === 'arrow';
    const retiredFrame = () => new ReactionError(409, '画像が古くなりました。', { generation: this.frames.publicMetadata()?.generation });
    const currentPublication = () => this.online && publicationGeneration === this.publicationGeneration && publicGeneration === this.frames.publicGeneration;
    if (placement) {
      if (kind === 'arrow' && (Object.keys(value).sort().join(',') !== 'frameId,from,kind,to' || !validArrowPoint(value.from) || !validArrowPoint(value.to) || value.from.x === value.to.x && value.from.y === value.to.y)) throw new ReactionError(400, '画像内に矢印の始点と終点を指定してください。');
      if (kind === 'area' && (Object.keys(value).sort().join(',') !== 'area,frameId,kind,shape' || typeof value.shape !== 'string' || !['ellipse','rectangle'].includes(value.shape) || !validReactionRegion(value.area) || value.area.width < .01 || value.area.height < .01)) throw new ReactionError(400, '映像内に縦横1%以上の丸または枠を指定してください。');
      if (typeof value.frameId !== 'string') throw new ReactionError(400, '最新画像を指定してください。');
      if (kind === 'point' && (Object.keys(value).filter(key => key !== 'intent').sort().join(',') !== 'frameId,kind,x,y' || 'intent' in value && !validReactionPointIntent(value.intent) || ![value.x,value.y].every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1))) throw new ReactionError(400, '画像内の場所とリアクションを指定してください。');
      const frame = this.frames.getPublic(value.frameId);
      if (!frame) throw retiredFrame();
      const staleImage = () => new ReactionError(409, '新しい画像でもう一度指定してください。');
      try {
        const read = this.read();
        // Check twice so a change between the independent OBS reads cannot be
        // hidden by combining old canvas/collection data with the current scene.
        for (let pass = 0; pass < 2; pass++) {
          const [collection, video, scene] = await Promise.all([
            read.request('GetSceneCollectionList'), read.request('GetVideoSettings'), read.request('GetCurrentProgramScene'),
          ]);
          const context = JSON.stringify([collection.currentSceneCollectionName, scene.currentProgramSceneUuid ?? scene.currentProgramSceneName, video.baseWidth, video.baseHeight]);
          if (!read.valid() || !currentPublication() || context !== frame.context || scene.currentProgramSceneName !== frame.scene) throw staleImage();
        }
      } catch (error) {
        if (!this.frames.getPublic(value.frameId) || error instanceof Error && error.message === 'OBS_CAPTURE_CHANGED') throw staleImage();
        throw error;
      }
      if (!this.frames.getPublic(value.frameId)) throw retiredFrame();
    } else if (kind === 'sticker' ? Object.keys(value).sort().join(',') !== 'kind,sticker' || !reactionSticker(value.sticker) : Object.keys(value).join(',') !== 'kind') throw new ReactionError(400, 'リアクションを確認してください。');
    // Desktop tracking can emit a snapshot while hiding a vanished target.
    // Emit it before advancing the reaction sequence so OBS cannot discard the new event.
    this.tick();
    if (placement) {
      if (!currentPublication()) throw new ReactionError(409,'対応範囲が変わりました。最新画像でもう一度指定してください。');
      if (!this.frames.getPublic(String(value.frameId))) throw retiredFrame();
    }
    this.counts[kind]++; this.sequence++;
    const event: ReactionEvent = { ...this.publicView(), kind, ...(kind === 'sticker' ? {sticker: reactionSticker(value.sticker)!.id} : {}), at: this.now(), ...(kind === 'point' ? { x: Number(value.x), y: Number(value.y), frameId: String(value.frameId) } : kind === 'area' ? {area: structuredClone(value.area) as ReactionRegion, shape: value.shape as 'ellipse' | 'rectangle', frameId: String(value.frameId)} : {}) };
    if (kind === 'arrow' && validArrowPoint(value.from) && validArrowPoint(value.to)) Object.assign(event, {from:{...value.from},to:{...value.to},frameId:String(value.frameId)});
    if (kind === 'point') {
      event.intent = validReactionPointIntent(value.intent) ? value.intent : 'look';
      this.deliverPoint(Number(value.x), Number(value.y), { intent: event.intent, at: event.at });
    }
    if (kind === 'sticker') event.stickerPlacement = this.stickerPlacement.choose(`${this.instance}:${this.sequence}`, this.frames.monotonicNow(), reactionSticker(event.sticker)!.duration, event.frame?.canvasWidth, event.frame?.canvasHeight);
    const r = this.settings.region;
    const arrowVisible = event.to && event.to.x >= r.x && event.to.x <= r.x+r.width && event.to.y >= r.y && event.to.y <= r.y+r.height;
    if (kind !== 'point' && this.showing && (kind !== 'arrow' || arrowVisible)) this.desktop.reaction(kind === 'area' || kind === 'arrow' ? {...event, clip:{...r}} : event);
    for (const listener of this.listeners) listener('reaction', event);
    return { message: 'リアクションを受け付けました。', kind, sequence: this.sequence, ...(kind === 'point' ? { x: value.x, y: value.y } : kind === 'area' ? {area:event.area,shape:event.shape,at:event.at} : kind === 'arrow' ? {from:event.from,to:event.to,at:event.at} : {}) };
  }
  async shutdown() {
    this.stickerPlacement.clear(); this.cancelPreviewLookup(); this.closed = true; this.online = false; this.stopDesktop(); clearInterval(this.timer); this.unsubscribe(); this.unsubscribeInventory?.(); this.frames.close(); await this.desktop.close(); for (const listener of this.listeners) listener('shutdown', this.publicView()); this.listeners.clear(); await this.saving; }
}
