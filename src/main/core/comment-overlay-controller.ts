import type {
  CommentOverlaySettings,
  CommentOverlayState,
  CommonComment,
  TimedOverlayComment,
} from '../../shared/types';
import { defaultCommentOverlayAppearance } from '../../shared/comment-overlay-theme';

export const defaultCommentOverlaySettings: CommentOverlaySettings = {
  mode: 'single',
  stackDurationSeconds: 10,
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

    if (this.settings.mode === 'stack') {
      this.active.push(this.withExpiry(comment, this.settings.stackDurationSeconds));
      if (this.active.length > 10) {
        this.active.splice(0, this.active.length - 10);
      }
    } else if (this.active.length === 0) {
      this.active = [this.withExpiry(comment, this.settings.singleDurationSeconds)];
    } else {
      this.queue.push(comment);
      if (this.queue.length > 100) {
        this.queue.shift();
      }
    }

    this.changed();
  }

  updateSettings(next: Partial<CommentOverlaySettings>): void {
    const modeChanged = next.mode !== undefined && next.mode !== this.settings.mode;
    this.settings = { ...this.settings, ...next };
    if (modeChanged) {
      this.clearDisplay();
      return;
    }
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
    this.cancelTimers();
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
      ...this.active.map((item) => new Date(item.expiresAt).getTime()),
    );
    this.timer = setTimeout(() => this.expire(), Math.max(0, nextExpiry - Date.now()));
  }

  private expire(): void {
    const now = Date.now();
    if (this.settings.mode === 'stack') {
      this.active = this.active.filter(
        (item) => new Date(item.expiresAt).getTime() > now,
      );
    } else if (
      this.active[0] &&
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
