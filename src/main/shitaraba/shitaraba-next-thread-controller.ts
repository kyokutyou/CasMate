import type {
  ShitarabaNextThreadSettings,
  ShitarabaNextThreadState,
  ShitarabaSourceSettings,
} from '../../shared/types';
import { ValidationError } from '../core/validation-error';
import {
  boardThreadKey,
  normalizeBoardInput,
  type NormalizedBoardThread,
} from '../sources/source-inputs';
import {
  BoardWriteFailure,
  type BoardWriteAdapter,
} from '../board/board-write-adapter';

type ThreadContent = { title: string; body: string };
type AttemptContext = { key: string; generation: number };

export interface ShitarabaNextThreadControllerDependencies {
  writer: Pick<BoardWriteAdapter, 'fetchThreadContent' | 'findThreadsByTitle' | 'createNextThread' | 'announceNextThread'>;
  onState(state: ShitarabaNextThreadState): void;
  onCreatedAnnouncement(recordKey: string): void;
  onSwitchedAnnouncement(recordKey: string): void;
  switchThread(threadUrl: string): Promise<void>;
  now?: () => Date;
  delay?: (milliseconds: number) => Promise<void>;
}

export type ResolveShitarabaNextThread =
  | { outcome: 'created'; threadUrl: string }
  | { outcome: 'notCreated' };

export class ShitarabaNextThreadController {
  private sourceSettings: ShitarabaSourceSettings;
  private state: ShitarabaNextThreadState;
  private currentThread: NormalizedBoardThread | null = null;
  private currentContent: ThreadContent | null = null;
  private attemptedContent: (ThreadContent & Pick<ShitarabaNextThreadSettings, 'authorName' | 'email'>) | null = null;
  private generation = 0;
  private manualConfirmationRequired = false;
  private automaticAttempted = false;
  private initialized = false;
  private operation: Promise<void> | null = null;
  private switching = false;
  private switchOperation: Promise<void> | null = null;
  private readonly now: () => Date;
  private readonly stopping = new AbortController();

  constructor(
    sourceSettings: ShitarabaSourceSettings,
    private readonly dependencies: ShitarabaNextThreadControllerDependencies,
  ) {
    this.sourceSettings = structuredClone(sourceSettings);
    this.now = dependencies.now ?? (() => new Date());
    this.currentThread = normalizedThread(sourceSettings.threadUrl);
    this.state = this.initialState();
  }

  snapshot(): ShitarabaNextThreadState {
    return structuredClone(this.state);
  }

  dispose(): void {
    this.stopping.abort();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.refreshForCurrentSettings(true);
  }

  async updateSettings(sourceSettings: ShitarabaSourceSettings): Promise<void> {
    const previousKey = this.currentKey();
    this.sourceSettings = structuredClone(sourceSettings);
    this.currentThread = normalizedThread(sourceSettings.threadUrl);
    const currentKey = this.currentKey();
    if (previousKey !== currentKey) {
      this.generation += 1;
      this.currentContent = null;
      this.attemptedContent = null;
      this.manualConfirmationRequired = false;
      this.automaticAttempted = false;
      this.state = this.initialState();
    }
    this.initialized = true;
    await this.refreshForCurrentSettings(previousKey !== currentKey);
  }

  observeResponseNumber(maxResponseNumber: number): void {
    if (this.stopping.signal.aborted) return;
    if (!Number.isSafeInteger(maxResponseNumber) || maxResponseNumber < 1) return;
    this.state.maxResponseNumber = Math.max(this.state.maxResponseNumber ?? 0, maxResponseNumber);
    this.updateRemaining();
    this.publish();
    if (this.state.status === 'created') {
      void this.switchIfReady();
      return;
    }
    void this.evaluateAutomaticCreation();
  }

  async createNow(): Promise<void> {
    if (this.operation) throw new ValidationError('次スレッドの作成処理中です。');
    if (!this.currentThread) {
      throw new ValidationError('現行スレッドURLを確認してください。');
    }
    if (['uncertain', 'created', 'browserRequired'].includes(this.state.status)) {
      throw new ValidationError('現在の次スレッド状態では新しい作成要求を送れません。');
    }
    this.automaticAttempted = true;
    this.operation = this.performCreation(true).finally(() => this.finishCreation());
    return this.operation;
  }

  async waitForIdle(): Promise<void> {
    // Completing an old thread can release an already reached condition on the new one.
    while (this.operation || this.switchOperation) {
      const creation = this.operation;
      const switching = this.switchOperation;
      await creation?.catch(() => undefined);
      await switching?.catch(() => undefined);
    }
  }

