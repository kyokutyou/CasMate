// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InitialSetupPhonePrerequisite } from '../src/renderer/components/InitialSetupPhonePrerequisite';
import { ManagementNavigation, SetupPresentation } from '../src/renderer/management-navigation';

afterEach(cleanup);

function fixture(kind: 'comment' | 'speech', ready = false, pending = false) {
  const open = vi.fn();
  const panel = (prepared: boolean, busy: boolean) => <ManagementNavigation.Provider value={{ editor: 'smartphone', open, reportError: vi.fn(), initialSetupPending: busy }}>
    <SetupPresentation.Provider value={{ source: 'youtube', selectSource: vi.fn() }}>
      <InitialSetupPhonePrerequisite kind={kind} ready={prepared} message={prepared ? '✓ 準備済み' : '準備が必要です。'} reserve={['✓ 準備済み', '準備が必要です。']} />
    </SetupPresentation.Provider>
  </ManagementNavigation.Provider>;
  const result = render(panel(ready, pending));
  return { open, update: (prepared: boolean, busy = false) => result.rerender(panel(prepared, busy)) };
}

it.each(['comment', 'speech'] as const)('%sの不足時だけ設定を開け、準備済みなら状態欄を復帰先にする', kind => {
  const f = fixture(kind);
  const button = screen.getByRole('button');
  fireEvent.click(button);
  expect(f.open).toHaveBeenCalledWith(kind === 'comment' ? 'sources' : 'commentSpeech', button);
  f.update(true);
  expect(screen.queryByRole('button')).toBeNull();
  const target = document.getElementById(`setup-phone-${kind}-settings`)!;
  expect(target).toHaveTextContent('✓ 準備済み');
  target.focus(); expect(target).toHaveFocus();
  f.update(false);
  expect(screen.getByRole('button')).toHaveAttribute('id', `setup-phone-${kind}-settings`);
});

it('進行保存待ちは設定へ移動せず、完了後に同じボタンから開ける', () => {
  const f = fixture('comment', false, true);
  const button = screen.getByRole('button'); button.focus(); fireEvent.click(button);
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(f.open).not.toHaveBeenCalled();
  f.update(false);
  expect(button).toHaveFocus(); fireEvent.click(button);
  expect(f.open).toHaveBeenCalledTimes(1);
});

it('準備完了の更新で別の操作に移したフォーカスを奪わない', () => {
  const f = fixture('comment');
  screen.getByRole('button').focus();
  const other = document.createElement('button'); document.body.append(other); other.focus();
  f.update(true);
  expect(other).toHaveFocus(); other.remove();
});

it('設定ボタンを操作中に準備が完了した場合は対応する状態欄へフォーカスを戻す', () => {
  const f = fixture('comment');
  screen.getByRole('button').focus();
  f.update(true);
  expect(document.getElementById('setup-phone-comment-settings')).toHaveFocus();
});
