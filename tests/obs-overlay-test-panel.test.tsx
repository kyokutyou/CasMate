// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ObsOverlayTestPanel, type ObsOverlayTestPanelProps } from '../src/renderer/components/ObsOverlayTestPanel';
import { obsRegistrationContext, obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import type { ObsSourceContext } from '../src/shared/obs-source-registration';

afterEach(cleanup);
function props(): ObsOverlayTestPanelProps {
  const context = { ...obsRegistrationContext(), candidates: [{ uuid: 'input', name: 'コメント' }], presentInputUuids: ['input'] };
  return { target: 'speech', active: true, unsaved: false, invalidSelector: '#invalid[aria-invalid="true"]', state: obsRegistrationSnapshot(), notice: vi.fn(),
    api: { mutate: vi.fn(async () => ({})), obsSourceContextRevision: 0, obsSourceContext: vi.fn(async () => context), obsTestContext: vi.fn(async () => ({ available: true, message: '' })), obsTestAction: vi.fn(async () => undefined) } };
}
const button = () => screen.getByRole('button', { name: 'OBSテスト（5秒）' });
const ready = () => waitFor(() => expect(button()).toHaveAttribute('aria-disabled', 'false'));

it('コメントはOBS未接続・登録なしでも1件を直接投入し、ソース選択を表示しない', async () => {
  const p = props(); p.target = 'comments'; p.state = { ...p.state!, obsControl: { ...p.state!.obsControl!, connection: 'disconnected' } };
  render(<ObsOverlayTestPanel {...p}/>);
  expect(screen.queryByLabelText('使用するOBSソース')).toBeNull();
  expect(screen.queryByRole('button', { name: 'OBSソースを再確認' })).toBeNull();
  const send = screen.getByRole('button', { name: 'コメント受信テスト' }); send.focus(); fireEvent.click(send);
  await waitFor(() => expect(p.api.mutate).toHaveBeenCalledExactlyOnceWith('/api/comments/test'));
  expect(p.api.obsSourceContext).not.toHaveBeenCalled(); expect(p.api.obsTestAction).not.toHaveBeenCalled();
  expect(p.notice).toHaveBeenCalledWith('テストコメントを1件投入しました。読み上げ・表示は通常の設定に従います。', false); expect(send).toHaveFocus();
  fireEvent.click(send); await waitFor(() => expect(p.api.mutate).toHaveBeenCalledTimes(2));
});
it('コメントの保存待ち・不正入力・二重送信を防ぎ、失敗を保持して再試行できる', async () => {
  const p = props(); p.target = 'comments';
  const view = render(<><input id="invalid" aria-invalid="true"/><ObsOverlayTestPanel {...p} unsaved/></>);
  fireEvent.click(screen.getByRole('button', { name: 'コメント受信テスト' })); expect(p.api.mutate).not.toHaveBeenCalled();
  view.rerender(<ObsOverlayTestPanel {...p}/>);
  let finish!: () => void;
  vi.mocked(p.api.mutate).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); }));
  const send = screen.getByRole('button', { name: 'コメント受信テスト' }); fireEvent.click(send); fireEvent.click(send);
  expect(p.api.mutate).toHaveBeenCalledOnce(); await act(async () => finish());
  vi.mocked(p.api.mutate).mockRejectedValueOnce(new Error('接続できません。')); fireEvent.click(send);
  await waitFor(() => expect(screen.getByLabelText('OBS表示テストの状態')).toHaveTextContent('接続できません。'));
  expect(p.notice).toHaveBeenLastCalledWith('接続できません。', true);
});

it('明示操作だけで現在ソースを再確認し、保存済み表示テストを開始する', async () => {
  const p = props(); render(<ObsOverlayTestPanel {...p}/>); await ready();
  expect(p.api.obsTestAction).not.toHaveBeenCalled();
  button().focus(); fireEvent.click(button());
  await waitFor(() => expect(p.api.obsTestAction).toHaveBeenCalledWith('start', { target: { kind: 'overlay', overlay: 'speech' }, collection: '配信', sceneUuid: 'scene-live', inputUuid: 'input' }));
  expect(p.api.obsSourceContext).toHaveBeenCalledTimes(2); expect(button()).toHaveFocus();
});

it('保存待ち・入力エラー・未接続では開始せず、実行中の共有テストは終了できる', async () => {
  const p = props(), view = render(<><input id="invalid" aria-invalid="false"/><ObsOverlayTestPanel {...p}/></>); await ready();
  await act(async () => document.getElementById('invalid')!.setAttribute('aria-invalid', 'true'));
  expect(button()).toHaveAttribute('aria-disabled', 'true'); fireEvent.click(button()); expect(p.api.obsTestAction).not.toHaveBeenCalled();
  p.unsaved = true;
  p.state = { ...p.state!, obsSourceTest: { busy: true, warnings: [], current: { target: { kind: 'overlay', overlay: 'speech' }, collection: '配信', sceneUuid: 's', inputUuid: 'other', id: 'shared', title: '音声認識', phase: 'preparing', startedAt: null, expiresAt: null, message: '準備中', needsAttention: false } } };
  view.rerender(<ObsOverlayTestPanel {...p}/>);
  fireEvent.click(screen.getByRole('button', { name: 'テスト終了' }));
  await waitFor(() => expect(p.api.obsTestAction).toHaveBeenCalledWith('stop', { testId: 'shared' }));
  p.state = { ...p.state!, obsControl: { ...p.state!.obsControl!, connection: 'disconnected' }, obsSourceTest: { busy: false, current: null, warnings: [] } };
  view.rerender(<ObsOverlayTestPanel {...p}/>);
  expect(button()).toHaveAttribute('aria-disabled', 'true'); expect(screen.getByLabelText('OBS表示テストの状態')).toHaveTextContent('OBSに接続していません');
});

