// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useApplicationState } from '../src/renderer/api';
import { obsRegistrationContext, obsRegistrationOperation, obsRegistrationSnapshot } from './fixtures/obs-registration-state';

class Socket extends EventTarget {
  static current: Socket;
  constructor() { super(); Socket.current = this; }
  close() {}
}
const json = (value: unknown, ok = true) => ({ ok, json: async () => value });
beforeEach(() => {
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ snapshot: obsRegistrationSnapshot(), operationToken: 'management-token' })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('初回の遅延bootstrapがWSの新しい表示テスト状態と要確認を消さない', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useApplicationState(true));
  const initial = obsRegistrationSnapshot();
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'state.snapshot', revision: 1, payload: initial }) })));
  const current = { target: { kind: 'overlay' as const, overlay: 'comments' as const }, collection: '配信', sceneUuid: 'scene-live', inputUuid: 'input', id: 'test', title: 'コメント',
    phase: 'unknown' as const, startedAt: 1, expiresAt: 5001, message: '要確認', needsAttention: true };
  const latest = { busy: true, current, warnings: [current] };
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'obsSourceTest.stateChanged', revision: 2, payload: latest }) })));
  await act(async () => { finish(json({ snapshot: initial, revision: 0, operationToken: 'management-token' }) as Response); });
  expect(result.current.snapshot?.obsSourceTest).toEqual(latest);
});
it('公開側の連番でbootstrapへ再同期した後も通常更新を受信する', async () => {
  const initial = obsRegistrationSnapshot();
  const { result } = renderHook(() => useApplicationState(false));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'state.snapshot', revision: 1, payload: initial }) })));
  const settings42 = { ...initial.settings, commentOverlay: { ...initial.settings.commentOverlay, fontSizePx: 42 } };
  vi.mocked(fetch).mockResolvedValueOnce(json({ snapshot: { ...initial, settings: settings42 }, revision: 3 }) as Response);
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'settings.changed', revision: 3, payload: { section: 'commentOverlay', value: settings42.commentOverlay, settingsRevision: 3 } }) })));
  await waitFor(() => expect(result.current.snapshot?.settings.commentOverlay.fontSizePx).toBe(42));
  const settings77 = { ...settings42, commentOverlay: { ...settings42.commentOverlay, fontSizePx: 77 } };
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'settings.changed', revision: 4, payload: { section: 'commentOverlay', value: settings77.commentOverlay, settingsRevision: 4 } }) })));
  expect(result.current.snapshot?.settings.commentOverlay.fontSizePx).toBe(77);
});

it('対象JSONを管理認証付き・no-storeで取得し、操作には別のトークンヘッダーを使う', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const target = { kind: 'smartphone' as const, deviceId: 'phone/id' };
  vi.mocked(fetch).mockResolvedValueOnce(json(obsRegistrationContext(target)) as Response);
  await act(async () => { expect(await result.current.obsSourceContext(target)).toEqual(obsRegistrationContext(target)); });
  expect(fetch).toHaveBeenLastCalledWith('/api/management/obs-sources/context?target=' + encodeURIComponent(JSON.stringify(target)),
    { cache: 'no-store', headers: { 'X-CasMate-Management': 'management-token' } });
  const request = { target, collection: '配信', sceneUuid: 'scene-live', inputUuid: 'shared-source' };
  const operation = obsRegistrationOperation(target); const snapshot = { ...obsRegistrationSnapshot(), obsSourceRegistration: { busy: false, lastOperation: operation } };
  vi.mocked(fetch).mockResolvedValueOnce(json({ operation, snapshot, revision: 3 }) as Response);
  await act(async () => { expect(await result.current.obsSourceAdd(request)).toEqual(operation); });
  expect(fetch).toHaveBeenLastCalledWith('/api/obs-sources/add', { method: 'POST', cache: 'no-store',
    headers: { 'X-CasMate-Token': 'management-token', 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  expect(result.current.snapshot?.obsSourceRegistration?.lastOperation).toEqual(operation);
});

it('200の未完了結果を成功へ変換せず、事前拒否のコードと理由を保つ', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const request = { target: { kind: 'overlay' as const, overlay: 'comments' as const }, collection: '配信', sceneUuid: 'scene-live' };
  const incomplete = { ...obsRegistrationOperation(), status: 'incomplete' as const, message: '配置を確認できません。' };
  vi.mocked(fetch).mockResolvedValueOnce(json({ operation: incomplete }) as Response);
  await act(async () => { expect(await result.current.obsSourceAdd(request)).toEqual(incomplete); });
  vi.mocked(fetch).mockResolvedValueOnce(json({ code: 'BUSY', message: '別のOBS操作を実行中です。' }, false) as Response);
  await expect(result.current.obsSourceAdd(request)).rejects.toMatchObject({ code: 'BUSY', message: '別のOBS操作を実行中です。' });
});

it('登録イベントを配信操作のlastOperationとは別に反映する', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const registration = { busy: true, lastOperation: { ...obsRegistrationOperation(), status: 'running' as const } };
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'obsSourceRegistration.stateChanged', revision: 1, payload: registration }) })));
  expect(result.current.snapshot?.obsSourceRegistration).toEqual(registration);
  expect(result.current.snapshot?.obsControl?.lastOperation).toBeNull();
});

