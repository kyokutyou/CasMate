// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ObsControlPanel } from '../src/renderer/components/ObsControlPanel';
import { ManagementNavigation } from '../src/renderer/management-navigation';
import { obsControlView as view } from './fixtures/obs-control-view';

const props = () => ({ view, configure: vi.fn(async () => {}), retry: vi.fn(async () => {}), cancel: vi.fn(async () => {}) });
beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const connectionDetails = () => screen.getByText('OBSの接続設定', { selector: 'summary span' }).closest('details')!;
const openConnection = () => { const details = connectionDetails(); if (!details.open) fireEvent.click(details.querySelector('summary')!); };

it.each([false, true])('再試行の通信失敗後、接続情報の保存と接続復旧で古い操作エラーを解消する（初回=%s）', async initialSetup => {
  const user = userEvent.setup();
  const p = { ...props(), view: { ...view, connection: 'unavailable' as const }, retry: vi.fn(async () => { throw new Error('再試行を送信できませんでした。'); }) };
  const panel = (connected = false) => <ManagementNavigation.Provider value={{ editor: 'obsControl', initialSetup, open: vi.fn(), reportError: vi.fn() }}><ObsControlPanel {...p} view={connected ? { ...view, connection: 'connected' } : p.view} /></ManagementNavigation.Provider>;
  const rendered = render(panel()); openConnection();
  await user.click(screen.getByRole('button', { name: 'OBS接続を再試行' }));
  await waitFor(() => expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('再試行を送信できませんでした。'));
  await user.type(screen.getByLabelText('OBS WebSocketパスワード'), 'correct-password');
  fireEvent.blur(screen.getByLabelText('OBS WebSocketパスワード'), { relatedTarget: document.body });
  await waitFor(() => expect(p.configure).toHaveBeenCalledWith({ port: view.obsPort, password: 'correct-password' }));
  await waitFor(() => expect(screen.getByRole('status', { name: 'OBS操作の状態' })).not.toHaveTextContent('再試行を送信できませんでした。'));
  rendered.rerender(panel(true));
  await waitFor(() => expect(screen.getByRole('status', { name: 'OBS操作の状態' })).not.toHaveTextContent('再試行を送信できませんでした。'));
  expect(p.retry).toHaveBeenCalledOnce();
});

it('保存操作なしで接続が復旧した場合も古い通信エラーを解除し、現在の接続エラーは保持する', async () => {
  const user = userEvent.setup();
  const p = { ...props(), retry: vi.fn(async () => { throw new Error('一時的な通信失敗'); }) };
  const rendered = render(<ObsControlPanel {...p} view={{ ...view, connection: 'unavailable' }} />);
  await user.click(screen.getByRole('button', { name: 'OBS接続を再試行' }));
  await waitFor(() => expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('一時的な通信失敗'));
  rendered.rerender(<ObsControlPanel {...p} view={{ ...view, connection: 'unavailable', error: '現在も認証できません' }} />);
  expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('現在も認証できません');
  expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('一時的な通信失敗');
  rendered.rerender(<ObsControlPanel {...p} view={{ ...view, connection: 'connected', error: null }} />);
  await waitFor(() => expect(screen.getByRole('status', { name: 'OBS操作の状態' })).not.toHaveTextContent('一時的な通信失敗'));
  expect(p.configure).not.toHaveBeenCalled();
});

