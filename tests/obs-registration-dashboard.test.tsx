// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSnapshot } from '../src/shared/types';
import type { ObsSourceAddRequest, ObsSourceContext, ObsSourceOperation, ObsSourceTarget } from '../src/shared/obs-source-registration';
import { obsRegistrationContext, obsRegistrationOperation, obsRegistrationSnapshot } from './fixtures/obs-registration-state';

const mocks = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null,
  updateSettings: vi.fn(async () => undefined), sourceAction: vi.fn(async () => undefined), mutate: vi.fn(async () => undefined),
  uploadAsset: vi.fn(async () => undefined), listSpeechVoices: vi.fn(async () => []), smartphoneObsInput: vi.fn(async () => 'udp://127.0.0.1:10001'),
  obsSourceContext: vi.fn<(target: ObsSourceTarget) => Promise<ObsSourceContext>>(),
  obsSourceAdd: vi.fn<(request: ObsSourceAddRequest) => Promise<ObsSourceOperation | null>>(),
}));
vi.mock('../src/renderer/api', () => ({ useApplicationState: () => ({ ...mocks, connected: true, error: null }) }));
vi.mock('../src/renderer/windows-fonts', () => ({ loadWindowsFonts: async () => ['Yu Gothic UI'] }));
import { Dashboard } from '../src/renderer/pages/Dashboard';

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); mocks.snapshot = obsRegistrationSnapshot();
  mocks.obsSourceContext.mockImplementation(async target => obsRegistrationContext(target));
  mocks.obsSourceAdd.mockImplementation(async request => {
    const operation = { ...obsRegistrationOperation(request.target), id: request.retryOperationId ?? `operation-${JSON.stringify(request.target)}-${request.sceneUuid}`, sceneUuid: request.sceneUuid };
    const unfinishedOperations = (mocks.snapshot!.obsSourceRegistration?.unfinishedOperations ?? []).filter(value => value.id !== operation.id);
    mocks.snapshot = { ...mocks.snapshot!, obsSourceRegistration: { busy: false, lastOperation: operation, unfinishedOperations } };
    return operation;
  });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const modal = () => document.getElementById('obs-source-registration-dialog')!;
const warningModal = () => document.getElementById('management-warning-dialog')!;
const navigation = () => within(document.querySelector('.management-nav')!);
const urls = () => within(document.querySelector('.obs-urls-panel')!);
const phonePanel = () => within(document.querySelector('.smartphone-panel')!);
const toast = () => within(document.querySelector('.toast-region')!);
const home = () => within(document.querySelector('.management-home')!);
function openUrls() {
  fireEvent.click(navigation().getByRole('button', { name: '設定', exact: true }));
  fireEvent.click(within(document.querySelector('.management-categories')!).getByRole('button', { name: /^OBSにソースを追加/ }));
}

it.each([['comments', 'コメント'], ['speech', '音声認識'], ['character', 'キャラクター'], ['effects', '文字演出']] as const)('%sの入口から共通ダイアログを開き、明示追加だけを実行する', async (overlay, title) => {
  render(<Dashboard />); openUrls();
    const entry = urls().getByRole('button', { name: `${title}をOBSに追加` }); fireEvent.click(entry);
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(modal()).toHaveAccessibleName(`${title}をOBSに追加`);
    expect(mocks.obsSourceContext).toHaveBeenLastCalledWith({ kind: 'overlay', overlay });
    await act(async () => fireEvent.click(within(modal()).getByRole('button', { name: 'OBSに追加', exact: true })));
    expect(mocks.obsSourceAdd).toHaveBeenLastCalledWith({ target: { kind: 'overlay', overlay }, collection: '配信', sceneUuid: 'scene-live' });
    expect(toast().getByText('OBSへの登録設定を確認しました。')).toBeVisible();
    fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' })); expect(entry).toHaveFocus();
  expect(mocks.obsSourceAdd).toHaveBeenCalledOnce(); expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
});

it('OBSがOFFなら接続設定へ案内するだけで有効化・接続・登録しない', () => {
  mocks.snapshot!.obsControl = { ...mocks.snapshot!.obsControl!, enabled: false, connection: 'disabled' };
  render(<Dashboard />); openUrls(); fireEvent.click(urls().getByRole('button', { name: 'コメントをOBSに追加' }));
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('OBS連携がOFF');
  fireEvent.click(within(modal()).getByRole('button', { name: 'OBS接続を設定' }));
  expect(document.querySelector('dialog[open]')).toBeNull(); expect(document.getElementById('editor-heading')).toHaveTextContent('OBS操作');
  expect(mocks.obsSourceContext).not.toHaveBeenCalled(); expect(mocks.obsSourceAdd).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
});

