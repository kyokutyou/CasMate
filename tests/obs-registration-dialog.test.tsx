// @vitest-environment jsdom
import { useState, type ContextType } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ObsSourceRegistrationDialog, type ObsSourceRegistrationEntry } from '../src/renderer/components/ObsSourceRegistrationDialog';
import type { ObsSourceContext, ObsSourceRegistrationState, ObsSourceTarget } from '../src/shared/obs-source-registration';
import { obsRegistrationContext, obsRegistrationOperation, obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { ManagementNavigation } from '../src/renderer/management-navigation';

const comments = { kind: 'overlay', overlay: 'comments' } as const;
const character = { kind: 'overlay', overlay: 'character' } as const;
const phone = { kind: 'smartphone', deviceId: '11111111-1111-4111-8111-111111111111' } as const;
type Overrides = Partial<Parameters<typeof ObsSourceRegistrationDialog>[0]>;
function setup(overrides: Overrides = {}, extraTarget?: ObsSourceTarget, navigation: ContextType<typeof ManagementNavigation> = null) {
  const initial = obsRegistrationSnapshot();
  const context = vi.fn(async (target: ObsSourceTarget) => obsRegistrationContext(target));
  const add = vi.fn(async (request: { target: ObsSourceTarget }) => obsRegistrationOperation(request.target));
  const onNotice = vi.fn(); const onStart = vi.fn();
  const props = { baseUrl: 'http://127.0.0.1:3000', obs: initial.obsControl, smartphone: initial.smartphone,
    state: { busy: false, lastOperation: null } as ObsSourceRegistrationState, context, add, onNotice, onStart, onCopyStart: vi.fn(), onCopyNotice: vi.fn(), ...overrides };
  function Harness({ options }: { options: typeof props }) {
    const [request, setRequest] = useState<ObsSourceRegistrationEntry | null>(null);
    return <ManagementNavigation.Provider value={navigation}><h2 id="editor-heading" tabIndex={-1}>設定画面</h2><button onClick={event => setRequest({ target: comments, title: 'コメントの入口名', entry: event.currentTarget })}>コメント入口</button>
      <h3 id="sp-device-list-heading" tabIndex={-1}>スマホ一覧</h3>
      <button onClick={event => setRequest({ target: character, title: 'キャラクターの入口名', entry: event.currentTarget })}>キャラクター入口</button>
      <button onClick={event => setRequest({ target: phone, title: 'スマホA', entry: event.currentTarget })}>スマホ入口</button>
      {extraTarget && <button onClick={event => setRequest({ target: extraTarget, title: '検証対象', entry: event.currentTarget })}>検証入口</button>}
      <ObsSourceRegistrationDialog {...options} request={request} onOpen={setRequest} onClose={() => setRequest(null)} /></ManagementNavigation.Provider>;
  }
  const rendered = render(<Harness options={props} />);
  return { ...props, update: (values: Overrides) => { Object.assign(props, values); rendered.rerender(<Harness options={{ ...props }} />); } };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = (name = 'コメント入口') => fireEvent.click(screen.getByRole('button', { name }));
const modal = () => screen.getByRole('dialog', { name: /をOBSに追加$/ });
const addButton = () => within(modal()).getByRole('button', { name: /^(OBSに追加|登録を再確認|OBS接続を設定)$/ });
const loaded = async () => waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('既存ソースを確認しています'));
const inputField = () => within(modal()).getByRole('combobox', { name: '使用するOBSソース' });
const sourceCard = () => within(modal()).getByRole('group', { name: '使用するOBSソースの内容' });

it('スマホの手動追加で入力を直接コピーし、二重取得を防いで通知する', async () => {
  let resolve!: (input: string) => void;
  const smartphoneObsInput = vi.fn(() => new Promise<string>(done => { resolve = done; }));
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const p = setup({ smartphoneObsInput }); open('スマホ入口'); await loaded();
  fireEvent.click(within(modal()).getByText('手動で追加する'));
  const button = within(modal()).getByRole('button', { name: 'OBS入力をコピー' });
  button.focus(); fireEvent.click(button); fireEvent.click(button);
  expect(smartphoneObsInput).toHaveBeenCalledOnce();
  expect(smartphoneObsInput).toHaveBeenCalledWith(phone.deviceId);
  await act(async () => resolve('udp://127.0.0.1:5000'));
  expect(writeText).toHaveBeenCalledWith('udp://127.0.0.1:5000');
  expect(p.onCopyNotice).toHaveBeenCalledWith('スマホAのOBS入力をコピーしました。', false);
  expect(button).toHaveFocus();
  p.update({ smartphoneBlockedReason: '未保存の入力があります。' });
  fireEvent.click(button);
  expect(smartphoneObsInput).toHaveBeenCalledOnce();
  p.update({ smartphoneBlockedReason: '', smartphoneObsInput: vi.fn(async () => { throw new Error('取得失敗'); }) });
  await act(async () => fireEvent.click(button));
  expect(p.onCopyNotice).toHaveBeenLastCalledWith(expect.stringContaining('OBS入力をコピーできませんでした'), true);
});

it.each(['対象を開き直す', '保存待ちになる', '接続が切れる', '接続し直す', '保存を完了する'])('入力取得中に%s場合は古いOBS入力をコピーしない', async change => {
  let resolve!: (input: string) => void;
  const smartphoneObsInput = vi.fn(() => new Promise<string>(done => { resolve = done; }));
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const p = setup({ smartphoneObsInput }); open('スマホ入口'); await loaded();
  fireEvent.click(within(modal()).getByText('手動で追加する'));
  fireEvent.click(within(modal()).getByRole('button', { name: 'OBS入力をコピー' }));
  if (change === '対象を開き直す') { fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' })); open('スマホ入口'); }
  else if (change === '保存待ちになる') p.update({ smartphoneBlockedReason: '未保存の入力があります。' });
  else if (change === '保存を完了する') { p.update({ smartphoneBlockedReason: '保存待ち' }); p.update({ smartphoneBlockedReason: '' }); }
  else { p.update({ smartphoneObsInput: undefined }); if (change === '接続し直す') p.update({ smartphoneObsInput }); }
  await act(async () => resolve('udp://127.0.0.1:5000'));
  expect(writeText).not.toHaveBeenCalled(); expect(p.onCopyNotice).not.toHaveBeenCalled();
});

it('追加先シーンを表示し、同名ソースは候補番号で選び、要求ではUUIDを使う', async () => {
  const context = vi.fn(async () => ({ ...obsRegistrationContext(), candidates: [
    { uuid: 'first-full-uuid', name: '同じ名前' }, { uuid: 'second-full-uuid', name: '同じ名前' },
  ] }));
  const p = setup({ context }); open(); await loaded();
  expect(within(modal()).getByLabelText('追加先のシーン')).toHaveTextContent('本番');
  expect(inputField()).toHaveTextContent('同じ名前（候補1）');
  expect(inputField()).toHaveTextContent('同じ名前（候補2）');
  expect(inputField()).not.toHaveTextContent('full-uuid');
  fireEvent.change(inputField(), { target: { value: 'second-full-uuid' } });
  fireEvent.click(within(modal()).getByText('登録の詳細'));
  const details = within(modal()).getByLabelText('OBS登録の詳細');
  expect(details).toHaveTextContent('候補1'); expect(details).toHaveTextContent('first-full-uuid');
  expect(details).toHaveTextContent('候補2'); expect(details).toHaveTextContent('second-full-uuid');
  await act(async () => fireEvent.click(addButton()));
  expect(p.add).toHaveBeenCalledWith(expect.objectContaining({ sceneUuid: 'scene-live', inputUuid: 'second-full-uuid' }));
});

it('追加先の再取得中・失敗・切断では古いシーン名を現在の追加先として表示しない', async () => {
  let finish!: (value: ObsSourceContext) => void;
  const context = vi.fn().mockResolvedValueOnce(obsRegistrationContext()).mockImplementationOnce(() => new Promise<ObsSourceContext>(resolve => { finish = resolve; })).mockRejectedValue(new Error('取得失敗'));
  const p = setup({ context }); open(); await loaded();
  const destination = () => within(modal()).getByLabelText('追加先のシーン');
  await waitFor(() => expect(destination()).toHaveTextContent('本番'));
  p.update({ contextRevision: 1 });
  expect(destination()).toHaveTextContent('確認中…'); expect(destination()).not.toHaveTextContent('本番');
  await act(async () => finish({ ...obsRegistrationContext(), currentSceneUuid: 'scene-other' }));
  expect(destination()).toHaveTextContent('待機');
  p.update({ contextRevision: 2 });
  await waitFor(() => expect(destination()).toHaveTextContent('取得できません'));
  expect(destination()).not.toHaveTextContent('待機');
  p.update({ obs: { ...obsRegistrationSnapshot().obsControl!, connection: 'unavailable' } });
  expect(destination()).toHaveTextContent('OBSに接続していません');
  expect(p.add).not.toHaveBeenCalled();
});

it('登録開始時の未取得シーン名は確認中と表示し、確定後は操作のシーン名を保持する', async () => {
  const p = setup(); open(); await loaded();
  const destination = () => within(modal()).getByLabelText('追加先のシーン');
  const running = { ...obsRegistrationOperation(), status: 'running' as const, phase: 'checking' as const, sceneName: '' };
  p.update({ state: { busy: true, lastOperation: running, unfinishedOperations: [] } });
  expect(destination()).toHaveTextContent('確認中…');
  p.update({ state: { busy: true, lastOperation: { ...running, phase: 'creatingInput', sceneName: '確定した追加先' }, unfinishedOperations: [] }, contextRevision: 1 });
  expect(destination()).toHaveTextContent('確定した追加先');
  expect(destination()).not.toHaveTextContent('本番');
  expect(p.add).not.toHaveBeenCalled();
});

it('スマホの準備不足で取得しない間は確認中とせず、解除後にシーンを取得する', async () => {
  const p = setup({ smartphoneBlockedReason: '未保存の入力があります。' }); open('スマホ入口');
  expect(within(modal()).getByLabelText('追加先のシーン')).toHaveTextContent('追加の準備が必要です');
  expect(p.context).not.toHaveBeenCalled();
  p.update({ smartphoneBlockedReason: '' });
  await waitFor(() => expect(within(modal()).getByLabelText('追加先のシーン')).toHaveTextContent('本番'));
  expect(p.context).toHaveBeenCalledOnce(); expect(p.add).not.toHaveBeenCalled();
});

it.each(['urls', 'smartphone'] as const)('%sの復旧一覧は対象の警告がある間だけ表示し、解消時は見出しへフォーカスを戻す', owner => {
  const p = setup({}, undefined, { editor: owner, open: vi.fn(), reportError: vi.fn() });
  expect(screen.queryByRole('heading', { name: 'OBS登録の確認' })).toBeNull();
  const target = owner === 'urls' ? comments : phone;
  const other = owner === 'urls' ? phone : comments;
  p.update({ recoveries: [{ key: 'other', target: other, title: '別画面', message: '別画面の問題' }] });
  expect(screen.queryByRole('heading', { name: 'OBS登録の確認' })).toBeNull();
  const warning = { key: 'current', target, title: '対象', message: '登録状態を確認してください。' };
  p.update({ recoveries: [warning] });
  expect(screen.getByRole('heading', { name: 'OBS登録の確認' })).toBeVisible();
  const button = screen.getByRole('button', { name: /登録状態を確認してください。・OBS登録の要確認を開く/ });
  act(() => button.focus()); p.update({ recoveries: [] });
  expect(screen.queryByRole('heading', { name: 'OBS登録の確認' })).toBeNull();
  expect(screen.getByRole('heading', { name: '設定画面' })).toHaveFocus();
  p.update({ recoveries: [warning] }); fireEvent.click(screen.getByRole('button', { name: /登録状態を確認してください。・OBS登録の要確認を開く/ }));
  expect(modal()).toBeVisible(); expect(p.add).not.toHaveBeenCalled();
});

it.each([false, true])('手動URLのコピーは重複を防ぎ、登録の警告を保持する（失敗=%s）', async failure => {
  let finish!: () => void;
  const writeText = vi.fn(() => new Promise<void>((resolve, reject) => { finish = () => failure ? reject(new Error('clipboard')) : resolve(); }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const operation = { ...obsRegistrationOperation(), status: 'incomplete' as const, message: '前回の登録を確認してください。' };
  const p = setup({ state: { busy: false, lastOperation: operation } }); open(); await loaded();
  expect(within(modal()).queryByText('未完了・結果不明の登録なし')).toBeNull();
  expect(within(modal()).queryByText(/既存ソースの不適合理由（0件）/)).toBeNull();
  fireEvent.click(within(modal()).getByText('URLを使って手動で追加'));
  const button = within(modal()).getByRole('button', { name: 'URLをコピー' });
  fireEvent.click(button); fireEvent.click(button);
  expect(writeText).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:3000/overlay/comments');
  expect(button).toHaveAttribute('aria-disabled', 'true'); expect(button).toHaveAttribute('aria-busy', 'true');
  expect(p.onCopyStart).toHaveBeenCalledOnce(); expect(p.onStart).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(button).toHaveAttribute('aria-disabled', 'false');
  expect(p.onCopyNotice).toHaveBeenCalledWith(failure ? 'URLをコピーできませんでした。表示されているURLを選択してコピーしてください。' : 'コメントのURLをコピーしました。', failure);
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent(operation.message);
  expect(p.onNotice).not.toHaveBeenCalled(); expect(p.add).not.toHaveBeenCalled();
});

it('開き直した画面では現在のシーンへの追加済みを実体から示し、過去の確認済みと区別する', async () => {
  const operation = obsRegistrationOperation();
  const context = vi.fn(async () => ({ ...obsRegistrationContext(),
    candidates: [{ uuid: operation.inputUuid!, name: '音声認識' }], presentInputUuids: [operation.inputUuid!] }));
  const p = setup({ context, state: { busy: false, lastOperation: operation } });
  open(); await loaded();
  const status = within(modal()).getByLabelText('OBS登録の状態');
  expect(status).toHaveTextContent('このシーンに追加済み');
  expect(status).not.toHaveTextContent('登録設定を確認済み');
  expect(status).not.toHaveTextContent('URLとサイズを自動で設定');
  expect(addButton()).toHaveTextContent('登録を再確認');
  expect(p.add).not.toHaveBeenCalled();
  fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' }));
  open(); await loaded();
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('このシーンに追加済み');
  expect(p.add).not.toHaveBeenCalled();
});

it('追加済み表示を削除通知で更新し、再取得に失敗しても古い所属を追加済みとしない', async () => {
  const initial = { ...obsRegistrationContext(), candidates: [{ uuid: 'shared-input', name: '共有コメント' }], presentInputUuids: ['shared-input'] };
  const context = vi.fn().mockResolvedValue(initial);
  const p = setup({ context }); open(); await loaded();
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('このシーンに追加済み');
  context.mockRejectedValueOnce(new Error('OBSへの問い合わせに失敗しました。'));
  p.update({ contextRevision: 1 });
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('一覧を更新できませんでした'));
  expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('このシーンに追加済み');
  expect(addButton()).toHaveAttribute('aria-disabled', 'true');
  context.mockResolvedValue({ ...initial, presentInputUuids: [] });
  p.update({ contextRevision: 2 });
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('既存ソースをこのシーンに追加できます'));
  expect(addButton()).toHaveTextContent('OBSに追加');
  expect(p.add).not.toHaveBeenCalled();
});

it.each(['failed', 'incomplete', 'unknown'] as const)('現在のシーンに存在しても%sの警告を追加済み表示で隠さない', async status => {
  const operation = { ...obsRegistrationOperation(), status, message: 'OBSで登録状態を確認してください。' };
  const context = vi.fn(async () => ({ ...obsRegistrationContext(),
    candidates: [{ uuid: operation.inputUuid!, name: '共有コメント' }], presentInputUuids: [operation.inputUuid!] }));
  const p = setup({ context, state: { busy: false, lastOperation: operation } }); open(); await loaded();
  const state = within(modal()).getByLabelText('OBS登録の状態');
  expect(state).toHaveTextContent('要確認');
  expect(state).toHaveTextContent(operation.message);
  expect(state).not.toHaveTextContent('このシーンに追加済み');
  expect(p.add).not.toHaveBeenCalled();
});

it('対象スマホを別画面で削除すると案内を閉じて一覧見出しへ戻り、再追加で開き直さない', async () => {
  const p = setup(); open('スマホ入口'); await loaded();
  const original = structuredClone(p.smartphone!);
  const smartphone = structuredClone(p.smartphone!); smartphone.devices = [];
  p.update({ smartphone });
  expect(screen.queryByRole('dialog', { name: /をOBSに追加$/ })).toBeNull();
  expect(screen.getByRole('heading', { name: 'スマホ一覧' })).toHaveFocus();
  p.update({ smartphone: original });
  expect(screen.queryByRole('dialog', { name: /をOBSに追加$/ })).toBeNull(); expect(p.add).not.toHaveBeenCalled();
});

it('一意の既存ソースは読取専用カードにし、UUIDと初期配置は詳細から確認できる', async () => {
  const context = vi.fn(async () => ({ ...obsRegistrationContext(), candidates: [{ uuid: 'manual-input', name: '手動で作ったコメント' }] }));
  const p = setup({ context }); open(); await loaded();
  expect(within(modal()).getByRole('heading', { name: 'コメントをOBSに追加' })).toBeVisible();
  expect(sourceCard()).toHaveTextContent('手動で作ったコメント'); expect(sourceCard()).toHaveTextContent('既存ソースの設定と配置を保持');
  expect(within(modal()).queryByRole('combobox')).toBeNull();
  expect(modal().querySelector('.obs-registration-details')).not.toHaveAttribute('open');
  expect(modal().querySelector('.obs-registration-manual')).not.toHaveAttribute('open');
  fireEvent.click(within(modal()).getByText('登録の詳細'));
  expect(within(modal()).getByLabelText('OBS登録の詳細')).toHaveTextContent('manual-input');
  await act(async () => fireEvent.click(addButton()));
  expect(p.add).toHaveBeenCalledWith({ target: comments, collection: '配信', sceneUuid: 'scene-live', inputUuid: 'manual-input' });
});

it('操作中の候補が一意に変わっても選択欄のフォーカスを維持し、欄を離れてからカードへ戻す', async () => {
  const initial = { ...obsRegistrationContext(), candidates: [{ uuid: 'a', name: 'A' }, { uuid: 'b', name: 'B' }] };
  const context = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, candidates: [initial.candidates[1]] });
  const p = setup({ context }); open(); await loaded(); const input = inputField();
  fireEvent.change(input, { target: { value: 'b' } }); act(() => input.focus()); p.update({ contextRevision: 1 });
  await waitFor(() => expect(context).toHaveBeenCalledTimes(2));
  expect(inputField()).toBe(input); expect(input).toHaveFocus(); expect(input).toHaveValue('b');
  act(() => addButton().focus()); expect(within(modal()).queryByRole('combobox')).toBeNull(); expect(sourceCard()).toHaveTextContent('B');
});

