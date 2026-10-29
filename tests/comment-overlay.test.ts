import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentOverlayController } from '../src/main/core/comment-overlay-controller';
import type { CommonComment } from '../src/shared/types';

function comment(sequence: number, initialHistory = false): CommonComment {
  return {
    id: `youtube:${sequence}`,
    externalId: String(sequence),
    sequence,
    source: 'youtube',
    authorName: '視聴者',
    content: [{ type: 'text', text: `コメント${sequence}` }],
    receivedAt: '2026-08-23T00:00:00.000Z',
    initialHistory,
  };
}

describe('OBSコメント表示状態', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初回履歴を無視し、積み上げを10件に制限して期限後に取り除く', () => {
    const controller = new CommentOverlayController();
    controller.updateSettings({ mode: 'stack' });

    controller.accept(comment(0, true));
    for (let index = 1; index <= 11; index += 1) {
      controller.accept(comment(index));
    }

    expect(controller.snapshot().active.map((item) => item.comment.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `youtube:${index + 2}`),
    );

    vi.advanceTimersByTime(10_000);
    expect(controller.snapshot().active).toEqual([]);
  });

  it('同期中の秒数変更は現在の表示を保ち、次に開始する代替表示から適用する', async () => {
    const controller = new CommentOverlayController();
    try {
      controller.startSynchronized(comment(1));
      const active = controller.snapshot().active;
      controller.updateSettings({ singleDurationSeconds: 15 });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(controller.snapshot().active).toEqual(active);
      controller.finishSynchronized(comment(1).id);

      const first = controller.fallbackSynchronized(comment(2));
      const expiry = controller.snapshot().active[0].expiresAt;
      await vi.advanceTimersByTimeAsync(1_000);
      controller.updateSettings({ singleDurationSeconds: 2 });
      expect(controller.snapshot().active[0].expiresAt).toBe(expiry);
      await vi.advanceTimersByTimeAsync(13_999);
      expect(controller.snapshot().active[0].comment.id).toBe(comment(2).id);
      await vi.advanceTimersByTimeAsync(1);
      await first;
      expect(controller.snapshot().active).toEqual([]);

      const next = controller.fallbackSynchronized(comment(3));
      await vi.advanceTimersByTimeAsync(1_999);
      expect(controller.snapshot().active[0].comment.id).toBe(comment(3).id);
      await vi.advanceTimersByTimeAsync(1);
      await next;
      expect(controller.snapshot().active).toEqual([]);
    } finally { controller.dispose(); }
  });

  it('1件表示の待ちキューを100件に制限し、モード変更で表示状態だけを消す', () => {
    const controller = new CommentOverlayController();
    expect(controller.getSettings().mode).toBe('single');

    for (let index = 1; index <= 102; index += 1) {
      controller.accept(comment(index));
    }

    const single = controller.snapshot();
    expect(single.active[0]?.comment.id).toBe('youtube:1');
    expect(single.queue).toHaveLength(100);
    expect(single.queue[0]?.id).toBe('youtube:3');

    controller.updateSettings({ mode: 'stack' });
    expect(controller.snapshot()).toMatchObject({ active: [], queue: [] });
  });
});
