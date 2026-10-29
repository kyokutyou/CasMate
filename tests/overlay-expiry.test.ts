import { describe, expect, it } from 'vitest';
import {
  unexpiredOverlayComments,
  unexpiredSpeechRecognitionOverlayItem,
} from '../src/renderer/overlay-expiry';
import type { TimedOverlayComment } from '../src/shared/types';

describe('OBSコメントのローカル表示期限', () => {
  it('バックエンド切断中でも期限を過ぎた表示を除外する', () => {
    const item = (id: string, expiresAt: string): TimedOverlayComment => ({
      expiresAt,
      comment: {
        id: `youtube:${id}`, externalId: id, source: 'youtube', authorName: 'Viewer',
        content: [{ type: 'text', text: id }], initialHistory: false, sequence: 1,
        receivedAt: new Date(0).toISOString(),
      },
    });
    const items = [
      item('expired', '2026-08-23T00:00:00.000Z'),
      item('active', '2026-08-23T00:00:10.000Z'),
    ];

    expect(unexpiredOverlayComments(items, Date.parse('2026-08-23T00:00:05.000Z')).map(({ comment }) => comment.externalId)).toEqual(['active']);
  });
});

describe('OBS音声認識のローカル表示期限', () => {
  it('バックエンド切断中でも期限を過ぎた表示を除外する', () => {
    const item = { id: 'result-1', text: '認識結果', expiresAt: '2026-08-23T00:00:10.000Z' };
    expect(unexpiredSpeechRecognitionOverlayItem(
      item,
      Date.parse('2026-08-23T00:00:05.000Z'),
    )).toEqual(item);
    expect(unexpiredSpeechRecognitionOverlayItem(
      item,
      Date.parse('2026-08-23T00:00:10.000Z'),
    )).toBeNull();
  });
});