it('他操作の占有や切断で選択欄のフォーカスを失わず、操作と登録は拒否する', async () => {
  const context = vi.fn(async () => ({ ...obsRegistrationContext(), candidates: [{ uuid: 'a', name: 'A' }, { uuid: 'b', name: 'B' }] }));
  const p = setup({ context }); open(); await loaded(); const input = inputField();
  fireEvent.change(input, { target: { value: 'a' } }); act(() => input.focus());
  p.update({ obs: { ...p.obs!, busy: true } }); expect(input).toHaveFocus(); expect(input).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(input, { target: { value: 'b' } }); expect(input).toHaveValue('a'); fireEvent.click(addButton()); expect(p.add).not.toHaveBeenCalled();
  p.update({ obs: { ...p.obs!, connection: 'disconnected', busy: false } });
  expect(input).toHaveFocus(); expect(input).toBeVisible(); expect(input).toHaveAttribute('aria-disabled', 'true');
});

it('複数の未完了登録は詳細から選び、元の操作と入力だけを再確認する', async () => {
  const a = { ...obsRegistrationOperation(), id: 'a', status: 'incomplete' as const };
  const b = { ...a, id: 'b', inputUuid: 'another-input' };
  const p = setup({ state: { busy: false, lastOperation: a, unfinishedOperations: [a, b] } }); open(); await loaded();
  expect(addButton()).toHaveAttribute('aria-disabled', 'true'); expect(modal()).toHaveTextContent('「登録の詳細」で再確認する操作');
  fireEvent.click(within(modal()).getByText('登録の詳細')); fireEvent.change(within(modal()).getByRole('combobox', { name: '未完了・結果不明の登録' }), { target: { value: 'b' } });
  await act(async () => fireEvent.click(addButton()));
  expect(p.add).toHaveBeenCalledWith({ target: comments, collection: '配信', sceneUuid: 'scene-live', inputUuid: 'another-input', retryOperationId: 'b' });
});