it('初回設定でも配信操作の結果不明を通常の接続成功案内へ置き換えない', () => {
  const p = { ...props(), view: { ...view, lastOperation: { operationId: 'unknown-operation', action: 'start' as const, status: 'unknown' as const, errorCode: 'TIMEOUT' } } };
  render(<ManagementNavigation.Provider value={{ editor: 'obsControl', initialSetup: true, open: vi.fn(), reportError: vi.fn() }}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  const status = screen.getByRole('status', { name: 'OBS操作の状態' });
  expect(status).toHaveTextContent('結果不明');
  expect(status).toHaveTextContent('自動再送しません。OBS本体で現在状態を確認してください。');
  expect(status).not.toHaveTextContent('接続できました。下の確認欄へ');
});

it('再試行の応答より先に接続が復旧していたら、遅延した通信失敗で復旧を取り消さない', async () => {
  let fail!: (error: Error) => void;
  const p = { ...props(), retry: vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; })) };
  const rendered = render(<ObsControlPanel {...p} view={{ ...view, connection: 'unavailable' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'OBS接続を再試行' }));
  await waitFor(() => expect(p.retry).toHaveBeenCalledOnce());
  rendered.rerender(<ObsControlPanel {...p} view={{ ...view, connection: 'connected' }} />);
  await act(async () => fail(new Error('遅延した通信失敗')));
  expect(screen.getByRole('status', { name: 'OBS操作の状態' })).not.toHaveTextContent('遅延した通信失敗');
});

it.each([
  ['戻る', 'setup-back', 'setup-footer'],
  ['後で設定する', 'setup-defer-obsControl', 'setup-footer'],
  ['詳細設定を開く', 'setup-detail', 'setup-detail-link'],
  ['中断する', 'setup-interrupt', 'setup-title-row'],
  ['読み上げへ', 'setup-topic-commentSpeech', 'setup-topic-nav'],
])('初回設定の「%s」へ移動しても接続情報を保存しない', async (label, id, className) => {
  const user = userEvent.setup(); const p = props();
  render(<ManagementNavigation.Provider value={{ editor: 'obsControl', initialSetup: true, open: vi.fn(), reportError: vi.fn() }}><ObsControlPanel {...p} /><div className={className}><button id={id}>{label}</button></div></ManagementNavigation.Provider>);
  const port = screen.getByLabelText('OBS WebSocketポート');
  await user.clear(port); await user.type(port, '4456');
  await user.click(screen.getByRole('button', { name: label, exact: true }));
  expect(p.configure).not.toHaveBeenCalled();
  expect(port).toHaveValue(4456);
});

