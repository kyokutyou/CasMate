const graphemeSegmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

export function graphemes(value: string): string[] {
  return [...graphemeSegmenter.segment(value)].map((part) => part.segment);
}

export function normalizeTextMatch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP');
}
