import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { defaultPollAppearance, defaultPollDraft, only, record, validPollAppearance, validPollDraft, type ListenerPoll, type PollBallot, type PollPublicSnapshot, type PollVoteRequest } from '../../shared/listener-poll';
import { emptyPollData, type PollData, type PollPersistence } from './poll-store';

export class PollError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export class PollController {
  private data = emptyPollData();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private revision = 0;
  private readonly instance = randomUUID();
  private error: string | null = null;
  private available = false;
  private readonly events = new EventEmitter();
  constructor(private readonly store: PollPersistence, private readonly now: () => number = Date.now) { this.events.setMaxListeners(0); }
  async initialize(): Promise<void> {
    try {
      this.data = await this.store.load();
      if (this.data.current?.closedAt === null) { const next = structuredClone(this.data); this.finish(next, 'interrupted'); await this.store.save(next); this.data = next; }
      this.available = true;
    } catch { this.error = '投票の保存データを読み込めません。保存先の原本を保持しています。投票機能だけを停止しました。'; }
  }
  view() { return { instance: this.instance, revision: this.revision, available: this.available, error: this.error, draft: structuredClone(this.data.draft ?? defaultPollDraft), appearance: { ...(this.data.appearance ?? defaultPollAppearance) }, current: structuredClone(this.data.current), history: structuredClone(this.data.history) }; }
  publicView(): PollPublicSnapshot {
    const current = this.data.current;
    let poll: PollPublicSnapshot['poll'] = null;
    if (current) {
      poll = { id: current.id, question: current.question, options: [...current.options], startedAt: current.startedAt, endsAt: current.endsAt, closedAt: current.closedAt, resultsVisible: current.resultsVisible, ...(current.resultsVisible ? { counts: [...current.counts] } : {}) };
    }
    return { instance: this.instance, revision: this.revision, poll, appearance: { ...this.data.appearance } };
  }
  ballot(id: string): PollBallot | null {
    const b = this.data.ballots[this.voterKey(id)];
    return b ? { option: b.option, version: b.version } : null;
  }
  subscribe(listener: () => void): () => void { this.events.on('change', listener); return () => { this.events.off('change', listener); }; }
  isAvailable(): boolean { return this.available && !this.stopped; }
  async draft(value: unknown): Promise<void> {
    if (!validPollDraft(value)) throw new PollError(400, 'POLL_DRAFT_INVALID', 'お題は200文字、選択肢は2〜10個・各100文字、制限時間は1〜1440分で入力してください。');
    await this.update(next => { next.draft = structuredClone(value); });
  }
  async appearance(value: unknown): Promise<void> {
    if (!validPollAppearance(value)) throw new PollError(400, 'POLL_APPEARANCE_INVALID', '文字サイズと色を確認してください。');
    await this.update(next => { next.appearance = { ...value }; });
  }
  async start(admitted: () => boolean = () => true): Promise<void> {
    await this.update(next => {
      if (!admitted()) throw new PollError(409, 'POLL_NOT_PUBLISHED', '投票ページを公開してから投票を開始してください。');
      if (next.current?.closedAt === null) throw new PollError(409, 'POLL_ALREADY_OPEN', '受付中の投票を締め切ってください。');
      if (!validPollDraft(next.draft, true)) throw new PollError(400, 'POLL_DRAFT_INCOMPLETE', 'お題と、空欄・重複のない選択肢を入力してください。');
      const now = this.now();
      next.current = { id: randomUUID(), question: next.draft.question.trim(), options: next.draft.options.map(x => x.trim()), counts: next.draft.options.map(() => 0), startedAt: now, endsAt: next.draft.durationMinutes === null ? null : now + next.draft.durationMinutes * 60_000, closedAt: null, closeReason: null, resultsVisible: false };
      next.ballots = {};
    });
  }
  async close(reason: NonNullable<ListenerPoll['closeReason']> = 'manual'): Promise<void> { await this.update(next => { if (next.current?.closedAt === null) this.finish(next, reason); }); }
  async reveal(value: unknown): Promise<void> {
    if (typeof value !== 'boolean') throw new PollError(400, 'POLL_INVALID', '結果公開の設定を確認してください。');
    await this.update(next => { if (!next.current) throw new PollError(409, 'POLL_NOT_FOUND', '投票がありません。'); next.current.resultsVisible = value; });
  }
  async duplicate(id: string): Promise<void> {
    await this.update(next => { const poll = next.history.find(x => x.id === id) ?? (next.current?.id === id ? next.current : null); if (!poll) throw new PollError(404, 'POLL_NOT_FOUND', '投票が見つかりません。'); next.draft = { question: poll.question, options: [...poll.options], durationMinutes: null }; });
  }
  async delete(id: string): Promise<void> {
    await this.update(next => { if (next.current?.id === id && next.current.closedAt === null) throw new PollError(409, 'POLL_OPEN', '受付中の投票は削除できません。'); next.history = next.history.filter(x => x.id !== id); if (next.current?.id === id) next.current = null; });
  }
  async vote(id: string, value: unknown): Promise<{ state: PollPublicSnapshot; ballot: PollBallot | null }> {
    if (!record(value) || !only(value, ['pollId','requestId','option','version']) || typeof value.pollId !== 'string' || typeof value.requestId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(value.requestId) || !Number.isInteger(value.option) || !Number.isSafeInteger(value.version) || Number(value.version) < 0) throw new PollError(400, 'POLL_VOTE_INVALID', '投票内容を確認してください。');
    const request = value as unknown as PollVoteRequest;
    await this.update(next => {
      const poll = next.current;
      if (!poll || poll.id !== request.pollId || poll.closedAt !== null || poll.endsAt !== null && this.now() >= poll.endsAt) throw new PollError(409, 'POLL_CLOSED', 'この投票の受付は終了しました。');
      if (request.option < 0 || request.option >= poll.options.length) throw new PollError(400, 'POLL_OPTION_INVALID', '選択肢を確認してください。');
      const key = this.voterKey(id), previous = next.ballots[key];
      if (previous?.requestId === request.requestId) return;
      if ((previous?.version ?? 0) !== request.version) throw new PollError(409, 'POLL_BALLOT_CHANGED', '別の画面で投票が変更されました。最新状態を確認してください。');
      if (previous) poll.counts[previous.option]--;
      poll.counts[request.option]++;
      next.ballots[key] = { option: request.option, version: (previous?.version ?? 0) + 1, requestId: request.requestId };
    });
    return { state: this.publicView(), ballot: this.ballot(id) };
  }
  async shutdown(): Promise<void> {
    this.stopped = true; clearTimeout(this.timer);
    await this.enqueue(async () => {
      if (!this.available || this.data.current?.closedAt !== null) return;
      const next = structuredClone(this.data); this.finish(next, 'interrupted'); await this.store.save(next); this.data = next;
    });
    this.events.removeAllListeners();
  }
  private voterKey(id: string): string { return createHash('sha256').update(id).digest('hex'); }
  private finish(next: PollData, reason: NonNullable<ListenerPoll['closeReason']>): void {
    if (!next.current || next.current.closedAt !== null) return;
    next.current.closedAt = Math.max(next.current.startedAt, this.now()); next.current.closeReason = reason;
    next.history.unshift(structuredClone(next.current)); next.ballots = {};
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> { const work = this.queue.then(action); this.queue = work.catch(() => undefined); return work; }
  private update(action: (data: PollData) => void): Promise<void> {
    return this.enqueue(async () => {
      if (!this.available || this.stopped) throw new PollError(503, 'POLL_UNAVAILABLE', this.error ?? '投票機能を停止しています。');
      // Commit a deadline before rejecting a delayed vote, even if its timer was delayed by sleep.
      if (this.data.current?.closedAt === null && this.data.current.endsAt !== null && this.now() >= this.data.current.endsAt) {
        const expired = structuredClone(this.data); this.finish(expired, 'deadline'); await this.commit(expired);
      }
      const next = structuredClone(this.data); action(next); await this.commit(next);
    });
  }
  private async commit(next: PollData): Promise<void> {
    try { await this.store.save(next); }
    catch { this.error = '投票データを保存できませんでした。直前の保存状態を保持しています。再試行してください。'; this.events.emit('change'); throw new PollError(503, 'POLL_SAVE_FAILED', this.error); }
    this.data = next; this.error = null; this.revision++; this.schedule(); this.events.emit('change');
  }
  private schedule(): void {
    clearTimeout(this.timer);
    const poll = this.data.current;
    if (this.stopped || poll?.closedAt !== null || poll.endsAt === null) return;
    this.timer = setTimeout(() => { void this.close('deadline').catch(() => { if (!this.stopped) { this.timer = setTimeout(() => this.schedule(), 1000); this.timer.unref(); } }); }, Math.min(2_147_483_647, Math.max(1, poll.endsAt - this.now())));
    this.timer.unref();
  }
}