it('未接続の主操作を接続設定にし、接続復帰時もフォーカス中の操作を保つ', async () => {
  const obs = obsRegistrationSnapshot().obsControl!;
  const navigate = vi.fn();
  const p = setup({ obs: { ...obs, connection: 'disconnected' } }, undefined, { editor: 'urls', open: navigate, reportError: vi.fn() }); open();
  const button = addButton(); expect(button).toHaveTextContent('OBS接続を設定'); act(() => button.focus());
  p.update({ obs }); await loaded();
  expect(button).toHaveFocus(); expect(button).toHaveTextContent('OBS接続を設定');
  act(() => within(modal()).getByRole('button', { name: '閉じる' }).focus());
  expect(addButton()).toBe(button); expect(button).toHaveTextContent('OBSに追加');
  p.update({ obs: { ...obs, connection: 'disconnected' } }); fireEvent.click(button);
  expect(navigate).toHaveBeenCalledWith('obsControl', expect.any(HTMLElement)); expect(p.add).not.toHaveBeenCalled();
});

it('未完了一覧が一件になっても操作中の選択欄を保持し、欄を離れてから読取表示へ戻す', async () => {
  const a = { ...obsRegistrationOperation(), id: 'a', status: 'incomplete' as const }, b = { ...a, id: 'b' };
  const p = setup({ state: { busy: false, lastOperation: a, unfinishedOperations: [a, b] } }); open(); await loaded();
  fireEvent.click(within(modal()).getByText('登録の詳細')); const input = within(modal()).getByRole('combobox', { name: '未完了・結果不明の登録' });
  fireEvent.change(input, { target: { value: 'a' } }); act(() => input.focus());
  p.update({ state: { busy: false, lastOperation: a, unfinishedOperations: [a] } }); expect(input).toHaveFocus(); expect(input).toBeVisible();
  act(() => addButton().focus()); expect(within(modal()).queryByRole('combobox', { name: '未完了・結果不明の登録' })).toBeNull();
  expect(within(modal()).getByLabelText('OBS登録の詳細')).toHaveTextContent('再確認する登録：配信・本番（a）');
});