it.each([false, true])('再試行は接続情報の保存成功を待ち、保存失敗時は接続を始めない（初回=%s）', async initialSetup => {
  const user = userEvent.setup();
  let fail!: (error: Error) => void;
  const onSuccess = vi.fn();
  const p = { ...props(), onSuccess, view: { ...view, connection: 'unavailable' as const } };
  p.configure.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  render(<ManagementNavigation.Provider value={{ editor: 'obsControl', initialSetup, open: vi.fn(), reportError: vi.fn() }}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  openConnection();
  const port = screen.getByLabelText('OBS WebSocketポート');
  await user.clear(port); await user.type(port, '4456');
  const retry = screen.getByRole('button', { name: 'OBS接続を再試行' });
  await user.click(retry);
  expect(p.configure).toHaveBeenCalledExactlyOnceWith({ port: 4456 });
  expect(p.retry).not.toHaveBeenCalled();
  await act(async () => fail(new Error('保存に失敗しました。')));
  expect(p.retry).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled();
  expect(retry).toHaveFocus(); expect(port).toHaveValue(4456);
  await user.click(retry);
  await waitFor(() => expect(p.retry).toHaveBeenCalledOnce());
  expect(p.configure).toHaveBeenCalledTimes(2);
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith('OBS接続を再試行しました。');
});

it('不正な接続情報では古い保存値へ再試行しない', async () => {
  const user = userEvent.setup(); const p = { ...props(), view: { ...view, connection: 'unavailable' as const } };
  render(<ObsControlPanel {...p} />); openConnection();
  const port = screen.getByLabelText('OBS WebSocketポート');
  await user.clear(port); await user.type(port, '0');
  await user.click(screen.getByRole('button', { name: 'OBS接続を再試行' }));
  expect(p.configure).not.toHaveBeenCalled(); expect(p.retry).not.toHaveBeenCalled();
  expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('OBSポートは1〜65535');
});

it('接続設定を閉じた時の保存失敗を自動で再送しない', async () => {
  const user = userEvent.setup(); const p = props();
  p.configure.mockRejectedValueOnce(new Error('保存に失敗しました。'));
  render(<ObsControlPanel {...p} />); openConnection();
  const port = screen.getByLabelText('OBS WebSocketポート');
  await user.clear(port); await user.type(port, '4456');
  await user.click(connectionDetails().querySelector('summary')!);
  await waitFor(() => expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('保存に失敗しました。'));
  expect(p.configure).toHaveBeenCalledExactlyOnceWith({ port: 4456 });
  expect(port).toHaveValue(4456);
});

it('初回接続の保存が失敗したら、同じクリックで保存し直したり接続を始めたりしない', async () => {
  const user = userEvent.setup(); const p = { ...props(), view: { ...view, enabled: false, connection: 'disabled' as const } };
  p.configure.mockRejectedValueOnce(new Error('保存に失敗しました。'));
  render(<ManagementNavigation.Provider value={{ editor: 'obsControl', initialSetup: true, open: vi.fn(), reportError: vi.fn() }}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  await user.type(screen.getByLabelText('OBS WebSocketパスワード'), 'new-password');
  const connect = screen.getByRole('button', { name: 'OBSに接続する' });
  await user.click(connect);
  await waitFor(() => expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('保存に失敗しました。'));
  expect(p.configure).toHaveBeenCalledExactlyOnceWith({ port: view.obsPort, password: 'new-password' });
  expect(connect).toHaveFocus();
});

it.each(['stop', 'cancel'] as const)('接続の%sでは編集中の接続情報を保存しない', async action => {
  const user = userEvent.setup();
  const p = { ...props(), view: { ...view, confirmation: action === 'cancel' ? { id: 'pending', source: 'voice' as const, action: 'start' as const, expiresAt: Date.now() + 10000 } : null } };
  render(<ObsControlPanel {...p} />); openConnection();
  const port = screen.getByLabelText('OBS WebSocketポート');
  await user.clear(port); await user.type(port, '4456');
  await user.click(action === 'cancel' ? screen.getByRole('button', { name: '確認を取り消す' }) : screen.getByRole('switch', { name: 'OBS連携', exact: true }));
  if (action === 'cancel') { expect(p.cancel).toHaveBeenCalledOnce(); expect(p.configure).not.toHaveBeenCalled(); }
  else expect(p.configure).toHaveBeenCalledExactlyOnceWith({ enabled: false });
  expect(port).toHaveValue(4456);
});

it('末尾の空欄を設けず、処理中・失敗を上部の既存状態欄に表示する', async () => {
  let fail!: (error: Error) => void;
  const p = { ...props(), view: { ...view, connection: 'unavailable' as const },
    retry: vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; })) };
  const { container } = render(<ObsControlPanel {...p} />);
  const status = screen.getByRole('status', { name: 'OBS操作の状態' });
  expect(container.querySelector('.oc-footer-status')).toBeNull();
  expect(status).toHaveTextContent('確認待ちはありません。');
  fireEvent.click(screen.getByRole('button', { name: 'OBS接続を再試行' }));
  expect(status).toHaveTextContent('操作を処理しています…');
  await waitFor(() => expect(p.retry).toHaveBeenCalledOnce());
  await act(async () => { fail(new Error('OBSへ接続できませんでした。')); });
  expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toBe(status);
  expect(status).toHaveTextContent('OBSへ接続できませんでした。');
  expect(status).toHaveTextContent('確認待ちはありません。');
  expect(screen.queryByText('OBS操作の障害で、コメント・読み上げ・映像送信は停止しません。')).not.toBeInTheDocument();
});

