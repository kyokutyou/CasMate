import type { CommonComment, CommentOverlaySettings, SpeechRecognitionOverlayAppearance } from '../../shared/types';
import type { CommentPreview } from './model';

// A local, embedded emote: a preview never requests a service's image URL.
const sampleEmote = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#ffd166"/><circle cx="13" cy="15" r="3" fill="#243047"/><circle cx="27" cy="15" r="3" fill="#243047"/><path d="M11 25 Q20 34 29 25" stroke="#243047" stroke-width="3" fill="none"/></svg>');

export function previewComments(preview: CommentPreview): CommonComment[] {
  const sources = preview.source === 'all' ? ['youtube', 'twitch', 'shitaraba'] as const : [preview.source];
  const count = preview.mode === 'single' ? 1 : 3;
  return Array.from({ length: count }, (_, index) => ({
    id: `sample-${index}`, externalId: `sample-${index}`, sequence: index,
    source: sources[index % sources.length], authorName: preview.author,
    content: [{ type: 'text', text: preview.text }, ...(preview.emotes ? [{ type: 'emote' as const, id: 'local-smile', alt: '笑顔のエモート', url: sampleEmote }] : [])],
    receivedAt: '2026-10-08T00:00:00.000Z', initialHistory: false,
  }));
}

// Intentionally an ordinary live theme. Generated CSS must override it exactly
// as it overrides a browser source's inline application appearance.
export const previewAppearance: Omit<SpeechRecognitionOverlayAppearance, 'design'> = {
  fontFamily: 'Yu Gothic UI', fontSizePx: 32, textColor: '#ffffff',
  backgroundColor: '#00000099', paddingPx: 8, borderRadiusPx: 8,
};

export function previewCommentSettings(preview: CommentPreview): CommentOverlaySettings {
  return { ...previewAppearance, showSource: true, showAuthor: true, showContent: true,
    mode: preview.mode, stackDirection: preview.stackDirection, singleDurationSeconds: 10, stackDurationSeconds: 10 };
}
