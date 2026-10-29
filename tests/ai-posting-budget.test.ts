import { describe, expect, it, vi } from 'vitest';
import { AiPostingBudget, type PostingBudgetRecord } from '../src/main/ai/ai-posting-budget';

function fixture(saved: PostingBudgetRecord | null = null) {
  let wall = 10_000_000; let mono = 0;
  const store = { loadPostingBudget: vi.fn(async () => saved), savePostingBudget: vi.fn(async (value: PostingBudgetRecord) => { saved = structuredClone(value); }) };
  const create = () => new AiPostingBudget(store, () => wall, () => mono);
  return { store, create, advance: (ms: number) => { wall += ms; mono += ms; }, wall: (value: number) => { wall = value; } };
}
describe('AI投稿枠', () => {
  it('30秒境界、60件目と61件目、60分境界を全体で制限する', async () => {
    const f = fixture(); const b = f.create(); await b.initialize([]);
    expect(await b.reserve()).toBe(true); f.advance(29_999); expect(await b.reserve()).toBe(false);
    f.advance(1); expect(await b.reserve()).toBe(true);
    for (let i = 2; i < 60; i++) { f.advance(30_000); expect(await b.reserve()).toBe(true); }
    f.advance(30_000); expect(await b.reserve()).toBe(false); expect(b.view().used).toBe(60);
    f.advance(1_799_999); expect(await b.reserve()).toBe(false);
    f.advance(1); expect(await b.reserve()).toBe(true); expect(b.view().used).toBe(60);
  });
  it('保存された枠を再起動で復元し、旧ログは初回だけ移行する', async () => {
    const f = fixture(); const b = f.create(); await b.initialize([9_999_000]);
    expect(b.view().used).toBe(1); expect(await b.reserve()).toBe(false);
    f.advance(29_000); expect(await b.reserve()).toBe(true);
    const restarted = f.create(); await restarted.initialize([]);
    expect(restarted.view().used).toBe(2); expect(await restarted.reserve()).toBe(false);
  });
  it('保存失敗では枠確保成功を返さず、本文を保存しない', async () => {
    const f = fixture(); const b = f.create(); await b.initialize([]);
    f.store.savePostingBudget.mockRejectedValueOnce(new Error('disk'));
    await expect(b.reserve()).rejects.toThrow('disk');
    expect(Object.keys(f.store.savePostingBudget.mock.calls.at(-1)![0]).sort()).toEqual(['reservations', 'savedAt', 'version']);
  });
  it('破損・未来の保存時刻は初期化で回避しない', async () => {
    const f = fixture({ version: 1, savedAt: 10_000_001, reservations: [] });
    await expect(f.create().initialize([])).rejects.toThrow('時刻');
    expect(f.store.savePostingBudget).not.toHaveBeenCalled();
    f.wall(10_000_001); await expect(f.create().initialize([])).resolves.toBeUndefined();
    const broken = fixture({ version: 1, savedAt: 10_000_000, reservations: [NaN] });
    await expect(broken.create().initialize([])).rejects.toThrow();
  });
  it('稼働中の時計早送りで枠を早く解放しない', async () => {
    const f = fixture(); const b = f.create(); await b.initialize([]); await b.reserve();
    f.wall(20_000_000); expect(await b.reserve()).toBe(false);
    f.advance(30_000); expect(await b.reserve()).toBe(true);
  });
});