it.each(['lan', 'tailscale', 'direct'] as const)('スマホ/%sでは表示テストを出さず、登録と通常送信の手順を残す', async network => {
  const target = phone;
  const smartphone = obsRegistrationSnapshot().smartphone!;
  smartphone.settings.activeNetwork = network;
  smartphone.devices[0].profiles[network] = { ...smartphone.devices[0].profiles.lan!, registered: true };
  const testContext = vi.fn(async () => ({ available: true, message: '' }));
  const testAction = vi.fn(async () => undefined);
  const p = setup({ smartphone, testContext, testAction }, target);
  open('検証入口'); await loaded();
  expect(within(modal()).queryByRole('button', { name: '表示テスト（5秒）' })).toBeNull();
  expect(within(modal()).queryByRole('button', { name: 'テスト終了' })).toBeNull();
  expect(within(modal()).queryByLabelText('OBS表示テストの状態')).toBeNull();
  expect(testContext).not.toHaveBeenCalled(); expect(testAction).not.toHaveBeenCalled();
  expect(modal()).toHaveTextContent('スマホで送信を開始し、OBSで映像・音声を確認します。');
  await act(async () => fireEvent.click(addButton()));
  expect(p.add).toHaveBeenCalledOnce();
});

it.each(['comments', 'speech', 'effects', 'character'] as const)('ブラウザ/%sでは表示テスト操作を残す', async overlay => {
  setup({}, { kind: 'overlay', overlay }); open('検証入口'); await loaded();
  expect(within(modal()).getByRole('button', { name: '表示テスト（5秒）' })).toBeVisible();
  expect(within(modal()).queryByRole('button', { name: 'テスト終了' })).toBeNull();
});