  async resolve(outcome: ResolveShitarabaNextThread): Promise<void> {
    if (!['uncertain', 'browserRequired'].includes(this.state.status) || !this.currentThread) {
      throw new ValidationError('確認・登録が必要な次スレッドはありません。');
    }
    if (outcome.outcome === 'notCreated') {
      if (this.state.status !== 'uncertain') {
        throw new ValidationError('認証要求があるため、ブラウザで作成してURLを登録してください。');
      }
      this.manualConfirmationRequired = true;
      this.setState('inputRequired', '未作成を確認しました。作成予定内容を確認し、「今すぐ作成」を選んでください。');
      return;
    }
    if (!/^https:\/\//i.test(outcome.threadUrl.trim())) {
      throw new ValidationError('作成済みURLはHTTPSの掲示板スレッドURLを指定してください。');
    }
    const nextThread = normalizedThread(outcome.threadUrl);
    if (
      !nextThread ||
      !sameBoard(this.currentThread, nextThread) || nextThread.threadId === this.currentThread.threadId
    ) {
      throw new ValidationError('現行スレッドと同じ掲示板の別スレッドURLを指定してください。');
    }
    await this.acceptCreated(this.context()!, nextThread.url, this.state.status === 'browserRequired');
  }

  private async refreshForCurrentSettings(resetStatus: boolean): Promise<void> {
    if (!this.currentThread) {
      this.setState('disabled', null);
      return;
    }
    // Saved edits prepare the next thread; they cannot replace an in-flight or confirmed submission.
    if (!resetStatus && ['creating', 'created'].includes(this.state.status)) {
      this.updateRemaining();this.publish();await this.switchIfReady();return;
    }
    const context = this.context()!;
    const reportFailure = (
      resetStatus ||
      this.state.status === 'disabled' ||
      this.state.status === 'manualReady' ||
      this.state.status === 'monitoring' ||
      this.state.status === 'inputRequired'
    );
    const previewReady = await this.refreshPreview(reportFailure, !resetStatus);
    if (!this.isCurrent(context)) return;
    if (!previewReady) return;
    if (resetStatus && await this.reconcileExistingThread()) return;
    if (
      !resetStatus &&
      this.state.status === 'inputRequired' &&
      this.manualConfirmationRequired
    ) {
      this.updateRemaining();
      this.publish();
      return;
    }
    if (!this.sourceSettings.nextThread.enabled) {
      if (['creating', 'created', 'uncertain', 'failed', 'browserRequired'].includes(this.state.status)) {
        this.updateRemaining();
        this.publish();
      } else {
        this.manualConfirmationRequired = false;
        this.setState('manualReady', null);
      }
      return;
    }
    if (
      resetStatus ||
      this.state.status === 'disabled' ||
      this.state.status === 'manualReady' ||
      this.state.status === 'inputRequired'
    ) {
      this.manualConfirmationRequired = false;
      this.setState('monitoring', null);
      await this.evaluateAutomaticCreation();
      return;
    }
    this.updateRemaining();
    this.publish();
    await this.evaluateAutomaticCreation();
  }

  private async refreshPreview(reportFailure = true, settingsRefresh = false): Promise<boolean> {
    const settings = this.sourceSettings.nextThread;
    if (!this.currentThread) return false;
    const context = this.context()!;
    const thread = this.currentThread;
    const previousAttempt = this.attemptedContent;
    const operationAtStart = this.operation;
    // A settings fetch may finish after an automatic submission has already started.
    const superseded = () => !this.isCurrent(context) || settingsRefresh &&
      (operationAtStart !== null || this.attemptedContent !== previousAttempt || ['creating', 'created'].includes(this.state.status));
    try {
      if (settings.titleMode === 'auto' || settings.bodyMode === 'auto') {
        const content = await this.dependencies.writer.fetchThreadContent(thread);
        if (superseded()) return false;
        this.currentContent = content;
      }
      const planned = plannedContent(settings, this.currentContent);
      this.state.plannedTitle = planned.title;
      this.state.plannedBody = planned.body;
      if (!planned.title || !planned.body) {
        if (reportFailure) {
          this.manualConfirmationRequired = true;
          this.setState('inputRequired', '作成予定のタイトルまたは本文を用意できません。手動モードで入力して確認してください。');
        }
        return false;
      }
      return true;
    } catch {
      if (superseded()) return false;
      this.currentContent = null;
      this.state.plannedTitle = settings.titleMode === 'manual' ? nonBlank(settings.manualTitle) : null;
      this.state.plannedBody = settings.bodyMode === 'manual' ? nonBlank(settings.manualBody) : null;
      if (reportFailure) {
        this.manualConfirmationRequired = true;
        this.setState('inputRequired', '現行スレッドから作成予定内容を取得できません。手動モードで入力してください。');
      }
      return false;
    }
  }

