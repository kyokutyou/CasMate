import { describe, expect, it } from 'vitest';
import {
  breathingKeyframes,
  synchronizedAnimationTime,
  tiltKeyframes,
  verticalKeyframes,
} from '../src/renderer/character-motion';

describe('簡易キャラクターの常時微動', () => {
  it('仕様どおりの中立姿勢を始点とするキーフレームを生成する', () => {
    expect(verticalKeyframes(0.5)).toEqual([
      { transform: 'translateY(0%)' },
      { transform: 'translateY(-0.5%)' },
      { transform: 'translateY(0%)' },
    ]);
    expect(tiltKeyframes(0.4)).toEqual([
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(0.4deg)' },
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(-0.4deg)' },
      { transform: 'rotate(0deg)' },
    ]);
    expect(breathingKeyframes(1)).toEqual([
      { transform: 'scaleY(1)' },
      { transform: 'scaleY(1.01)' },
      { transform: 'scaleY(1)' },
    ]);
  });

  it('共通開始時刻から各周期内の同じ再生位置を算出する', () => {
    expect(synchronizedAnimationTime(10_250, 1_000, 3_000)).toBe(250);
    expect(synchronizedAnimationTime(1_000, 1_000, 3_000)).toBe(0);
    expect(synchronizedAnimationTime(500, 1_000, 3_000)).toBe(0);
  });
});
