import { expect, it } from 'vitest';
import { setupEffectExampleCount } from '../src/renderer/initial-setup-effects-example';
import type { TextEffectRule } from '../src/shared/types';

const linked: TextEffectRule = { id: 'grass', enabled: false, trigger: 'w', displayText: '草', color: '#66cc66ff', countMode: 'consecutive', minimumConsecutiveCount: 2 };
it('説明用の反応例は最長連続数・正規化・URL除外・上限を使い、OFFでも説明できる', () => {
  expect(setupEffectExampleCount('ww と ｗＷw', linked)).toBe(3);
  expect(setupEffectExampleCount('w と w', linked)).toBe(0);
  expect(setupEffectExampleCount('https://example.com/wwww', linked)).toBe(0);
  expect(setupEffectExampleCount('w'.repeat(25), linked)).toBe(20);
  expect(setupEffectExampleCount('ww')).toBe(0);
  // Match the engine's first normalized grapheme for a compatibility character.
  expect(setupEffectExampleCount('ff', { ...linked, trigger: 'ﬃ' })).toBe(2);
});
it('固定個数の説明は出現回数に連動せず、結合絵文字も1文字として連続を扱う', () => {
  expect(setupEffectExampleCount('8888と8888', { ...linked, countMode: 'fixed', trigger: '8888', fixedCount: 6 })).toBe(6);
  expect(setupEffectExampleCount('👨‍👩‍👧👨‍👩‍👧', { ...linked, trigger: '👨‍👩‍👧' })).toBe(2);
});
