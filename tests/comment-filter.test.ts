import { describe, expect, it } from 'vitest';
import { blocksComment, isAsciiArt } from '../src/main/core/comment-filter';
import type { CommentFilterSettings, IncomingComment } from '../src/shared/types';
import { evaluateCommentFilter } from '../src/shared/comment-filter';

const settings: CommentFilterSettings = {
  ngWords: ['禁止語'],
  asciiArtEnabled: false,
};

function comment(change: Partial<IncomingComment> = {}): IncomingComment {
  return {
    externalId: 'one',
    source: 'youtube',
    authorName: '視聴者',
    content: [{ type: 'text', text: '通常のコメント' }],
    initialHistory: false,
    ...change,
  };
}

describe('コメントフィルター', () => {
  it.each([
    ['1行だけ', '####aaaa', false],
    ['合計7文字', '##a\n##aa', false],
    ['合計8文字かつ記号率ちょうど50%', '##aa\n##aa', true],
    ['片方の行が2文字', '##\n######', false],
    ['片方の行の記号率が50%未満', '##aaa\n##a', false],
    ['全体の記号率が50%未満', '###\n###\nabcdefg', false],
    ['全体の記号率がちょうど50%', '###\n###\nabcdef', true],
    ['対象行が3文字ちょうど', '#a?\n#a?\naa', true],
    ['CRLF', '##aa\r\n##aa', true],
    ['CR', '##aa\r##aa', true],
    ['空白行を合計へ含めない', '##a\n \t\n##aa', false],
    ['結合文字を記号に数えない', '##e\u0301a\n##e\u0301a', false],
    ['補助平面の文字を1文字に数える', '--\u{10400}\n--\u{10400}', false],
  ] as const)('AA境界: %s', (_name, body, expected) => {
    expect(isAsciiArt(body)).toBe(expected);
    expect(evaluateCommentFilter('', body, { ngWords: [], asciiArtEnabled: true }).blocked).toBe(expected);
    expect(blocksComment(comment({ content: [{ type: 'text', text: body }] }), { ngWords: [], asciiArtEnabled: true })).toBe(expected);
  });
  it('テストと受信で同じ判定を使い、登録順と投稿者名を優先した理由を返す', () => {
    const filter = { ngWords: [' ', ' ＳＰＡＭ ', 'ネタバレ'], asciiArtEnabled: true };
    expect(evaluateCommentFilter('spam配信', 'ネタバレ spam', filter)).toEqual({ blocked: true, reason: 'ngWord', word: 'ＳＰＡＭ', target: 'author' });
    expect(evaluateCommentFilter('視聴者', 'spam広告', filter)).toEqual({ blocked: true, reason: 'ngWord', word: 'ＳＰＡＭ', target: 'body' });
    const bodies = ['(^_^)', 'こんにちは\nこんばんは', '########\n########', 'ネタバレ', 'ＳＰＡＭ', '<script>test</script>'];
    for (const body of bodies) {
      expect(evaluateCommentFilter('視聴者', body, filter).blocked).toBe(blocksComment(comment({ content: [{ type: 'text', text: body }] }), filter));
    }
    expect(evaluateCommentFilter('', '########\n########', filter)).toEqual({ blocked: true, reason: 'asciiArt' });
    expect(evaluateCommentFilter('', '(^_^)', filter)).toEqual({ blocked: false });
  });
  it('投稿者名・本文・公式エモート代替テキストを正規化してNGワードと部分一致する', () => {
    const normalizedSettings = {
      ...settings,
      ngWords: ['ＢＡＤ', '禁止語', '', ' 禁止語 '],
    };

    expect(blocksComment(comment({ authorName: 'Very bad user' }), normalizedSettings)).toBe(true);
    expect(blocksComment(comment({ content: [{ type: 'text', text: 'これは禁止語です' }] }), normalizedSettings)).toBe(true);
    expect(blocksComment(comment({
      content: [{ type: 'emote', id: 'one', alt: 'BAD face', url: 'https://example.com/e.png' }],
    }), normalizedSettings)).toBe(true);
    expect(blocksComment(comment({ content: [{ type: 'text', text: '問題ありません' }] }), normalizedSettings)).toBe(false);
  });

  it('複数行のアスキーアートを判定し通常文・箇条書き・URL・1行顔文字を除外しない', () => {
    expect(isAsciiArt('  /\\_/\\\n ( o.o )\n  > ^ <')).toBe(true);
    expect(isAsciiArt('こんにちは\nこんばんは')).toBe(false);
    expect(isAsciiArt('- one\n- two')).toBe(false);
    expect(isAsciiArt('https://example.com/a\nhttps://example.com/b')).toBe(false);
    expect(isAsciiArt('(^_^)')).toBe(false);
  });

  it('アスキーアート判定がオンのときだけ該当本文を除外する', () => {
    const asciiArt = comment({ content: [{ type: 'text', text: '  /\\_/\\\n ( o.o )\n  > ^ <' }] });

    expect(blocksComment(asciiArt, { ...settings, asciiArtEnabled: false })).toBe(false);
    expect(blocksComment(asciiArt, { ...settings, asciiArtEnabled: true })).toBe(true);
  });
});
