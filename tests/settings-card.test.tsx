// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsCard } from '../src/renderer/components/SettingsCard';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Card({ id = 'test' }: { id?: string }) {
  return <SettingsCard cardId={id} title={id} eyebrow="TEST" summary="状態" warning="警告">
    <input aria-label={`${id}入力`} defaultValue="初期値" />
  </SettingsCard>;
}

it('初回は開き、閉じても入力を保持して再表示時に開閉状態だけを復元する', () => {
  const view = render(<Card />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '入力途中' } });
  input.focus();
  const close = screen.getByRole('button', { name: 'test：閉じる' });
  fireEvent.click(close);
  expect(close).toHaveFocus();
  expect(input).not.toBeVisible();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText('警告')).toBeVisible();
  expect(screen.getByText('状態')).toBeVisible();
  fireEvent.click(close);
  expect(input).toHaveValue('入力途中');
  fireEvent.click(close);
  view.unmount();
  render(<Card />);
  expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
});

it('複数画面の別カード操作が保存内容や開いている画面に干渉しない', () => {
  const first = render(<Card />);
  const second = render(<><Card /><Card id="other" /></>);
  fireEvent.click(first.container.querySelector('button')!);
  expect(second.container.querySelector('button')).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'other：閉じる' }));
  expect(localStorage.getItem('casmate.management.cards.test')).toBe('false');
  expect(localStorage.getItem('casmate.management.cards.other')).toBe('false');
});

it.each(['broken', 'null', '0', '{}', 'true'])('保存値 %s は開いて表示する', (value) => {
  localStorage.setItem('casmate.management.cards.test', value);
  render(<Card />);
  expect(screen.getByRole('textbox')).toBeVisible();
});

it('保存領域が利用できなくてもキーボードで開閉できる', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  const user = userEvent.setup();
  render(<Card />);
  await user.tab();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await user.keyboard(' ');
  expect(screen.getByRole('textbox')).toBeVisible();
});
