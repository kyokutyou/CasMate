// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSnapshot } from '../src/shared/types';
import { obsRegistrationContext, obsRegistrationSnapshot } from './fixtures/obs-registration-state';

const api = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null, connected: true, error: null,
  updateSettings: vi.fn(async (): Promise<unknown> => undefined), sourceAction: vi.fn(async () => undefined), mutate: vi.fn(async () => undefined),
  listSpeechVoices: vi.fn(async () => []), obsSourceContext: vi.fn(async () => obsRegistrationContext()), obsSourceAdd: vi.fn(async () => null) }));
vi.mock('../src/renderer/api', () => ({ useApplicationState: () => api }));
vi.mock('../src/renderer/windows-fonts', () => ({ loadWindowsFonts: async () => ['Yu Gothic UI'] }));
import { Dashboard } from '../src/renderer/pages/Dashboard';

beforeEach(() => {
  api.snapshot = obsRegistrationSnapshot(); vi.clearAllMocks(); localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);
const navigate = (name: string) => fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name, exact: true }));

const speechStates = [
  { enabled: false, engine: 'ready', current: 'playing', label: '停止中' },
  { enabled: false, engine: 'preparing', current: null, label: '停止中' },
  { enabled: true, engine: 'preparing', current: null, label: '準備中' },
  { enabled: true, engine: 'ready', current: 'playing', label: '読み上げ中' },
  { enabled: true, engine: 'ready', current: null, label: '新着待ち' },
  { enabled: true, engine: 'unavailable', current: null, label: '要確認' },
  { enabled: true, engine: 'disabled', current: null, label: '停止中' },
] as const;

it.each(speechStates.flatMap(state => (['ホーム', '配信中'] as const).map(page => ({ ...state, page }))))('$pageの読み上げ状態は保存値と実稼働から示す（$enabled/$engine/$current）', ({ enabled, engine, current, label, page }) => {
  api.snapshot!.settings.commentSpeech.enabled = enabled;
  api.snapshot!.commentSpeech = { ...api.snapshot!.commentSpeech, engineStatus: engine, currentCommentId: current };
  render(<Dashboard />); navigate(page);
  const toggle = screen.getByRole('switch', { name: 'コメント読み上げ', exact: true });
  expect(within(toggle.closest('article')!).getByText(label)).toBeVisible();
  expect(toggle).toHaveAttribute('aria-checked', String(enabled));
  expect(api.updateSettings).not.toHaveBeenCalled();
  expect(api.mutate).not.toHaveBeenCalled();
});

it.each((['ホーム', '配信中'] as const).flatMap(page => ([['playing', '読み上げ中'], ['idle', '新着待ち']] as const).map(([state, label]) => ({ page, state, label }))))('$pageで読み上げOFFの保存待機・失敗中も実際の稼働状態を示す（$state）', async ({ page, state, label }) => {
  api.snapshot!.settings.commentSpeech.enabled = true;
  api.snapshot!.commentSpeech = { ...api.snapshot!.commentSpeech, engineStatus: 'ready', currentCommentId: state === 'playing' ? 'speaking-comment' : null };
  let reject!: (error: Error) => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>((_resolve, failure) => { reject = failure; }));
  const view = render(<Dashboard />); navigate(page);
  const toggle = screen.getByRole('switch', { name: 'コメント読み上げ', exact: true });
  const operation = within(toggle.closest('article')!);
  fireEvent.click(toggle);
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith('commentSpeech', expect.objectContaining({ enabled: false })));
  expect(toggle).not.toBeChecked();
  expect(operation.getByText(label)).toBeVisible();
  await act(async () => reject(new Error('停止設定を保存できませんでした。')));
  expect(toggle).not.toBeChecked();
  expect(operation.getByText(label)).toBeVisible();
  expect(document.getElementById('management-warning-entry')).toHaveTextContent('要確認');
  api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1,
    settings: { ...api.snapshot!.settings, commentSpeech: { ...api.snapshot!.settings.commentSpeech, enabled: false } },
    commentSpeech: { ...api.snapshot!.commentSpeech, engineStatus: 'disabled', currentCommentId: null } };
  view.rerender(<Dashboard />);
  expect(operation.getByText('停止中')).toBeVisible();
});

function portInput() {
  const input=screen.getByLabelText('アプリの接続ポート（再起動後に有効）');
  const details=input.closest('details')!;
  if(!details.open) fireEvent.click(details.querySelector('summary')!);
  return input;
}

