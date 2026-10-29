// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prototype } from '../prototypes/text-effects-ui-throwaway/prototype';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, writable: true, value() {} });
  if (!HTMLDialogElement.prototype.close) Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, writable: true, value() {} });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });
const payload = () => JSON.parse(screen.getByTestId('payload').textContent ?? '{}');
const switchTo = (key: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${key}`) }));
const editFirst = () => fireEvent.click(screen.getAllByRole('button', { name: '編集 →' })[0]);

describe('コメント文字演出の3案比較見本', () => {
  it('共通見出しを使い、3案と画面移動で未入力・保存待ちを保持する', () => {
    vi.useFakeTimers(); render(<Prototype />);
    expect(screen.getByRole('button', { name: '← 設定に戻る' }).textContent).toBe('←');
    editFirst(); fireEvent.change(screen.getByLabelText(/^表示文字/), { target: { value: '笑' } });
    expect(payload().saved.rules[0].displayText).toBe('草');
    switchTo('B'); expect(screen.getByLabelText(/^表示文字/)).toHaveValue('笑');
    switchTo('C'); fireEvent.click(screen.getByRole('button', { name: /2表示する文字/ }));
    expect(screen.getByLabelText(/^表示文字/)).toHaveValue('笑');
    fireEvent.click(screen.getByRole('button', { name: '← 設定に戻る' }));
    fireEvent.click(screen.getByRole('button', { name: /コメント文字演出/ }));
    expect(screen.getByLabelText(/^表示文字/)).toHaveValue('笑');
    act(() => vi.advanceTimersByTime(500)); expect(payload().saved.rules[0].displayText).toBe('笑');
    expect(window.location.search).toBe('?variant=C');
  });

  it('不正な色を保持し、テスト再生は直前の有効な設定を使う', () => {
    vi.useFakeTimers(); render(<Prototype />); editFirst();
    fireEvent.change(screen.getByLabelText(/^色/), { target: { value: 'invalid' } });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByLabelText(/^色/)).toHaveValue('invalid');
    expect(screen.getByLabelText(/^色/)).toHaveAttribute('aria-invalid', 'true');
    expect(payload().saved.rules[0].color).toBe('#66CC66FF');
    screen.getByRole('button', { name: 'wのテスト再生' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'wのテスト再生' }));
    expect(screen.getByRole('dialog', { name: 'テスト再生（見本内）' })).toBeVisible();
    expect(document.querySelectorAll('.te-particle')).toHaveLength(2);
    expect(document.querySelector('.te-particle')).toHaveStyle({ color: '#66CC66FF' });
    fireEvent.click(screen.getByRole('button', { name: '閉じる', exact: true }));
    expect(screen.getByRole('button', { name: 'wのテスト再生' })).toHaveFocus();
  });

  it('連動型にできない反応ワードでは方式を戻し、入力エラーを知らせる', () => {
    render(<Prototype />); fireEvent.click(screen.getAllByRole('button', { name: '編集 →' })[1]);
    fireEvent.change(screen.getByLabelText(/^個数方式/), { target: { value: 'consecutive' } });
    expect(screen.getByLabelText(/^個数方式/)).toHaveValue('fixed');
    expect(payload().saved.rules[1].countMode).toBe('fixed');
    expect(screen.getByRole('alert')).toHaveTextContent('反応ワードを1文字');
  });

  it('新規ルールは追加操作で反映し、並び替えと確認付き削除を行う', () => {
    render(<Prototype />); fireEvent.click(screen.getByRole('button', { name: '＋ ルールを追加' }));
    expect(screen.getByRole('button', { name: '追加', exact: true })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^反応ワード/), { target: { value: 'ありがとう' } });
    expect(payload().saved.rules).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '追加', exact: true }));
    expect(payload().saved.rules).toHaveLength(4);
    expect(screen.getByRole('button', { name: '↓ 下へ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '↑ 上へ' }));
    expect(payload().saved.rules[2].trigger).toBe('ありがとう');
    fireEvent.click(screen.getByRole('button', { name: 'ありがとうを削除' }));
    expect(payload().saved.rules).toHaveLength(4);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル' }));
    expect(payload().saved.rules).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'ありがとうを削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    expect(payload().saved.rules).toHaveLength(3);
  });

  it('全体オフ・個別オフでも保存済みルールのテスト再生ができる', async () => {
    render(<Prototype />);
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'コメント文字演出' })));
    expect(payload().saved.enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'おめでとうのテスト再生' }));
    expect(document.querySelectorAll('.te-particle')).toHaveLength(8);
  });

  it('50件の上限・空状態と、保存失敗時の値の保持を再現する', () => {
    vi.useFakeTimers(); render(<Prototype />);
    fireEvent.change(screen.getByLabelText('状態の見本'), { target: { value: 'many' } });
    expect(screen.getByRole('button', { name: '＋ ルールを追加' })).toBeDisabled();
    expect(payload().saved.rules).toHaveLength(50);
    fireEvent.change(screen.getByLabelText('状態の見本'), { target: { value: 'empty' } });
    expect(screen.getByText('最初の反応をつくりましょう')).toBeVisible();
    fireEvent.change(screen.getByLabelText('状態の見本'), { target: { value: 'failure' } });
    editFirst(); fireEvent.change(screen.getByLabelText(/^表示文字/), { target: { value: '笑' } });
    act(() => vi.advanceTimersByTime(500));
    expect(payload().failure).toBe(true); expect(payload().draft.rules[0].displayText).toBe('笑');
    expect(payload().saved.rules[0].displayText).toBe('草');
    fireEvent.click(screen.getByRole('button', { name: /要確認/ }));
    expect(screen.getByText(/保存に失敗しました/)).toBeVisible();
  });

  it('成功通知はヘッダーに置換表示し、最後の通知から4秒で消す', () => {
    vi.useFakeTimers(); render(<Prototype />); editFirst();
    fireEvent.change(screen.getByLabelText(/^表示文字/), { target: { value: '笑' } });
    act(() => vi.advanceTimersByTime(500));
    expect(document.querySelector('.management-header .toast-message')).toHaveTextContent('設定を反映しました');
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.change(screen.getByLabelText(/^表示文字/), { target: { value: '草' } });
    act(() => vi.advanceTimersByTime(500));
    act(() => vi.advanceTimersByTime(3999)); expect(document.querySelector('.toast-message')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1)); expect(document.querySelector('.toast-message')).toBeNull();
  });

  it('矢印キーは入力欄とモーダルの操作を妨げない', () => {
    render(<Prototype />); editFirst();
    fireEvent.keyDown(screen.getByLabelText(/^反応ワード/), { key: 'ArrowRight' });
    expect(payload().variant).toBe('A');
    fireEvent.keyDown(window, { key: 'ArrowRight' }); expect(payload().variant).toBe('B');
    fireEvent.click(screen.getByRole('button', { name: 'wのテスト再生' }));
    fireEvent.keyDown(window, { key: 'ArrowRight' }); expect(payload().variant).toBe('B');
  });
});
