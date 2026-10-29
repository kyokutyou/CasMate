// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ObsSourceTestControls } from '../src/renderer/components/ObsSourceTestControls';
import type { ObsSourceTestState } from '../src/shared/obs-source-test';
const selection = { target: { kind: 'overlay' as const, overlay: 'comments' as const }, collection: 'c', sceneUuid: 's', inputUuid: 'i' };
afterEach(cleanup);
it('同じ共有入力でも削除通知で可否を再取得し、前の確認応答で巻き戻さない', async () => {
  let finish!: (value: { available: boolean; message: string }) => void;
  const context = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ available: false, message: '対象のシーンに追加されていません。' });
  const props = { selection, blocked: false, context, action: vi.fn(), notice: vi.fn() };
  const view = render(<ObsSourceTestControls {...props} contextRevision={0} />);
  await waitFor(() => expect(context).toHaveBeenCalledOnce());
  view.rerender(<ObsSourceTestControls {...props} contextRevision={1} />);
  await waitFor(() => expect(view.getByLabelText('OBS表示テストの状態')).toHaveTextContent('対象のシーンに追加されていません'));
  expect(context).toHaveBeenCalledTimes(2);
  await act(async () => finish({ available: true, message: '' }));
  expect(view.getByRole('button', { name: '表示テスト（5秒）' })).toHaveAttribute('aria-disabled', 'true');
  expect(view.getByLabelText('OBS表示テストの状態')).toHaveTextContent('対象のシーンに追加されていません');
});

it('allows a preparing stop from the same screen while start HTTP remains pending, preserves focus', async () => {
  const context = vi.fn(async () => ({ available: true, message: '準備済み' })); const notice = vi.fn();
  let complete!: () => void;
  const action = vi.fn(async (kind: 'start' | 'stop') => { if (kind === 'start') await new Promise<void>(resolve => { complete = resolve; }); return undefined; });
  const view = render(<ObsSourceTestControls selection={selection} state={{ busy: false, current: null, warnings: [] }} blocked={false} context={context} action={action} notice={notice} />);
  const start = view.getByRole('button', { name: '表示テスト（5秒）' });
  await waitFor(() => expect(start).toHaveAttribute('aria-disabled', 'false')); start.focus(); fireEvent.click(start);
  const state: ObsSourceTestState = { busy: true, warnings: [], current: { ...selection, id: 'test', title: 'コメント', phase: 'preparing', startedAt: null, expiresAt: null, message: '準備中', needsAttention: false } };
  view.rerender(<ObsSourceTestControls selection={selection} state={state} blocked={false} context={context} action={action} notice={notice} />);
  expect(document.activeElement).toBe(start);
  const stop = view.getByRole('button', { name: 'テスト終了' }); expect(stop).toHaveAttribute('aria-disabled', 'false'); fireEvent.click(stop);
  expect(stop).toBe(start); expect(view.getAllByRole('button')).toHaveLength(1);
  await waitFor(() => expect(action).toHaveBeenCalledWith('stop', { testId: 'test' })); complete();
  await waitFor(() => expect(notice).not.toHaveBeenCalled());
});

it('別対象の実行中テストを現在のIDで停止でき、停止中の連打を受け付けない', async () => {
  let finish!: () => void;
  const action = vi.fn(() => new Promise<undefined>(resolve => { finish = () => resolve(undefined); }));
  const current = { ...selection, target: { kind: 'overlay' as const, overlay: 'effects' as const }, inputUuid: 'other', id: 'other-test', title: '文字演出', phase: 'sending' as const, startedAt: 1, expiresAt: 5001, message: '送信中', needsAttention: false };
  const props = { selection: null, blocked: true, context: vi.fn(), action, notice: vi.fn() };
  const view = render(<ObsSourceTestControls {...props} state={{ busy: true, current, warnings: [] }} />);
  const stop = view.getByRole('button', { name: 'テスト終了' }); stop.focus(); fireEvent.click(stop); fireEvent.click(stop);
  expect(action).toHaveBeenCalledExactlyOnceWith('stop', { testId: 'other-test' });
  expect(stop).toHaveTextContent('終了中…'); expect(stop).toHaveFocus();
  view.rerender(<ObsSourceTestControls {...props} state={{ busy: false, current: { ...current, phase: 'complete', message: '' }, warnings: [] }} />);
  await act(async () => finish()); expect(stop).toHaveTextContent('表示テスト（5秒）'); expect(stop).toHaveFocus();
  expect(props.notice).not.toHaveBeenCalled(); expect(props.context).not.toHaveBeenCalled();
});
it('unblocks after the shared terminal state and ignores a late error from the previous HTTP request', async () => {
  const context = vi.fn(async () => ({ available: true, message: '準備済み' })), notice = vi.fn();
  let rejectFirst!: (error: Error) => void, resolveSecond!: () => void;
  const action = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { resolveSecond = resolve; }));
  const base: ObsSourceTestState = { busy: false, current: null, warnings: [] };
  const props = { selection, blocked: false, context, action, notice };
  const view = render(<ObsSourceTestControls {...props} state={base} />);
  const start = view.getByRole('button', { name: '表示テスト（5秒）' });
  await waitFor(() => expect(start).toHaveAttribute('aria-disabled', 'false')); fireEvent.click(start);
  const current = { ...selection, id: 'one', title: 'コメント', phase: 'sending' as const, startedAt: 1, expiresAt: 5001, message: '送信', needsAttention: false };
  view.rerender(<ObsSourceTestControls {...props} state={{ ...base, busy: true, current }} />);
  view.rerender(<ObsSourceTestControls {...props} state={{ ...base, current: { ...current, phase: 'complete' } }} />);
  await waitFor(() => expect(start).toHaveAttribute('aria-disabled', 'false')); fireEvent.click(start);
  await act(async () => { rejectFirst(new Error('古い応答')); });
  expect(notice).not.toHaveBeenCalled(); expect(start).toHaveAttribute('aria-disabled', 'true');
  expect(action).toHaveBeenCalledTimes(2); await act(async () => { resolveSecond(); });
});


it('説明を一文にし、正常終了の定型文を隠してエラーは維持する', async () => {
  const context = vi.fn(async () => ({ available: true, message: '' })), notice = vi.fn();
  const current = { ...selection, id: 'test', title: 'コメント', phase: 'complete' as const, startedAt: 1, expiresAt: 5001, message: 'テスト送信を終了しました。', needsAttention: false };
  const props = { selection, blocked: false, context, notice };
  const view = render(<ObsSourceTestControls {...props} state={{ busy: false, current, warnings: [] }} />);
  await waitFor(() => expect(context).toHaveBeenCalled()); expect(view.getByRole('button', { name: '表示テスト（5秒）' })).toBeVisible();
  expect(view.queryByText('5秒のテスト表示を送ります。')).toBeNull();
  expect(view.queryByText('テスト送信を終了しました。')).toBeNull(); expect(view.queryByText('実際の表示と終了後の表示はOBSで確認してください。')).toBeNull();
  view.rerender(<ObsSourceTestControls {...props} state={{ busy: false, current: { ...current, needsAttention: true, message: '対象が変更されました。' }, warnings: [] }} />);
  expect(view.getByLabelText('OBS表示テストの状態')).toHaveTextContent('対象が変更されました。');
});
