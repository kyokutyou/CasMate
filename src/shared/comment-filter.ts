import type { CommentFilterSettings } from './types';

export type CommentFilterResult =
  | { blocked: false }
  | { blocked: true; reason: 'ngWord'; word: string; target: 'author' | 'body' }
  | { blocked: true; reason: 'asciiArt' };

// Pure and shared by reception and the local settings tester. Never logs its inputs/results.
export function evaluateCommentFilter(authorName: string, body: string, settings: CommentFilterSettings): CommentFilterResult {
  const author = normalizeCommentFilterText(authorName);
  const text = normalizeCommentFilterText(body);
  for (const entry of settings.ngWords) {
    const word = entry.trim();
    const normalized = normalizeCommentFilterText(word);
    if (!normalized) continue;
    if (author.includes(normalized)) return { blocked: true, reason: 'ngWord', word, target: 'author' };
    if (text.includes(normalized)) return { blocked: true, reason: 'ngWord', word, target: 'body' };
  }
  return settings.asciiArtEnabled && isAsciiArt(body) ? { blocked: true, reason: 'asciiArt' } : { blocked: false };
}

export function isAsciiArt(value: string): boolean {
  const lines = value.replace(/\r\n?/gu, '\n').split('\n').filter(line => nonWhitespaceCharacters(line).length > 0);
  if (lines.length < 2) return false;
  const characters = lines.flatMap(nonWhitespaceCharacters);
  if (characters.length < 8) return false;
  const decorativeLines = lines.filter(line => {
    const lineCharacters = nonWhitespaceCharacters(line);
    return lineCharacters.length >= 3 && symbolRatio(lineCharacters) >= 0.5;
  });
  return decorativeLines.length >= 2 && symbolRatio(characters) >= 0.5;
}

function nonWhitespaceCharacters(value: string): string[] {
  return Array.from(value).filter(character => !/\s/u.test(character));
}

function symbolRatio(characters: string[]): number {
  return characters.filter(character => !/[\p{L}\p{N}\p{M}]/u.test(character)).length / characters.length;
}

export function normalizeCommentFilterText(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

export function canonicalizeNgWords(words: string[]): string[] {
  const seen = new Set<string>();
  return words.flatMap((word) => {
    const trimmed = word.trim();
    if (!trimmed) return [];
    const normalized = normalizeCommentFilterText(trimmed);
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    return [trimmed];
  });
}
