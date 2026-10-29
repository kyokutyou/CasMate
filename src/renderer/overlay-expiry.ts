import type { SpeechRecognitionOverlayItem, TimedOverlayComment } from '../shared/types';

export function unexpiredOverlayComments(
  items: TimedOverlayComment[],
  now: number,
): TimedOverlayComment[] {
  return items.filter((item) => new Date(item.expiresAt).getTime() > now);
}

export function unexpiredSpeechRecognitionOverlayItem(
  item: SpeechRecognitionOverlayItem | null,
  now: number,
): SpeechRecognitionOverlayItem | null {
  return item && new Date(item.expiresAt).getTime() > now ? item : null;
}