  private async evaluateAutomaticCreation(): Promise<void> {
    if (
      this.stopping.signal.aborted ||
      this.operation ||
      this.state.status !== 'monitoring' ||
      this.manualConfirmationRequired ||
      !this.sourceSettings.nextThread.enabled ||
      !this.currentThread ||
      this.automaticAttempted ||
      (this.state.maxResponseNumber ?? 0) < this.sourceSettings.nextThread.createAtResponseNumber
    ) return;
    this.automaticAttempted = true;
    this.operation = this.performCreation(false).finally(() => this.finishCreation());
    await this.operation;
  }

  private async finishCreation(): Promise<void> {
    this.operation = null;
    await this.evaluateAutomaticCreation();
  }

  private async performCreation(manual: boolean): Promise<void> {
    if (!this.currentThread) return;
    const attemptThread = this.currentThread;
    const attempt = this.context()!;
    const settings = structuredClone(this.sourceSettings.nextThread);
    const previewReady = await this.refreshPreview();
    if (!this.requireCurrent(attempt, manual)) return;
    if (!previewReady) {
      if (manual) throw new ValidationError(this.state.message ?? '作成予定内容を確認できません。');
      return;
    }
    const title = this.state.plannedTitle!;
    const body = this.state.plannedBody!;
    this.attemptedContent = { title, body, authorName: settings.authorName, email: settings.email };
    let existingThreads: string[];
    try {
      existingThreads = await this.dependencies.writer.findThreadsByTitle(
        attemptThread,
        title,
      );
    } catch {
      if (!this.requireCurrent(attempt, manual)) return;
      this.manualConfirmationRequired = true;
      const message = '掲示板の既存スレッドを確認できないため、次スレッドを作成しませんでした。';
      this.setState('failed', message);
      if (manual) throw new ValidationError(message);
      return;
    }
    if (!this.requireCurrent(attempt, manual)) return;
    this.state.plannedTitle = title;this.state.plannedBody = body;
    if (existingThreads.length === 1) {
      await this.acceptCreated(attempt, existingThreads[0]!);
      return;
    }
    if (existingThreads.length > 1) {
      const message = '同じタイトルのスレッドが複数あるため、次スレッドURLを確認してください。';
      this.setStateForAttempt(attempt, 'uncertain', message);
      if (manual) throw new ValidationError(message);
      return;
    }
    this.setStateForAttempt(attempt, 'creating', null);
    let threadUrl: string;
    try {
      const result = await this.dependencies.writer.createNextThread({
        currentThread: attemptThread,
        title,
        body,
        authorName: settings.authorName,
        email: settings.email,
      });
      threadUrl = result.threadUrl;
    } catch (error) {
      if (!this.requireCurrent(attempt, manual)) return;
      if (error instanceof BoardWriteFailure && error.kind === 'browserRequired') {
        this.setStateForAttempt(attempt, 'browserRequired', error.message);
        if (manual) throw new ValidationError(error.message);
        return;
      }
      if (error instanceof BoardWriteFailure && error.kind === 'uncertain') {
        const recoveredUrl = await this.findSingleExistingThread(attemptThread, title);
        if (!this.requireCurrent(attempt, manual)) return;
        if (recoveredUrl) {
          await this.acceptCreated(attempt, recoveredUrl);
          return;
        }
        const message = '送信後に次スレッドの作成を確認できません。掲示板をブラウザで確認してください。';
        this.setStateForAttempt(attempt, 'uncertain', message);
        if (manual) throw new ValidationError(message);
        return;
      }
      const message = error instanceof BoardWriteFailure
        ? error.message
        : '次スレッドを作成できませんでした。内容と掲示板の投稿条件を確認してください。';
      this.setStateForAttempt(attempt, 'failed', message);
      if (manual) throw new ValidationError(message);
      return;
    }
    if (!this.requireCurrent(attempt, manual)) return;
    await this.acceptCreated(attempt, threadUrl);
  }

  private async acceptCreated(attempt: AttemptContext, threadUrl: string, skipAnnouncement = false): Promise<void> {
    if (!this.isCurrent(attempt)) return;
    if (this.attemptedContent) {
      this.state.plannedTitle = this.attemptedContent.title;this.state.plannedBody = this.attemptedContent.body;
    }
    this.state.nextThreadUrl = threadUrl;
    this.setState('created', skipAnnouncement && this.sourceSettings.nextThread.announceCurrentThread
      ? '認証要求のためアプリからの案内は省略しました。必要ならブラウザで案内してください。' : null);
    await this.afterCreated(attempt, threadUrl, skipAnnouncement);
  }