it('配信中の一覧見出しから独立窓を切り替え、外部の開閉と処理ロックを同期する', async () => {
  let finish!: () => void;
  api.mutate.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<Dashboard />); navigate('配信中');
  const button = screen.getByRole('button', { name: 'コメント一覧の独立ウィンドウ', exact: true });
  expect([...button.parentElement!.children].map(node => node.id)).toEqual(['', 'live-comment-window', 'live-list-settings']);
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(api.mutate).not.toHaveBeenCalled();
  button.focus(); fireEvent.click(button);
  expect(api.mutate).toHaveBeenCalledWith('/api/windows/comment-list/toggle');
  expect(button).toHaveAttribute('aria-disabled', 'true'); expect(button).toHaveFocus();
  fireEvent.click(button);
  fireEvent.click(document.getElementById('live-windows')!);
  fireEvent.click(within(screen.getByRole('group', { name: '独立ウィンドウ' })).getAllByRole('button')[0]);
  expect(api.mutate).toHaveBeenCalledTimes(1);
  fireEvent.click(within(screen.getByRole('dialog', { name: '別ウィンドウを開く・設定' })).getByRole('button', { name: '閉じる' }));
  await act(async () => finish());
  api.snapshot = { ...api.snapshot!, settings: { ...api.snapshot!.settings, application: { ...api.snapshot!.settings.application, commentListWindowVisible: true } } };
  view.rerender(<Dashboard />);
  expect(button).toHaveAttribute('aria-pressed', 'true'); expect(button).toHaveAttribute('title', '独立窓を非表示');
  api.snapshot = { ...api.snapshot, settings: { ...api.snapshot.settings, application: { ...api.snapshot.settings.application, commentListWindowVisible: false } } };
  view.rerender(<Dashboard />); expect(button).toHaveAttribute('aria-pressed', 'false');
  api.mutate.mockRejectedValueOnce(new Error('独立窓を開けませんでした。'));
  button.focus(); await act(async () => fireEvent.click(button));
  expect(document.getElementById('management-warning-entry')).toHaveTextContent('要確認 1件');
  expect(screen.getByText('独立窓を開けませんでした。')).toBeInTheDocument();
  expect(button).toHaveAttribute('aria-pressed', 'false'); expect(button).toHaveFocus();
  await act(async () => fireEvent.click(button)); expect(api.mutate).toHaveBeenCalledTimes(3);
});

it('ホームの音声カードは読み上げと認識の2項目で、AIリスナーは設定・配信中から使える', () => {
  render(<Dashboard />);
  const voice = within(document.querySelector('.home-support')!);
  expect(voice.getByRole('heading', { name: '音声' })).toBeVisible();
  expect(voice.getAllByRole('switch').map(node => node.getAttribute('aria-label'))).toEqual(['コメント読み上げ', '配信者音声認識']);
  expect(document.getElementById('home-aiListener')).toBeNull();
  for (const page of ['配信中']) {
    navigate(page);
    expect(screen.getByRole('switch', { name: 'AIリスナー', exact: true })).toBeVisible();
  }
  navigate('設定'); fireEvent.click(document.getElementById('settings-aiListener')!);
  expect(screen.getByRole('heading', { name: 'AIリスナー', level: 1 })).toBeVisible();
  expect(api.mutate).not.toHaveBeenCalled();
});

const sizeRadio = (name:string) => within(screen.getByRole('group', { name:'管理画面の文字サイズ' })).getByRole('radio', { name:new RegExp(`^${name}`) });

it('中を既定とし、小中大の変更を即時反映・保存する。保存中は配色・サイズ・ポートの二重操作を防ぐ', async () => {
  render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-text-size', 'medium');
  expect(sizeRadio('標準')).toBeChecked();
  let finish!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish=resolve; }));
  fireEvent.click(sizeRadio('大'));
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-text-size', 'large');
  expect(document.querySelector('.management-shell')).toHaveStyle('--management-font-body: 18px');
  expect(portInput()).toBeDisabled();
  fireEvent.click(sizeRadio('小')); fireEvent.click(screen.getByRole('radio', { name:/パール/ }));
  expect(api.updateSettings).toHaveBeenCalledTimes(1);
  expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ managementTextSize:'large', managementTheme:'ocean', port:3000 }));
  expect(sizeRadio('大')).toBeChecked();
  await act(async () => finish());
  await act(async () => fireEvent.click(sizeRadio('小')));
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-text-size', 'small');
  navigate('ホーム');
  expect(screen.getByText('管理画面の文字サイズを保存しました。')).toBeVisible();
});

it('不正なポート入力を保持しながら別管理画面の配色と文字サイズを同期する', async () => {
  const view=render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  fireEvent.change(portInput(), { target:{ value:'' } });
  api.snapshot={ ...api.snapshot!, settingsRevision:api.snapshot!.settingsRevision+1, settings:{ ...api.snapshot!.settings,
    application:{ ...api.snapshot!.settings.application, managementTheme:'ivory', managementTextSize:'large' } } };
  view.rerender(<Dashboard />);
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-theme', 'ivory');
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-text-size', 'large');
  expect(sizeRadio('大')).toBeChecked();
  expect(portInput()).toHaveValue(null);
  expect(api.updateSettings).not.toHaveBeenCalled();
});