it('explains the separate recognition setting without implying that preview controls OBS', () => {
  const p = props(); const { container } = render(<ObsControlPanel {...p} />);
  expect(screen.getByText('音声認識の「配信に使う」もオンにしてください。プレビューだけではOBSを操作しません。')).toBeVisible();
  expect(container.textContent).not.toContain('本番');
  expect(p.configure).not.toHaveBeenCalled(); expect(p.retry).not.toHaveBeenCalled(); expect(p.cancel).not.toHaveBeenCalled();
});

it('shows both permission cards without tabs and batches connection fields on leaving the group', async () => {
  const p = props(); render(<ObsControlPanel {...p} />);
  expect(screen.queryByRole('tab')).toBeNull();
  expect(connectionDetails()).not.toHaveAttribute('open');
  expect(screen.getByRole('switch', { name: '音声によるOBS操作' })).toBeVisible();
  expect(screen.getByRole('switch', { name: 'AndroidからのOBS操作' })).toBeVisible();
  openConnection();
  expect(screen.queryByText('この設定を適用')).toBeNull();
  expect(screen.queryByText('OBS操作登録を含める')).toBeNull();
  const port = screen.getByLabelText('OBS WebSocketポート');
  const password = screen.getByLabelText('OBS WebSocketパスワード');
  fireEvent.change(port, { target: { value: '4456' } });
  fireEvent.blur(port, { relatedTarget: password });
  fireEvent.change(password, { target: { value: 'new-password' } });
  expect(p.configure).not.toHaveBeenCalled();
  fireEvent.blur(password, { relatedTarget: screen.getByRole('switch', { name: '音声によるOBS操作' }) });
  await waitFor(() => expect(p.configure).toHaveBeenCalledWith({ port: 4456, password: 'new-password' }));
  expect(password).toHaveValue('');
  expect(screen.getByText('Android待受：準備完了')).toBeVisible();
  expect(screen.queryByText('外配信登録も含める')).toBeNull();
});

