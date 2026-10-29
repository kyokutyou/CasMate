import { describe, expect, it } from 'vitest';
import { CommentStore } from '../src/main/core/comment-store';

describe('共通コメント履歴', () => {
  it('受理順を付与し、重複を拒否して、上限超過時も重複判定を維持する', () => {
    const store = new CommentStore({
      limit: 2,
      now: () => new Date('2026-08-23T01:02:03.000Z'),
    });

    const first = store.accept({
      externalId: 'one',
      source: 'youtube',
      authorName: '配信視聴者A',
      content: [{ type: 'text', text: '最初のコメント' }],
      initialHistory: true,
    });
    const second = store.accept({
      externalId: 'two',
      source: 'twitch',
      authorName: '配信視聴者B',
      content: [{ type: 'text', text: '次のコメント' }],
      initialHistory: false,
    });
    const third = store.accept({
      externalId: 'three',
      source: 'shitaraba',
      authorName: '名無しさん',
      content: [{ type: 'text', text: '三つ目' }],
      initialHistory: false,
    });

    expect(first.comment).toMatchObject({
      id: 'youtube:one',
      sequence: 1,
      receivedAt: '2026-08-23T01:02:03.000Z',
      initialHistory: true,
    });
    expect(second.comment?.sequence).toBe(2);
    expect(third.removed?.id).toBe('youtube:one');
    expect(store.snapshot().map((comment) => comment.id)).toEqual([
      'twitch:two',
      'shitaraba:three',
    ]);

    const duplicate = store.accept({
      externalId: 'one',
      source: 'youtube',
      authorName: '配信視聴者A',
      content: [{ type: 'text', text: '再取得されたコメント' }],
      initialHistory: false,
    });
    expect(duplicate).toEqual({ duplicate: true });
  });
});
