import { randomUUID } from 'node:crypto';
import { aiSources, type AiSettings, type AiMemory, type AiAttempt, type AiView, type AiProcessingStage } from '../../shared/ai-listener';
import type { AiGenerationEvent } from '../../shared/ai-visual';
import type { CommentSource, IncomingComment, SpeechRecognitionRuntimeStatus } from '../../shared/types';
import { graphemes } from '../../shared/unicode';
import { normalizeCommentFilterText } from '../../shared/comment-filter';
import type { AiPersistence, AiPromptSkipReason } from './ai-store';
import { AiServiceError, type AiGateway } from './ai-connections';
import type { ObsStreamState } from '../../shared/obs-control';
import { AiPostingBudget, AI_POST_INTERVAL_MS } from './ai-posting-budget';
import { emptyAiApiUsage, emptyAiOutcomes, type AiGenerationOutcome } from '../../shared/ai-usage';
import { AiMemoryWriter } from './ai-memory-writer';
import { AiMemoryBuffer } from './ai-memory-buffer';
import { aiSkipMessage } from './ai-reply';

interface Options {
  store: AiPersistence; gateway: AiGateway; changed(view: AiView): void;
  acquire(): Promise<void>; release(): Promise<void>; ngWords(): string[];
  invalidated?(): void;
  now?: () => number; random?: () => number;
  monotonic?: () => number;
  checkObs?: () => Promise<{ connected: boolean; stream: ObsStreamState }>;
}
type BoardSource = 'shitaraba' | 'jpnkn';
const boardSources = ['shitaraba', 'jpnkn'] as const;
const isBoardSource = (source: CommentSource): source is BoardSource => source === 'shitaraba' || source === 'jpnkn';
interface ConnectionCapture { target: string; epoch: number }
interface BoardRow { id: string; text: string; author: string }
interface BoardBatch extends ConnectionCapture { rows: BoardRow[] }
const SPEECH_GAP_MS = 1500;
export class AiController {
  private readonly memoryBuffer = new AiMemoryBuffer();
  private get memory(): AiMemory[] { return this.memoryBuffer.records; }
  private attempts: AiAttempt[] = [];
  private requested = false;
  private initialized = false;
  private manualAttention = '';
  private memoryBroken = false;
  private storageBroken = false;
  private obsSuppressed = false;
  private obsConnected = false;
  private obsStreaming = false;
  private obsStream: ObsStreamState = 'unknown';
  private seenStream = false;
  private obsCheckFailed = false;
  private obsProbeTimer?: ReturnType<typeof setTimeout>;
  private obsRevision = 0;
  private runRevision = 0;
  private speechReady = false;
  private speechActivity: SpeechRecognitionRuntimeStatus = 'listening';
  private speechActivityAt: number | null = null;
  private quietUntil = 0;
  private waitElapsed = false;
  private waitStartedAt: number | null = null;
  private waitExpiredAt: number | null = null;
  private processingStage: AiProcessingStage | null = null;
  private processingStartedAt: number | null = null;
  private lastDurationsMs: Partial<Record<AiProcessingStage, number>> = {};
  private generationRequest?: { id: string; generation: number; observedApi: boolean };
  private unsubscribeGeneration?: () => void;
  private targets: Record<CommentSource, string> = { youtube: '', twitch: '', shitaraba: '', jpnkn: '' };
  private connected: Record<CommentSource, boolean> = { youtube: false, twitch: false, shitaraba: false, jpnkn: false };
  private connectionEpoch: Record<CommentSource, number> = { youtube: 0, twitch: 0, shitaraba: 0, jpnkn: 0 };
  private errors: Partial<Record<CommentSource, string>> = {};
  private greeted = new Set<CommentSource>();
  private firstPosted = false;
  private speechSequence = 0;
  private consumedSpeech = 0;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pruneTimer?: ReturnType<typeof setInterval>;
  private nextAt: number | null = null;
  private working: Promise<void> | null = null;
  private sending = false;
  private abort?: AbortController;
  private isolated?: AbortController;
  async withIdleContext<T>(action: (settings: AiSettings, memory: AiMemory[], signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.memoryBroken) throw new Error('共有記憶を確認してからテスト生成してください。');
    return this.withIdleSettings(async (settings, signal) => {
      await this.memoryWriter.flush(); signal.throwIfAborted();
      return action(settings, structuredClone(this.memory), signal);
    });
  }
  async withIdleSettings<T>(action: (settings: AiSettings, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposed || !this.initialized || this.requested || this.working || this.isolated || this.clearing) throw new Error('AIを停止して処理完了を待ってください。');
    const isolated = new AbortController(); this.isolated = isolated;
    const obsRevision = this.obsRevision;
    try { isolated.signal.throwIfAborted(); return await action(structuredClone(this.settings), isolated.signal); }
    finally {
      if (this.isolated === isolated) {
        this.isolated = undefined;
        if (obsRevision !== this.obsRevision && this.settings.mode === 'obs' && this.obsConnected && this.obsStreaming) await this.observeObs(true, this.obsStream);
      }
    }
  }
  private failures = 0;
  private retryAt = 0;
  private readonly memoryWriter: AiMemoryWriter;
  private clearingWork?: Promise<void>;
  private storageFailureRevision = 0;
  private pendingComments: Array<ConnectionCapture & { comment: IncomingComment }> = [];
  private authorMatches: Record<BoardSource, Map<string, string>> = { shitaraba: new Map(), jpnkn: new Map() };
  private boardBatches: Partial<Record<BoardSource, BoardBatch>> = {};
  private previousResponse: Record<BoardSource, number> = { shitaraba: 0, jpnkn: 0 };
  private attemptEpochs = new WeakMap<AiAttempt, number>();
  private authorization: AiView['authorization'] = null;
  private notice = '';
  private wasActive = false;
  private disposed = false;
  private clearing = false;
  private unsavedResults = new Map<string, AiAttempt>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly budget: AiPostingBudget;
  private readonly outcomes = emptyAiOutcomes();
  private unsubscribeUsage?: () => void;
  constructor(private settings: AiSettings, private readonly options: Options) {
    this.now = options.now ?? Date.now; this.random = options.random ?? Math.random;
    this.budget = new AiPostingBudget(options.store, this.now, options.monotonic);
    this.memoryWriter = new AiMemoryWriter(records => options.store.saveMemory(records), () => this.notify(), () => this.storageFailed());
  }
  async initialize() {
    if (this.initialized) return;
    this.unsubscribeUsage = this.options.gateway.observeUsage?.(() => this.notify());
    try { this.memoryBuffer.replace(await this.options.store.loadMemory(), this.settings.memoryCharacters); }
    catch { this.memoryBroken = true; this.manualAttention = '共有記憶を読めません。記憶削除で初期化してください。'; }
    try {
      this.attempts = await this.options.store.loadAttempts(); this.obsSuppressed = await this.options.store.loadSuppressed();
      await this.budget.initialize(this.attempts.map(a => Date.parse(a.at)));
      for (const a of this.attempts) if ((a.result === 'unknown' || a.result === 'failed') && !a.reviewed) this.errors[a.source] = '前回の投稿失敗または結果不明を確認して再開してください。';
    } catch (e) { this.storageFailed(e instanceof Error ? e.message : undefined); }
    this.initialized = true;
    const prune = () => {
      const cutoff = new Date(this.now()); cutoff.setDate(cutoff.getDate() - 29); cutoff.setHours(0, 0, 0, 0);
      this.attempts = this.attempts.filter(a => Date.parse(a.at) >= cutoff.getTime() || a.result === 'sending' || this.unsavedResults.has(a.id));
      this.notify();
      void this.options.store.prune().catch(() => { this.notice = '古い発言ログを削除できませんでした。'; this.notify(); });
    };
    prune(); let date = new Date(this.now()).toDateString();
    let budgetView = JSON.stringify(this.budget.view());
    this.pruneTimer = setInterval(() => {
      const next = new Date(this.now()).toDateString(); if (next !== date) { date = next; prune(); }
      const budget = JSON.stringify(this.budget.view()); if (budget !== budgetView) { budgetView = budget; this.notify(); }
    }, 30000);
    this.pruneTimer.unref?.(); this.notify();
  }
  private candidates() { return aiSources.filter(s => this.settings.participants[s].enabled && this.settings.personas.some(p => p.id === this.settings.participants[s].personaId) && this.connected[s] && this.targets[s] && this.options.gateway.account(s) && !this.errors[s]); }
  private active() { return !this.disposed && !this.clearing && this.requested && !this.manualAttention && this.speechReady && this.options.gateway.hasKey() && this.candidates().length > 0 && this.obsConnected && this.obsStreaming && !this.obsCheckFailed && (this.settings.mode === 'manual' || !this.obsSuppressed); }
  view(): AiView {
    const services = Object.fromEntries(aiSources.map(source => {
      const latest = [...this.attempts].reverse().find(a => a.source === source);
      return [source, { ready: this.candidates().includes(source), message: this.errors[source] ?? (this.connected[source] ? '' : 'コメント取得を待っています。'), account: this.options.gateway.account(source), latest: latest ? { ...latest, target: '', authorName: undefined } : null }];
    })) as AiView['services'];
    const postingBudget = this.budget.view();
    const obsMessage = !this.obsConnected || this.obsCheckFailed ? 'OBS接続・配信状態の確認待ちです。' : this.obsStream === 'reconnecting' ? 'OBS配信先への再接続待ちです。' : !this.obsStreaming ? 'OBS配信開始待ちです。' : '';
    return { postingBudget, requested: this.requested, status: this.manualAttention ? 'attention' : !this.requested ? 'stopped' : this.active() ? 'running' : 'paused',
      activity: this.activityView(),
      usage: { api: this.options.gateway.apiUsage?.() ?? emptyAiApiUsage(), outcomes: { ...this.outcomes } },
      message: this.manualAttention || (!this.requested ? '停止中' : obsMessage || this.notice || (!this.options.gateway.hasKey() ? 'Gemini APIキーを設定してください。' : !this.speechReady ? '音声認識を待っています。' : this.active() ? postingBudget.used >= postingBudget.limit ? '投稿上限による待機中です。会話は記憶しています。' : '会話を聞いています。' : '接続・認証・人格を確認してください。')),
      nextAt: this.nextAt, memoryCharacters: this.memoryBuffer.characters, hasKey: this.options.gateway.hasKey(), services, authorization: this.authorization };
  }
  private notify() { if (!this.disposed) this.options.changed(this.view()); }
  private activityView(): NonNullable<AiView['activity']> {
    let stage: NonNullable<AiView['activity']>['stage'] = 'idle'; let startedAt: number | null = null;
    if (this.processingStage) { stage = this.processingStage; startedAt = this.processingStartedAt; }
    else if (this.active()) {
      if (this.speechBusy()) { stage = this.speechActivity === 'recognizing' ? 'recognizing' : 'speaking'; startedAt = this.speechActivityAt; }
      else if (this.waitElapsed && this.now() < this.quietUntil) { stage = 'speech-gap'; startedAt = this.quietUntil - SPEECH_GAP_MS; }
      else if (this.waitElapsed && this.firstPosted && this.speechSequence <= this.consumedSpeech) { stage = 'new-speech'; startedAt = this.waitExpiredAt; }
      else { stage = 'waiting'; startedAt = this.waitStartedAt; }
    }
    return { stage, startedAt, lastDurationsMs: { ...this.lastDurationsMs } };
  }
  contextRevision() { return this.generation; }
  private cancel() { this.generation++; this.generationRequest = undefined; this.processingStage = null; this.processingStartedAt = null; this.unsubscribeGeneration?.(); this.unsubscribeGeneration = undefined; this.abort?.abort(); this.isolated?.abort(); this.options.invalidated?.(); clearTimeout(this.timer); clearTimeout(this.obsProbeTimer); this.obsProbeTimer = undefined; this.timer = undefined; this.nextAt = null; this.waitElapsed = false; }
  private setProcessingStage(stage: AiProcessingStage, generation: number) {
    if (generation !== this.generation || this.disposed) return;
    this.processingStage = stage; this.processingStartedAt = this.now(); this.notify();
  }
  private recordDuration(stage: AiProcessingStage, milliseconds: number, generation: number) {
    if (generation !== this.generation || this.disposed || !Number.isFinite(milliseconds)) return;
    this.lastDurationsMs[stage] = Math.max(0, Math.round(milliseconds)); this.notify();
  }
  private observeGeneration(event: AiGenerationEvent) {
    const request = this.generationRequest;
    if (!request || event.id !== request.id || request.generation !== this.generation || this.disposed) return;
    if (event.stage === 'capture' && event.status === 'working') this.setProcessingStage('image-preparation', request.generation);
    if (event.stage === 'api') {
      this.recordDuration('image-preparation', event.capture.durationMs, request.generation);
      if (event.status === 'working') { request.observedApi = true; this.setProcessingStage('generating', request.generation); }
      else this.recordDuration('generating', event.apiDurationMs, request.generation);
    }
  }
  private wait(minimum = 0) {
    clearTimeout(this.timer); this.timer = undefined; this.nextAt = null; this.waitElapsed = false; this.waitExpiredAt = null;
    if (!this.active() || this.disposed) { this.scheduleObsProbe(); this.notify(); return; }
    const duration = Math.max(AI_POST_INTERVAL_MS, minimum, (this.budget.view().nextAllowedAt ?? 0) - this.now(), this.retryAt - this.now(), Math.round(this.settings.waitSeconds * 1000 * (1 + (this.random() * 2 - 1) * this.settings.jitterPercent / 100)));
    this.waitStartedAt = this.now(); this.nextAt = this.now() + duration;
    this.timer = setTimeout(() => { this.timer = undefined; this.nextAt = null; this.waitElapsed = true; this.waitExpiredAt = this.now(); this.tick(); }, duration); this.timer.unref?.(); this.notify();
  }
  private reconcile() {
    const active = this.active();
    if (!active) { if (this.wasActive) this.cancel(); }
    else if (!this.wasActive) this.wait();
    this.wasActive = active; this.notify();
  }
  connection(source: CommentSource, target: string, connected: boolean) {
    const changed = target !== this.targets[source];
    const invalidated = changed || (this.connected[source] && !connected);
    if (invalidated) {
      this.cancel(); this.connectionEpoch[source]++; this.targets[source] = target;
      this.pendingComments = this.pendingComments.filter(p => p.comment.source !== source);
      if (isBoardSource(source)) { this.previousResponse[source] = 0; this.authorMatches[source].clear(); delete this.boardBatches[source]; }
    }
    this.connected[source] = connected; this.reconcile();
    if (invalidated) this.wait();
  }
  private speechBusy() { return this.speechActivity === 'speechDetected' || this.speechActivity === 'recognizing'; }
  private speechGapReady() { return !this.speechBusy() && this.now() >= this.quietUntil; }
  private scheduleSpeechGap() {
    if (!this.waitElapsed || this.working || !this.active()) return;
    clearTimeout(this.timer); this.timer = undefined; this.nextAt = null;
    if (!this.speechBusy() && this.now() < this.quietUntil) {
      this.nextAt = this.quietUntil;
      this.timer = setTimeout(() => { this.timer = undefined; this.nextAt = null; this.tick(); }, this.quietUntil - this.now()); this.timer.unref?.();
    } else if (!this.speechBusy()) this.tick();
    this.notify();
  }
  recognition(ready: boolean, activity: SpeechRecognitionRuntimeStatus = 'listening') {
    const wasBusy = this.speechBusy(); this.speechReady = ready;
    const next = ready ? activity : 'listening';
    if (this.speechActivity !== next) { this.speechActivity = next; this.speechActivityAt = this.now(); }
    if (ready && wasBusy && !this.speechBusy()) this.quietUntil = this.now() + SPEECH_GAP_MS;
    if (ready && !wasBusy && this.speechBusy() && this.working && !this.sending) { this.cancel(); this.wait(); }
    this.reconcile(); this.scheduleSpeechGap();
  }
  authorizationChanged(authorization: AiView['authorization'], message?: string) { if (this.disposed) return; this.cancel(); this.authorization = authorization; this.notice = message ?? ''; this.reconcile(); this.wait(); }
  invalidate() { this.cancel(); this.wait(); }
  async configure(settings: AiSettings) {
    if (this.disposed) return;
    if (JSON.stringify(this.settings) === JSON.stringify(settings)) return;
    const modeChanged = this.settings.mode !== settings.mode;
    this.cancel(); this.settings = structuredClone(settings);
    if (!this.memoryBroken) {
      this.memoryBuffer.resize(settings.memoryCharacters);
      this.persistMemory();
      await this.waitForMemory();
    }
    if (this.disposed) return;
    if (modeChanged) { await this.stop(false); if (settings.mode === 'obs') await this.observeObs(this.obsConnected, this.obsStream); }
    else if (this.requested) { await this.options.acquire(); this.wait(); }
    this.reconcile();
  }
  async start(fresh = true) {
    if (this.disposed) return;
    if (this.isolated) throw new Error('テスト生成の終了を待ってください。');
    const expectedRun = this.runRevision;
    await this.initialize();
    if (this.disposed || expectedRun !== this.runRevision) return;
    if (this.isolated) throw new Error('テスト生成の終了を待ってください。');
    if (this.memoryBroken || this.storageBroken) throw new Error('記憶・ログの保存状態を復旧してください。');
    if (this.requested && fresh) return;
    const run = ++this.runRevision;
    this.cancel(); this.manualAttention = ''; this.notice = ''; this.requested = true;
    this.seenStream = this.obsConnected && this.obsStreaming;
    if (fresh) { this.greeted.clear(); this.firstPosted = false; this.consumedSpeech = this.speechSequence; }
    this.obsSuppressed = false;
    try { await this.options.store.saveSuppressed(false); } catch { this.storageFailed(); return; }
    if (run !== this.runRevision || !this.requested) return;
    await this.options.acquire(); this.wasActive = false; this.reconcile();
    this.scheduleObsProbe();
  }
  async stop(manual = true) {
    if (this.disposed) return;
    this.runRevision++;
    this.cancel(); this.requested = false; this.wasActive = false;
    if (manual && this.settings.mode === 'obs' && (this.obsStream !== 'stopped' || !this.obsConnected)) {
      this.obsSuppressed = true; try { await this.options.store.saveSuppressed(true); } catch { this.storageFailed(); }
    }
    await this.options.release(); this.notify();
  }
  async resume(source?: CommentSource) {
    if (this.disposed) return;
    const run = this.runRevision;
    await this.clearingWork;
    if (this.disposed || run !== this.runRevision) return;
    const storageFailureRevision = this.storageFailureRevision;
    for (const a of this.attempts) if ((!source || a.source === source) && !a.reviewed && (a.result === 'unknown' || a.result === 'failed' || (isBoardSource(a.source) && a.result === 'succeeded' && !a.externalId))) {
      a.reviewed = true; this.unsavedResults.set(a.id, a);
    }
    if (source) delete this.errors[source]; else this.errors = {};
    try {
      if (this.memoryBroken) throw new Error('記憶を削除して初期化してください。');
      await this.memoryWriter.retry(this.memory);
      await this.options.store.checkWritable(); await this.options.store.loadAttempts();
      await this.budget.initialize(this.attempts.map(a => Date.parse(a.at)));
      for (const a of this.unsavedResults.values()) await this.options.store.log(a);
      this.unsavedResults.clear();
      await this.memoryWriter.flush();
      if (this.disposed || run !== this.runRevision || storageFailureRevision !== this.storageFailureRevision) return;
      this.storageBroken = false; this.manualAttention = ''; this.failures = 0; this.retryAt = 0;
    } catch (e) { this.storageFailed(e instanceof Error ? e.message : undefined); return; }
    if (!this.requested) await this.start(false); else { this.cancel(); this.wasActive = false; this.reconcile(); }
    this.scheduleObsProbe();
  }
  async observeObs(connected: boolean, stream: ObsStreamState) {
    if (this.disposed) return;
    const revision = ++this.obsRevision;
    this.obsConnected = connected; this.obsStream = stream; this.obsStreaming = stream === 'streaming';
    if (this.requested && connected && this.obsStreaming) this.seenStream = true;
    if (!this.initialized) return;
    if (this.settings.mode === 'manual') {
      if (connected && stream === 'stopped' && this.requested && this.seenStream) await this.stop(false);
      else this.reconcile();
      return;
    }
    if (connected && stream === 'stopped') {
      this.obsSuppressed = false; try { await this.options.store.saveSuppressed(false); } catch { this.storageFailed(); }
      if (revision !== this.obsRevision) return;
      if (this.requested) await this.stop(false);
    } else if (connected && this.obsStreaming && !this.requested && !this.obsSuppressed && !this.manualAttention && !this.isolated) await this.start(true);
    else this.reconcile();
  }
  private scheduleObsProbe() {
    if (this.disposed || !this.requested || this.manualAttention || !this.obsCheckFailed || this.obsProbeTimer) return;
    const duration = Math.max(AI_POST_INTERVAL_MS, Math.round(this.settings.waitSeconds * 1000 * (1 + (this.random() * 2 - 1) * this.settings.jitterPercent / 100)));
    this.obsProbeTimer = setTimeout(() => { this.obsProbeTimer = undefined; void this.verifyObs(this.generation); }, duration);
    this.obsProbeTimer.unref?.();
  }
  private async verifyObs(generation: number): Promise<boolean> {
    const startedAt = this.now(); this.setProcessingStage('obs-check', generation);
    try {
      const state = await this.options.checkObs?.();
      if (generation !== this.generation || this.disposed) return false;
      if (!state) throw new Error('OBS_UNAVAILABLE');
      this.obsCheckFailed = false;
      await this.observeObs(state.connected, state.stream);
      return generation === this.generation && this.active();
    } catch {
      if (generation === this.generation && !this.disposed) {
        this.cancel(); this.obsCheckFailed = true; this.wasActive = false; this.scheduleObsProbe(); this.notify();
      }
      return false;
    } finally { this.recordDuration('obs-check', this.now() - startedAt, generation); if (generation === this.generation && this.processingStage === 'obs-check') { this.processingStage = null; this.processingStartedAt = null; this.notify(); } }
  }
  private capture(source: CommentSource): ConnectionCapture { return { target: this.targets[source], epoch: this.connectionEpoch[source] }; }
  private currentCapture(source: CommentSource, capture: ConnectionCapture) { return capture.target === this.targets[source] && capture.epoch === this.connectionEpoch[source]; }
  progress(number: number) { this.observeBoardProgress('shitaraba', number); }
  observeBoardProgress(source: BoardSource, number: number) { if (!this.disposed) this.previousResponse[source] = Math.max(this.previousResponse[source], number); }
  observeRaw(source: CommentSource, externalId: string, author: string) { if (!this.disposed && isBoardSource(source)) this.authorMatches[source].set(externalId, author); }
  observeShitarabaBatch(comments: IncomingComment[]) { this.observeBoardBatch(comments, 'shitaraba'); }
  observeBoardBatch(comments: IncomingComment[], emptySource?: BoardSource) {
    if (this.disposed) return;
    for (const source of boardSources) {
      const input = comments.filter(c => c.source === source);
      if (!input.length && emptySource !== source) continue;
      const capture = this.capture(source);
      const rows = input.map(c => ({ id: c.externalId, text: c.content.map(p => p.type === 'text' ? p.text : p.alt).join(''), author: this.authorMatches[source].get(c.externalId) ?? '' }));
      this.authorMatches[source].clear();
      const previous = this.boardBatches[source];
      const sending = this.attempts.some(a => a.source === source && a.target === capture.target && a.result === 'sending');
      // Keep the posted row if a later empty poll arrives before the send finishes.
      this.boardBatches[source] = { ...capture, rows: sending && previous && this.currentCapture(source, previous) ? [...new Map([...previous.rows, ...rows].map(row => [row.id, row])).values()] : rows };
    }
    this.resolveBoards();
  }
  private resolveBoards() { for (const source of boardSources) this.resolveBoard(source); }
  private resolveBoard(source: BoardSource) {
    const batch = this.boardBatches[source];
    if (!batch || !this.currentCapture(source, batch) || this.attempts.some(a => a.source === source && a.target === batch.target && a.result === 'sending')) return;
    const unresolved = this.attempts.filter(a => a.source === source && a.target === batch.target && a.result === 'succeeded' && !a.externalId && !a.reviewed && (!this.attemptEpochs.has(a) || this.attemptEpochs.get(a) === batch.epoch));
    // An empty submitted name is replaced by the board's default name.
    const matches = (a: AiAttempt, c: { id: string; text: string; author: string }) => a.text === c.text && (a.authorName === '' || a.authorName === c.author) && Number(c.id.split(':').at(-1)) > (a.previousResponse ?? Infinity);
    for (const a of unresolved) {
      // A poll may finish before the posted comment becomes visible; no new rows are not an ambiguous match.
      if (!batch.rows.some(c => Number(c.id.split(':').at(-1)) > (a.previousResponse ?? Infinity))) continue;
      const rows = batch.rows.filter(c => matches(a, c));
      if (rows.length === 1 && unresolved.filter(other => matches(other, rows[0])).length === 1) {
        a.externalId = rows[0].id; this.unsavedResults.set(a.id, a);
        void this.options.store.log(a).then(() => this.unsavedResults.delete(a.id)).catch(() => this.storageFailed());
      } else this.errors[source] = '自己投稿の照合が曖昧です。確認後に再開してください。';
    }
    if (unresolved.length) this.reconcile();
  }
  comment(comment: IncomingComment) {
    if (this.disposed || this.clearing) return;
    if (comment.initialHistory) { if (isBoardSource(comment.source)) this.authorMatches[comment.source].delete(comment.externalId); return; }
    if (this.working && this.attempts.some(a => a.result === 'sending' && a.source === comment.source)) { this.pendingComments.push({ ...this.capture(comment.source), comment: structuredClone(comment) }); return; }
    const text = comment.content.map(p => p.type === 'text' ? p.text : p.alt).join('');
    const related = this.attempts.filter(a => a.source === comment.source && a.target === this.targets[comment.source]);
    if (related.some(a => a.externalId === comment.externalId)) return;
    if (isBoardSource(comment.source)) this.authorMatches[comment.source].delete(comment.externalId);
    if (!this.active()) return;
    this.cancel(); this.wait(); void this.addMemory({ id: randomUUID(), at: new Date(this.now()).toISOString(), role: 'viewer', source: comment.source, text });
  }
  speech(text: string, id: string) {
    if (!this.active() || this.memory.some(r => r.id === id)) return;
    this.quietUntil = this.now() + SPEECH_GAP_MS;
    this.speechSequence++; void this.addMemory({ id, at: new Date(this.now()).toISOString(), role: 'streamer', source: null, text });
    if (this.working && !this.sending) { this.cancel(); this.wait(); }
    this.scheduleSpeechGap();
  }
  private storageFailed(reason?: string) { this.storageFailureRevision++; this.storageBroken = true; this.manualAttention = reason?.includes('投稿枠') ? reason : '共有記憶・発言ログ・投稿枠を保存できません。復旧後に再開してください。'; this.cancel(); this.wasActive = false; this.notify(); }
  private persistMemory() {
    this.memoryWriter.update(this.memory);
  }
  private waitForMemory(): Promise<void> { return this.memoryWriter.flush().catch(() => undefined); }
  private addMemory(record: AiMemory) {
    this.memoryBuffer.append(record, this.settings.memoryCharacters);
    this.persistMemory();
  }
  clearMemory(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.clearingWork ??= this.clearMemoryNow().finally(() => { this.clearingWork = undefined; });
  }
  private async clearMemoryNow(): Promise<void> {
    const wasBroken = this.memoryBroken;
    this.clearing = true; this.pendingComments = []; this.cancel(); await this.waitForMemory(); this.memoryBuffer.clear();
    try { await this.memoryWriter.retry([]); this.memoryBroken = false;
      if (!this.storageBroken) this.manualAttention = wasBroken ? '記憶を初期化しました。確認後に再開してください。' : '';
    } catch { this.storageFailed(); }
    this.clearing = false; this.consumedSpeech = this.speechSequence; this.wait(); this.notify();
  }
  private tick() {
    if (this.working || !this.active()) return;
    if (!this.speechGapReady()) { this.scheduleSpeechGap(); return; }
    if (this.firstPosted && this.speechSequence <= this.consumedSpeech) { this.notify(); return; }
    if (this.budget.view().nextAllowedAt !== null) { this.wait(); return; }
    this.working = this.perform().finally(() => { this.working = null; this.sending = false; this.resolveBoards(); const comments = this.pendingComments.splice(0); for (const p of comments) if (this.currentCapture(p.comment.source, p)) this.comment(p.comment); if (!this.timer && this.active()) this.wait(); this.notify(); });
  }
  private async perform() {
    const candidates = this.candidates(); const source = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    if (!source) return;
    const persona = this.settings.personas.find(p => p.id === this.settings.participants[source].personaId)!;
    const settings = structuredClone(this.settings); const generation = this.generation; const speech = this.speechSequence; const capture = this.capture(source); const target = capture.target;
    const contextAllowed = () => generation === this.generation && this.active() && this.candidates().includes(source) && this.currentCapture(source, capture);
    const sendAllowed = () => contextAllowed() && this.speechGapReady();
    const conversation = structuredClone(this.memory);
    const controller = new AbortController(); this.abort = controller; let attempt: AiAttempt | undefined; let sent = false; let loggingFailed = false; let budgetDeferred = false;
    let generating = false; let outcome: AiGenerationOutcome | undefined;
    try {
      await this.waitForMemory();
      if (!sendAllowed()) return;
      if (!await this.verifyObs(generation)) return;
      if (!sendAllowed()) return;
      const requestId = randomUUID(); const promptId = settings.debugPromptLog ? requestId : undefined;
      const request = { id: requestId, generation, observedApi: false }; this.generationRequest = request;
      this.unsubscribeGeneration = this.options.gateway.observeGeneration?.(event => this.observeGeneration(event));
      const generationStartedAt = this.now(); this.setProcessingStage('generating', generation);
      generating = true;
      const result = await this.options.gateway.generate(settings, persona, conversation, !this.greeted.has(source), AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]), requestId);
      if (!request.observedApi) this.recordDuration('generating', this.now() - generationStartedAt, generation);
      if (this.generationRequest === request) this.generationRequest = undefined;
      this.unsubscribeGeneration?.(); this.unsubscribeGeneration = undefined;
      this.failures = 0; this.retryAt = 0;
      if (!sendAllowed()) return;
      if (typeof result !== 'string') {
        outcome = 'skipped'; this.notice = aiSkipMessage(result);
        if (promptId) {
          try { await this.options.store.logPromptOutcome(promptId, result.reason === 'invalid-response' ? 'invalid-response' : 'intentional'); }
          catch { this.storageFailed(); }
        }
        return;
      }
      const text = result.trim();
      const normalized = normalizeCommentFilterText(text);
      const skipReason: AiPromptSkipReason | undefined = !text ? 'empty' :
        graphemes(text).length > 200 ? 'length' :
        this.options.ngWords().some(w => w.trim() && normalized.includes(normalizeCommentFilterText(w.trim()))) ? 'ng' :
        this.attempts.filter(a => a.result === 'succeeded').slice(-10).some(a => a.text === text) ? 'duplicate' : undefined;
      if (skipReason) {
        outcome = 'skipped';
        this.notice = '生成文を見送りました（空文・文字数・NG・同文）。';
        if (promptId) { try { await this.options.store.logPromptOutcome(promptId, skipReason); } catch { this.storageFailed(); } }
        return;
      }
      attempt = { id: randomUUID(), at: new Date(this.now()).toISOString(), source, target, personaId: persona.id, personaName: persona.name, text, result: 'sending', ...(isBoardSource(source) ? { previousResponse: this.previousResponse[source], authorName: source === 'shitaraba' ? settings.shitarabaName : settings.jpnknName } : {}) };
      const current = attempt;
      const postingStartedAt = this.now(); this.setProcessingStage('posting', generation);
      try {
        attempt.externalId = await this.options.gateway.post(source, target, text, settings, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), async () => {
          if (!await this.verifyObs(generation)) throw new Error('投稿を取り消しました。');
          this.setProcessingStage('posting', generation);
          if (!sendAllowed()) throw new Error('投稿を取り消しました。');
          try {
            if (!await this.budget.reserve()) { budgetDeferred = true; throw new Error('投稿枠の解放を待っています。'); }
          } catch (e) { if (!budgetDeferred) { loggingFailed = true; this.storageFailed(e instanceof Error ? e.message : undefined); } throw e; }
          if (!sendAllowed()) throw new Error('投稿を取り消しました。');
          try { await this.options.store.log(current); } catch (e) { loggingFailed = true; throw e; }
          if (!sendAllowed()) {
            try { await this.options.store.discardAttempt(current.id); } catch (e) { loggingFailed = true; throw e; }
            throw new Error('投稿を取り消しました。');
          }
          sent = true; this.sending = true; if (isBoardSource(source)) delete this.boardBatches[source]; this.attemptEpochs.set(current, capture.epoch); this.attempts.push(current); this.notify();
        }); attempt.result = 'succeeded'; outcome = 'succeeded';
      } catch (e) {
        if (loggingFailed) { outcome = sent ? 'unknown' : 'skipped'; if (!this.storageBroken) this.storageFailed(); return; }
        if (budgetDeferred) { outcome = 'skipped'; return; }
        if (!sent) {
          outcome = generation !== this.generation || controller.signal.aborted ? 'cancelled' : 'skipped';
          if (generation === this.generation) {
            const reason = e instanceof AiServiceError ? e.message : '投稿準備に失敗しました。接続・認証を確認してください。';
            this.errors[source] = `${reason} 確認後にこのサービスを再開してください。`;
            this.notice = `投稿前に見送りました。${this.errors[source]}`;
          }
          return;
        }
        attempt.result = e instanceof AiServiceError && e.kind === 'rejected' ? 'failed' : 'unknown';
        outcome = attempt.result;
        if (this.currentCapture(source, capture)) this.errors[source] = e instanceof AiServiceError ? `${e.message} 確認後にこのサービスを再開してください。` : '投稿失敗または結果不明です。サービス上で確認して再開してください。';
      } finally { this.recordDuration('posting', this.now() - postingStartedAt, generation); }
      this.unsavedResults.set(attempt.id, attempt);
      if (attempt.result === 'succeeded' && contextAllowed()) {
        this.notice = '';
        this.greeted.add(source); this.firstPosted = true; this.consumedSpeech = speech;
        this.addMemory({ id: attempt.id, at: attempt.at, source, role: 'ai', text });
        await this.waitForMemory();
      }
      await this.options.store.log(attempt); this.unsavedResults.delete(attempt.id);
    } catch (e) {
      if (generation !== this.generation && !attempt) return;
      outcome ??= 'failed';
      if (attempt) this.storageFailed();
      else if (e instanceof AiServiceError && e.kind === 'attention') { this.manualAttention = e.message; this.cancel(); }
      else { this.failures++; this.retryAt = this.now() + 60000; this.notice = 'Geminiとの通信に失敗しました。'; if (this.failures >= 3) this.manualAttention = 'Geminiとの通信が3回失敗しました。確認して再開してください。'; }
    } finally {
      if (generating) this.outcomes[outcome ?? (generation !== this.generation || controller.signal.aborted ? 'cancelled' : 'failed')]++;
      this.unsubscribeGeneration?.(); this.unsubscribeGeneration = undefined; if (generation === this.generation) { this.generationRequest = undefined; this.processingStage = null; this.processingStartedAt = null; this.abort = undefined; this.wait(this.failures > 0 ? 60000 : 0); }
    }
  }
  async shutdown() {
    this.disposed = true; this.requested = false; this.runRevision++; this.cancel(); clearInterval(this.pruneTimer);
    this.unsubscribeUsage?.(); this.unsubscribeUsage = undefined;
    this.unsubscribeGeneration?.(); this.unsubscribeGeneration = undefined;
    await this.working; await this.clearingWork; await this.waitForMemory();
    // Every send already has a durable reservation. A failed final clock checkpoint must
    // not prevent AppState from releasing the speech worker and other services.
    try { await this.budget.checkpoint(); }
    catch { console.warn('AI投稿枠の終了時刻を保存できませんでした。送信前に保存した記録を保持します。'); }
    await this.options.store.flush();
  }
}