it('keeps edits and expanded details across common navigation and saves on explicit collapse', async () => {
  const p = props(); const nav = { editor: 'obsControl' as const, open: vi.fn(), reportError: vi.fn() };
  const rendered = render(<ManagementNavigation.Provider value={nav}><ObsControlPanel {...p} /><button className="back-button">戻る</button></ManagementNavigation.Provider>);
  openConnection();
  const port = screen.getByLabelText('OBS WebSocketポート');
  fireEvent.change(port, { target: { value: '4456' } });
  fireEvent.blur(port, { relatedTarget: screen.getByRole('button', { name: '戻る' }) });
  rendered.rerender(<ManagementNavigation.Provider value={{ ...nav, editor: null }}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  expect(p.configure).not.toHaveBeenCalled();
  rendered.rerender(<ManagementNavigation.Provider value={nav}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  expect(screen.getByLabelText('OBS WebSocketポート')).toHaveValue(4456);
  expect(connectionDetails()).toHaveAttribute('open');
  fireEvent.click(connectionDetails().querySelector('summary')!);
  await waitFor(() => expect(p.configure).toHaveBeenCalledExactlyOnceWith({ port: 4456 }));
});
it('履歴移動によるフォーカスの移動ではOBS接続情報を保存しない', () => {
  const p = props();
  render(<ManagementNavigation.Provider value={{ editor: 'obsControl', open: vi.fn(), reportError: vi.fn(), isHistoryNavigation: () => true }}>
    <ObsControlPanel {...p} /><button>ホームの入口</button>
  </ManagementNavigation.Provider>);
  openConnection();
  const port = screen.getByLabelText('OBS WebSocketポート');
  fireEvent.change(port, { target: { value: '4456' } });
  fireEvent.blur(port, { relatedTarget: screen.getByRole('button', { name: 'ホームの入口' }) });
  expect(p.configure).not.toHaveBeenCalled();
  expect(port).toHaveValue(4456);
});

it('accepts the first toggle click while a field-blur save is in progress', async () => {
  const user = userEvent.setup(); const p = props(); let complete!: () => void;
  p.configure.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  render(<ObsControlPanel {...p} />);
  openConnection();
  await user.clear(screen.getByLabelText('OBS WebSocketポート'));
  await user.type(screen.getByLabelText('OBS WebSocketポート'), '4456');
  fireEvent.blur(screen.getByLabelText('OBS WebSocketポート'), { relatedTarget: document.body });
  await waitFor(() => expect(p.configure).toHaveBeenCalledExactlyOnceWith({ port: 4456 }));
  await user.click(screen.getByRole('switch', { name: 'OBS連携', exact: true }));
  expect(p.configure).toHaveBeenCalledExactlyOnceWith({ port: 4456 });
  await act(async () => { complete(); });
  await waitFor(() => expect(p.configure).toHaveBeenLastCalledWith({ enabled: false }));
  expect(screen.getByRole('switch', { name: 'OBS連携', exact: true })).toHaveAttribute('aria-checked', 'false');
});

it('connects after entering the first password when OBS integration was already switched on', async () => {
  const user = userEvent.setup();
  const initial = { ...view, enabled: false, passwordConfigured: false, connection: 'disabled' as const };
  let stored = initial;
  const configure = vi.fn(async (patch: unknown) => {
    const value = patch as { enabled?: boolean; password?: string };
    if ((value.enabled ?? stored.enabled) && !(value.password || stored.passwordConfigured)) {
      throw new Error('OBS連携オンにはパスワードが必要です。');
    }
    stored = { ...stored, enabled: value.enabled ?? stored.enabled,
      passwordConfigured: Boolean(value.password) || stored.passwordConfigured };
  });
  const p = { ...props(), view: initial, configure };
  render(<ObsControlPanel {...p} />);
  await user.click(screen.getByRole('switch', { name: 'OBS連携', exact: true }));
  expect(screen.getByRole('switch', { name: 'OBS連携', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect(stored.enabled).toBe(false);
  openConnection();
  await user.type(screen.getByLabelText('OBS WebSocketパスワード'), 'first-password');
  await user.click(connectionDetails().querySelector('summary')!);
  await waitFor(() => expect(stored.enabled).toBe(true));
  expect(stored.passwordConfigured).toBe(true);
  expect(screen.queryByText('OBS連携オンにはパスワードが必要です。')).not.toBeInTheDocument();
  expect(p.retry).not.toHaveBeenCalled();
});

it('links unified registration to outdoor without changing any setting', () => {
  const p = props(); const open = vi.fn(); const nav = { editor: 'obsControl' as const, open, reportError: vi.fn() };
  render(<ManagementNavigation.Provider value={nav}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  fireEvent.click(screen.getByRole('button', { name: /スマホ連携を開く/ }));
  expect(open).toHaveBeenCalledWith('smartphone', expect.any(HTMLElement));
  expect(p.configure).not.toHaveBeenCalled();
});

it('keeps phrase edits and errors when collapsed, and reports the error above both cards', async () => {
  const user = userEvent.setup(); const p = props();
  render(<ObsControlPanel {...p} />);
  const summary = screen.getByText('フレーズを編集', { selector: 'summary' });
  expect(summary.closest('details')).not.toHaveAttribute('open');
  await user.click(summary);
  await user.clear(screen.getByLabelText('開始を指示するフレーズ'));
  await user.click(summary);
  await waitFor(() => expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('フレーズは1〜100文字'));
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(p.configure).not.toHaveBeenCalled();
  await user.click(summary);
  expect(screen.getByLabelText('開始を指示するフレーズ')).toHaveValue('');
});

it('shows connection inputs directly during initial setup without permission cards', () => {
  const p = props();
  render(<ManagementNavigation.Provider value={{ editor: 'obsControl', initialSetup: true, open: vi.fn(), reportError: vi.fn() }}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  expect(connectionDetails()).toHaveAttribute('open');
  expect(screen.getByLabelText('OBS WebSocketポート')).toBeVisible();
  expect(screen.getByRole('button', { name: '接続情報を保存' })).toBeVisible();
  expect(screen.queryByRole('switch', { name: '音声によるOBS操作' })).toBeNull();
  expect(p.configure).not.toHaveBeenCalled();
});
it('初回設定では入力直後の1回のクリックを保存待ちで失わず、保存してからOBSへ接続する', async () => {
  const user = userEvent.setup();
  let release!: () => void;
  const pendingSave = new Promise<void>(resolve => { release = resolve; });
  const p = { ...props(), view: { ...view, enabled: false, connection: 'disabled' as const, passwordConfigured: false } };
  p.configure.mockImplementationOnce(async () => pendingSave);
  render(<ManagementNavigation.Provider value={{ editor: 'obsControl', initialSetup: true, open: vi.fn(), reportError: vi.fn() }}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  await user.type(screen.getByLabelText('OBS WebSocketパスワード'), 'password');
  await user.click(screen.getByRole('button', { name: 'OBSに接続する' }));
  await waitFor(() => expect(p.configure).toHaveBeenCalledWith({ port: view.obsPort, password: 'password' }));
  expect(p.configure).not.toHaveBeenCalledWith({ enabled: true });
  await act(async () => { release(); });
  await waitFor(() => expect(p.configure).toHaveBeenCalledWith({ enabled: true }));
});

it('uses the real stream state and never retries an operation with an unknown result', () => {
  const p = { ...props(), view: { ...view, stream: 'unknown' as const, lastOperation: { operationId: 'last', action: 'start' as const, status: 'unknown' as const, errorCode: 'TIMEOUT' } } };
  render(<ObsControlPanel {...p} />);
  expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('自動再送しません');
  expect(screen.getByText('状態不明')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '確認を取り消す' }));
  expect(p.cancel).not.toHaveBeenCalled(); expect(p.retry).not.toHaveBeenCalled();
});

it('keeps the confirmation visible and sends cancellation success to the shared notice callback', async () => {
  const onSuccess = vi.fn();
  const p = { ...props(), onSuccess, view: { ...view, confirmation: { id: 'pending', source: 'voice' as const, action: 'start' as const, expiresAt: Date.now() + 10000 } } };
  render(<ObsControlPanel {...p} />);
  expect(screen.getByRole('status', { name: 'OBS操作の状態' })).toHaveTextContent('開始を実行');
  fireEvent.click(screen.getByRole('button', { name: '確認を取り消す' }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledExactlyOnceWith('確認を取り消しました。'));
  expect(p.cancel).toHaveBeenCalledOnce(); expect(p.configure).not.toHaveBeenCalled();
});

it('changes each permission independently and leaves disconnected status controlled by the server', async () => {
  const p = props(); render(<ObsControlPanel {...p} />);
  fireEvent.click(screen.getByRole('switch', { name: '音声によるOBS操作' }));
  await waitFor(() => expect(p.configure).toHaveBeenCalledExactlyOnceWith({ voiceEnabled: false }));
  expect(screen.getByRole('switch', { name: 'AndroidからのOBS操作' })).toHaveAttribute('aria-checked','true');
  expect(p.retry).not.toHaveBeenCalled(); expect(p.cancel).not.toHaveBeenCalled();
});

it('retains expanded phrase details when an initial setup visit hides the permission cards', () => {
  const p = props(); const nav = { editor: 'obsControl' as const, open: vi.fn(), reportError: vi.fn() };
  const rendered = render(<ManagementNavigation.Provider value={nav}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  fireEvent.click(screen.getByText('フレーズを編集', { selector: 'summary' }));
  rendered.rerender(<ManagementNavigation.Provider value={{ ...nav, initialSetup: true }}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  expect(screen.queryByRole('switch', { name: '音声によるOBS操作' })).toBeNull();
  rendered.rerender(<ManagementNavigation.Provider value={nav}><ObsControlPanel {...p} /></ManagementNavigation.Provider>);
  expect(screen.getByLabelText('開始を指示するフレーズ')).toBeVisible();
  expect(p.configure).not.toHaveBeenCalled();
});