it('手動URLコピーを共通トーストへ伝え、未完了登録の要確認を消さない', async () => {
  const operation = { ...obsRegistrationOperation(), status: 'incomplete' as const, message: '配置の確認が必要です。' };
  mocks.snapshot!.obsSourceRegistration = { busy: false, lastOperation: operation, unfinishedOperations: [operation] };
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<Dashboard />); openUrls(); fireEvent.click(urls().getByRole('button', { name: 'コメントをOBSに追加' }));
  fireEvent.click(within(modal()).getByText('URLを使って手動で追加'));
  await act(async () => fireEvent.click(within(modal()).getByRole('button', { name: 'URLをコピー' })));
  expect(writeText).toHaveBeenCalledExactlyOnceWith('http://localhost:3000/overlay/comments');
  expect(toast().getByText('コメントのURLをコピーしました。')).toBeVisible();
  expect(navigation().getByRole('button', { name: '要確認 1件' })).toBeVisible();
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent(operation.message);
  expect(mocks.obsSourceAdd).not.toHaveBeenCalled();
});

it('未完了結果は閉じた後・ページ移動後も要確認に残り、警告から同じ操作を再確認できる', async () => {
  const operation = { ...obsRegistrationOperation(), status: 'incomplete' as const, sceneUuid: 'scene-other', sceneName: '待機', message: '配置の確認が必要です。' };
  mocks.obsSourceAdd.mockImplementationOnce(async () => {
    mocks.snapshot = { ...mocks.snapshot!, obsSourceRegistration: { busy: false, lastOperation: operation, unfinishedOperations: [operation] } }; return operation;
  });
  render(<Dashboard />); openUrls(); fireEvent.click(urls().getByRole('button', { name: 'コメントをOBSに追加' }));
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
  mocks.obsSourceContext.mockImplementation(async target => ({ ...obsRegistrationContext(target), currentSceneUuid: 'scene-other' }));
  await act(async () => fireEvent.click(within(modal()).getByRole('button', { name: 'OBSに追加', exact: true })));
  expect(toast().queryByText(/確認が必要/)).toBeNull();
  fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' })); fireEvent.click(navigation().getByRole('button', { name: 'ホーム', exact: true }));
  const warningEntry = navigation().getByRole('button', { name: '要確認 1件' }); fireEvent.click(warningEntry);
  const warning = warningModal(); expect(warning).toHaveAccessibleName('要確認事項（1件）');
  fireEvent.click(within(warning).getByRole('button', { name: /コメント・待機：配置の確認が必要/ }));
  await waitFor(() => expect(modal()).toBeVisible()); expect(mocks.obsSourceAdd).toHaveBeenCalledOnce();
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
  await act(async () => fireEvent.click(within(modal()).getByRole('button', { name: '登録を再確認' })));
  expect(mocks.obsSourceAdd).toHaveBeenLastCalledWith({ target: operation.target, collection: operation.collection, sceneUuid: 'scene-other', inputUuid: operation.inputUuid, retryOperationId: operation.id });
  expect(navigation().getByRole('button', { name: '要確認 0件' })).toBeVisible();
  fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' })); expect(warningEntry).toHaveFocus();
}, 15_000);

it('スマホの映像入口は共通登録を使い、OFFの未登録経路でもOBSへ追加できる', async () => {
  render(<Dashboard />); fireEvent.click(home().getByRole('button', { name: /スマホ連携/ }));
  const entry = phonePanel().getByRole('button', { name: 'スマホAの映像をOBSに追加' }); fireEvent.click(entry);
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
  expect(mocks.obsSourceContext).toHaveBeenLastCalledWith({ kind: 'smartphone', deviceId: mocks.snapshot!.smartphone!.devices[0].id });
  fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' }));
  fireEvent.click(phonePanel().getByRole('button', { name: '外配信Tailscaleネットワーク' })); fireEvent.click(entry);
  await waitFor(() => expect(mocks.obsSourceContext).toHaveBeenCalledTimes(2));
  fireEvent.click(within(modal()).getByText('手動で追加する'));
  expect(within(modal()).getByText('「＋」→「メディアソース」')).toBeVisible();
  await waitFor(() => expect(within(modal()).getByRole('button', { name: 'OBSに追加', exact: true })).toHaveAttribute('aria-disabled', 'false'));
  fireEvent.click(within(modal()).getByRole('button', { name: 'OBSに追加', exact: true }));
  await waitFor(() => expect(mocks.obsSourceAdd).toHaveBeenCalledOnce()); expect(mocks.mutate).not.toHaveBeenCalled();
});

it('スマホの警告復旧入口でも未保存入力を回避して自動追加できない', () => {
  const target = { kind: 'smartphone', deviceId: mocks.snapshot!.smartphone!.devices[0].id } as const;
  mocks.snapshot!.obsSourceRegistration = { busy: false, lastOperation: { ...obsRegistrationOperation(target), status: 'incomplete', message: '配置の確認が必要です。' } };
  render(<Dashboard />); fireEvent.click(home().getByRole('button', { name: /スマホ連携/ }));
  fireEvent.change(phonePanel().getByRole('textbox', { name: 'スマホAの名前' }), { target: { value: '' } });
  fireEvent.click(within(document.querySelector('.obs-registration-recovery-slot:not([hidden])')!).getByRole('button', { name: /OBS登録の要確認を開く/ }));
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('未保存');
  fireEvent.click(within(modal()).getByRole('button', { name: '登録を再確認' }));
  expect(mocks.obsSourceContext).not.toHaveBeenCalled(); expect(mocks.obsSourceAdd).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
});