const refreshTargets: ObsSourceTarget[] = [comments, character, { kind: 'overlay', overlay: 'speech' }, { kind: 'overlay', overlay: 'effects' }, phone];
it.each(refreshTargets)('$kind/$overlayで選択欄を省き、追加前後の取得と登録結果・位置を保つ', async target => {
  const smartphone = obsRegistrationSnapshot().smartphone!;
  const initial = obsRegistrationContext(target), operation = obsRegistrationOperation(target);
  const updated = { ...initial, canvas: { width: 1280, height: 720 }, candidates: [{ uuid: operation.inputUuid!, name: '今回のソース' }] };
  const context = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockResolvedValue(updated);
  const p = setup({ smartphone, context, add: vi.fn(async () => operation) }, target);
  open('検証入口'); await loaded();
  expect(within(modal()).queryByLabelText('追加先シーン')).toBeNull(); expect(modal()).not.toHaveTextContent('コレクション：');
  expect(sourceCard()).toHaveTextContent('新しいソースを作成します'); expect(within(modal()).queryByRole('combobox')).toBeNull();
  const button = addButton(), body = modal().querySelector('.obs-registration-body')!; button.focus(); body.scrollTop = 45;
  await act(async () => fireEvent.click(button));
  await waitFor(() => expect(sourceCard()).toHaveAttribute('data-input-uuid', operation.inputUuid));
  expect(sourceCard()).toHaveTextContent('今回のソース'); expect(within(modal()).queryByRole('combobox')).toBeNull();
  expect(context).toHaveBeenCalledTimes(3); expect(p.add).toHaveBeenCalledExactlyOnceWith({ target, collection: initial.collection, sceneUuid: initial.currentSceneUuid });
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('登録設定を確認済み');
  expect(button).toHaveFocus(); expect(body.scrollTop).toBe(45);
  fireEvent.click(within(modal()).getByText('登録の詳細')); expect(within(modal()).getByText(/1280 × 720/)).toBeVisible();
});
it.each([false, true])('登録後にOBSで削除して開き直すと、過去の成功を今回の確認済みにしない（共有入力=%s）', async shared => {
  const operation = obsRegistrationOperation();
  const initial = obsRegistrationContext();
  const current = { ...initial, candidates: [{ uuid: operation.inputUuid!, name: '共有コメント' }] };
  const context = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockResolvedValue(current);
  const p = setup({ context }); open(); await loaded(); await act(async () => fireEvent.click(addButton()));
  await waitFor(() => expect(sourceCard()).toHaveTextContent('共有コメント'));
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('登録設定を確認済み');
  fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' }));
  context.mockResolvedValue(shared ? current : initial);
  open(); await waitFor(() => expect(sourceCard()).toHaveTextContent(shared ? '共有コメント' : '新しいソースを作成します'));
  expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('登録設定を確認済み');
  expect(within(modal()).getByRole('button', { name: 'OBSに追加', exact: true })).toHaveAttribute('aria-disabled', 'false');
  expect(p.add).toHaveBeenCalledOnce();
});

