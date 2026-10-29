import { describe, expect, it } from 'vitest';
import { AiMemoryBuffer } from '../src/main/ai/ai-memory-buffer';
import { trimAiMemory, type AiMemory } from '../src/shared/ai-listener';
import { graphemes } from '../src/shared/unicode';

const record = (id: string, text: string): AiMemory => ({ id, text, role: 'streamer', source: null, at: '2026-10-15T00:00:00Z' });
const ids = (buffer: AiMemoryBuffer) => buffer.records.map(r => r.id);

describe('共有記憶の文字数集計', () => {
  it('絵文字・結合文字を本文を変えずに書記素として数える', () => {
    const buffer = new AiMemoryBuffer();
    const text = '👩‍💻か\u3099🇯🇵✈\uFE0F👍🏽';
    buffer.replace([record('loaded', text)], 10);
    buffer.append(record('new', text), 10);
    expect(buffer.characters).toBe(10);
    expect(buffer.records.map(r => r.text)).toEqual([text, text]);
    buffer.append(record('next', 'あ'), 10);
    expect(buffer.characters).toBe(6); expect(ids(buffer)).toEqual(['new', 'next']);
  });

  it('上限と同じ長さは保持し、超過入力は既存の記憶を追い出さない', () => {
    const buffer = new AiMemoryBuffer();
    buffer.append(record('exact', 'か\u3099'.repeat(1000)), 1000);
    const before = buffer.records;
    buffer.append(record('too-long', '👩‍💻'.repeat(1001)), 1000);
    expect(buffer.characters).toBe(1000); expect(buffer.records).toBe(before);
    buffer.append(record('empty', ''), 1000);
    expect(buffer.characters).toBe(1000); expect(ids(buffer)).toEqual(['exact', 'empty']);
    buffer.append(record('next', '🇯🇵'), 1000);
    expect(buffer.characters).toBe(1); expect(ids(buffer)).toEqual(['empty', 'next']);
  });

  it('上限縮小時は単体で上限を超える記憶を先に除き、残りを古い順に削る', () => {
    const buffer = new AiMemoryBuffer();
    buffer.replace([record('small', 'あ'), record('large', 'い'.repeat(5))], 10);
    buffer.resize(3);
    expect(ids(buffer)).toEqual(['small']); expect(buffer.characters).toBe(1);
    buffer.append(record('two', 'うえ'), 3);
    buffer.append(record('last', 'お'), 3);
    expect(ids(buffer)).toEqual(['two', 'last']); expect(buffer.characters).toBe(3);
    buffer.resize(10);
    expect(ids(buffer)).toEqual(['two', 'last']); expect(buffer.characters).toBe(3);
  });

  it('再読込では同じIDでも本文から再計算し、削除前の集計を残さない', () => {
    const buffer = new AiMemoryBuffer();
    buffer.replace([record('same', 'あいう')], 1000);
    buffer.clear(); expect(buffer.characters).toBe(0); expect(buffer.records).toEqual([]);
    buffer.replace([record('same', '👩‍💻か\u3099')], 1000);
    expect(buffer.characters).toBe(2); expect(buffer.records[0].text).toBe('👩‍💻か\u3099');
    buffer.replace([], 1000); expect(buffer.characters).toBe(0); expect(buffer.records).toEqual([]);
  });

  it('追加・上限変更・削除・再読込で保存待ちのスナップショットを変更しない', () => {
    const buffer = new AiMemoryBuffer();
    buffer.replace([record('first', 'ああ')], 10);
    const first = buffer.records;
    buffer.append(record('second', 'いう'), 10);
    const second = buffer.records;
    buffer.resize(2); const resized = buffer.records;
    buffer.clear(); buffer.replace([record('loaded', 'え')], 10);
    expect(first.map(r => r.id)).toEqual(['first']);
    expect(second.map(r => r.id)).toEqual(['first', 'second']);
    expect(resized.map(r => r.id)).toEqual(['second']);
    expect(ids(buffer)).toEqual(['loaded']); expect(buffer.characters).toBe(1);
  });

  it('混在する追加・上限変更・再読込でも従来の容量制限と一致する', () => {
    const buffer = new AiMemoryBuffer(); let reference: AiMemory[] = []; let limit = 20;
    const texts = ['あ', '👩‍💻', 'か\u3099', '🇯🇵', '✈\uFE0F', '👍🏽', '', '長'.repeat(21)];
    for (let i = 0; i < 160; i++) {
      if (i % 17 === 0) {
        limit = [3, 10, 20][Math.floor(i / 17) % 3];
        buffer.resize(limit); reference = trimAiMemory(reference, limit);
      } else if (i % 23 === 0) {
        reference = [record('reload', texts[i % texts.length]), ...reference];
        buffer.replace(structuredClone(reference), limit); reference = trimAiMemory(reference, limit);
      } else if (i % 31 === 0) {
        buffer.clear(); reference = [];
      } else {
        const next = record(`${i}`, texts[i % texts.length]);
        buffer.append(next, limit); reference = trimAiMemory([...reference, next], limit);
      }
      expect(buffer.records).toEqual(reference);
      expect(buffer.characters).toBe(reference.reduce((sum, r) => sum + graphemes(r.text).length, 0));
      expect(buffer.characters).toBeLessThanOrEqual(limit);
    }
  });
});