it('文字サイズの送信待ち中に変わった配色・ポート・ウィンドウ状態を実送信時に保持する', async () => {
  let finish!:()=>void;
  api.updateSettings.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const view=render(<Dashboard />); fireEvent.click(screen.getByRole('switch', { name:'コメント読み上げ', exact:true }));
  fireEvent.click(document.getElementById('home-application')!); fireEvent.click(sizeRadio('大'));
  const current={ ...api.snapshot!.settings.application, port:4321, managementTheme:'pearl' as const, commentListWindowVisible:true, managementWindow:{ width:910, height:710 } };
  api.snapshot={ ...api.snapshot!, settingsRevision:api.snapshot!.settingsRevision+1, settings:{ ...api.snapshot!.settings, application:current } };
  view.rerender(<Dashboard />); await act(async()=>finish());
  expect(api.updateSettings).toHaveBeenLastCalledWith('application', { ...current, managementTextSize:'large' });
});

it('ポートの送信待ち中に変わった文字サイズを保持する', async () => {
  let finish!:()=>void;
  api.updateSettings.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const view=render(<Dashboard />); fireEvent.click(screen.getByRole('switch', { name:'コメント読み上げ', exact:true }));
  fireEvent.click(document.getElementById('home-application')!);
  vi.useFakeTimers();
  try {
    fireEvent.change(portInput(), { target:{ value:'4321' } });
    await act(async()=>vi.advanceTimersByTimeAsync(500));
    api.snapshot={ ...api.snapshot!, settingsRevision:api.snapshot!.settingsRevision+1, settings:{ ...api.snapshot!.settings,
      application:{ ...api.snapshot!.settings.application, managementTextSize:'large' } } };
    view.rerender(<Dashboard />); await act(async()=>finish());
    expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ port:4321, managementTextSize:'large' }));
  } finally { vi.useRealTimers(); }
});

it('文字サイズ保存の失敗は選択を保持し、配色保存成功で未保存ポートのエラーを消さない', async () => {
  api.updateSettings.mockRejectedValueOnce(new Error('ポート保存失敗。')).mockRejectedValueOnce(new Error('サイズ保存失敗。'));
  render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  vi.useFakeTimers();
  try {
    fireEvent.change(portInput(), { target:{ value:'4321' } });
    await act(async()=>vi.advanceTimersByTimeAsync(500));
    await act(async()=>fireEvent.click(sizeRadio('大')));
    expect(screen.getByRole('button', { name:'文字サイズを再保存' })).toBeVisible();
    expect(sizeRadio('大')).toBeChecked();
    await act(async()=>fireEvent.click(screen.getByRole('button', { name:'文字サイズを再保存' })));
    expect(screen.queryByRole('button', { name:'文字サイズを再保存' })).not.toBeInTheDocument();
    await act(async()=>fireEvent.click(screen.getByRole('radio', { name:/パール/ })));
    expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ port:3000, managementTheme:'pearl', managementTextSize:'large' }));
    expect(screen.getByRole('button', { name:'再保存', exact:true })).toBeVisible();
    expect(portInput()).toHaveValue(4321);
  } finally { vi.useRealTimers(); }
});

it('別管理画面で失敗した文字サイズが保存されたら警告を消し、その後のサイズも同期する', async () => {
  api.updateSettings.mockRejectedValueOnce(new Error('サイズ保存失敗。'));
  const view=render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  await act(async()=>fireEvent.click(sizeRadio('大'))); navigate('設定');
  expect(document.getElementById('settings-application')).toHaveTextContent('要確認');
  for (const managementTextSize of ['large','small'] as const) {
    api.snapshot={ ...api.snapshot!, settingsRevision:api.snapshot!.settingsRevision+1, settings:{ ...api.snapshot!.settings,
      application:{ ...api.snapshot!.settings.application, managementTextSize } } };
    view.rerender(<Dashboard />);
    expect(document.getElementById('settings-application')).not.toHaveTextContent('要確認');
    expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-text-size', managementTextSize);
  }
  fireEvent.click(document.getElementById('settings-application')!);
  expect(screen.queryByRole('button', { name:'文字サイズを再保存' })).not.toBeInTheDocument();
});

it('文字サイズのHTTP応答前に届いた新しいsnapshotを保存成功後に表示する', async () => {
  let finish!:()=>void;
  api.updateSettings.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const view=render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!); fireEvent.click(sizeRadio('大'));
  api.snapshot={ ...api.snapshot!, settingsRevision:api.snapshot!.settingsRevision+2, settings:{ ...api.snapshot!.settings,
    application:{ ...api.snapshot!.settings.application, managementTextSize:'small' } } };
  view.rerender(<Dashboard />); await act(async()=>finish());
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-text-size', 'small');
  expect(sizeRadio('小')).toBeChecked();
});

