// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import { useAutoSavingSettings } from '../src/renderer/use-auto-saving-settings';
import { useCommentFilterEditing } from '../src/renderer/use-comment-filter-editing';
import type { AppSettings, SettingsSection } from '../src/shared/types';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('保存中のAA切替を続けて戻しても、古い切替の後処理で新しい選択を上書きしない', async () => {
  vi.useFakeTimers();
  const settings = createDefaultSettings();
  let finish!: () => void;
  let stored = settings.commentFilter;
  const save = vi.fn(async (_section: SettingsSection, value: AppSettings[SettingsSection]) => {
    if ('ngWords' in value) stored = structuredClone(value);
  });
  save.mockImplementationOnce((_section, value) => new Promise<void>(resolve => {
    finish = () => { if ('ngWords' in value) stored = structuredClone(value); resolve(); };
  }));
  const { result } = renderHook(() => {
    const saving = useAutoSavingSettings(settings, 1, save, vi.fn());
    return { saving, filter: useCommentFilterEditing({ saving, saved: settings.commentFilter, clearNotice: vi.fn() }) };
  });
  act(() => result.current.filter.change({ ngWords: ['保存中の語'], asciiArtEnabled: false }));
  await act(() => vi.advanceTimersByTimeAsync(500));
  let first!: Promise<void>; let second!: Promise<void>;
  act(() => { first = result.current.filter.toggleAsciiArt(true); });
  act(() => { second = result.current.filter.toggleAsciiArt(false); });
  await act(async () => { finish(); await Promise.all([first, second]); });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(stored).toEqual({ ngWords: ['保存中の語'], asciiArtEnabled: false });
  expect(result.current.saving.draft!.commentFilter).toEqual(stored);
});

it.each([false, true])('AA切替は直前に保存成功したNG語を消さない（復元保存失敗=%s）', async restoreFails => {
  vi.useFakeTimers();
  const settings = createDefaultSettings();
  settings.commentFilter = { ngWords: [], asciiArtEnabled: false };
  let finish!: () => void;
  let stored = settings.commentFilter;
  const save = vi.fn(async (_section: SettingsSection, value: AppSettings[SettingsSection]) => {
    if ('ngWords' in value) stored = structuredClone(value);
  });
  save.mockImplementationOnce((_section, value) => new Promise<void>(resolve => {
    finish = () => { if ('ngWords' in value) stored = structuredClone(value); resolve(); };
  }));
  const { result, rerender } = renderHook(({ current, revision }) => {
    const saving = useAutoSavingSettings(current, revision, save, vi.fn());
    const filter = useCommentFilterEditing({ saving, saved: current.commentFilter, clearNotice: vi.fn() });
    return { saving, filter };
  }, { initialProps: { current: settings, revision: 1 } });
  act(() => result.current.filter.change({ ngWords: ['新規禁止語'], asciiArtEnabled: false }));
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(save).toHaveBeenCalledExactlyOnceWith('commentFilter', { ngWords: ['新規禁止語'], asciiArtEnabled: false });
  let toggle!: Promise<void>;
  act(() => { toggle = result.current.filter.toggleAsciiArt(true); });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    rerender({ current: { ...settings, commentFilter: { ngWords: ['新規禁止語'], asciiArtEnabled: false } }, revision: 2 });
    await toggle;
  });
  expect(save).toHaveBeenCalledTimes(2);

  if (restoreFails) {
    save.mockRejectedValueOnce(new Error('復元の保存失敗'));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(result.current.saving.saveErrors.commentFilter).toBe('復元の保存失敗');
  }
  expect(stored).toEqual({ ngWords: ['新規禁止語'], asciiArtEnabled: true });
});
