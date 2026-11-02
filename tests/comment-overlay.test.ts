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

  it('初回履歴を無視し、積み上げを10件に制限して時間が経過しても保持する', () => {
    const controller = new CommentOverlayController();
    controller.updateSettings({ mode: 'stack' });

    controller.accept(comment(0, true));
    for (let index = 1; index <= 11; index += 1) {
      controller.accept(comment(index));
    }

    expect(controller.snapshot().active.map((item) => item.comment.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `youtube:${index + 2}`),
    );

    const active = controller.snapshot().active;
    expect(active.every(item => item.expiresAt === null)).toBe(true);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(controller.snapshot().active).toEqual(active);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([1, 10, 50])('積み上げの上限%s件で最古を削除し、保持中IDを重複追加しない', stackMaxComments => {
    const controller = new CommentOverlayController();
    controller.updateSettings({ mode: 'stack', stackMaxComments });
    for (let index = 1; index <= stackMaxComments + 1; index++) controller.accept(comment(index));
    controller.accept(comment(stackMaxComments + 1));
    expect(controller.snapshot().active.map(item => item.comment.sequence)).toEqual(
      Array.from({ length: stackMaxComments }, (_, index) => index + 2),
    );
    expect(controller.snapshot().queue).toEqual([]);
    controller.dispose();
  });

  it('件数減少は直ちに反映し、方向・配置の変更と件数増加では保持中コメントを維持する', () => {
    const controller = new CommentOverlayController();
    controller.updateSettings({ mode: 'stack' });
    for (let index = 1; index <= 10; index++) controller.accept(comment(index));
    controller.updateSettings({ stackMaxComments: 2 });
    expect(controller.snapshot().active.map(item => item.comment.sequence)).toEqual([9, 10]);
    const active = controller.snapshot().active;
    controller.updateSettings({ stackMaxComments: 50, stackDirection: 'newestTop', stackAlignment: 'bottom' });
    expect(controller.snapshot().active).toEqual(active);
    controller.clearDisplay();
    expect(controller.snapshot()).toEqual({ active: [], queue: [] });
    expect(new CommentOverlayController(controller.getSettings()).snapshot()).toEqual({ active: [], queue: [] });
    controller.dispose();
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
