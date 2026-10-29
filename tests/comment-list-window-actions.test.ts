import { describe, expect, it, vi } from 'vitest';
import { handleCommentListWindowOpen } from '../src/shared/comment-list-window-actions';

describe('独立コメント一覧ウィンドウの外部操作', () => {
  it('最前面コマンドだけをウィンドウへ適用する', () => {
    const setAlwaysOnTop = vi.fn();
    const openExternal = vi.fn();

    handleCommentListWindowOpen(
      'casmate-comment-list://always-on-top/on',
      setAlwaysOnTop,
      openExternal,
    );

    expect(setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('HTTPリンクだけを既定ブラウザへ渡し危険なスキームを無視する', () => {
    const setAlwaysOnTop = vi.fn();
    const openExternal = vi.fn();

    handleCommentListWindowOpen('https://example.com/path', setAlwaysOnTop, openExternal);
    handleCommentListWindowOpen('javascript:alert(1)', setAlwaysOnTop, openExternal);

    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/path');
    expect(setAlwaysOnTop).not.toHaveBeenCalled();
  });
});
