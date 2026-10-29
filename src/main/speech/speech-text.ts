import type { CommentSpeechSettings, CommonComment } from '../../shared/types';

const sourceLabels = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  shitaraba: 'したらば',
  jpnkn: 'jpnkn',
} as const;

export function buildSpeechText(
  comment: CommonComment,
  settings: CommentSpeechSettings,
): string | null {
  const rawBody = comment.content
    .map((part) => part.type === 'text' ? part.text : part.alt)
    .join('');
  const normalized = normalizeSpeechText(rawBody);
  const characters = Array.from(normalized);
  const body = characters.length > settings.maxTextLength
    ? `${characters.slice(0, settings.maxTextLength).join('')} 以下省略`
    : normalized;
  const fields = [
    settings.readSource ? sourceLabels[comment.source] : '',
    settings.readAuthor ? normalizeSpeechText(comment.authorName) : '',
    body,
  ].filter(Boolean);
  return fields.length > 0 ? fields.join(' ') : null;
}

export function normalizeSpeechText(value: string): string {
  return value
    .replace(/h?ttps?:\/\/[^\s]+/giu, 'URL')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\p{Emoji_Presentation}/gu, '')
    .replace(/\p{Emoji_Modifier}/gu, '')
    .replace(/\p{Regional_Indicator}/gu, '')
    .replace(/[\uFE0E\uFE0F]/gu, '')
    .replace(/\u200D/gu, '')
    .replace(/\u20E3/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