it('既定のオーシャンと8配色を提供し、選択は即時反映・保存され、移動後も保持する', async () => {
  render(<Dashboard />);
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-theme', 'ocean');
  navigate('設定');
  const entry = document.getElementById('settings-application')!;
  fireEvent.click(entry);
  expect(screen.getByRole('heading', { name: 'アプリ設定', level: 1 })).toHaveFocus();
  expect(within(screen.getByRole('group', { name:'管理画面の配色' })).getAllByRole('radio')).toHaveLength(8);
  expect(within(screen.getByRole('group', { name:'管理画面の文字サイズ' })).getAllByRole('radio')).toHaveLength(3);
  expect(screen.getByRole('radio', { name: /オーシャン/ })).toBeChecked();
  let finish!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('radio', { name: /パール/ }));
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-theme', 'pearl');
  expect(screen.getAllByRole('radio').every(node => node.getAttribute('aria-disabled') === 'true')).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: /アイボリー/ }));
  expect(api.updateSettings).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('radio', { name: /パール/ })).toBeChecked();
  expect(api.updateSettings).toHaveBeenCalledWith('application', expect.objectContaining({ managementTheme: 'pearl', port: 3000 }));
  navigate('ホーム');
  await act(async () => finish());
  expect(screen.getByText('管理画面の配色を保存しました。')).toBeVisible();
  navigate('設定'); fireEvent.click(entry);
  expect(screen.getByRole('radio', { name: /パール/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '← 設定に戻る' }));
  expect(entry).toHaveFocus();
});

it('配色保存の失敗を表示し、選択を保って再保存できる', async () => {
  api.updateSettings.mockRejectedValueOnce(new Error('配色を保存できませんでした。'));
  render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  await act(async () => fireEvent.click(screen.getByRole('radio', { name: /サクラ/ })));
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-theme', 'sakura');
  expect(screen.getByRole('radio', { name: /サクラ/ })).toBeChecked();
  expect(screen.getByRole('button', { name: '配色を再保存' })).toBeVisible();
  navigate('設定'); fireEvent.click(document.getElementById('settings-application')!);
  expect(screen.getByRole('radio', { name: /サクラ/ })).toBeChecked();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '配色を再保存' })));
  expect(api.updateSettings).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: '配色を再保存' })).not.toBeInTheDocument();
});

it('別管理画面から保存された配色を同期し、ポートの不正入力を失わない', async () => {
  const view = render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  fireEvent.change(portInput(), { target: { value: '' } });
  expect(api.updateSettings).not.toHaveBeenCalled();
  expect(portInput()).toHaveValue(null);
  api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: {
    ...api.snapshot!.settings, application: { ...api.snapshot!.settings.application, managementTheme: 'ivory' },
  } };
  view.rerender(<Dashboard />);
  await waitFor(() => expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-theme', 'ivory'));
  expect(screen.getByRole('radio', { name: /アイボリー/ })).toBeChecked();
  expect(portInput()).toHaveValue(null);
  vi.useFakeTimers();
  try {
    fireEvent.change(portInput(), { target: { value: '4321' } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ port: 4321, managementTheme: 'ivory' }));
  } finally { vi.useRealTimers(); }
});

it('他セクションの保存待ち中でも配色を保存し、ポート編集で待機要求を失わない', async () => {
  let finish!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<Dashboard />);
  fireEvent.click(screen.getByRole('switch', { name: 'コメント読み上げ', exact: true }));
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  fireEvent.click(document.getElementById('home-application')!);
  fireEvent.click(screen.getByRole('radio', { name: /パール/ }));
  const port = portInput();
  expect(port).toBeDisabled();
  fireEvent.change(port, { target: { value: '' } });
  await act(async () => finish());
  expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ port: 3000, managementTheme: 'pearl' }));
  expect(screen.getByRole('radio', { name: /パール/ })).toBeEnabled();
  expect(port).toBeEnabled();
});

it('不正なポートを保持しながら配色を保存しても最新のウィンドウ状態を戻さない', async () => {
  const view = render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  fireEvent.change(portInput(), { target: { value: '' } });
  const current = { ...api.snapshot!.settings.application, commentListWindowVisible: true, managementWindow: { width: 900, height: 700 }, commentListWindow: { width: 600, height: 800 } };
  api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: { ...api.snapshot!.settings, application: current } };
  view.rerender(<Dashboard />);
  await act(async () => fireEvent.click(screen.getByRole('radio', { name: /バーガンディ/ })));
  expect(api.updateSettings).toHaveBeenLastCalledWith('application', { ...current, managementTheme: 'burgundy' });
  expect(portInput()).toHaveValue(null);
});

it('配色の送信待ち中に変わったポートとウィンドウ状態を実送信時に保持する', async () => {
  let finish!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<Dashboard />);
  fireEvent.click(screen.getByRole('switch', { name: 'コメント読み上げ', exact: true }));
  fireEvent.click(document.getElementById('home-application')!);
  fireEvent.click(screen.getByRole('radio', { name: /パール/ }));
  const current = { ...api.snapshot!.settings.application, port: 5000, commentListWindowVisible: true, managementWindow: { width: 910, height: 710 } };
  api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: { ...api.snapshot!.settings, application: current } };
  view.rerender(<Dashboard />);
  expect(portInput()).toHaveValue(5000);
  expect(screen.getByText(/OBS側のURLも変更してください/)).toBeVisible();
  await act(async () => finish());
  expect(api.updateSettings).toHaveBeenLastCalledWith('application', { ...current, managementTheme: 'pearl' });
  expect(screen.getByText(/OBS側のURLも変更してください/)).toBeVisible();
});

