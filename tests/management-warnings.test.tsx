// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManagementShell, type ManagementWarning } from '../src/renderer/components/ManagementShell';

const warnings: ManagementWarning[] = [
  { id: 'outdoor', message: '状態報告の待受を利用できません。' },
  { id: 'obsControl', message: 'OBS操作を完了できません。' },
  { id: 'obsControl', key: 'publication', message: 'TailscaleのIPv4アドレスを取得できません。' },
  { id: 'mobileSpeech', message: 'Tailscaleサービスが停止しています。' },
];
const shell = (items = warnings, error?: string) => <ManagementShell connected pcStatus={null} warnings={items} activities={[]}
  operationNotice={error ? { message: error, tone: 'error' } : undefined}
  home={<button>ホームの操作</button>} windows={null}>{null}</ManagementShell>;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

it('更新案内を確認済みにでき、通常の接続警告には確認済み操作を付けない', async () => {
  const acknowledge = vi.fn(async () => undefined);
  render(<ManagementShell connected pcStatus={null} warnings={[warnings[0]]} activities={[]}
    updateNotices={[{ key: 'migration', message: '共通QRで再登録してください。', onAcknowledge: acknowledge }]}
    home={null} windows={null}>{null}</ManagementShell>);
  fireEvent.click(screen.getByRole('button', { name: '要確認 2件' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '案内を確認した' }));
  expect(acknowledge).toHaveBeenCalledOnce();
  expect(within(dialog).getAllByRole('button', { name: /案内を確認した/ })).toHaveLength(1);
  expect(dialog).toBeVisible();
});

it('未確認の更新案内も設定入口に表示し、案内本文から該当設定へ移動できる', () => {
  render(<ManagementShell connected pcStatus={null} warnings={[]} activities={[]}
    updateNotices={[{ key: 'migration', owner: 'smartphone', message: '共通QRで再登録してください。', onAcknowledge: async () => undefined }]}
    home={null} windows={null}>{null}</ManagementShell>);
  expect(screen.getByRole('button', { name: /スマホ連携/ })).toHaveTextContent('要確認');
  fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /共通QRで再登録/ }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('heading', { name: 'スマホ連携' })).toBeVisible();
});

it('小型表示でも接続済みと再接続中の状態名を支援技術へ伝える', () => {
  const show = (connected: boolean) => <ManagementShell connected={connected} pcStatus={null} warnings={[]} activities={[]}
    home={null} windows={null}>{null}</ManagementShell>;
  const view = render(show(true));
  fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
  expect(screen.getByRole('status', { name: 'アプリ接続済み' })).toBeVisible();
  view.rerender(show(false));
  expect(screen.getByRole('status', { name: 'アプリに再接続中' })).toBeVisible();
});

it('成功通知はヘッダーで1件を置換し、長文の全文と操作中のフォーカスを維持する', () => {
  const show = (message?: string) => <ManagementShell connected pcStatus={null} warnings={[]} activities={[]}
    operationNotice={message ? { message, tone: 'success' } : undefined}
    home={<button>ホームの操作</button>} windows={null}>{null}</ManagementShell>;
  const view = render(show());
  const notice = screen.getByRole('region', { name: '通知' });
  expect(notice.closest('header')).toHaveClass('management-header');
  const action = screen.getByRole('button', { name: 'ホームの操作' }); action.focus();
  view.rerender(show('試聴を再生しました。'));
  expect(notice).toHaveTextContent('試聴を再生しました。');
  const long = '設定を保存しました。'.repeat(30);
  view.rerender(show(long));
  expect(notice).not.toHaveTextContent('試聴を再生しました。');
  expect(within(notice).getByText(long)).toHaveAttribute('title', long);
  expect(action).toHaveFocus();
  view.rerender(show()); expect(notice).toBeEmptyDOMElement(); expect(action).toHaveFocus();
});

it('複数警告があっても一覧を自動表示せず、閉じた後も件数と入口の要確認を保持する', () => {
  render(shell());
  const entry = screen.getByRole('button', { name: '要確認 4件' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('region', { name: '通知' })).toBeEmptyDOMElement();
  expect(screen.getByRole('button', { name: 'ホームの操作' })).toBeVisible();
  expect(screen.getByRole('button', { name: /スマホ連携/ })).toHaveTextContent('要確認');
  fireEvent.click(entry);
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
  expect(entry).toHaveFocus(); expect(entry).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(entry).toHaveTextContent('要確認 4件');
  fireEvent.click(entry);
  expect(within(screen.getByRole('dialog')).getByText(warnings[0].message)).toBeVisible();
});

it('Escで閉じ、TabとShift+Tabが警告一覧の外へ抜けない', () => {
  render(shell()); const entry = screen.getByRole('button', { name: '要確認 4件' }); fireEvent.click(entry);
  const dialog = screen.getByRole('dialog'); const close = within(dialog).getByRole('button', { name: '閉じる' });
  const last = within(dialog).getAllByRole('button').at(-1)!;
  close.focus(); fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: 'Tab' }); expect(close).toHaveFocus();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(entry).toHaveFocus(); expect(screen.queryByRole('dialog')).toBeNull();
});

it('警告の増減は一覧を自動で開かず、開いている一覧は全件解消を反映する', () => {
  const view = render(shell([])); const entry = screen.getByRole('button', { name: '要確認 0件' });
  view.rerender(shell()); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(entry); const dialog = screen.getByRole('dialog');
  within(dialog).getAllByRole('button').at(-1)!.focus();
  view.rerender(shell([]));
  expect(entry).toHaveTextContent('要確認 0件');
  expect(within(dialog).getByText('現在、要確認事項はありません。')).toBeVisible();
  expect(within(dialog).getByRole('button', { name: '閉じる' })).toHaveFocus();
});

it('同じ機能の同一警告と操作失敗を重複して数えない', () => {
  render(shell([...warnings, warnings[0]], warnings[0].message));
  fireEvent.click(screen.getByRole('button', { name: '要確認 4件' }));
  expect(within(screen.getByRole('dialog')).getAllByText(warnings[0].message)).toHaveLength(1);
});

it('異なる保存設定の同じエラー文は別件にし、同じsources設定の失敗だけまとめる', () => {
  render(shell([
    { id: 'sources', key: 'save', message: '保存できません。' },
    { id: 'nextThread', key: 'save', message: '保存できません。' },
    { id: 'commentSpeech', key: 'save', message: '保存できません。' },
  ]));
  fireEvent.click(screen.getByRole('button', { name: '要確認 2件' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByText('保存できません。')).toHaveLength(2);
  expect(dialog.querySelector('#warning-sources-save')).not.toBeNull();
  expect(dialog.querySelector('#warning-commentSpeech-save')).not.toBeNull();
});

it('操作失敗と同文の機能警告はリンクを保持したまま他の機能警告より先に表示する', () => {
  render(shell(warnings, warnings[3].message));
  fireEvent.click(screen.getByRole('button', { name: '要確認 4件' }));
  const rows = within(screen.getByRole('dialog')).getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent(warnings[3].message);
  expect(within(rows[0]).getByRole('button')).toHaveAttribute('id', 'warning-mobileSpeech-state');
});
