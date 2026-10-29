// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prototype } from '../prototypes/obs-control-ui-throwaway/prototype';
beforeEach(() => vi.stubEnv('DEV', true));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); window.history.replaceState(null, '', '/'); });
const choose = (value: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${value}`) }));
describe('OBS操作の比較見本', () => {
  it('共通見出しを使い、案・タブ・戻る操作で未適用値を保持する', () => {
    render(<Prototype />);
    expect(screen.getByRole('button', { name: '← 設定に戻る' }).textContent).toBe('←');
    fireEvent.change(screen.getByLabelText('OBS WebSocketポート'), { target: { value: '4456' } });
    choose('B');
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(screen.getAllByLabelText('① 指示するフレーズ')[0], { target: { value: '配信を始めます' } });
    choose('C'); choose('A');
    fireEvent.click(screen.getByRole('button', { name: '← 設定に戻る' }));
    fireEvent.click(screen.getByRole('button', { name: /設定を開く/ }));
    expect(screen.getByLabelText('OBS WebSocketポート')).toHaveValue(4456);
    expect(screen.getAllByLabelText('① 指示するフレーズ')[0]).toHaveValue('配信を始めます');
    expect(screen.getByText('未適用の変更があります')).toBeVisible();
  });
  it('重複フレーズを拒否し、適用中の追加入力を上書きしない', () => {
    vi.useFakeTimers(); render(<Prototype />);
    const commands = screen.getAllByLabelText('① 指示するフレーズ');
    fireEvent.change(commands[1], { target: { value: 'きゃすメイト 配信開始' } });
    fireEvent.click(screen.getByRole('button', { name: 'この設定を適用' }));
    expect(screen.getByText(/1件の入力を確認/)).toBeVisible();
    fireEvent.change(commands[1], { target: { value: 'きゃすメイト、配信終了' } });
    fireEvent.change(screen.getByLabelText('OBS WebSocketポート'), { target: { value: '4456' } });
    fireEvent.click(screen.getByRole('button', { name: 'この設定を適用' }));
    expect(screen.getByRole('button', { name: '適用中…' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(screen.getByLabelText('OBS WebSocketポート'), { target: { value: '4457' } });
    act(() => vi.advanceTimersByTime(650));
    expect(screen.getByLabelText('OBS WebSocketポート')).toHaveValue(4457);
    expect(screen.getByText('未適用の変更があります')).toBeVisible();
    expect(document.querySelector('.toast-message')).toHaveTextContent('適用しました');
    act(() => vi.advanceTimersByTime(4000));
    expect(document.querySelector('.toast-message')).toBeNull();
  });
  it('音声確認は10秒で失効し、結果不明では再送操作を提供しない', () => {
    vi.useFakeTimers(); render(<Prototype />);
    fireEvent.click(screen.getByText('状態の見本・内部状態を確認'));
    fireEvent.change(screen.getByLabelText('状態'), { target: { value: 'confirming' } });
    expect(screen.getByRole('button', { name: '確認を取り消す' })).toBeEnabled();
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('button', { name: '確認を取り消す' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('状態'), { target: { value: 'unknown' } });
    expect(within(screen.getByLabelText('OBSの現在状態')).getByText(/結果不明/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /配信を開始|再送/ })).toBeNull();
  });
});