it('送信待ちの有効なポート変更を後から選んだ配色とともに保存する', async () => {
  let finish!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<Dashboard />);
  fireEvent.click(screen.getByRole('switch', { name: 'コメント読み上げ', exact: true }));
  fireEvent.click(document.getElementById('home-application')!);
  vi.useFakeTimers();
  try {
    fireEvent.change(portInput(), { target: { value: '4000' } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('radio', { name: /パール/ }));
    await act(async () => finish());
    expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ port: 4000, managementTheme: 'pearl' }));
    expect(portInput()).toHaveValue(4000);
    expect(screen.getByText(/OBS側のURLも変更してください/)).toBeVisible();
  } finally { vi.useRealTimers(); }
});

it('送信待ちのポートを不正入力で取り消した後は配色保存で古いポート変更を復活させない', async () => {
  let finish!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<Dashboard />);
  fireEvent.click(screen.getByRole('switch', { name: 'コメント読み上げ', exact: true }));
  fireEvent.click(document.getElementById('home-application')!);
  vi.useFakeTimers();
  try {
    const port = portInput();
    fireEvent.change(port, { target: { value: '4000' } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(port, { target: { value: '' } });
    fireEvent.click(screen.getByRole('radio', { name: /パール/ }));
    await act(async () => finish());
    expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ port: 3000, managementTheme: 'pearl' }));
    expect(port).toHaveValue(null);
    expect(document.querySelector('.app-field-hint')).toHaveTextContent('1024〜65535の整数を入力してください。');
  } finally { vi.useRealTimers(); }
});

it('配色保存の失敗後に後続のポート保存で同じ配色が保存されたら配色の要確認を消す', async () => {
  let failTheme!: (error: Error) => void;
  let finishPort!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failTheme = reject; }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { finishPort = resolve; }));
  const view = render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  vi.useFakeTimers();
  try {
    fireEvent.change(portInput(), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('radio', { name: /パール/ }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => failTheme(new Error('配色の保存に失敗しました。')));
    expect(screen.getByRole('button', { name: '配色を再保存' })).toBeVisible();
    expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ port: 4000, managementTheme: 'pearl' }));
    api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: {
      ...api.snapshot!.settings, application: { ...api.snapshot!.settings.application, port: 4000, managementTheme: 'pearl' },
    } };
    view.rerender(<Dashboard />);
    await act(async () => finishPort());
    expect(screen.queryByRole('button', { name: '配色を再保存' })).not.toBeInTheDocument();
    navigate('設定');
    expect(document.getElementById('settings-application')).not.toHaveTextContent('要確認');
  } finally { vi.useRealTimers(); }
});

it('ポート保存に失敗しても配色保存でポートを再送せず、ポートの入力と再保存を保持する', async () => {
  api.updateSettings.mockRejectedValueOnce(new Error('ポートの保存に失敗しました。'));
  render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  vi.useFakeTimers();
  try {
    fireEvent.change(portInput(), { target: { value: '4000' } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole('button', { name: '再保存', exact: true })).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /パール/ })));
    expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ port: 3000, managementTheme: 'pearl' }));
    expect(portInput()).toHaveValue(4000);
    expect(screen.getByRole('button', { name: '再保存', exact: true })).toBeVisible();
  } finally { vi.useRealTimers(); }
});

it('別管理画面で失敗した配色が保存されたら要確認を消し、その後の配色も同期する', async () => {
  api.updateSettings.mockRejectedValueOnce(new Error('配色の保存に失敗しました。'));
  const view = render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  const warningCount = document.getElementById('management-warning-entry')!.textContent;
  await act(async () => fireEvent.click(screen.getByRole('radio', { name: /パール/ })));
  navigate('設定');
  expect(document.getElementById('settings-application')).toHaveTextContent('要確認');
  for (const managementTheme of ['pearl', 'ivory'] as const) {
    api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: {
      ...api.snapshot!.settings, application: { ...api.snapshot!.settings.application, managementTheme },
    } };
    view.rerender(<Dashboard />);
    expect(document.getElementById('settings-application')).not.toHaveTextContent('要確認');
    expect(document.getElementById('management-warning-entry')).toHaveTextContent(warningCount!);
    expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-theme', managementTheme);
  }
  fireEvent.click(document.getElementById('settings-application')!);
  expect(screen.queryByRole('button', { name: '配色を再保存' })).not.toBeInTheDocument();
  fireEvent.click(document.getElementById('management-warning-entry')!);
  expect(document.getElementById('management-warning-dialog')).not.toHaveTextContent('配色の保存に失敗しました。');
});

it('別管理画面で配色が保存されても未保存ポートの入力・エラー・要確認を保持する', async () => {
  api.updateSettings.mockRejectedValueOnce(new Error('ポートの保存に失敗しました。'))
    .mockRejectedValueOnce(new Error('配色の保存に失敗しました。'));
  const view = render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  vi.useFakeTimers();
  try {
    fireEvent.change(portInput(), { target: { value: '4000' } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /パール/ })));
    api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: {
      ...api.snapshot!.settings, application: { ...api.snapshot!.settings.application, managementTheme: 'pearl' },
    } };
    view.rerender(<Dashboard />);
    expect(screen.queryByRole('button', { name: '配色を再保存' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再保存', exact: true })).toBeVisible();
    expect(portInput()).toHaveValue(4000);
    expect(document.querySelector('.app-field-hint')).toHaveTextContent('ポートの保存に失敗しました。');
    navigate('設定');
    expect(document.getElementById('settings-application')).toHaveTextContent('要確認');
  } finally { vi.useRealTimers(); }
});

