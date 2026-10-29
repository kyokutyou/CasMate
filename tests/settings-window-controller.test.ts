import { describe, expect, it, vi } from 'vitest';
import { SettingsWindowController, type SettingsWindow } from '../src/main/settings-window-controller';

describe('簡易キャラクター設定ウィンドウ', () => {
  it('単一ウィンドウを再利用し、閉じる操作では位置を保存して非表示にする', async () => {
    const listeners = new Map<string, (event?: { preventDefault(): void }) => void>();
    const window = {
      show: vi.fn(), hide: vi.fn(), destroy: vi.fn(), focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 10, y: 20, width: 760, height: 700 })),
      on: vi.fn((event: string, listener: (event?: { preventDefault(): void }) => void) => listeners.set(event, listener)),
    } as unknown as SettingsWindow;
    const create = vi.fn(() => window);
    const saveBounds = vi.fn(async () => undefined);
    const controller = new SettingsWindowController({ create, saveBounds });

    await controller.show();
    await controller.show();
    expect(create).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledTimes(2);

    const preventDefault = vi.fn();
    listeners.get('close')?.({ preventDefault });
    await vi.waitFor(() => expect(window.hide).toHaveBeenCalledOnce());
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(saveBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 760, height: 700 });
  });

  it('位置保存に失敗しても閉じる操作で非表示にする', async () => {
    let close: ((event: { preventDefault(): void }) => void) | undefined;
    const window = {
      show: vi.fn(), hide: vi.fn(), destroy: vi.fn(), focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 760, height: 700 })),
      on: vi.fn((event: string, listener: (event: { preventDefault(): void }) => void) => {
        if (event === 'close') close = listener;
      }),
    } as unknown as SettingsWindow;
    const controller = new SettingsWindowController({
      create: () => window,
      saveBounds: async () => { throw new Error('保存失敗'); },
    });
    await controller.show();

    close?.({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(window.hide).toHaveBeenCalledOnce());
  });
});
