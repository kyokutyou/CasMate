import { expect, it } from 'vitest';
import { createDefaultDocument, createPreset, obsPresets, parseDocument } from '../src/shared/obs-style';
import { createObsDesignPreset, validateObsDesign } from '../src/shared/obs-design';
import { generateCss } from '../src/renderer/obs-style-editor/css';

it('両表示に同名の10種類を提供し、全プリセットを既存形式で往復できる', () => {
  expect(obsPresets.map(item => item.label)).toEqual(['標準', '明るいカード', '背景なし', 'ダークカード', 'くっきり縁取り', 'パステル', 'ネオン', 'レトロ端末', '和風', '高視認性']);
  expect(new Set(obsPresets.map(item => item.id)).size).toBe(10);
  for (const target of ['comments', 'speech'] as const) {
    const designs = new Set<string>();
    for (const { id } of obsPresets) {
      const value = createDefaultDocument();
      if (target === 'comments') value.designs.comments = createPreset(target, id);
      else value.designs.speech = createPreset(target, id);
      designs.add(JSON.stringify(value.designs[target]));
      expect(parseDocument(JSON.stringify(value))).toEqual(value);
      const application = createObsDesignPreset(target, id);
      expect(validateObsDesign(target, application)).toEqual(application);
      application.style.border.width = 12;
      expect(createObsDesignPreset(target, id).style.border.width).not.toBe(12);
    }
    expect(designs.size).toBe(10);
  }
});

it('標準の付箋・字幕を保ち、等幅・明朝の代替書体と各用途の特徴を適用する', () => {
  expect(createObsDesignPreset('comments', 'standard')).toMatchObject({ variant: 'paper', paperColors: true, style: { fontWeight: 500, fontSize: 36 } });
  expect(createObsDesignPreset('speech', 'standard').style).toMatchObject({ fontWeight: 400, fontSize: 32 });
  expect(createPreset('comments', 'outlined')).toMatchObject({ backgroundOpacity: 0, outline: { enabled: true, width: 3 }, sourceBackgroundOpacity: 0 });
  expect(createPreset('speech', 'highContrast')).toMatchObject({ backgroundOpacity: 100, fontWeight: 700, fontSize: 52 });
  expect(createPreset('comments', 'neon').cardShadow).toMatchObject({ enabled: true, color: '#45e5ff' });
  expect(generateCss('comments', createPreset('comments', 'terminal'))).toContain('"Consolas", "Courier New", monospace');
  expect(generateCss('speech', createPreset('speech', 'japanese'))).toContain('"Yu Mincho", "MS PMincho", serif');
});