it('保存済みの配色に戻して保存が失敗しても、回復後の別管理画面の配色を同期する', async () => {
  api.updateSettings.mockRejectedValueOnce(new Error('配色の保存に失敗しました。'))
    .mockRejectedValueOnce(new Error('配色の保存に失敗しました。'));
  const view = render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  await act(async () => fireEvent.click(screen.getByRole('radio', { name: /パール/ })));
  await act(async () => fireEvent.click(screen.getByRole('radio', { name: /オーシャン/ })));
  expect(screen.queryByRole('button', { name: '配色を再保存' })).not.toBeInTheDocument();
  api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: {
    ...api.snapshot!.settings, application: { ...api.snapshot!.settings.application, managementTheme: 'ivory' },
  } };
  view.rerender(<Dashboard />);
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-theme', 'ivory');
  expect(screen.getByRole('radio', { name: /アイボリー/ })).toBeChecked();
});

it('配色のHTTP応答前に届いた新しい管理snapshotを成功後に表示する', async () => {
  let finish!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  fireEvent.click(screen.getByRole('radio', { name: /パール/ }));
  for (const theme of ['pearl', 'ivory'] as const) {
    api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: {
      ...api.snapshot!.settings, application: { ...api.snapshot!.settings.application, managementTheme: theme },
    } };
    view.rerender(<Dashboard />);
  }
  await act(async () => finish());
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-theme', 'ivory');
  expect(screen.getByRole('radio', { name: /アイボリー/ })).toBeChecked();
});

it('配色のHTTP応答前に元の配色を指定した新しいsnapshotが届いた場合も同期する', async () => {
  let finish!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<Dashboard />); fireEvent.click(document.getElementById('home-application')!);
  fireEvent.click(screen.getByRole('radio', { name: /パール/ }));
  api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 2, settings: {
    ...api.snapshot!.settings, application: { ...api.snapshot!.settings.application, managementTheme: 'ocean' },
  } };
  view.rerender(<Dashboard />);
  await act(async () => finish());
  expect(document.querySelector('.management-shell')).toHaveAttribute('data-management-theme', 'ocean');
  expect(screen.getByRole('radio', { name: /オーシャン/ })).toBeChecked();
});

it('ポートの送信待ち中に別管理画面で変わった最新の配色を保持する', async () => {
  let finish!: () => void;
  api.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<Dashboard />);
  fireEvent.click(screen.getByRole('switch', { name: 'コメント読み上げ', exact: true }));
  fireEvent.click(document.getElementById('home-application')!);
  vi.useFakeTimers();
  try {
    fireEvent.change(portInput(), { target: { value: '4321' } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: {
      ...api.snapshot!.settings, application: { ...api.snapshot!.settings.application, managementTheme: 'pearl' },
    } };
    view.rerender(<Dashboard />);
    await act(async () => finish());
    expect(api.updateSettings).toHaveBeenLastCalledWith('application', expect.objectContaining({ port: 4321, managementTheme: 'pearl' }));
  } finally { vi.useRealTimers(); }
});