it('ボタン操作時に取得した現在のシーンへ追加し、開いた時点のシーンを送らない', async () => {
  const current = { ...obsRegistrationContext(), currentSceneUuid: 'scene-other' };
  const context = vi.fn().mockResolvedValueOnce(obsRegistrationContext()).mockResolvedValue(current);
  const p = setup({ context }); open(); await loaded(); expect(p.add).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(addButton()));
  expect(p.add).toHaveBeenCalledWith({ target: comments, collection: '配信', sceneUuid: 'scene-other' });
});
it('削除通知で前回の確認表示とテスト可否を更新し、操作中のフォーカスを維持する', async () => {
  const operation = obsRegistrationOperation(), initial = obsRegistrationContext();
  const current = { ...initial, candidates: [{ uuid: operation.inputUuid!, name: '共有コメント' }] };
  const context = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockResolvedValue(current);
  const testContext = vi.fn().mockResolvedValue({ available: true, message: '' });
  const p = setup({ context, testContext, testAction: vi.fn() }); open(); await loaded(); await act(async () => fireEvent.click(addButton()));
  await waitFor(() => expect(within(modal()).getByRole('button', { name: '表示テスト（5秒）' })).toHaveAttribute('aria-disabled', 'false'));
  const button = addButton(); act(() => button.focus());
  testContext.mockResolvedValue({ available: false, message: 'このOBSソースは対象のシーンに追加されていません。「OBSに追加」で追加してからテストしてください。' });
  p.update({ contextRevision: 1 });
  await waitFor(() => expect(within(modal()).getByLabelText('OBS表示テストの状態')).toHaveTextContent('対象のシーンに追加されていません'));
  expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('登録設定を確認済み');
  expect(button).toHaveTextContent('OBSに追加'); expect(button).toHaveFocus();
  expect(sourceCard()).toHaveTextContent('共有コメント'); expect(p.add).toHaveBeenCalledOnce();
  fireEvent.click(within(modal()).getByText('登録の詳細'));
  expect(within(modal()).getByLabelText('OBS登録の詳細')).toHaveTextContent(`前回の登録結果：${operation.message}`);
});

