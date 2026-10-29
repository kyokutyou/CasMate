import { describe, expect, it } from 'vitest';
import { buildSpeechText } from '../src/main/speech/speech-text';
import { createDefaultSettings } from '../src/main/core/settings';
import type { CommonComment } from '../src/shared/types';

const baseComment: CommonComment = {
  id: 'youtube:1',
  externalId: '1',
  sequence: 1,
  source: 'youtube',
  authorName: '配信リスナー',
  content: [{ type: 'text', text: 'こんにちは' }],
  receivedAt: '2026-08-24T00:00:00.000Z',
  initialHistory: false,
};

describe('コメント読み上げ文字列', () => {
  it('既定では投稿者名と本文100文字までを読み、超えた場合だけ以下省略を付ける', () => {
    const settings = createDefaultSettings().commentSpeech;
    for (const length of [100, 101]) {
      expect(buildSpeechText({ ...baseComment, content: [{ type: 'text', text: 'あ'.repeat(length) }] }, settings))
        .toBe('配信リスナー ' + 'あ'.repeat(100) + (length > 100 ? ' 以下省略' : ''));
    }
  });
  it('jpnknのサービス名とレス番号を共通の順序で読める', () => {
    const settings = { ...createDefaultSettings().commentSpeech, readSource: true, readAuthor: true };
    expect(buildSpeechText({ ...baseComment, source: 'jpnkn', authorName: 'レス2' }, settings)).toBe('jpnkn レス2 こんにちは');
  });
  it('既定では投稿者名と本文を読み、URL・公式エモート・絵文字・空白を正規化する', () => {
    const settings = createDefaultSettings().commentSpeech;
    const comment: CommonComment = {
      ...baseComment,
      content: [
        { type: 'text', text: '  詳細は https://example.com/a?q=1 です 👋🏻  ' },
        { type: 'emote', id: 'wave', alt: '手を振る', url: 'https://example.com/e.png' },
      ],
    };

    expect(buildSpeechText(comment, settings)).toBe('配信リスナー 詳細は URL です 手を振る');
  });

  it('先頭のhを省いたURL表記もURLとして読む', () => {
    const settings = createDefaultSettings().commentSpeech;
    const comment: CommonComment = {
      ...baseComment,
      content: [{
        type: 'text',
        text: '安全な ttps://example.com/secure と ttp://example.com/plain です',
      }],
    };

    expect(buildSpeechText(comment, settings)).toBe('配信リスナー 安全な URL と URL です');
  });

  it('サービス名、投稿者名、本文の固定順と省略文を適用する', () => {
    const settings = {
      ...createDefaultSettings().commentSpeech,
      readSource: true,
      readAuthor: true,
      maxTextLength: 50,
    };
    const comment = {
      ...baseComment,
      content: [{ type: 'text' as const, text: 'あ'.repeat(51) }],
    };

    expect(buildSpeechText(comment, settings)).toBe(
      `YouTube 配信リスナー ${'あ'.repeat(50)} 以下省略`,
    );
  });

  it('正規化後に読む項目がなければ音声合成対象にしない', () => {
    const settings = { ...createDefaultSettings().commentSpeech, readAuthor: false };
    expect(buildSpeechText({ ...baseComment, content: [{ type: 'text', text: '😀' }] }, settings)).toBeNull();
  });
});
