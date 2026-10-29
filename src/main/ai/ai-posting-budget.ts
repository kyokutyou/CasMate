export const AI_POST_INTERVAL_MS = 30_000;
export const AI_POST_WINDOW_MS = 60 * 60_000;
export const AI_POST_LIMIT = 60;

export interface PostingBudgetRecord { version: 1; savedAt: number; reservations: number[] }
export interface PostingBudgetStore {
  loadPostingBudget(): Promise<PostingBudgetRecord | null>;
  savePostingBudget(record: PostingBudgetRecord): Promise<void>;
}

/** Persistent reservations, independent of conversation deletion and post outcomes. */
export class AiPostingBudget {
  private record: PostingBudgetRecord | null = null;
  private wallOrigin = 0;
  private monotonicOrigin = 0;
  constructor(private readonly store: PostingBudgetStore, private readonly now = Date.now,
    private readonly monotonic = () => performance.now()) {}

  async initialize(legacyAttempts: number[]) {
    const wall = this.now();
    const saved = await this.store.loadPostingBudget();
    const record = saved ?? { version: 1, savedAt: wall, reservations: legacyAttempts.filter(at => at > wall - AI_POST_WINDOW_MS).sort((a, b) => a - b) };
    if (record.version !== 1 || !Number.isFinite(record.savedAt) || !Array.isArray(record.reservations) ||
      !record.reservations.every((at, i, all) => Number.isFinite(at) && at <= record.savedAt && (i === 0 || at >= all[i - 1]))) {
      throw new Error('投稿枠の保存記録が破損しています。');
    }
    if (wall < record.savedAt) throw new Error('PCの時刻が投稿枠の保存時刻より前です。時刻を確認してください。');
    if (!saved) await this.store.savePostingBudget(record);
    this.record = structuredClone(record); this.wallOrigin = wall; this.monotonicOrigin = this.monotonic();
  }

  private time() {
    return Math.min(this.now(), this.wallOrigin + Math.max(0, this.monotonic() - this.monotonicOrigin));
  }
  view() {
    const time = this.time();
    const recent = this.record?.reservations.filter(at => at > time - AI_POST_WINDOW_MS) ?? [];
    const interval = recent.length ? recent[recent.length - 1] + AI_POST_INTERVAL_MS : 0;
    const window = recent.length >= AI_POST_LIMIT ? recent[recent.length - AI_POST_LIMIT] + AI_POST_WINDOW_MS : 0;
    const delay = Math.max(0, interval - time, window - time);
    return { used: recent.length, limit: AI_POST_LIMIT, nextAllowedAt: delay ? this.now() + delay : null };
  }

  async reserve(): Promise<boolean> {
    if (!this.record) throw new Error('投稿枠を読み込めません。');
    if (this.now() < this.record.savedAt) throw new Error('PCの時刻が投稿枠の保存時刻より前です。時刻を確認してください。');
    if (this.view().nextAllowedAt !== null) return false;
    const time = this.time();
    // Keep the in-memory reservation even when saving fails; sending must not proceed.
    this.record = { version: 1, savedAt: this.now(), reservations: [...this.record.reservations.filter(at => at > time - AI_POST_WINDOW_MS), time] };
    await this.store.savePostingBudget(this.record);
    return true;
  }

  async checkpoint() {
    if (!this.record) return;
    this.record = { ...this.record, savedAt: Math.max(this.record.savedAt, this.now()) };
    await this.store.savePostingBudget(this.record);
  }
}