it('複数候補は選択を要求し、所属していないソースを表示しない', async () => {
  const p = props();
  vi.mocked(p.api.obsSourceContext).mockResolvedValue({ ...obsRegistrationContext(), candidates: [{ uuid: 'a', name: '同名' }, { uuid: 'b', name: '同名' }, { uuid: 'outside', name: '別シーン' }], presentInputUuids: ['a', 'b'] });
  render(<ObsOverlayTestPanel {...p}/>);
  await waitFor(() => expect(screen.getByLabelText('使用するOBSソース')).toHaveAttribute('aria-disabled', 'false'));
  expect(button()).toHaveAttribute('aria-disabled', 'true'); expect(screen.queryByRole('option', { name: /別シーン/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('使用するOBSソース'), { target: { value: 'b' } }); await ready(); fireEvent.click(button());
  await waitFor(() => expect(p.api.obsTestAction).toHaveBeenCalledWith('start', expect.objectContaining({ inputUuid: 'b' })));
});

it('開始直前のシーン変更と取得失敗を表示し、自動再送しない', async () => {
  const p = props(); render(<ObsOverlayTestPanel {...p}/>); await ready();
  vi.mocked(p.api.obsSourceContext).mockRejectedValueOnce(new Error('OBSとの通信に失敗しました。'));
  fireEvent.click(button()); await waitFor(() => expect(p.notice).toHaveBeenCalledWith('OBSとの通信に失敗しました。', true));
  expect(p.api.obsTestAction).not.toHaveBeenCalled();
  vi.mocked(p.api.obsSourceContext).mockResolvedValueOnce({ ...obsRegistrationContext(), currentSceneUuid: 'changed' });
  fireEvent.click(button()); await waitFor(() => expect(p.notice).toHaveBeenCalledWith(expect.stringContaining('変わりました'), true));
  expect(p.api.obsTestAction).not.toHaveBeenCalled();
});

it.each(['hidden', 'unsaved', 'unmounted', 'otherTest'] as const)('再取得中に%sになったら開始しない', async change => {
  const p = props(), view = render(<ObsOverlayTestPanel {...p}/>); await ready();
  let finish!: (value: ObsSourceContext) => void;
  vi.mocked(p.api.obsSourceContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(button());
  await waitFor(() => expect(p.api.obsSourceContext).toHaveBeenCalledTimes(2));
  if (change === 'unmounted') view.unmount();
  else if (change === 'otherTest') view.rerender(<ObsOverlayTestPanel {...p} state={{ ...p.state!, obsSourceTest: { busy: true, current: null, warnings: [] } }}/>);
  else view.rerender(<ObsOverlayTestPanel {...p} active={change !== 'hidden'} unsaved={change === 'unsaved'}/>);
  await act(async () => finish({ ...obsRegistrationContext(), candidates: [{ uuid: 'input', name: 'コメント' }], presentInputUuids: ['input'] }));
  expect(p.api.obsTestAction).not.toHaveBeenCalled();
});

it('複数候補の再確認中も選択・フォーカスを保ち、変更操作は受理しない', async () => {
  const p = props();
  const context = { ...obsRegistrationContext(), candidates: [{ uuid: 'a', name: 'A' }, { uuid: 'b', name: 'B' }], presentInputUuids: ['a', 'b'] };
  vi.mocked(p.api.obsSourceContext).mockResolvedValue(context);
  const view = render(<ObsOverlayTestPanel {...p}/>);
  const select = screen.getByLabelText('使用するOBSソース');
  await waitFor(() => expect(select).toHaveAttribute('aria-disabled', 'false'));
  fireEvent.change(select, { target: { value: 'b' } }); select.focus();
  let finish!: (value: ObsSourceContext) => void;
  vi.mocked(p.api.obsSourceContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  view.rerender(<ObsOverlayTestPanel {...p} api={{ ...p.api, obsSourceContextRevision: 1 }}/>);
  expect(select).toHaveFocus(); expect(select).toHaveValue('b'); expect(select).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(select, { target: { value: 'a' } }); expect(select).toHaveValue('b');
  await act(async () => finish(context)); await ready(); expect(select).toHaveFocus(); expect(select).toHaveValue('b');
});

it('古い取得応答を無視し、候補なし・取得失敗から再確認できる', async () => {
  const p = props(); let finish!: (value: ObsSourceContext) => void;
  vi.mocked(p.api.obsSourceContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ObsOverlayTestPanel {...p}/>);
  p.api = { ...p.api, obsSourceContextRevision: 1 };
  vi.mocked(p.api.obsSourceContext).mockResolvedValueOnce(obsRegistrationContext());
  view.rerender(<ObsOverlayTestPanel {...p}/>);
  await waitFor(() => expect(screen.getByLabelText('OBS表示テストの状態')).toHaveTextContent('OBSにソースを追加'));
  await act(async () => finish({ ...obsRegistrationContext(), candidates: [{ uuid: 'old', name: '古い候補' }], presentInputUuids: ['old'] }));
  expect(screen.queryByRole('option', { name: /古い候補/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'OBSソースを再確認' })); await ready();
});