it('A未完了の後Bが成功してもAの復旧IDを要確認に残し、再読み込み状態から再開する', async () => {
  const a = { ...obsRegistrationOperation(), id: 'unfinished-a', status: 'incomplete' as const, message: 'Aの配置確認が必要です。' };
  mocks.obsSourceAdd.mockImplementationOnce(async () => {
    mocks.snapshot = { ...mocks.snapshot!, obsSourceRegistration: { busy: false, lastOperation: a, unfinishedOperations: [a] } }; return a;
  });
  const rendered = render(<Dashboard />); openUrls();
  fireEvent.click(urls().getByRole('button', { name: 'コメントをOBSに追加' }));
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
  await act(async () => fireEvent.click(within(modal()).getByRole('button', { name: 'OBSに追加', exact: true })));
  fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' }));
  fireEvent.click(urls().getByRole('button', { name: 'キャラクターをOBSに追加' }));
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
  await act(async () => fireEvent.click(within(modal()).getByRole('button', { name: 'OBSに追加', exact: true })));
  expect(mocks.snapshot!.obsSourceRegistration!.lastOperation!.target).toEqual({ kind: 'overlay', overlay: 'character' });
  expect(mocks.snapshot!.obsSourceRegistration!.unfinishedOperations).toEqual([a]);
  rendered.unmount(); render(<Dashboard />);
  fireEvent.click(navigation().getByRole('button', { name: '要確認 1件' }));
  expect(warningModal()).toHaveAccessibleName('要確認事項（1件）');
  fireEvent.click(within(warningModal()).getByRole('button', { name: /Aの配置確認が必要/ }));
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
  fireEvent.click(within(modal()).getByText('登録の詳細'));
  expect(within(modal()).getByLabelText('OBS登録の詳細')).toHaveTextContent('unfinished-a');
  await act(async () => fireEvent.click(within(modal()).getByRole('button', { name: '登録を再確認' })));
  expect(mocks.obsSourceAdd).toHaveBeenLastCalledWith({ target: a.target, collection: a.collection, sceneUuid: a.sceneUuid, inputUuid: a.inputUuid, retryOperationId: a.id });
  expect(navigation().getByRole('button', { name: '要確認 0件' })).toBeVisible();
}, 15_000);

it('未完了が複数ある管理状態から、各警告を選んで元の操作を開ける', async () => {
  const a = { ...obsRegistrationOperation(), id: 'unfinished-a', status: 'incomplete' as const, message: '本番の配置を確認してください。' };
  const c = { ...a, id: 'unfinished-c', status: 'unknown' as const, sceneUuid: 'scene-other', sceneName: '待機', message: '待機の配置を確認してください。' };
  mocks.snapshot!.obsSourceRegistration = { busy: false, lastOperation: obsRegistrationOperation({ kind: 'overlay', overlay: 'character' }), unfinishedOperations: [a, c] };
  render(<Dashboard />);
  for (const operation of [a, c]) {
    fireEvent.click(navigation().getByRole('button', { name: '要確認 2件' }));
    expect(warningModal()).toHaveAccessibleName('要確認事項（2件）');
    fireEvent.click(within(warningModal()).getByRole('button', { name: new RegExp(operation.message) }));
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
    expect(within(modal()).getByLabelText('未完了・結果不明の登録')).toHaveValue(operation.id);
    fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' }));
  }
  expect(mocks.obsSourceAdd).not.toHaveBeenCalled();
}, 15_000);

it('解消済みAの遅い結果が破棄された場合、共通通知と要確認を復活させない', async () => {
  const b = { ...obsRegistrationOperation({ kind: 'overlay', overlay: 'character' }), id: 'operation-b' };
  mocks.obsSourceAdd.mockImplementationOnce(async () => {
    mocks.snapshot = { ...mocks.snapshot!, obsSourceRegistration: { busy: false, lastOperation: b, unfinishedOperations: [] } };
    return null;
  });
  render(<Dashboard />); openUrls(); fireEvent.click(urls().getByRole('button', { name: 'コメントをOBSに追加' }));
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
  await act(async () => fireEvent.click(within(modal()).getByRole('button', { name: 'OBSに追加', exact: true })));
  expect(navigation().getByRole('button', { name: '要確認 0件' })).toBeVisible();
  expect(document.querySelector('.toast-region .banner')).toBeNull();
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('最終結果を受信できませんでした');
  expect(mocks.snapshot!.obsSourceRegistration).toEqual({ busy: false, lastOperation: b, unfinishedOperations: [] });
  expect(mocks.obsSourceAdd).toHaveBeenCalledOnce(); expect(mocks.obsSourceContext).toHaveBeenCalledTimes(3);
});
