import { describe, expect, it, vi } from 'vitest';
import * as unicode from '../src/shared/unicode';
import { matchTextEffects } from '../src/main/core/text-effects';
import { createDefaultSettings } from '../src/main/core/settings';
import type { IncomingComment, TextEffectRule } from '../src/shared/types';

const comment = (content: IncomingComment['content']): IncomingComment => ({
  externalId: '1',
  source: 'youtube',
  authorName: 'viewer',
  content,
  initialHistory: false,
});

describe('コメント文字演出の判定', () => {
  it('50個の連動ルールでも本文の書記素を一度だけ走査し、エモートで連続を区切る', () => {
    const body = '👩‍💻👩‍💻か\u3099か\u3099か\u3099';
    const rules: TextEffectRule[] = Array.from({ length: 48 }, (_, i) => ({ id: String(i), enabled: true,
      trigger: String.fromCodePoint(0x4e00 + i), displayText: 'なし', color: '#ffffffff', countMode: 'consecutive', minimumConsecutiveCount: 2 }));
    rules.push({ id: 'emoji', enabled: true, trigger: '👩‍💻', displayText: 'emoji', color: '#ffffffff', countMode: 'consecutive', minimumConsecutiveCount: 2 },
      { id: 'combining', enabled: true, trigger: 'が', displayText: 'kana', color: '#ffffffff', countMode: 'consecutive', minimumConsecutiveCount: 2 });
    const scan = vi.spyOn(unicode, 'graphemes');
    try {
      const result = matchTextEffects(comment([{ type: 'text', text: body }, { type: 'emote', id: 'e', alt: 'がががが', url: 'https://example.test/e' },
        { type: 'text', text: 'が' }]), { ...createDefaultSettings().textEffects, rules });
      expect(result.map(item => item.text)).toEqual(['emoji', 'emoji', 'kana', 'kana', 'kana']);
      expect(scan.mock.calls.filter(([text]) => text === body.normalize('NFKC'))).toHaveLength(1);
    } finally { scan.mockRestore(); }
  });

  it('固定型は正規化した部分一致で1コメントにつき1回だけ発火する', () => {
    const settings = createDefaultSettings().textEffects;
    const rules: TextEffectRule[] = [{
      id: 'fixed', enabled: true, trigger: 'ABC', displayText: '星', color: '#ffffffff',
      countMode: 'fixed', fixedCount: 3,
    }];

    expect(matchTextEffects(comment([{ type: 'text', text: 'ａｂｃ ABC' }]), { ...settings, rules }))
      .toEqual(Array(3).fill({ text: '星', color: '#ffffffff' }));
  });

  it('連動型はテキスト部分ごとの最長連続数を使いエモートをまたがない', () => {
    const settings = createDefaultSettings().textEffects;
    const input = comment([
      { type: 'text', text: 'ＷＷ' },
      { type: 'emote', id: 'w', alt: 'wwwww', url: 'https://example.test/w.png' },
      { type: 'text', text: 'www' },
    ]);

    expect(matchTextEffects(input, settings)).toEqual(Array(3).fill({
      text: '草', color: '#66cc66ff',
    }));
  });

  it('URL部分を除外し、URL外の連続wだけで発火する', () => {
    const settings = createDefaultSettings().textEffects;

    expect(matchTextEffects(
      comment([{ type: 'text', text: 'http://www.google.com' }]),
      settings,
    )).toEqual([]);
    expect(matchTextEffects(
      comment([{ type: 'text', text: 'ttps://www.google.com' }]),
      settings,
    )).toEqual([]);
    expect(matchTextEffects(
      comment([{ type: 'text', text: 'http://www.google.com すごいww' }]),
      settings,
    )).toEqual(Array(2).fill({ text: '草', color: '#66cc66ff' }));
  });

  it('保存順ですべての一致を処理し1コメント20個で打ち切る', () => {
    const settings = createDefaultSettings().textEffects;
    const rules: TextEffectRule[] = [
      { id: 'a', enabled: true, trigger: 'x', displayText: 'A', color: '#ffffffff', countMode: 'fixed', fixedCount: 15 },
      { id: 'b', enabled: true, trigger: 'x', displayText: 'B', color: '#ffffffff', countMode: 'fixed', fixedCount: 15 },
    ];

    const result = matchTextEffects(comment([{ type: 'text', text: 'x' }]), { ...settings, rules });
    expect(result).toHaveLength(20);
    expect(result.slice(0, 15).every((item) => item.text === 'A')).toBe(true);
    expect(result.slice(15).every((item) => item.text === 'B')).toBe(true);
  });
});
