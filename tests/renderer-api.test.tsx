// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useApplicationState } from '../src/renderer/api';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';

class Socket extends EventTarget {
  static current: Socket;
  constructor() { super(); Socket.current = this; }
  close() {}
}
const json = (value: unknown, ok = true) => ({ ok, json: async () => value }) as Response;
function recognitionSnapshot(revision: number, smartphoneDeviceId: string | null = null) {
  const snapshot = obsRegistrationSnapshot();
  snapshot.settings.speechRecognition = { ...snapshot.settings.speechRecognition, enabled: true,
    inputSource: smartphoneDeviceId ? 'smartphone' : 'microphone', smartphoneDeviceId };
  snapshot.speechRecognition.settingsRevision = revision;
  snapshot.speechRecognition.status = smartphoneDeviceId ? 'waitingForInput' : 'listening';
  return snapshot;
}
beforeEach(() => {
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ snapshot: recognitionSnapshot(1), revision: 1,
    operationToken: 'management-token' })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('キャラクターの表示オプション保存で古い素材・微動・ウィンドウ状態を送信しない', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  await act(async () => { await result.current.updateSettings('character', { ...result.current.snapshot!.settings.character, clickThrough: true }); });
  expect(fetch).toHaveBeenLastCalledWith('/api/character/options', expect.objectContaining({ method: 'PUT' }));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toEqual({ alwaysOnTop: true, clickThrough: true });
});

it('文字サイズの明示編集だけを部分保存し、通常の表示設定から古い外観を送信しない', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const value = { ...result.current.snapshot!.settings.commentOverlay, fontSizePx: 48 };
  await act(async () => { await result.current.updateSettings('commentOverlay', value, { commentFontSizePx: 48 }); });
  expect(fetch).toHaveBeenLastCalledWith('/api/obs-design/comments/options', expect.objectContaining({
    method: 'PUT', body: expect.any(String), headers: expect.objectContaining({ 'X-CasMate-Token': 'management-token' }),
  }));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toMatchObject({ fontSizePx: 48 });
  await act(async () => { await result.current.updateSettings('commentOverlay', { ...value, mode: 'single' }); });
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body));
  expect(body).toMatchObject({ mode: 'single' });
  expect(body).not.toHaveProperty('fontSizePx'); expect(body).not.toHaveProperty('design');
});

it('PCの操作応答が遅れても、スマホが変更した新しい認識設定を巻き戻さない', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: ReturnType<typeof result.current.mutate>;
  act(() => { pending = result.current.mutate('/api/speech-recognition/enabled', 'PUT', { enabled: true }); });
  const newer = recognitionSnapshot(3, '5f5b49c5-bb15-4371-95d5-1d10c66b84b2');
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', {
    data: JSON.stringify({ type: 'state.snapshot', revision: 5, payload: newer }),
  })));
  await act(async () => { finish(json({ snapshot: recognitionSnapshot(2), revision: 4 })); await pending; });
  expect(result.current.snapshot).toEqual(newer);
});

it('既存操作の版なし応答が遅れても、新しいWSの認識設定を巻き戻さない', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: ReturnType<typeof result.current.sourceAction>;
  act(() => { pending = result.current.sourceAction('youtube', 'start'); });
  const newer = recognitionSnapshot(3, '5f5b49c5-bb15-4371-95d5-1d10c66b84b2');
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', {
    data: JSON.stringify({ type: 'state.snapshot', revision: 5, payload: newer }),
  })));
  await act(async () => { finish(json({ snapshot: recognitionSnapshot(2) })); await pending; });
  expect(result.current.snapshot).toEqual(newer);
});

it.each([['upload', undefined], ['upload', 4], ['direct', undefined], ['direct', 4]] as const)(
  '%sの遅い応答(revision=%s)で新しいWS状態を巻き戻さない', async (kind, revision) => {
    const { result } = renderHook(() => useApplicationState(true));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<unknown>;
    act(() => { pending = kind === 'upload' ? result.current.uploadAsset('closed', new File(['png'], 'closed.png', { type: 'image/png' }))
      : result.current.smartphoneDirectAction('retry'); });
    const newer = recognitionSnapshot(3, '5f5b49c5-bb15-4371-95d5-1d10c66b84b2');
    act(() => Socket.current.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'state.snapshot', revision: 5, payload: newer }),
    })));
    await act(async () => { finish(json({ snapshot: recognitionSnapshot(2), ...(revision === undefined ? {} : { revision }) })); await pending; });
    expect(result.current.snapshot).toEqual(newer);
  },
);

it.each(['upload', 'direct'])('%sの新しい版付き応答を受理した後は古いWS差分を無視する', async kind => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const newer = recognitionSnapshot(3, '5f5b49c5-bb15-4371-95d5-1d10c66b84b2');
  vi.mocked(fetch).mockResolvedValueOnce(json({ snapshot: newer, revision: 5 }));
  await act(async () => {
    if (kind === 'upload') await result.current.uploadAsset('closed', new File(['png'], 'closed.png', { type: 'image/png' }));
    else await result.current.smartphoneDirectAction('retry');
  });
  expect(result.current.snapshot).toEqual(newer);
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
    type: 'settings.changed', revision: 4, payload: { section: 'speechRecognition',
      value: recognitionSnapshot(2).settings.speechRecognition, settingsRevision: 2 },
  }) })));
  expect(result.current.snapshot).toEqual(newer);
});

it('新しい操作snapshotの版を進め、その後の古いWSイベントを反映しない', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const newer = recognitionSnapshot(3, '5f5b49c5-bb15-4371-95d5-1d10c66b84b2');
  vi.mocked(fetch).mockResolvedValueOnce(json({ snapshot: newer, revision: 5 }));
  await act(async () => { await result.current.mutate('/api/speech-recognition/input', 'PUT', {
    revision: 2, inputSource: 'smartphone', smartphoneDeviceId: newer.settings.speechRecognition.smartphoneDeviceId,
  }); });
  expect(result.current.snapshot).toEqual(newer);
  act(() => Socket.current.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
    type: 'settings.changed', revision: 4, payload: { section: 'speechRecognition',
      value: recognitionSnapshot(2).settings.speechRecognition, settingsRevision: 2 },
  }) })));
  expect(result.current.snapshot).toEqual(newer);
});

it('入力競合のエラーコードと理由を保持し、失敗応答のsnapshotを適用しない', async () => {
  const { result } = renderHook(() => useApplicationState(true));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const before = result.current.snapshot;
  vi.mocked(fetch).mockResolvedValueOnce(json({ snapshot: recognitionSnapshot(99), revision: 99,
    code: 'SPEECH_SETTINGS_CONFLICT', message: '別の端末で音声認識の設定が変更されました。' }, false));
  await expect(result.current.mutate('/api/speech-recognition/settings', 'PUT', {})).rejects.toMatchObject({
    code: 'SPEECH_SETTINGS_CONFLICT', message: '別の端末で音声認識の設定が変更されました。',
  });
  expect(result.current.snapshot).toEqual(before);
});