it.each(['commentSpeech', 'aiListener', 'speechRecognition', 'commentList'] as const)('%sの処理待ちを操作ページと設定編集の両方向で共有する', async key => {
  const service = { ready: false, message: '', account: null, latest: null };
  api.snapshot!.aiListener = { requested: false, status: 'stopped', message: '', nextAt: null, memoryCharacters: 0, hasKey: false, authorization: null,
    postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, services: { youtube: service, twitch: service, shitaraba: service, jpnkn: service } };
  // Starting AI requires a prepared participant; missing-key guidance has no start action.
  api.snapshot!.aiListener.hasKey = true;
  api.snapshot!.aiListener.services.shitaraba = { ...service, ready: true };
  api.snapshot!.settings.aiListener.personas = [{ id: 'p', name: '相棒', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];
  api.snapshot!.settings.aiListener.participants.shitaraba = { enabled: true, personaId: 'p' };
  api.snapshot!.speechRecognition.settingsRevision = 1;
  const labels = { commentSpeech: 'コメント読み上げ', aiListener: 'AIリスナー', speechRecognition: '配信者音声認識', commentList: 'コメント一覧' };
  const operationPage = key === 'aiListener' ? '配信中' : 'ホーム';
  const entryId = `${key === 'aiListener' ? 'live' : 'home'}-${key}`;
  const homeControl = () => key === 'commentList'
    ? within(screen.getAllByText(/^コメント一覧・/).find(node => !node.closest('[hidden]'))!.parentElement!).getByRole('button')
    : screen.getByRole('switch', { name: labels[key], exact: true });
  const editorControl = () => key === 'commentList' ? screen.getByRole('button', { name: 'ウィンドウを開く' })
    : key === 'aiListener' ? screen.getByRole('button', { name: '開始', exact: true })
    : screen.getByRole('switch', { name: key === 'speechRecognition' ? '配信者音声認識を配信に使う' : labels[key] });
  const expectBlocked = (control: HTMLElement) => {
    expect(control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.click(control);
  };
  const target = key === 'commentSpeech' ? api.updateSettings : api.mutate;
  for (const first of ['home', 'editor']) {
    let finish!: () => void;
    target.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<Dashboard />);
    navigate(operationPage);
    if (first === 'editor') fireEvent.click(document.getElementById(entryId)!);
    fireEvent.click(first === 'home' ? homeControl() : editorControl());
    await waitFor(() => expect(target).toHaveBeenCalledTimes(1));
    if (first === 'home') {
      fireEvent.click(document.getElementById(entryId)!); expectBlocked(editorControl());
    } else {
      navigate(operationPage); expectBlocked(homeControl());
    }
    expect(target).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    const control = first === 'home' ? editorControl() : homeControl();
    expect(control).not.toHaveAttribute('disabled'); expect(control).not.toHaveAttribute('aria-disabled', 'true');
    view.unmount(); vi.clearAllMocks();
  }
});

it.each(['コメント読み上げ', 'AIリスナー', '配信者音声認識', 'コメント一覧', 'キャラクター'])('%sの処理待ちは画面を移動しても重ねて要求できない', async name => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const service = { ready: false, message: '', account: null, latest: null };
  api.snapshot!.aiListener = { requested: false, status: 'stopped', message: '', nextAt: null, memoryCharacters: 0, hasKey: false, authorization: null,
    postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, services: { youtube: service, twitch: service, shitaraba: service, jpnkn: service } };
  if (name === 'コメント読み上げ') api.updateSettings.mockImplementationOnce(() => pending);
  else api.mutate.mockImplementationOnce(() => pending);
  const control = () => ['コメント一覧', 'キャラクター'].includes(name)
    ? within(screen.getAllByText(new RegExp(`^${name}・`)).find(node => !node.closest('[hidden]'))!.parentElement!).getByRole('button')
    : screen.getByRole('switch', { name, exact: true });
  render(<Dashboard />);
  if (name === 'AIリスナー') navigate('配信中');
  fireEvent.click(control());
  await waitFor(() => expect(name === 'コメント読み上げ' ? api.updateSettings : api.mutate).toHaveBeenCalledTimes(1));
  for (const page of ['配信中', 'ホーム']) {
    navigate(page);
    if (page === 'ホーム' && name === 'AIリスナー') {
      expect(screen.queryByRole('switch', { name, exact: true })).not.toBeInTheDocument();
      continue;
    }
    if (page === '配信中' && ['コメント一覧', 'キャラクター'].includes(name)) fireEvent.click(document.getElementById('live-windows')!);
    if (page === '配信中') expect(control()).toHaveAttribute('aria-disabled', 'true');
    else expect(control()).toBeDisabled();
    fireEvent.click(control());
  }
  expect(name === 'コメント読み上げ' ? api.updateSettings : api.mutate).toHaveBeenCalledTimes(1);
  if (name === 'AIリスナー') navigate('配信中');
  await act(async () => finish()); expect(control()).toBeEnabled();
});

it('画面を移動して要求が失敗した場合も通知し、音声認識を再操作できる', async () => {
  let fail!: (error: Error) => void;
  api.mutate.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  render(<Dashboard />); fireEvent.click(screen.getByRole('switch', { name: '配信者音声認識' })); navigate('配信中');
  expect(screen.getByRole('switch', { name: '配信者音声認識' })).toHaveAttribute('aria-disabled', 'true');
  await act(async () => fail(new Error('認識の切替を確認してください。')));
  fireEvent.click(screen.getByRole('button', { name: /要確認/ }));
  expect(screen.getByText('認識の切替を確認してください。')).toBeVisible();
  expect(screen.getByRole('switch', { name: '配信者音声認識' })).toBeEnabled();
});

it('設定から始めたウィンドウ操作が失敗しても共有ロックを解除して再操作できる', async () => {
  let fail!: (error: Error) => void;
  api.mutate.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  render(<Dashboard />); fireEvent.click(document.getElementById('home-commentList')!);
  fireEvent.click(screen.getByRole('button', { name: 'ウィンドウを開く' })); navigate('ホーム');
  const control = () => within(screen.getAllByText(/^コメント一覧・/).find(node => !node.closest('[hidden]'))!.parentElement!).getByRole('button');
  expect(control()).toBeDisabled();
  await act(async () => fail(new Error('ウィンドウ操作を確認してください。')));
  expect(control()).toBeEnabled(); fireEvent.click(screen.getByRole('button', { name: /要確認/ }));
  expect(screen.getByText('ウィンドウ操作を確認してください。')).toBeVisible();
});