it('管理状態に前回の成功が残っていても、新しく開いた画面の確認済みとしない', async () => {
  const previous = obsRegistrationOperation();
  setup({ state: { busy: false, lastOperation: previous, unfinishedOperations: [] },
    context: vi.fn(async () => ({ ...obsRegistrationContext(), candidates: [{ uuid: previous.inputUuid!, name: '共有コメント' }] })) });
  open(); await waitFor(() => expect(sourceCard()).toHaveTextContent('共有コメント'));
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('追加できます');
  expect(addButton()).toHaveTextContent('OBSに追加');
});
it.each(['http', 'state'] as const)('削除通知の後に届いた%s成功で古い確認済みを復活させない', async delivery => {
  const terminal = obsRegistrationOperation(), running = { ...terminal, status: 'running' as const, phase: 'verifying' as const };
  const context = vi.fn(async () => ({ ...obsRegistrationContext(), candidates: [{ uuid: terminal.inputUuid!, name: '共有コメント' }] }));
  let finish!: (value: typeof terminal) => void;
  const p = setup({ context });
  const add = vi.fn(async () => {
    p.update({ state: { busy: true, lastOperation: running, unfinishedOperations: [] } });
    return delivery === 'http' ? new Promise<typeof terminal>(resolve => { finish = resolve; }) : running;
  });
  p.update({ add });
  open(); await loaded(); fireEvent.click(addButton()); await waitFor(() => expect(add).toHaveBeenCalledOnce());
  if (delivery === 'state') await waitFor(() => expect(context).toHaveBeenCalledTimes(2));
  p.update({ contextRevision: 1, state: { busy: false, lastOperation: terminal, unfinishedOperations: [] } });
  if (delivery === 'http') await act(async () => finish(terminal));
  await waitFor(() => expect(context).toHaveBeenCalledTimes(3));
  expect(within(modal()).getByLabelText('OBS登録の状態')).not.toHaveTextContent('登録設定を確認済み');
  expect(addButton()).toHaveTextContent('OBSに追加'); expect(add).toHaveBeenCalledOnce();
});
it('OBS変更イベントで候補を更新し、入力選択とフォーカスを同じコレクションで維持する', async () => {
  const initial = { ...obsRegistrationContext(), candidates: [{ uuid: 'a', name: 'A' }, { uuid: 'b', name: 'B' }] };
  const context = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, currentSceneUuid: 'scene-other' });
  const p = setup({ context, contextRevision: 0 }); open(); await loaded(); fireEvent.change(inputField(), { target: { value: 'b' } }); inputField().focus();
  p.update({ contextRevision: 1 }); await waitFor(() => expect(context).toHaveBeenCalledTimes(2));
  expect(inputField()).toHaveValue('b'); expect(inputField()).toHaveFocus();
  await act(async () => fireEvent.click(addButton()));
  expect(p.add).toHaveBeenCalledWith({ target: comments, collection: '配信', sceneUuid: 'scene-other', inputUuid: 'b' });
});
it('コレクション変更後は旧入力を引き継がず、一意な最新候補を使う', async () => {
  const initial = { ...obsRegistrationContext(), candidates: [{ uuid: 'old', name: '旧入力' }] };
  const current = { ...initial, collection: '新しい配信', candidates: [{ uuid: 'new', name: '新入力' }] };
  const context = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(current);
  const p = setup({ context }); open(); await loaded(); await act(async () => fireEvent.click(addButton()));
  expect(p.add).toHaveBeenCalledWith({ target: comments, collection: '新しい配信', sceneUuid: 'scene-live', inputUuid: 'new' });
});
it('削除された選択入力を別の一意な入力へ勝手に置換せず、利用者の選択を待つ', async () => {
  const initial = { ...obsRegistrationContext(), candidates: [{ uuid: 'old', name: '旧入力' }] };
  const context = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, candidates: [{ uuid: 'new', name: '新入力' }] });
  const p = setup({ context }); open(); await loaded(); p.update({ contextRevision: 1 });
  await waitFor(() => expect(inputField()).toHaveValue('')); expect(inputField()).toBeEnabled(); expect(addButton()).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(inputField(), { target: { value: 'new' } }); await act(async () => fireEvent.click(addButton()));
  expect(p.add).toHaveBeenCalledWith({ target: comments, collection: '配信', sceneUuid: 'scene-live', inputUuid: 'new' });
});
it('一意な手動候補を使い、同名の複数候補では選んだUUIDだけを送る', async () => {
  const initial = { ...obsRegistrationContext(), candidates: [{ uuid: 'a', name: 'コメント' }, { uuid: 'b', name: 'コメント' }] };
  const p = setup({ context: vi.fn(async () => initial) }); open(); await loaded();
  fireEvent.click(addButton()); expect(p.add).not.toHaveBeenCalled();
  fireEvent.change(inputField(), { target: { value: 'b' } }); await act(async () => fireEvent.click(addButton()));
  expect(p.add).toHaveBeenCalledWith({ target: comments, collection: '配信', sceneUuid: 'scene-live', inputUuid: 'b' });
});
it('登録後の取得失敗は成功を取り消さず、古い一覧での次の追加を止める', async () => {
  const context = vi.fn().mockResolvedValueOnce(obsRegistrationContext()).mockResolvedValueOnce(obsRegistrationContext()).mockRejectedValue(new Error('OBSが使用中です。'));
  const p = setup({ context }); open(); await loaded(); await act(async () => fireEvent.click(addButton()));
  await waitFor(() => expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('一覧を更新できませんでした'));
  expect(within(modal()).getByLabelText('OBS登録の状態')).toHaveTextContent('登録設定を確認済み');
  expect(addButton()).toHaveAttribute('aria-disabled', 'true'); fireEvent.click(addButton()); expect(p.add).toHaveBeenCalledOnce();
});
it('再取得中に閉じたら、まだ送信していない追加を止める', async () => {
  let finish!: (value: ObsSourceContext) => void;
  const context = vi.fn().mockResolvedValueOnce(obsRegistrationContext()).mockImplementationOnce(() => new Promise<ObsSourceContext>(resolve => { finish = resolve; }));
  const p = setup({ context }); open(); await loaded(); fireEvent.click(addButton());
  await waitFor(() => expect(context).toHaveBeenCalledTimes(2)); fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' }));
  await act(async () => finish(obsRegistrationContext())); expect(p.add).not.toHaveBeenCalled(); expect(p.onNotice).not.toHaveBeenCalled();
});
it('完了後の遅い再取得と別対象の取得を混ぜない', async () => {
  let finish!: (value: ObsSourceContext) => void;
  const context = vi.fn().mockResolvedValueOnce(obsRegistrationContext()).mockResolvedValueOnce(obsRegistrationContext())
    .mockImplementationOnce(() => new Promise<ObsSourceContext>(resolve => { finish = resolve; })).mockImplementation(async target => obsRegistrationContext(target));
  setup({ context }); open(); await loaded(); await act(async () => fireEvent.click(addButton()));
  await waitFor(() => expect(context).toHaveBeenCalledTimes(3)); fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' })); open('キャラクター入口'); await loaded();
  await act(async () => finish({ ...obsRegistrationContext(), candidates: [{ uuid: 'old', name: '古いコメント' }] }));
  expect(within(modal()).getByLabelText('OBSに追加する対象')).toHaveTextContent('キャラクター'); expect(sourceCard()).toHaveAttribute('data-input-uuid', '');
});
it('更新中の利用者による入力選択変更を完了時のUUIDで上書きしない', async () => {
  let finish!: (value: ObsSourceContext) => void;
  const initial = { ...obsRegistrationContext(), candidates: [{ uuid: 'a', name: 'A' }, { uuid: 'b', name: 'B' }] };
  const context = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockImplementationOnce(() => new Promise<ObsSourceContext>(resolve => { finish = resolve; }));
  const p = setup({ context, add: vi.fn(async () => ({ ...obsRegistrationOperation(), inputUuid: 'a' })) }); open(); await loaded();
  fireEvent.change(inputField(), { target: { value: 'a' } }); await act(async () => fireEvent.click(addButton()));
  await waitFor(() => expect(context).toHaveBeenCalledTimes(3)); inputField().focus(); fireEvent.change(inputField(), { target: { value: 'b' } });
  await act(async () => finish(initial)); expect(inputField()).toHaveValue('b'); expect(inputField()).toHaveFocus(); expect(p.add).toHaveBeenCalledOnce();
});
it('編集中のシーンが不明なら別シーンを選ばず、OBSでの選択を案内する', async () => {
  const p = setup({ context: vi.fn(async () => ({ ...obsRegistrationContext(), currentSceneUuid: null })) }); open(); await loaded();
  expect(modal()).toHaveTextContent('OBSで追加先のシーンを開いてください'); expect(addButton()).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(addButton()); expect(p.add).not.toHaveBeenCalled();
});
it('不適合ソースは理由を示し、重複作成しない', async () => {
  const p = setup({ context: vi.fn(async () => ({ ...obsRegistrationContext(), incompatible: [{ uuid: 'bad', name: '手動', reason: 'ローカルファイルがONです。' }] })) });
  open(); await loaded(); fireEvent.click(addButton()); expect(p.add).not.toHaveBeenCalled();
  fireEvent.click(within(modal()).getByText('登録の詳細')); expect(modal()).toHaveTextContent('ローカルファイルがONです。');
});
it.each(['disabled', 'unavailable'] as const)('OBSが%sなら接続と手動手順を案内する', connection => {
  const initial = obsRegistrationSnapshot(); const p = setup({ obs: { ...initial.obsControl!, enabled: connection !== 'disabled', connection } }); open();
  fireEvent.click(within(modal()).getByText('URLを使って手動で追加'));
  expect(within(modal()).getByLabelText('OBSへの手動登録手順')).toHaveTextContent('http://127.0.0.1:3000/overlay/comments');
  fireEvent.click(addButton()); expect(p.context).not.toHaveBeenCalled(); expect(p.add).not.toHaveBeenCalled();
});
it('未完了操作を元のシーンと操作IDで再確認し、別シーンへ移さない', async () => {
  const incomplete = { ...obsRegistrationOperation(), status: 'incomplete' as const, sceneUuid: 'scene-other', sceneName: '待機' };
  const current = { ...obsRegistrationContext(), currentSceneUuid: 'scene-other' };
  const p = setup({ state: { busy: false, lastOperation: incomplete }, context: vi.fn(async () => current) }); open(); await loaded();
  await act(async () => fireEvent.click(within(modal()).getByRole('button', { name: '登録を再確認' })));
  expect(p.add).toHaveBeenCalledWith({ target: comments, collection: '配信', sceneUuid: 'scene-other', inputUuid: 'source-created', retryOperationId: 'registration-1' });
});
it('OBSで別のシーンを開いている未完了操作は元のシーンを案内し、再送しない', async () => {
  const incomplete = { ...obsRegistrationOperation(), status: 'incomplete' as const, sceneUuid: 'scene-other', sceneName: '待機' };
  const p = setup({ state: { busy: false, lastOperation: incomplete } }); open(); await loaded();
  const button = within(modal()).getByRole('button', { name: '登録を再確認' }); expect(button).toHaveAttribute('aria-disabled', 'true'); fireEvent.click(button);
  expect(modal()).toHaveTextContent('シーン「待機」を開いて'); expect(p.add).not.toHaveBeenCalled();
});
it('running応答では状態の終端まで待ち、終端結果で一覧を更新する', async () => {
  const running = { ...obsRegistrationOperation(), status: 'running' as const };
  const terminal = { ...running, status: 'succeeded' as const };
  const context = vi.fn(async () => obsRegistrationContext());
  const p = setup({ context, state: { busy: false, lastOperation: null, unfinishedOperations: [] } });
  p.update({ add: vi.fn(async () => { p.update({ state: { busy: true, lastOperation: running, unfinishedOperations: [] } }); return running; }) });
  open(); await loaded(); await act(async () => fireEvent.click(addButton())); expect(context).toHaveBeenCalledTimes(2);
  p.update({ state: { busy: true, lastOperation: running, unfinishedOperations: [] } });
  p.update({ state: { busy: false, lastOperation: terminal, unfinishedOperations: [] } });
  await waitFor(() => expect(context).toHaveBeenCalledTimes(3)); expect(p.onNotice).toHaveBeenCalledExactlyOnceWith(terminal.message, 'success', comments, 'コメント');
});
it('再取得後に追加済み要求を連打しても送信は一度だけで、閉じた後も結果を通知する', async () => {
  let finish!: (value: ReturnType<typeof obsRegistrationOperation>) => void;
  const p = setup({ add: vi.fn(() => new Promise<ReturnType<typeof obsRegistrationOperation>>(resolve => { finish = resolve; })) }); open(); await loaded();
  const button = addButton(); fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(p.add).toHaveBeenCalledOnce());
  fireEvent.click(within(modal()).getByRole('button', { name: '閉じる' })); open('キャラクター入口'); await loaded();
  await act(async () => finish(obsRegistrationOperation())); expect(p.add).toHaveBeenCalledOnce();
  expect(within(modal()).getByLabelText('OBSに追加する対象')).toHaveTextContent('キャラクター'); expect(p.onNotice).toHaveBeenCalledOnce();
});
it.each(['failed', 'incomplete', 'unknown'] as const)('200の%s結果を成功とせず要確認に残す', async status => {
  const operation = { ...obsRegistrationOperation(), status, message: 'OBSで配置を確認してください。' };
  const p = setup({ add: vi.fn(async () => operation) }); open(); await loaded(); await act(async () => fireEvent.click(addButton()));
  expect(p.onNotice).toHaveBeenCalledWith(operation.message, 'error', comments, 'コメント'); expect(modal()).toHaveTextContent('要確認');
});
it('管理状態から失われた操作は成功と推測せず、再確認を案内する', async () => {
  const p = setup({ add: vi.fn(async () => null), state: { busy: false, lastOperation: null, unfinishedOperations: [] } }); open(); await loaded();
  await act(async () => fireEvent.click(addButton())); expect(modal()).toHaveTextContent('最終結果を受信できませんでした'); expect(p.onNotice).not.toHaveBeenCalled();
});
it('テストボタンも押した時点の対象を取得してから送信する', async () => {
  const initial = { ...obsRegistrationContext(), candidates: [{ uuid: 'a', name: 'A' }] };
  const context = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, currentSceneUuid: 'scene-other' });
  const action = vi.fn(async () => undefined);
  setup({ context, testContext: vi.fn(async () => ({ available: true, message: '' })), testAction: action }); open(); await loaded();
  const button = within(modal()).getByRole('button', { name: '表示テスト（5秒）' }); await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
  await act(async () => fireEvent.click(button)); expect(action).toHaveBeenCalledWith('start', { target: comments, collection: '配信', sceneUuid: 'scene-other', inputUuid: 'a' });
});
it('Tabを内部で循環し、Escで閉じて入口へフォーカスを戻す', async () => {
  const p = setup(); open(); await loaded(); const close = within(modal()).getByRole('button', { name: '閉じる' }); const last = within(modal()).getByText('URLを使って手動で追加');
  expect(close).toHaveFocus(); fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: 'Tab' }); expect(close).toHaveFocus(); fireEvent.keyDown(close, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('button', { name: 'コメント入口' })).toHaveFocus(); expect(p.add).not.toHaveBeenCalled();
});