  private async afterCreated(attempt: AttemptContext, threadUrl: string, skipAnnouncement: boolean): Promise<void> {
    const currentThread = this.currentThread;
    if (!this.isCurrent(attempt) || !currentThread) return;
    const settings = structuredClone(this.sourceSettings.nextThread);
    if (this.attemptedContent) {
      settings.authorName = this.attemptedContent.authorName;settings.email = this.attemptedContent.email;
    }
    const announcement = settings.announceCurrentThread && !skipAnnouncement
      ? this.announceAfterDelay(attempt, currentThread, threadUrl, settings)
      : Promise.resolve();
    try { this.dependencies.onCreatedAnnouncement(attempt.key); }
    catch { /* A speech failure must not stop announcement or source switching. */ }
    await Promise.all([announcement, this.switchIfReady()]);
  }

  private async announceAfterDelay(
    attempt: AttemptContext,
    currentThread: NormalizedBoardThread,
    threadUrl: string,
    settings: ShitarabaNextThreadSettings,
  ): Promise<void> {
    try {
      const waitMilliseconds = currentThread.service === 'jpnkn' ? 30_000 : 5_000;
      if (this.dependencies.delay) await this.dependencies.delay(waitMilliseconds);
      else await delay(waitMilliseconds, this.stopping.signal);
      if (this.stopping.signal.aborted) return;
      await this.dependencies.writer.announceNextThread({
        currentThread,
        message: settings.announcementTemplate.replace('{url}', threadUrl),
        authorName: settings.authorName,
        email: settings.email,
      });
    } catch (error) {
      const status = error instanceof BoardWriteFailure && error.kind === 'uncertain'
        ? 'uncertain'
        : 'failed';
      if (this.isCurrent(attempt)) {
        this.setState('created', error instanceof BoardWriteFailure && error.kind === 'browserRequired'
          ? '次スレッドは作成済みですが、認証要求のためURLを案内できません。必要ならブラウザで案内してください。'
          : status === 'uncertain'
          ? '次スレッドは作成済みですが、現行スレッドへのURL案内は結果不明です。'
          : '次スレッドは作成済みですが、現行スレッドへURLを案内できませんでした。');
      }
    }
  }

  private async switchIfReady(): Promise<void> {
    if (
      this.stopping.signal.aborted ||
      this.switching ||
      this.state.status !== 'created' ||
      !this.state.nextThreadUrl ||
      (this.state.maxResponseNumber ?? 0) < this.sourceSettings.nextThread.switchAtResponseNumber
    ) return;
    this.switching = true;
    const threadUrl = this.state.nextThreadUrl;
    const attempt = this.context()!;
    const nextThread = normalizedThread(threadUrl);
    const operation = (async () => {
      try {
        await this.dependencies.switchThread(threadUrl);
        if (!this.stopping.signal.aborted && (this.isCurrent(attempt) || (nextThread && this.generation === attempt.generation + 1 && this.currentKey() === boardThreadKey(nextThread)))) {
          try {
            this.dependencies.onSwitchedAnnouncement(attempt.key);
          } catch {
            // A speech failure must not turn a completed source switch into a failure.
          }
        }
      } catch {
        this.setStateForAttempt(attempt, 'created', '次スレッドは作成済みですが、掲示板の接続先を切り替えられませんでした。');
      } finally {
        this.switching = false;
      }
    })();
    const trackedOperation = operation.finally(() => {
      if (this.switchOperation === trackedOperation) this.switchOperation = null;
    });
    this.switchOperation = trackedOperation;
    await trackedOperation;
    if (this.generation !== attempt.generation) await this.switchIfReady();
  }

  private initialState(): ShitarabaNextThreadState {
    return {
      status: !this.currentThread
        ? 'disabled'
        : this.sourceSettings.nextThread.enabled ? 'monitoring' : 'manualReady',
      maxResponseNumber: null,
      remainingResponses: null,
      plannedTitle: null,
      plannedBody: null,
      nextThreadUrl: null,
      message: null,
      updatedAt: this.timestamp(),
    };
  }

  private setState(status: ShitarabaNextThreadState['status'], message: string | null): void {
    this.state.status = status;
    this.state.message = message;
    if (status !== 'created') this.state.nextThreadUrl = null;
    this.updateRemaining();
    this.publish();
  }

