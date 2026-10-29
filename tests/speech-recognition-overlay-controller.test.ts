import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechRecognitionOverlayController } from '../src/main/core/speech-recognition-overlay-controller';
import type { SpeechRecognitionResult } from '../src/shared/types';

describe('OBS音声認識表示状態', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    [1_000, '2026-08-28T00:00:10.000Z'],
    [5_000, '2026-08-28T00:00:10.000Z'],
    [20_000, '2026-08-28T00:00:10.000Z'],
  ])('音声時間%dミリ秒に関係なく固定の表示期限を使う', (audioDuration, expiresAt) => {
    const controller = new SpeechRecognitionOverlayController(true);
    controller.accept(result('result-1', '認識結果', audioDuration));

    expect(controller.snapshot().active).toEqual({
      id: 'result-1', text: '認識結果', expiresAt,
    });
    controller.dispose();
  });

  it('新しい結果で置換し、空文字とオフ切替で直ちに消す', () => {
    const changed = vi.fn();
    const controller = new SpeechRecognitionOverlayController(true, changed);
    controller.accept(result('first', '最初', 1_000));
    controller.accept(result('second', '次', 1_000));
    expect(controller.snapshot().active?.id).toBe('second');

    controller.accept(result('empty', '   ', 1_000));
    expect(controller.snapshot().active).toBeNull();
    controller.accept(result('third', '再表示', 1_000));
    controller.updateEnabled(false);
    expect(controller.snapshot().active).toBeNull();
    expect(changed).toHaveBeenLastCalledWith({ active: null });
  });

  it('プレビュー単独の結果を受理せず、期限後に状態を消す', () => {
    const changed = vi.fn();
    const controller = new SpeechRecognitionOverlayController(false, changed);
    controller.accept(result('preview', 'プレビュー', 1_000));
    expect(controller.snapshot().active).toBeNull();

    controller.updateEnabled(true);
    controller.accept(result('production', '本番', 1_000));
    vi.advanceTimersByTime(10_000);
    expect(controller.snapshot().active).toBeNull();
    expect(changed).toHaveBeenLastCalledWith({ active: null });
  });
  it('秒数変更は表示中の期限を変えず、次の結果から適用する', () => {
    const controller = new SpeechRecognitionOverlayController(true);
    controller.accept(result('first', '最初', 1_000));
    const first = controller.snapshot().active;
    controller.updateDuration(2);
    expect(controller.snapshot().active).toEqual(first);
    vi.advanceTimersByTime(9_999);
    expect(controller.snapshot().active?.id).toBe('first');
    vi.advanceTimersByTime(1);
    expect(controller.snapshot().active).toBeNull();
    controller.accept(result('next', '次', 20_000));
    vi.advanceTimersByTime(1_999);
    expect(controller.snapshot().active?.id).toBe('next');
    vi.advanceTimersByTime(1);
    expect(controller.snapshot().active).toBeNull();
    controller.dispose();
  });
});

function result(
  id: string,
  text: string,
  audioDurationMilliseconds: number,
): SpeechRecognitionResult {
  return {
    id,
    sessionId: 'session-1',
    sequence: 1,
    recognizedAt: '2026-08-28T00:00:00.000Z',
    text,
    audioDurationMilliseconds,
    recognitionDurationMilliseconds: 100,
  };
}
