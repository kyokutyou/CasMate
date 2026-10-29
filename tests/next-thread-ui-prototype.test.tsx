// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prototype } from '../prototypes/next-thread-ui-throwaway/prototype';
afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });
const payload = () => JSON.parse(screen.getByTestId('payload').textContent ?? '{}');
const variant = (key: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${key}`) }));
describe('次スレッド設定の比較見本', () => {
  it('共通見出しを使い、案とタブをまたいで入力を保持する', () => {
    render(<Prototype />);
    expect(screen.getByRole('button', { name: '← 設定に戻る' }).textContent).toBe('←');
    fireEvent.change(screen.getByRole('spinbutton', { name: '作成開始レス番号' }), { target: { value: '960' } });
    variant('B');
    fireEvent.click(screen.getByRole('tab', { name: '投稿内容' }));
    fireEvent.click(screen.getAllByRole('button', { name: '手動で入力' })[0]);
    fireEvent.change(screen.getByLabelText('手動タイトル'), { target: { value: '<script>見本</script>' } });
    variant('C'); variant('A');
    expect(screen.getByLabelText('手動タイトル')).toHaveValue('<script>見本</script>');
    expect(payload().settings.createAt).toBe('960');
    expect(document.querySelector('script')).toBeNull();
    expect(window.location.search).toBe('?variant=A');
  });
  it('自動作成オフでも手動作成でき、二重作成を防ぎ、通知は4秒で消える', () => {
    vi.useFakeTimers(); render(<Prototype />);
    expect(screen.getByRole('switch', { name: '次スレッド自動作成' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: '今すぐ作成' }));
    expect(screen.getByRole('button', { name: '作成中…' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'URLをコピー' })).toBeEnabled();
    expect(document.querySelector('.toast-message')).toHaveTextContent('次スレッドを作成しました');
    act(() => vi.advanceTimersByTime(4000));
    expect(document.querySelector('.toast-message')).toBeNull();
  });
  it('結果不明では送信せず、同じ掲示板のURLを確認して登録する', () => {
    render(<Prototype />);
    fireEvent.change(screen.getByLabelText('状態の見本'), { target: { value: 'uncertain' } });
    expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /結果不明時の確認/ }));
    fireEvent.change(screen.getByLabelText('作成済み次スレッドURL'), { target: { value: 'https://example.com/' } });
    fireEvent.click(screen.getByRole('button', { name: '作成済みURLを登録' }));
    expect(payload().status).toBe('uncertain');
    fireEvent.change(screen.getByLabelText('作成済み次スレッドURL'), { target: { value: 'https://jbbs.shitaraba.net/bbs/read.cgi/radio/12345/1000000001/' } });
    fireEvent.click(screen.getByRole('button', { name: '作成済みURLを登録' }));
    expect(payload().status).toBe('created');
  });
  it('範囲外入力を示し、入力中の矢印で案を切り替えない', () => {
    render(<Prototype />);
    const field = screen.getByRole('spinbutton', { name: '作成開始レス番号' });
    fireEvent.change(field, { target: { value: '0' } });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeDisabled();
    fireEvent.keyDown(field, { key: 'ArrowRight' });
    expect(payload().variant).toBe('A');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(payload().variant).toBe('B');
  });
});