it('3画面への移動は既存APIへ操作や設定保存を送らない', () => {
  render(<Dashboard />);
  for (const page of ['配信中', '設定', 'ホーム']) navigate(page);
  expect(api.updateSettings).not.toHaveBeenCalled(); expect(api.sourceAction).not.toHaveBeenCalled();
  expect(api.mutate).not.toHaveBeenCalled(); expect(api.obsSourceContext).not.toHaveBeenCalled(); expect(api.obsSourceAdd).not.toHaveBeenCalled();
});

it.each(['配信中'])('%sのコメント取得と認識切替は既存のAPIだけを使う', async page => {
  render(<Dashboard />); navigate(page);
  const workspace = within(document.querySelector('.management-live')!);
  if (page === '配信中') fireEvent.click(document.getElementById('live-connections-summary')!);
  await act(async () => fireEvent.click(workspace.getByRole('switch', { name: 'YouTube Liveのコメント取得' })));
  expect(api.sourceAction).toHaveBeenCalledExactlyOnceWith('youtube', 'start');
  expect(api.updateSettings).toHaveBeenCalledWith('sources', expect.objectContaining({ youtube: expect.objectContaining({ enabled: true }) }));
  if (page === '配信中') fireEvent.click(within(screen.getByRole('dialog', { name: 'コメントの接続' })).getByRole('button', { name: '閉じる' }));
  await act(async () => fireEvent.click(workspace.getByRole('switch', { name: '配信者音声認識' })));
  expect(api.mutate).toHaveBeenCalledExactlyOnceWith('/api/speech-recognition/enabled', 'PUT', { enabled: true });
});

it('配信中の主要操作は読み上げ・認識・AIの順で、AI確認待ちは設定から明示再開する', () => {
  const service = { ready: false, message: '', account: null, latest: null };
  api.snapshot!.aiListener = { requested: false, status: 'attention', message: '投稿先の連携を確認してください。', nextAt: null, memoryCharacters: 0, hasKey: false, authorization: null,
    postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, services: { youtube: service, twitch: service, shitaraba: service, jpnkn: service } };
  render(<Dashboard />); navigate('配信中');
  const operations = within(screen.getByRole('region', { name: 'いつもの操作' }));
  expect(operations.getAllByRole('switch').map(node => node.getAttribute('aria-label'))).toEqual(['コメント読み上げ', '配信者音声認識', 'AIリスナー']);
  expect(operations.getByRole('switch', { name: 'AIリスナー', exact: true })).toHaveAttribute('aria-disabled', 'true');
  expect(operations.getByText('設定で確認・再開', { exact: false })).toBeVisible();
  fireEvent.click(operations.getByRole('button', { name: 'AIリスナーの設定と状態' }));
  expect(screen.getByRole('heading', { name: 'AIリスナー', level: 1 })).toHaveFocus();
  expect(api.mutate).not.toHaveBeenCalled();
});

it('配信中の詳細は操作せずに開閉でき、詳細内から編集して戻ると常設の入口へ戻る', () => {
  render(<Dashboard />); navigate('配信中');
  const entry = document.getElementById('live-connections-summary')!;
  fireEvent.click(entry);
  let dialog = screen.getByRole('dialog', { name: 'コメントの接続' });
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' })); expect(entry).toHaveFocus();
  fireEvent.click(entry); dialog = screen.getByRole('dialog', { name: 'コメントの接続' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'YouTube Live ›' }));
  expect(screen.queryByRole('dialog', { name: 'コメントの接続' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('YouTube接続先')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '← 配信中に戻る' }));
  expect(entry).toHaveFocus();
  expect(api.sourceAction).not.toHaveBeenCalled(); expect(api.mutate).not.toHaveBeenCalled(); expect(api.updateSettings).not.toHaveBeenCalled();
});

it('OBS状態とスマホ準備は実状態から表示し、詳細の更新で閉じる操作のフォーカスを奪わない', () => {
  api.snapshot!.obsControl!.stream = 'unknown';
  const view = render(<Dashboard />); navigate('配信中');
  const obsEntry = document.getElementById('live-obs-settings')!;
  expect(obsEntry).toHaveTextContent('状態不明');
  fireEvent.click(obsEntry);
  const close = within(screen.getByRole('dialog', { name: 'OBSとの連携' })).getByRole('button', { name: '閉じる' }); close.focus();
  api.snapshot = { ...api.snapshot!, obsControl: { ...api.snapshot!.obsControl!, stream: 'streaming', error: '接続の確認が必要です。' } }; view.rerender(<Dashboard />);
  expect(close).toHaveFocus(); expect(obsEntry).toHaveTextContent('配信中');
  expect(screen.getByRole('dialog', { name: 'OBSとの連携' })).toHaveTextContent('接続の確認が必要です。');
  fireEvent.click(close); expect(obsEntry).toHaveFocus();
  fireEvent.click(document.getElementById('live-smartphone-settings')!);
  expect(screen.getByRole('dialog', { name: 'スマホの接続準備' })).toHaveTextContent('PCの接続準備です。スマホの接続・送信は端末で開始します。');
  expect(api.mutate).not.toHaveBeenCalled();
});
