// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useObsControlSettings } from '../src/renderer/use-obs-control-settings';
import { obsControlView as view } from './fixtures/obs-control-view';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('retains the enable intent and password on save failure and commits both on retry', async () => {
  const configure = vi.fn(async () => {}).mockRejectedValueOnce(new Error('パスワード未設定'));
  const { result } = renderHook(() => useObsControlSettings({ ...view, enabled: false, passwordConfigured: false }, configure));
  await act(() => result.current.change('enabled', true, 'immediate'));
  configure.mockRejectedValueOnce(new Error('保存に失敗しました'));
  act(() => { void result.current.change('connection', { port: '4455', password: 'first-secret' }, 'blur'); });
  await act(() => result.current.save('connection'));
  expect(configure).toHaveBeenLastCalledWith({ port: 4455, password: 'first-secret', enabled: true });
  expect(result.current.draft.enabled).toBe(true);
  expect(result.current.draft.connection.password).toBe('first-secret');
  expect(result.current.unsaved).toBe(true);
  await act(() => result.current.save('connection'));
  expect(configure).toHaveBeenCalledTimes(3);
  expect(result.current.draft.connection.password).toBe('');
  expect(result.current.unsaved).toBe(false);
  expect(Object.values(result.current.errors).filter(Boolean)).toEqual([]);
});

it('does not enable OBS if the user turns it off before saving the first password', async () => {
  const configure = vi.fn(async () => {}).mockRejectedValueOnce(new Error('パスワード未設定'));
  const { result } = renderHook(() => useObsControlSettings({ ...view, enabled: false, passwordConfigured: false }, configure));
  await act(() => result.current.change('enabled', true, 'immediate'));
  act(() => { void result.current.change('connection', { port: '4455', password: 'first-secret' }, 'blur'); });
  await act(() => result.current.change('enabled', false, 'immediate'));
  await act(() => result.current.save('connection'));
  expect(configure.mock.calls).toEqual([[{ enabled: true }], [{ enabled: false }], [{ port: 4455, password: 'first-secret' }]]);
  expect(result.current.unsaved).toBe(false);
});

it('keeps a newer off intent when a combined connection save completes slowly', async () => {
  let complete!: () => void;
  const configure = vi.fn<(_: unknown) => Promise<void>>().mockRejectedValueOnce(new Error('パスワード未設定'));
  const { result, rerender } = renderHook(({ remote }) => useObsControlSettings(remote, configure),
    { initialProps: { remote: { ...view, enabled: false, passwordConfigured: false } } });
  await act(() => result.current.change('enabled', true, 'immediate'));
  configure.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue(undefined);
  act(() => { void result.current.change('connection', { port: '4455', password: 'first-secret' }, 'blur'); });
  let first!: Promise<boolean>;
  await act(async () => { first = result.current.save('connection'); await Promise.resolve(); });
  let off!: Promise<boolean>;
  act(() => { off = result.current.change('enabled', false, 'immediate'); });
  rerender({ remote: { ...view, enabled: true, passwordConfigured: true } });
  expect(result.current.draft.enabled).toBe(false);
  await act(async () => { complete(); await first; await off; });
  expect(configure).toHaveBeenLastCalledWith({ enabled: false });
  expect(result.current.draft.enabled).toBe(false);
  expect(result.current.unsaved).toBe(false);
});

it('saves phrases 500ms after IME completion and keeps invalid drafts', async () => {
  vi.useFakeTimers();
  const configure = vi.fn(async () => {});
  const { result } = renderHook(() => useObsControlSettings(view, configure));
  act(() => {
    result.current.composition('phrases', true);
    void result.current.change('phrases', { ...view.phrases, startCommand: '配信を開始して' }, 'deferred');
  });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(configure).not.toHaveBeenCalled();
  act(() => result.current.composition('phrases', false));
  await act(() => vi.advanceTimersByTimeAsync(499));
  expect(configure).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(configure).toHaveBeenCalledWith({ phrases: { ...view.phrases, startCommand: '配信を開始して' } });
  act(() => { void result.current.change('phrases', { ...view.phrases, startCommand: '' }, 'deferred'); });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(configure).toHaveBeenCalledTimes(1);
  expect(result.current.draft.phrases.startCommand).toBe('');
  expect(result.current.errors.phrases).toBeTruthy();
  expect(result.current.unsaved).toBe(true);
});

it('batches connection edits, retains password on failure and clears it only on successful save', async () => {
  const configure = vi.fn(async () => {}).mockRejectedValueOnce(new Error('保存先にアクセスできません'));
  const { result, rerender } = renderHook(({ remote }) => useObsControlSettings(remote, configure), { initialProps: { remote: view } });
  act(() => { void result.current.change('connection', { port: '4456', password: 'new-secret' }, 'blur'); });
  expect(configure).not.toHaveBeenCalled();
  await act(() => result.current.save('connection'));
  expect(configure).toHaveBeenCalledWith({ port: 4456, password: 'new-secret' });
  expect(result.current.errors.connection).toContain('保存先');
  rerender({ remote: { ...view, obsPort: 4457 } });
  expect(result.current.draft.connection).toEqual({ port: '4456', password: 'new-secret' });
  await act(() => result.current.flush());
  expect(result.current.draft.connection.password).toBe('');
  expect(result.current.unsaved).toBe(false);
  act(() => { void result.current.change('connection', { port: '4458', password: '' }, 'blur'); });
  await act(() => result.current.save('connection'));
  expect(configure).toHaveBeenLastCalledWith({ port: 4458 });
});

it('serializes edits and never overwrites newer input with a slow response or snapshot', async () => {
  let complete!: () => void;
  const configure = vi.fn<(_: unknown) => Promise<void>>().mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue(undefined);
  const { result, rerender } = renderHook(({ remote }) => useObsControlSettings(remote, configure), { initialProps: { remote: view } });
  act(() => { void result.current.change('connection', { port: '4456', password: 'first' }, 'blur'); });
  let first!: Promise<boolean>;
  await act(async () => { first = result.current.save('connection'); await Promise.resolve(); });
  act(() => { void result.current.change('connection', { port: '4457', password: 'second' }, 'blur'); });
  let second!: Promise<boolean>;
  act(() => { second = result.current.save('connection'); });
  expect(configure).toHaveBeenCalledTimes(1);
  rerender({ remote: { ...view, obsPort: 4456 } });
  expect(result.current.draft.connection.password).toBe('second');
  await act(async () => { complete(); await first; await second; });
  expect(configure).toHaveBeenLastCalledWith({ port: 4457, password: 'second' });
  expect(result.current.draft.connection.port).toBe('4457');
  expect(result.current.unsaved).toBe(false);
});
