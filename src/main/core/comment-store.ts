import type { CommonComment, IncomingComment } from '../../shared/types';

export interface CommentStoreOptions {
  limit?: number;
  now?: () => Date;
}

export type AcceptCommentResult =
  | { duplicate: true }
  | { duplicate: false; comment: CommonComment; removed?: CommonComment };

export class CommentStore {
  private readonly comments: CommonComment[] = [];
  private readonly seenIds = new Set<string>();
  private readonly limit: number;
  private readonly now: () => Date;
  private nextSequence = 1;

  constructor(options: CommentStoreOptions = {}) {
    this.limit = options.limit ?? 10_000;
    this.now = options.now ?? (() => new Date());
  }

  accept(incoming: IncomingComment): AcceptCommentResult {
    const id = `${incoming.source}:${incoming.externalId}`;
    if (this.seenIds.has(id)) {
      return { duplicate: true };
    }

    const comment: CommonComment = {
      ...incoming,
      content: incoming.content.map((part) => ({ ...part })),
      id,
      sequence: this.nextSequence++,
      receivedAt: this.now().toISOString(),
    };
    this.seenIds.add(id);
    this.comments.push(comment);

    const removed = this.comments.length > this.limit ? this.comments.shift() : undefined;
    return { duplicate: false, comment, removed };
  }

  markSeen(incoming: IncomingComment): boolean {
    const id = `${incoming.source}:${incoming.externalId}`;
    if (this.seenIds.has(id)) return false;
    this.seenIds.add(id);
    return true;
  }

  snapshot(): CommonComment[] {
    return this.comments.map((comment) => ({
      ...comment,
      content: comment.content.map((part) => ({ ...part })),
    }));
  }

  clear(): void {
    this.comments.length = 0;
    this.seenIds.clear();
    this.nextSequence = 1;
  }
}
