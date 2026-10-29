import { expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';

const dimensions = async (asset: string) => asset.includes('large') ? { width: 2, height: 2 } : { width: 1, height: 1 };

it('素材・微動・表示オプション・両ウィンドウの保存を最新設定へ部分反映する', async () => {
  const state = new AppState(createDefaultSettings());
  try {
    const motion = { ...state.snapshot().settings.character.simple.motion, enabled: false };
    await Promise.all([
      state.updateCharacterMotion(motion),
      state.updateCharacterAsset('closed', '/assets/closed.png', dimensions),
      state.updateCharacterOptions({ windowBounds: { width: 500, height: 600 }, windowVisible: true }),
      state.updateCharacterOptions({ settingsWindowBounds: { width: 800, height: 900 } }),
      state.updateCharacterOptions({ alwaysOnTop: false, clickThrough: true }),
      state.updateCharacterAsset('open', '/assets/open.png', dimensions),
    ]);
    expect(state.snapshot().settings.character).toMatchObject({ alwaysOnTop: false, clickThrough: true, windowVisible: true,
      windowBounds: { width: 500, height: 600 }, settingsWindowBounds: { width: 800, height: 900 },
      simple: { closedAsset: '/assets/closed.png', openAsset: '/assets/open.png', motion } });
    await state.updateCharacterAsset('open', null, dimensions);
    expect(state.snapshot().settings.character.simple).toEqual({ closedAsset: '/assets/closed.png', openAsset: null, motion });
    await state.updateCharacterAsset('closed', null, dimensions);
    expect(state.snapshot().settings.character.simple).toEqual({ closedAsset: null, openAsset: null, motion });
  } finally { state.dispose(); }
});

it('口開き保存時に最新の閉口画像と寸法を照合し、解除後の古い登録も拒否する', async () => {
  const state = new AppState(createDefaultSettings());
  try {
    await state.updateCharacterAsset('closed', '/assets/closed.png', dimensions);
    await state.updateCharacterAsset('open', '/assets/open.png', dimensions);
    const closed = state.updateCharacterAsset('closed', '/assets/large.png', dimensions);
    const open = state.updateCharacterAsset('open', '/assets/open.png', dimensions);
    await closed;
    await expect(open).rejects.toThrow('幅・高さ');
    expect(state.snapshot().settings.character.simple).toMatchObject({ closedAsset: '/assets/large.png', openAsset: null });
    expect(state.snapshot().character.assetWarning).toContain('寸法不一致');
    await state.updateCharacterAsset('closed', null, dimensions);
    await expect(state.updateCharacterAsset('open', '/assets/open.png', dimensions)).rejects.toThrow();
    expect(state.snapshot().settings.character.simple).toMatchObject({ closedAsset: null, openAsset: null });
  } finally { state.dispose(); }
});

it('素材の永続保存失敗では参照と警告を保持し、再試行後に解除する', async () => {
  const persist = vi.fn(async () => undefined);
  const state = new AppState(createDefaultSettings(), { saveSettings: persist });
  try {
    await state.updateCharacterAsset('closed', '/assets/closed.png', dimensions);
    state.setCharacterAssetWarning('画像を確認してください。');
    const before = state.snapshot().settings.character;
    persist.mockRejectedValueOnce(new Error('保存失敗'));
    await expect(state.updateCharacterAsset('closed', '/assets/new.png', dimensions)).rejects.toThrow('保存失敗');
    expect(state.snapshot().settings.character).toEqual(before);
    expect(state.snapshot().character.assetWarning).toBe('画像を確認してください。');
    await state.updateCharacterAsset('closed', '/assets/new.png', dimensions);
    expect(state.snapshot().settings.character.simple.closedAsset).toBe('/assets/new.png');
    expect(state.snapshot().character.assetWarning).toBeNull();
    await expect(state.updateCharacterOptions({ simple: {} })).rejects.toThrow('項目');
  } finally { state.dispose(); }
});
