// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useContext, useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManagementShell } from '../src/renderer/components/ManagementShell';
import { SettingsCard } from '../src/renderer/components/SettingsCard';
import { ManagementNavigation } from '../src/renderer/management-navigation';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

function EditingControls({ mounted, stopped }: { mounted(): void; stopped(): void }) {
  useEffect(() => { mounted(); return stopped; }, [mounted, stopped]);
  return <>
    <label>起動検証の入力<input id="startup-test-input" defaultValue="保存済み" /></label>
    <details><summary>起動検証の詳細</summary><p>開いた状態を保持する詳細</p></details>
  </>;
}

function Shortcut() {
  const navigation = useContext(ManagementNavigation);
  return <button id="startup-filter-entry" onClick={event => navigation?.open('commentFilter', event.currentTarget, 'startup-test-input')}>入力へ進む</button>;
}

function managementCard({ mounted, stopped, saveError }: { mounted(): void; stopped(): void; saveError?: string }) {
  return <ManagementShell home={<Shortcut />} windows={null} pcStatus={null} connected warnings={[]} activities={[]}>
    <SettingsCard cardId="commentFilter" title="コメントフィルター" eyebrow="FILTER" summary="現在のフィルター状態" saveError={saveError}
      actions={<button>既存のフィルター操作</button>}>
      <EditingControls mounted={mounted} stopped={stopped} />
    </SettingsCard>
    <SettingsCard cardId="urls" title="OBSにソースを追加" eyebrow="URL"><p>別の編集画面</p></SettingsCard>
  </ManagementShell>;
}

it('未表示の編集内容を起動時に生成せず、警告と既存のカード情報は保持する', () => {
  const mounted = vi.fn(); const stopped = vi.fn();
  render(managementCard({ mounted, stopped, saveError: '起動検証の保存に失敗しました。' }));
  expect(screen.queryByLabelText('起動検証の入力')).toBeNull();
  expect(mounted).not.toHaveBeenCalled();
  expect(screen.getByText('現在のフィルター状態')).toBeInTheDocument();
  expect(screen.getByText('既存のフィルター操作')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
  fireEvent.click(screen.getByRole('button', { name: '起動検証の保存に失敗しました。' }));
  expect(screen.getByLabelText('起動検証の入力')).toBeVisible();
  expect(mounted).toHaveBeenCalledOnce();
  expect(stopped).not.toHaveBeenCalled();
});

it('初めて開く項目へ同期してフォーカスし、ホームと別編集先への移動後も入力と処理を保持する', () => {
  const mounted = vi.fn(); const stopped = vi.fn();
  render(managementCard({ mounted, stopped }));
  const entry = screen.getByRole('button', { name: '入力へ進む' });
  fireEvent.click(entry);
  const input = screen.getByLabelText('起動検証の入力');
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '編集途中の値' } });
  const details = screen.getByText('起動検証の詳細').closest('details')!;
  details.open = true;
  expect(mounted).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
  expect(input).not.toBeVisible();
  expect(entry).toHaveFocus();
  expect(stopped).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: /OBSにソースを追加\s*OBSへの追加・URL/ }));
  expect(screen.getByText('別の編集画面')).toBeVisible();
  expect(stopped).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
  fireEvent.click(entry);
  expect(screen.getByLabelText('起動検証の入力')).toBe(input);
  expect(input).toHaveValue('編集途中の値');
  expect(details.open).toBe(true);
  expect(mounted).toHaveBeenCalledOnce();
  expect(stopped).not.toHaveBeenCalled();
});

it('単独カードは保存された閉じた状態でも内容を生成し、展開操作で入力を保持する', () => {
  localStorage.setItem('casmate.management.cards.commentFilter', 'false');
  const mounted = vi.fn(); const stopped = vi.fn();
  render(<SettingsCard cardId="commentFilter" title="コメントフィルター" eyebrow="FILTER">
    <EditingControls mounted={mounted} stopped={stopped} />
  </SettingsCard>);
  const input = screen.getByLabelText('起動検証の入力');
  expect(input).not.toBeVisible();
  expect(mounted).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'コメントフィルター：詳細を開く' }));
  fireEvent.change(input, { target: { value: '単独画面の編集途中' } });
  fireEvent.click(screen.getByRole('button', { name: 'コメントフィルター：閉じる' }));
  fireEvent.click(screen.getByRole('button', { name: 'コメントフィルター：詳細を開く' }));
  expect(input).toHaveValue('単独画面の編集途中');
  expect(input).toBeVisible();
  expect(mounted).toHaveBeenCalledOnce();
  expect(stopped).not.toHaveBeenCalled();
});
