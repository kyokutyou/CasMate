// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiListenerPanel } from '../src/renderer/components/AiListenerPanel';
import { defaultAiSettings, validateAiSettings, type AiView } from '../src/shared/ai-listener';
import type { AiCapture } from '../src/shared/ai-visual';
import { ManagementNavigation } from '../src/renderer/management-navigation';
const source = { uuid: 'game', name: 'ゲーム画面', collection: 'main' };
const view: AiView = { postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: true, authorization: null,
  services: { youtube: { ready: false, message: '', account: null, latest: null }, twitch: { ready: false, message: '', account: null, latest: null }, shitaraba: { ready: false, message: '', account: null, latest: null }, jpnkn: { ready: false, message: '', account: null, latest: null } } };
afterEach(cleanup);
it('映像ソースの自動再取得成功で一覧の障害だけを解消し、撮影障害は保持する', async () => {
  let first = true;
  const mutate = vi.fn(async (path: string) => {
    if (path.endsWith('/sources')) { if (first) { first = false; throw new Error('一覧取得に失敗しました。'); } return { sources: [source] }; }
    if (path.endsWith('/capture')) throw new Error('撮影に失敗しました。');
    return { debugEnabled: false };
  });
  const settings = defaultAiSettings();settings.visual = { enabled: false, source };
  render(<AiListenerPanel settings={settings} view={view} mutate={mutate} change={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: '映像' }));await waitFor(() => expect(screen.getByText('一覧取得に失敗しました。')).toBeVisible());
  fireEvent.click(screen.getByRole('tab', { name: '連携' }));fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  await waitFor(() => expect(screen.getByRole('option', { name: 'ゲーム画面' })).toBeInTheDocument());expect(screen.queryByText('一覧取得に失敗しました。')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '画像を取得して確認' }));await waitFor(() => expect(screen.getByText('撮影に失敗しました。')).toBeVisible());
  fireEvent.click(screen.getByRole('tab', { name: '連携' }));fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'ソース一覧を更新' })).toHaveAttribute('aria-disabled', 'false'));
  expect(screen.getByText('撮影に失敗しました。')).toBeVisible();
});
it('一覧の再取得中も選択欄のフォーカスを保持し、選択変更は受け付けない', async () => {
  let release!: () => void;
  let hold = false;
  const changed = vi.fn();
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mutate = vi.fn(async (path: string) => {
    if (!path.endsWith('/sources')) return { debugEnabled: false };
    if (hold) await gate;
    return { sources: [source] };
  });
  render(<AiListenerPanel settings={defaultAiSettings()} view={view} mutate={mutate} change={changed} />);
  fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  const input = screen.getByLabelText('撮影するOBSソース');
  await waitFor(() => expect(input).toHaveAttribute('aria-disabled', 'false'));
  input.focus(); hold = true; fireEvent.click(screen.getByRole('button', { name: 'ソース一覧を更新' }));
  expect(input).toHaveAttribute('aria-disabled', 'true'); expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'main\ngame' } }); expect(changed).not.toHaveBeenCalled();
  await act(async () => { release(); });
  expect(input).toHaveAttribute('aria-disabled', 'false'); expect(input).toHaveFocus();
});
it('映像一覧を自動取得し、先にオンを希望した場合はソース選択後に有効な設定を保存する', async () => {
  const changed = vi.fn();
  const mutate = vi.fn(async (path: string) => path.endsWith('/sources') ? { sources: [source] } : { debugEnabled: false });
  function Harness() {
    const [settings, setSettings] = useState(defaultAiSettings());
    return <AiListenerPanel settings={settings} view={view} mutate={mutate} change={value => { changed(value); setSettings(validateAiSettings(value)); }} />;
  }
  render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  await waitFor(() => expect(screen.getByRole('option', { name: 'ゲーム画面' })).toBeInTheDocument());
  const toggle = screen.getByRole('switch', { name: '配信映像をAIに見せる' });
  expect(toggle).not.toBeDisabled(); fireEvent.click(toggle);
  expect(changed).not.toHaveBeenCalled();
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByLabelText('撮影するOBSソース')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('撮影するOBSソース'), { target: { value: 'main\ngame' } });
  expect(changed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ visual: { enabled: true, source } }));
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(mutate.mock.calls.some(([path]) => path.endsWith('/capture') || path.includes('generate'))).toBe(false);
});
it('未保存のオン希望をオフに戻した場合は、後からソースを選んでもオンにしない', async () => {
  const changed = vi.fn();
  const mutate = vi.fn(async (path: string) => path.endsWith('/sources') ? { sources: [source] } : { debugEnabled: false });
  function Harness() {
    const [settings, setSettings] = useState(defaultAiSettings());
    return <AiListenerPanel settings={settings} view={view} mutate={mutate} change={value => { changed(value); setSettings(validateAiSettings(value)); }} />;
  }
  render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  await waitFor(() => expect(screen.getByRole('option', { name: 'ゲーム画面' })).toBeInTheDocument());
  const toggle = screen.getByRole('switch', { name: '配信映像をAIに見せる' });
  fireEvent.click(toggle); await waitFor(() => expect(toggle).toHaveAttribute('aria-disabled', 'false'));
  fireEvent.click(toggle);
  fireEvent.change(screen.getByLabelText('撮影するOBSソース'), { target: { value: 'main\ngame' } });
  expect(changed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ visual: { enabled: false, source } }));
});
it('撮影失敗をAIリスナーの警告として登録する', async () => {
  const reportError = vi.fn(); const settings = defaultAiSettings(); settings.visual = { enabled: false, source };
  render(<ManagementNavigation.Provider value={{ editor: 'aiListener', open: () => {}, reportError }}>
    <AiListenerPanel settings={settings} view={view} change={() => {}} mutate={async path => path.endsWith('/capture') ? { capture: { reason: 'ソースが非表示です', durationMs: 1 } } : { debugEnabled: false }} />
  </ManagementNavigation.Provider>);
  fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'ソース一覧を更新' })).toHaveAttribute('aria-disabled', 'false'));
  fireEvent.click(screen.getByRole('button', { name: '画像を取得して確認' }));
  await waitFor(() => expect(reportError).toHaveBeenCalledWith('aiListener', 'ソースが非表示です'));
  expect(reportError.mock.calls.some(([id]) => id === 'ai-visual' || id === 'ai-visual-debug')).toBe(false);
});
it('映像タブで一覧を自動取得し、選択・ローカル確認後のタブ往復で画像を保つ', async () => {
  const mutate = vi.fn(async (path: string) => {
    if (path.endsWith('/sources')) return { sources: [source] };
    if (path.endsWith('/capture')) return { capture: { reason: '取得済み', durationMs: 2, image: { data: '/9j/2Q==', mimeType: 'image/jpeg', width: 100, height: 100, bytes: 4, capturedAt: '2026-09-18T00:00:00Z' } } };
    return { status: { reason: '未生成', durationMs: 0 }, debugEnabled: false };
  });
  function Harness() { const [settings, change] = useState(defaultAiSettings()); return <AiListenerPanel settings={settings} view={view} change={change} mutate={mutate} />; }
  render(<Harness />); expect(screen.getAllByRole('tab')).toHaveLength(6);
  fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  await waitFor(() => expect(screen.getByRole('option', { name: 'ゲーム画面' })).toBeInTheDocument());
  expect(screen.getByRole('switch', { name: '配信映像をAIに見せる' })).toHaveAttribute('aria-disabled', 'false');
  fireEvent.change(screen.getByLabelText('撮影するOBSソース'), { target: { value: 'main\ngame' } });
  fireEvent.click(screen.getByRole('button', { name: '画像を取得して確認' }));
  await waitFor(() => expect(screen.getByAltText('撮影確認したOBSソース')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('tab', { name: '連携' })); fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  expect(screen.getByAltText('撮影確認したOBSソース')).toBeInTheDocument();
  expect(mutate.mock.calls.filter(([path]) => path.endsWith('/capture'))).toHaveLength(1);
  expect(mutate.mock.calls.some(([path]) => path.includes('generate'))).toBe(false);
  expect(screen.queryByText('画像送信のデバッグ（開発用）')).not.toBeInTheDocument();
});
it('クリア後に届いた古い撮影応答を表示しない', async () => {
  let finish!: (value: { capture: AiCapture }) => void;
  const mutate = vi.fn(async (path: string) => path.endsWith('/capture') ? new Promise<{ capture: AiCapture }>(resolve => { finish = resolve; }) : { debugEnabled: false });
  const settings = defaultAiSettings(); settings.visual = { enabled: false, source };
  render(<AiListenerPanel settings={settings} view={view} change={() => {}} mutate={mutate} />);
  fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'ソース一覧を更新' })).toHaveAttribute('aria-disabled', 'false'));
  fireEvent.click(screen.getByRole('button', { name: '画像を取得して確認' }));
  fireEvent.click(screen.getByRole('button', { name: '画像をクリア' }));
  finish({ capture: { reason: '古い画像', durationMs: 1, image: { data: '/9j/2Q==', mimeType: 'image/jpeg', width: 100, height: 100, bytes: 4, capturedAt: '2026-09-18T00:00:00Z' } } });
  await waitFor(() => expect(screen.getByRole('button', { name: '画像を取得して確認' })).not.toBeDisabled());
  expect(screen.queryByAltText('撮影確認したOBSソース')).not.toBeInTheDocument();
});
