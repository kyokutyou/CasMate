import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LivePrototype } from './prototype';

beforeEach(() => {
  history.replaceState(null, '', '/?variant=A');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterEach(cleanup);

it('案を変えても操作状態と新着コメントを保持し、URLに選択を反映する', () => {
  render(<LivePrototype />);
  fireEvent.click(screen.getByRole('switch', { name: 'コメント読み上げ' }));
  fireEvent.click(screen.getByRole('button', { name: '＋ 1件' }));
  expect(screen.getByRole('region', { name: 'コメント一覧' })).toHaveTextContent('25件');
  fireEvent.click(screen.getByRole('button', { name: /B\s*操作を左に常設/ }));
  expect(new URLSearchParams(location.search).get('variant')).toBe('B');
  expect(screen.getByRole('switch', { name: 'コメント読み上げ' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('region', { name: 'コメント一覧' })).toHaveTextContent('25件');
  fireEvent.click(screen.getByRole('button', { name: /C\s*コメントを広く/ }));
  expect(screen.getByRole('switch', { name: 'コメント読み上げ' })).toHaveAttribute('aria-checked', 'false');
});

it('未接続の空状態からサービスを個別に接続すると、新着待ちの案内へ進める', () => {
  render(<LivePrototype />);
  fireEvent.change(screen.getByLabelText('見本の状態を切り替える'), { target: { value: 'empty' } });
  expect(screen.getByRole('button', { name: '＋ 1件' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'コメントの接続を開く' }));
  fireEvent.click(screen.getByRole('switch', { name: 'YouTube Liveのコメント取得' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '閉じる' }));
  expect(screen.getByText('新着コメントを待っています')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'コメントを1件受け取る' }));
  expect(screen.getByRole('region', { name: 'コメント一覧' })).toHaveTextContent('1件');
});

it('AI確認待ちをスイッチで即時再開せず、理由を確認して明示再開する', () => {
  render(<LivePrototype />);
  fireEvent.change(screen.getByLabelText('見本の状態を切り替える'), { target: { value: 'attention' } });
  fireEvent.click(screen.getByRole('switch', { name: 'AIリスナー' }));
  const modal = screen.getByRole('dialog');
  expect(modal).toHaveTextContent('投稿先の連携を確認してください');
  expect(screen.getByRole('switch', { name: 'AIリスナー' })).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(within(modal).getByRole('button', { name: '確認して再開する（見本）' }));
  expect(screen.getByRole('switch', { name: 'AIリスナー' })).toHaveAttribute('aria-checked', 'true');
});
