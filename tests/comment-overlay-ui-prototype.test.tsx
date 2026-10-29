// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prototype } from '../prototypes/comment-overlay-ui-throwaway/prototype';
afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });
const payload = () => JSON.parse(screen.getByTestId('payload').textContent ?? '{}');
const choose = (key: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${key}`) }));
const advance = (ms = 500) => act(() => vi.advanceTimersByTime(ms));
describe('OBSコメント表示の比較見本', () => {
  it('3案で共通見出しを使用し、範囲外の入力と有効値を画面移動後も保持する', () => {
    vi.useFakeTimers(); render(<Prototype />);
    expect(screen.getByRole('button', { name: '← 設定に戻る' }).textContent).toBe('←');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByLabelText('積み上げ表示時間'), { target: { value: '61' } }); advance();
    expect(payload().saved.stackTime).toBe('10');
    choose('B'); expect(screen.getByLabelText('積み上げ表示時間')).toHaveValue(61);
    choose('C'); expect(screen.getByLabelText('積み上げ表示時間')).toHaveValue(61);
    fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: /OBSコメント表示/ }));
    expect(screen.getByLabelText('積み上げ表示時間')).toHaveValue(61);
    fireEvent.change(screen.getByLabelText('積み上げ表示時間'), { target: { value: '60' } }); advance();
    expect(payload().saved.stackTime).toBe('60');
    expect(screen.getByRole('button', { name: /要確認 0件/ })).toBeVisible();
  });
  it('表示時間を独立して保持し、読み上げ中の1件表示時間を無効にする', () => {
    vi.useFakeTimers(); render(<Prototype />);
    fireEvent.change(screen.getByLabelText('積み上げ表示時間'), { target: { value: '25' } }); advance();
    fireEvent.click(screen.getByRole('button', { name: /^1件ずつ/ }));
    expect(screen.getByLabelText('1件表示時間')).toHaveValue(10);
    fireEvent.click(screen.getByLabelText('コメント読み上げがオンの状態'));
    expect(screen.getByLabelText('1件表示時間')).toBeDisabled();
    expect(payload().saved.singleTime).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: /^積み上げ/ }));
    expect(screen.getByLabelText('積み上げ表示時間')).toHaveValue(25);
    expect(screen.getByLabelText('積み上げ表示時間')).toBeEnabled();
  });
  it('全項目非表示を拒否し、保存失敗では入力と反映済みの値を分ける', async () => {
    vi.useFakeTimers(); render(<Prototype />);
    for (const name of ['サービス名', '投稿者名', '本文']) await act(async () => fireEvent.click(screen.getByRole('switch', { name })));
    expect(payload().saved.body).toBe(true); expect(payload().fieldError).toBe(true);
    expect(screen.getByRole('button', { name: /要確認 1件/ })).toBeVisible();
    fireEvent.click(screen.getByLabelText('保存に失敗する状態'));
    fireEvent.change(screen.getByLabelText('文字サイズ'), { target: { value: '48' } }); advance();
    expect(payload().draft.size).toBe('48'); expect(payload().saved.size).toBe('32');
    advance(5000); expect(payload().saveError).toBe(true);
    fireEvent.click(screen.getByLabelText('保存に失敗する状態')); advance();
    expect(payload().saved.size).toBe('32');
    fireEvent.change(screen.getByLabelText('文字サイズ'), { target: { value: '49' } }); advance();
    expect(payload().saved.size).toBe('49'); expect(payload().saveError).toBe(false);
  });
  it('通知をヘッダーへ集約して4秒で置換消去し、タブ操作と案切替を分ける', () => {
    vi.useFakeTimers(); render(<Prototype />);
    fireEvent.click(screen.getByRole('button', { name: '成功通知', exact: true }));
    expect(document.querySelector('.management-header .toast-message')).toBeInTheDocument();
    advance(3000); fireEvent.click(screen.getByRole('button', { name: '長文通知' }));
    advance(3000); expect(document.querySelectorAll('.toast-message')).toHaveLength(1);
    advance(1000); expect(document.querySelector('.toast-message')).toBeNull();
    fireEvent.keyDown(screen.getByLabelText('文字サイズ'), { key: 'ArrowRight' });
    expect(payload().variant).toBe('A');
    fireEvent.keyDown(window, { key: 'ArrowRight' }); expect(payload().variant).toBe('B');
    fireEvent.keyDown(screen.getByRole('tab', { name: '表示', exact: true }), { key: 'ArrowRight' });
    expect(payload().variant).toBe('B'); expect(screen.getByRole('tab', { name: '外観' })).toHaveFocus();
    expect(window.location.search).toBe('?variant=B');
  });
});
