import { describe, expect, it } from 'vitest';
import { analyzeRmsFrames } from '../src/main/speech/lip-sync-analyzer';

describe('PC読み上げ音声の口形解析', () => {
  it('40msフレームを音声全体で正規化し18%開口・10%閉口・80ms保持を適用する', () => {
    const frames = [0.05, 0.2, 0.2, 0.05, 0.05, 1].map((amplitude) =>
      Array.from({ length: 40 }, () => amplitude),
    ).flat();

    expect(analyzeRmsFrames(Float32Array.from(frames), 1_000)).toEqual([
      { atMs: 40, shape: 'open' },
      { atMs: 120, shape: 'closed' },
      { atMs: 200, shape: 'open' },
    ]);
  });

  it('無音は全期間を閉口のままにする', () => {
    expect(analyzeRmsFrames(new Float32Array(400), 1_000)).toEqual([]);
  });
});
