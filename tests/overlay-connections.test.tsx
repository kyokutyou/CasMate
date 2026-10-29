// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSpeechRecognitionOverlay, useTextEffectsOverlay } from '../src/renderer/api';
import { createDefaultSettings } from '../src/main/core/settings';

class Socket extends EventTarget {
  static instances: Socket[] = [];
  constructor() { super(); Socket.instances.push(this); }
  close() {}
  receive(type: string, payload: unknown, revision = 1) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type, payload, revision }) }));
  }
}
type Kind = 'effects' | 'speech';
const appearance = (fontSizePx: number) => ({ ...createDefaultSettings().commentOverlay, fontSizePx });
const state = (kind: Kind, fontSizePx: number) => kind === 'effects'
  ? { settings: { textEffects: { ...createDefaultSettings().textEffects, fontSizePx } } }
  : { state: { active: null }, appearance: appearance(fontSizePx) };
function mount(kind: Kind) {
  if (kind === 'effects') {
    const hook = renderHook(useTextEffectsOverlay);
    return () => hook.result.current.settings?.fontSizePx;
  }
  const hook = renderHook(useSpeechRecognitionOverlay);
  return () => hook.result.current?.appearance.fontSizePx;
}
function publish(kind: Kind, socket: Socket, size: number) {
  socket.receive(kind === 'effects' ? 'state.snapshot' : 'speechRecognitionOverlay.snapshot', state(kind, size));
}
beforeEach(() => { Socket.instances = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['effects', 'speech'] as const)('%sは初期HTTPが無応答でもWSを開始し、遅いHTTPで新状態を巻き戻さない', async kind => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const size = mount(kind);
  expect(Socket.instances).toHaveLength(1);
  act(() => publish(kind, Socket.instances[0], 80));
  expect(size()).toBe(80);
  await act(async () => { finish({ ok: true, json: async () => kind === 'effects' ? { snapshot: state(kind, 32) } : state(kind, 32) } as Response); });
  expect(size()).toBe(80);
});

it.each(['effects', 'speech'] as const)('%sは再接続後に旧ソケットの遅延通知を無視する', async kind => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => kind === 'effects' ? { snapshot: state(kind, 32) } : state(kind, 32) })));
  const size = mount(kind);
  await act(async () => { await Promise.resolve(); });
  const old = Socket.instances[0];
  act(() => old.dispatchEvent(new Event('close')));
  act(() => { vi.advanceTimersByTime(1500); });
  expect(Socket.instances).toHaveLength(2);
  act(() => publish(kind, Socket.instances[1], 80));
  act(() => publish(kind, old, 24));
  expect(size()).toBe(80);
});

it.each(['effects', 'speech'] as const)('%sはHTTP失敗からWSで復旧し、終了後に接続を作らない', async kind => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  const size = mount(kind);
  await act(async () => { await Promise.resolve(); });
  expect(Socket.instances).toHaveLength(1);
  const socket = Socket.instances[0];
  act(() => publish(kind, socket, 80));
  expect(size()).toBe(80);
  cleanup();
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  expect(signal.aborted).toBe(true);
  act(() => { socket.dispatchEvent(new Event('close')); vi.advanceTimersByTime(2000); });
  expect(Socket.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
