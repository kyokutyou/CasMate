import type { CommentFilterSettings, IncomingComment } from '../../shared/types';
import { canonicalizeNgWords, evaluateCommentFilter } from '../../shared/comment-filter';
import { ValidationError } from './validation-error';

export { isAsciiArt } from '../../shared/comment-filter';

export const defaultCommentFilterSettings: CommentFilterSettings = {
  ngWords: [],
  asciiArtEnabled: false,
};

export function validateCommentFilterSettings(value: Record<string, unknown>): CommentFilterSettings {
  if (!Array.isArray(value.ngWords) || !value.ngWords.every((word) => typeof word === 'string')) {
    throw new ValidationError('NGワード一覧が正しくありません。');
  }
  const ngWords = canonicalizeNgWords(value.ngWords);
  if (typeof value.asciiArtEnabled !== 'boolean') {
    throw new ValidationError('アスキーアート判定が正しくありません。');
  }
  return { ngWords, asciiArtEnabled: value.asciiArtEnabled };
}

export function blocksComment(
  comment: IncomingComment,
  settings: CommentFilterSettings,
): boolean {
  const body = comment.content
    .map((part) => part.type === 'text' ? part.text : part.alt)
    .join('');
  return evaluateCommentFilter(comment.authorName, body, settings).blocked;
}