  private updateRemaining(): void {
    this.state.remainingResponses = this.state.maxResponseNumber === null
      ? null
      : Math.max(0, this.sourceSettings.nextThread.createAtResponseNumber - this.state.maxResponseNumber);
  }

  private publish(): void {
    this.state.updatedAt = this.timestamp();
    this.dependencies.onState(this.snapshot());
  }

  private currentKey(): string | null {
    return this.currentThread ? boardThreadKey(this.currentThread) : null;
  }

  private context(): AttemptContext | null {
    const key = this.currentKey();
    return key ? { key, generation: this.generation } : null;
  }

  private isCurrent(attempt: AttemptContext): boolean {
    return !this.stopping.signal.aborted && this.generation === attempt.generation && this.currentKey() === attempt.key;
  }

  private requireCurrent(attempt: AttemptContext, manual: boolean): boolean {
    if (this.isCurrent(attempt)) return true;
    if (manual) throw new ValidationError('接続先が変更されたため、旧スレッドの作成処理を取り消しました。');
    return false;
  }

  private async findSingleExistingThread(
    thread: NormalizedBoardThread,
    title: string,
  ): Promise<string | null> {
    try {
      const matches = await this.dependencies.writer.findThreadsByTitle(thread, title);
      return matches.length === 1 ? matches[0]! : null;
    } catch {
      return null;
    }
  }

  private async reconcileExistingThread(): Promise<boolean> {
    if (!this.currentThread || !this.state.plannedTitle) return false;
    const attempt = this.context()!;
    let matches: string[];
    try {
      matches = await this.dependencies.writer.findThreadsByTitle(
        this.currentThread,
        this.state.plannedTitle,
      );
    } catch {
      if (!this.isCurrent(attempt)) return true;
      this.automaticAttempted = true;
      this.setState(
        'failed',
        '掲示板の既存スレッドを確認できないため、次スレッドを作成しませんでした。',
      );
      return true;
    }
    if (!this.isCurrent(attempt)) return true;
    if (matches.length === 0) return false;
    this.automaticAttempted = true;
    if (matches.length > 1) {
      this.setState(
        'uncertain',
        '同じタイトルのスレッドが複数あるため、次スレッドURLを確認してください。',
      );
      return true;
    }
    this.state.nextThreadUrl = matches[0]!;
    this.setState('created', null);
    return true;
  }

  private setStateForAttempt(
    attempt: AttemptContext,
    status: ShitarabaNextThreadState['status'],
    message: string | null,
  ): void {
    if (this.isCurrent(attempt)) this.setState(status, message);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => { clearTimeout(timer); reject(new Error('終了のためURL案内を取り消しました。')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function plannedContent(
  settings: ShitarabaNextThreadSettings,
  current: ThreadContent | null,
): { title: string | null; body: string | null } {
  return {
    title: settings.titleMode === 'manual'
      ? nonBlank(settings.manualTitle)
      : current ? incrementShitarabaTitle(current.title) : null,
    body: settings.bodyMode === 'manual'
      ? nonBlank(settings.manualBody)
      : current ? nonBlank(current.body) : null,
  };
}

function nonBlank(value: string): string | null {
  return value.trim() ? value : null;
}

function normalizedThread(value: string): NormalizedBoardThread | null {
  try {
    return normalizeBoardInput(value);
  } catch {
    return null;
  }
}

function sameBoard(current: NormalizedBoardThread, next: NormalizedBoardThread): boolean {
  if (current.service !== next.service || current.boardId !== next.boardId) return false;
  return current.service === 'jpnkn' || (next.service === 'shitaraba' && current.category === next.category);
}

export function incrementShitarabaTitle(title: string): string | null {
  if (!title) return null;
  const matches = [...title.matchAll(/[0-9０-９]+/g)];
  const match = matches.at(-1);
  if (!match || match.index === undefined) return null;
  const digits = match[0];
  const hasHalfWidth = /[0-9]/.test(digits);
  const hasFullWidth = /[０-９]/.test(digits);
  if (hasHalfWidth && hasFullWidth) return null;
  const normalized = hasFullWidth
    ? digits.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    : digits;
  const incremented = (BigInt(normalized) + 1n).toString().padStart(digits.length, '0');
  const rendered = hasFullWidth
    ? incremented.replace(/[0-9]/g, (digit) => String.fromCharCode(0xff10 + Number(digit)))
    : incremented;
  return `${title.slice(0, match.index)}${rendered}${title.slice(match.index + digits.length)}` || null;
}