it('新しいWSのB状態の後に古いHTTPのA snapshotが届いても巻き戻さない', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const request = { target: { kind: 'overlay' as const, overlay: 'comments' as const }, collection: '配信', sceneUuid: 'scene-live' };
  let returned!: Promise<ReturnType<typeof obsRegistrationOperation> | null>;
  act(() => { returned = result.current.obsSourceAdd(request); });
  const newer = { ...obsRegistrationSnapshot(), settingsRevision: 9,
    obsSourceRegistration: { busy: false, lastOperation: { ...obsRegistrationOperation({ kind: 'overlay', overlay: 'character' }), id: 'operation-b' }, unfinishedOperations: [] } };
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'state.snapshot', revision: 9, payload: newer }) })));
  await act(async () => { finish(json({ operation: obsRegistrationOperation(), snapshot: obsRegistrationSnapshot(), revision: 2 }) as Response); expect(await returned).toBeNull(); });
  expect(result.current.snapshot).toEqual(newer);
});

it('A復旧成功とB成功を受信した後、操作一覧から消えたAの古い未完了結果を返さない', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const a = obsRegistrationOperation();
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let returned!: Promise<ReturnType<typeof obsRegistrationOperation> | null>;
  act(() => { returned = result.current.obsSourceAdd({ target: a.target, collection: a.collection, sceneUuid: a.sceneUuid }); });
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'obsSourceRegistration.stateChanged', revision: 4,
    payload: { busy: false, lastOperation: a, unfinishedOperations: [] } }) })));
  const b = { ...obsRegistrationOperation({ kind: 'overlay', overlay: 'character' }), id: 'operation-b' };
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'obsSourceRegistration.stateChanged', revision: 5,
    payload: { busy: false, lastOperation: b, unfinishedOperations: [] } }) })));
  await act(async () => {
    finish(json({ operation: { ...a, status: 'incomplete' }, snapshot: obsRegistrationSnapshot(), revision: 2 }) as Response);
    expect(await returned).toBeNull();
  });
  expect(result.current.snapshot?.obsSourceRegistration).toEqual({ busy: false, lastOperation: b, unfinishedOperations: [] });
});

it('古い同操作IDの未完了応答より新しい共有状態の成功を優先する', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const operation = obsRegistrationOperation(); const latest = { busy: false, lastOperation: operation, unfinishedOperations: [] };
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'obsSourceRegistration.stateChanged', revision: 1, payload: latest }) })));
  vi.mocked(fetch).mockResolvedValueOnce(json({ operation: { ...operation, status: 'incomplete' }, snapshot: obsRegistrationSnapshot(), revision: 0 }) as Response);
  await act(async () => { expect(await result.current.obsSourceAdd({ target: operation.target, collection: operation.collection, sceneUuid: operation.sceneUuid })).toEqual(operation); });
  expect(result.current.snapshot?.obsSourceRegistration).toEqual(latest);
});


it('管理専用の対象変更イベントを受け、再接続snapshotでも再確認用のリビジョンを進める', async () => {
  const { result } = renderHook(() => useApplicationState(true)); await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const initial = result.current.snapshot;
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'obsSourceRegistration.contextInvalidated', revision: 1, payload: {} }) })));
  expect(result.current.obsSourceContextRevision).toBe(1); expect(result.current.snapshot).toEqual(initial);
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'state.snapshot', revision: 2, payload: initial }) })));
  expect(result.current.obsSourceContextRevision).toBe(2);
});
