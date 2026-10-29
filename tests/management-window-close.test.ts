import { describe, expect, it, vi } from 'vitest';
import { requestQuitFromManagementWindow } from '../src/main/management-window-close';

describe('管理画面の終了要求', () => {
  it('管理画面を閉じると確認を挟まずアプリ終了を要求する', () => {
    const preventDefault = vi.fn();
    const quit = vi.fn();

    requestQuitFromManagementWindow(false, { preventDefault }, quit);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('終了処理中の管理画面には新しい終了要求を出さない', () => {
    const preventDefault = vi.fn();
    const quit = vi.fn();

    requestQuitFromManagementWindow(true, { preventDefault }, quit);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });
});
