// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSnapshot } from '../src/shared/types';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
const mocks = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null,
  mutate: vi.fn<(...args: unknown[]) => Promise<unknown>>(), updateSettings: vi.fn(async () => undefined),
  listSpeechVoices: vi.fn(async () => []), sourceAction: vi.fn(async () => undefined),
}));
vi.mock('../src/renderer/api', () => ({ useApplicationState: () => ({ ...mocks, connected: true, error: null }) }));
vi.mock('../src/renderer/windows-fonts', () => ({ loadWindowsFonts: async () => [] }));
import { Dashboard } from '../src/renderer/pages/Dashboard';
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.snapshot = obsRegistrationSnapshot();
  mocks.snapshot.updateNotices = [{ id: 'a'.repeat(64), source: 'smartphone', message: '受信方式を更新しました。共通QRで再登録してください。' }];
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

it('更新案内の確認だけを管理APIへ送り、成功後に開いた一覧と共通トーストへ反映する', async () => {
  mocks.mutate.mockImplementation(async () => { mocks.snapshot = { ...mocks.snapshot!, updateNotices: [] }; });
  render(<Dashboard />); fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
  const dialog = screen.getByRole('dialog'); const confirm = within(dialog).getByRole('button', { name: '案内を確認した' }); confirm.focus();
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.getByRole('button', { name: '要確認 0件' })).toBeVisible());
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith('/api/management/update-notices/acknowledge', 'POST', { id: 'a'.repeat(64) });
  expect(dialog).toBeVisible(); expect(within(dialog).getByRole('button', { name: '閉じる' })).toHaveFocus();
  expect(screen.getByRole('region', { name: '通知' })).toHaveTextContent('更新案内を確認済みにしました。');
});

it('確認保存の失敗は要確認へ集約し、元の案内を維持して再試行できる', async () => {
  mocks.mutate.mockRejectedValue(new Error('確認済みを保存できませんでした。'));
  render(<Dashboard />); fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
  const dialog = screen.getByRole('dialog'); const confirm = within(dialog).getByRole('button', { name: '案内を確認した' });
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.getByRole('button', { name: '要確認 2件' })).toBeVisible());
  expect(within(dialog).getByText('確認済みを保存できませんでした。')).toBeVisible();
  expect(within(dialog).getByText(mocks.snapshot!.updateNotices![0].message)).toBeVisible();
  expect(confirm).toBeEnabled(); expect(screen.getByRole('region', { name: '通知' })).toBeEmptyDOMElement();
});
