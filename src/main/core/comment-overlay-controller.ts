import type {
  CommentOverlaySettings,
  CommentOverlayState,
  CommonComment,
  TimedOverlayComment,
} from '../../shared/types';
import { defaultCommentOverlayAppearance } from '../../shared/comment-overlay-theme';
import { appendOverlayComment } from '../../shared/comment-overlay-flow';

export const defaultCommentOverlaySettings: CommentOverlaySettings = {
  mode: 'single',
  stackMaxComments: 10,
  stackAlignment: 'top',
  singleDurationSeconds: 10,
  stackDirection: 'newestBottom',
  showSource: false,
  showAuthor: true,
  showContent: true,
  ...defaultCommentOverlayAppearance,
};

export class CommentOverlayController {
  private settings: CommentOverlaySettings;
  private active: TimedOverlayComment[] = [];
  private queue: CommonComment[] = [];
  private timer?: NodeJS.Timeout;
  private synchronizedFallback?: { timer: NodeJS.Timeout; resolve: () => void };

  constructor(
    settings: CommentOverlaySettings = defaultCommentOverlaySettings,
    private readonly onChange: (state: CommentOverlayState) => void = () => undefined,
  ) {
    this.settings = { ...settings };
  }

  accept(comment: CommonComment): void {
    if (comment.initialHistory || this.contains(comment.id)) {
      return;
    }

    const next = appendOverlayComment({ active: this.active, queue: this.queue }, comment, this.settings, Date.now());
    this.active = next.active;
    this.queue = next.queue;

    this.changed();
  }

  updateSettings(next: Partial<CommentOverlaySettings>): void {
    const modeChanged = next.mode !== undefined && next.mode !== this.settings.mode;
    this.settings = { ...this.settings, ...next };
    if (modeChanged) {
      this.clearDisplay();
      return;
    }
    if (this.settings.mode === 'stack') this.trimStack();
    this.changed();
  }

  getSettings(): CommentOverlaySettings {
    return { ...this.settings };
  }

  startSynchronized(comment: CommonComment): void {
    this.cancelTimers();
    this.queue = [];
    this.active = [{
      comment: cloneComment(comment),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    }];
    this.changed(false);
  }

  finishSynchronized(commentId: string): void {
    if (this.active[0]?.comment.id !== commentId) return;
    this.active = [];
    this.changed(false);
  }

  fallbackSynchronized(comment: CommonComment): Promise<void> {
    this.cancelTimers();
    this.queue = [];
    this.active = [this.withExpiry(comment, this.settings.singleDurationSeconds)];
    this.changed(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.synchronizedFallback = undefined;
        if (this.active[0]?.comment.id === comment.id) this.active = [];
        this.changed(false);
        resolve();
      }, this.settings.singleDurationSeconds * 1_000);
      this.synchronizedFallback = { timer, resolve };
    });
  }

  snapshot(): CommentOverlayState {
    return {
      active: this.active.map((item) => ({
        expiresAt: item.expiresAt,
        comment: cloneComment(item.comment),
      })),
      queue: this.queue.map(cloneComment),
    };
  }

  clearDisplay(): void {
    this.cancelTimers();
    this.active = [];
    this.queue = [];
    this.changed(false);
  }

  dispose(): void {
    this.clearDisplay();
  }

  private trimStack(): void {
    if (this.active.length > this.settings.stackMaxComments) {
      this.active.splice(0, this.active.length - this.settings.stackMaxComments);
    }
  }

  private contains(id: string): boolean {
    return (
      this.active.some((item) => item.comment.id === id) ||
      this.queue.some((item) => item.id === id)
    );
  }

  private withExpiry(comment: CommonComment, seconds: number): TimedOverlayComment {
    return {
      comment: cloneComment(comment),
      expiresAt: new Date(Date.now() + seconds * 1_000).toISOString(),
    };
  }

  private changed(schedule = true): void {
    if (schedule) {
      this.scheduleExpiry();
    }
    this.onChange(this.snapshot());
  }

  private cancelTimers(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.synchronizedFallback) {
      clearTimeout(this.synchronizedFallback.timer);
      this.synchronizedFallback.resolve();
      this.synchronizedFallback = undefined;
    }
  }

  private scheduleExpiry(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.active.length === 0) {
      return;
    }

    const nextExpiry = Math.min(
      ...this.active.flatMap((item) => item.expiresAt === null ? [] : [new Date(item.expiresAt).getTime()]),
    );
    if (!Number.isFinite(nextExpiry)) return;
    this.timer = setTimeout(() => this.expire(), Math.max(0, nextExpiry - Date.now()));
  }

  private expire(): void {
    const now = Date.now();
    if (this.settings.mode === 'stack') {
      this.active = this.active.filter(
        (item) => item.expiresAt === null || new Date(item.expiresAt).getTime() > now,
      );
    } else if (
      this.active[0] &&
      this.active[0].expiresAt !== null &&
      new Date(this.active[0].expiresAt).getTime() <= now
    ) {
      const next = this.queue.shift();
      this.active = next
        ? [this.withExpiry(next, this.settings.singleDurationSeconds)]
        : [];
    }
    this.changed();
  }
}

function cloneComment(comment: CommonComment): CommonComment {
  return {
    ...comment,
    content: comment.content.map((part) => ({ ...part })),
  };
}
