// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterPrototype } from '../prototypes/comment-filter-ui-throwaway/prototype';

function choose(variant: string) {
  fireEvent.click(within(screen.getByRole('group', { name: 'デザイン案を比較' })).getByRole('button', { name: new RegExp(`^${variant}`) }));
}
function state() {
  const element = document.querySelector('.cf-debug pre');
  if (!element?.textContent) throw new Error('Missing prototype state');
  return JSON.parse(element.textContent);
}
beforeEach(() => {
  window.history.replaceState(null, '', '/?variant=A');
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('コメントフィルターの比較見本', () => {
  it('3案と設定一覧の往復で入力を維持し、URLに選択を反映する', () => {
    render(<FilterPrototype />);
    fireEvent.change(screen.getByLabelText('NGワード（1行1件）'), { target: { value: '編集途中\n ＳＰＡＭ \nspam' } });
    choose('B');
    expect(window.location.search).toBe('?variant=B');
    expect(screen.getByText('編集途中')).toBeTruthy();
    expect(state().draft.ngWords).toEqual(['編集途中', 'ＳＰＡＭ']);
    choose('C');
    expect(screen.getByLabelText('NGワード（1行1件）')).toHaveValue('編集途中\n ＳＰＡＭ \nspam');
    fireEvent.click(screen.getByRole('button', { name: '設定一覧へ戻る' }));
    fireEvent.click(screen.getByRole('button', { name: /◇ コメントフィルター/ }));
    expect(screen.getByLabelText('NGワード（1行1件）')).toHaveValue('編集途中\n ＳＰＡＭ \nspam');
  });
  it('本体の判定に従って投稿者名・部分一致・顔文字・複数行アートを確認できる', () => {
    render(<FilterPrototype />);
    expect(screen.getByText('⊘ このコメントは除外されます')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '通常文', exact: true }));
    expect(screen.getByText('✓ このコメントは通過します')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('投稿者名'), { target: { value: 'ＳＰＡＭ太郎' } });
    expect(screen.getByText('NGワード「spam」に一致')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'アート', exact: true }));
    expect(screen.getByText('複数行のアスキーアートに該当')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'アスキーアート判定' }));
    expect(screen.getByText('✓ このコメントは通過します')).toBeTruthy();
  });
  it('500ms後の自動反映、スイッチの即時反映、ヘッダートーストの4秒消去を維持する', () => {
    render(<FilterPrototype />);
    const field = screen.getByLabelText('NGワード（1行1件）');
    field.focus();
    fireEvent.change(field, { target: { value: '新しい語句' } });
    act(() => vi.advanceTimersByTime(499));
    expect(state().applied.ngWords).not.toContain('新しい語句');
    fireEvent.click(screen.getByRole('checkbox', { name: 'アスキーアート判定' }));
    expect(state().applied.asciiArtEnabled).toBe(false);
    expect(state().applied.ngWords).not.toContain('新しい語句');
    act(() => vi.advanceTimersByTime(500));
    expect(state().applied.ngWords).toEqual(['新しい語句']);
    expect(document.activeElement).toBe(field);
    expect(document.querySelector('.cf-header .cf-toast')).not.toHaveAttribute('hidden');
    act(() => vi.advanceTimersByTime(4000));
    expect(document.querySelector('.cf-toast')).toHaveAttribute('hidden');
  });
  it('保存失敗で入力と適用済み設定を保持し、再試行できる', () => {
    render(<FilterPrototype />);
    fireEvent.change(screen.getByLabelText('比較する状態'), { target: { value: 'failure' } });
    fireEvent.change(screen.getByLabelText('NGワード（1行1件）'), { target: { value: '未保存の語句' } });
    act(() => vi.advanceTimersByTime(500));
    expect(state().applied.ngWords).toContain('ネタバレ');
    expect(state().draft.ngWords).toEqual(['未保存の語句']);
    expect(screen.getByRole('button', { name: '⚠ 要確認 1件' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '⚠ 要確認 1件' }));
    fireEvent.click(screen.getByRole('button', { name: '復旧して再試行（見本）' }));
    expect(state().applied.ngWords).toEqual(['未保存の語句']);
    expect(state().unsaved).toBe(false);
  });
  it('B案で重複を防いで追加・検索・削除できる', () => {
    render(<FilterPrototype />); choose('B');
    fireEvent.change(screen.getByLabelText('NGワードを追加'), { target: { value: 'ＳＰＡＭ' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ 追加' }));
    expect(screen.getByText('同じNGワードが登録されています。')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('NGワードを追加'), { target: { value: '追加語句' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ 追加' }));
    fireEvent.change(screen.getByLabelText('登録済みを検索'), { target: { value: '追加' } });
    expect(screen.queryByRole('button', { name: 'spamを削除' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '追加語句を削除' }));
    expect(screen.getByText('一致する登録がありません。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'まとめて編集' }));
    expect(screen.getByLabelText('NGワード（1行1件）')).toHaveValue('ネタバレ\n宣伝です\nspam');
  });
  it('C案の手順と未登録・大量登録の状態を確認できる', () => {
    render(<FilterPrototype />); choose('C');
    fireEvent.change(screen.getByLabelText('比較する状態'), { target: { value: 'empty' } });
    expect(state().draft.ngWords).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '次へ →' }));
    expect(screen.getByRole('checkbox', { name: 'アスキーアート判定' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '次へ →' }));
    expect(screen.getByLabelText('コメント本文')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('比較する状態'), { target: { value: 'many' } });
    expect(state().draft.ngWords).toHaveLength(60);
  });
  it('入力中の矢印キーは案を切り替えず、比較操作の矢印は循環する', () => {
    render(<FilterPrototype />);
    fireEvent.keyDown(screen.getByLabelText('NGワード（1行1件）'), { key: 'ArrowRight' });
    expect(state().variant).toBe('A');
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(state().variant).toBe('C');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(state().variant).toBe('A');
  });
});
