// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useObsDisplayTest } from '../src/renderer/use-obs-display-test';
import { createDefaultSettings } from '../src/main/core/settings';
class Socket extends EventTarget {
  static all: Socket[] = [];
  constructor(readonly url: string) { super(); Socket.all.push(this); }
  close() { this.dispatchEvent(new Event('close')); }
  frame(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); Socket.all = []; });
function display(id: string, now = Date.now()) { return { testId: id, startedAt: now, expiresAt: now + 5000, data: { kind: 'comments', appearance: createDefaultSettings().commentOverlay } }; }
it('joins reconnect phase, accepts a restarted server and rejects late sockets/bootstrap', async () => {
  vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket);
  let resolve!: (value: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r; })));
  const hook = renderHook(() => useObsDisplayTest('comments'));
  act(() => Socket.all[0].frame({ revision: 8, display: display('one') }));
  expect(hook.result.current?.testId).toBe('one');
  act(() => Socket.all[0].frame({ revision: 7, display: null })); expect(hook.result.current?.testId).toBe('one');
  act(() => Socket.all[0].close()); await act(() => vi.advanceTimersByTimeAsync(1000));
  act(() => Socket.all[1].frame({ revision: 1, display: display('two') })); expect(hook.result.current?.testId).toBe('two');
  act(() => Socket.all[0].frame({ revision: 99, display: null }));
  await act(async () => { resolve({ ok: true, json: async () => ({ revision: 100, display: null }) }); });
  expect(hook.result.current?.testId).toBe('two');
});
it('does not extend the deadline or resurrect an expired ID on reconnect', async () => {
  vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  const hook = renderHook(() => useObsDisplayTest('comments')); const sample = display('one');
  act(() => Socket.all[0].frame({ revision: 1, display: sample }));
  await act(() => vi.advanceTimersByTimeAsync(3000));
  act(() => Socket.all[0].close()); await act(() => vi.advanceTimersByTimeAsync(1000));
  act(() => Socket.all[1].frame({ revision: 1, display: sample }));
  await act(() => vi.advanceTimersByTimeAsync(1000)); expect(hook.result.current).toBeNull();
  act(() => Socket.all[1].frame({ revision: 2, display: display('one') })); expect(hook.result.current).toBeNull();
});
it('does not subscribe an independent presentation or preview', () => {
  vi.stubGlobal('WebSocket', Socket); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const hook = renderHook(() => useObsDisplayTest('character', false));
  expect(hook.result.current).toBeNull(); expect(Socket.all).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
});
