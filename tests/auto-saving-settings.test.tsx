// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import { useAutoSavingSettings } from '../src/renderer/use-auto-saving-settings';

describe('設定の自動保存', () => {
  it.each(['no-snapshot', 'older-snapshot', 'corrected-snapshot'] as const)('部分保存は新しい同期と正式な保存結果を保持する: %s', async response => {
    const settings = createDefaultSettings();
    const synchronized = structuredClone(settings);
    synchronized.sources.youtube.target = '@synchronized';
    const corrected = structuredClone(synchronized);
    corrected.sources.youtube.target = '@corrected';
    let finish!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve(response === 'no-snapshot' ? undefined : { snapshot: {
        settings: response === 'corrected-snapshot' ? corrected : settings,
        settingsRevision: response === 'corrected-snapshot' ? 3 : 1,
      } });
    })).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ current, revision }) => useAutoSavingSettings(current, revision, save, vi.fn()),
      { initialProps: { current: settings, revision: 1 } });
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.saveSectionNow('sources', settings.sources);
      second = result.current.saveSectionNow('sources', saved => ({ ...saved, twitch: { enabled: true, channel: 'viewer' } }), settings.sources);
    });
    rerender({ current: synchronized, revision: 2 });
    await act(async () => { finish(); await Promise.all([first, second]); });
    expect(save).toHaveBeenLastCalledWith('sources', expect.objectContaining({
      youtube: expect.objectContaining({ target: response === 'corrected-snapshot' ? '@corrected' : '@synchronized' }),
      twitch: { enabled: true, channel: 'viewer' },
    }));
  });

  it.each([true, false])('部分保存は先行保存の成功=%sに応じた値を基にし、失敗値を混入しない', async success => {
    let finish!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = () => success ? resolve() : reject(new Error('保存失敗'));
    })).mockResolvedValue(undefined);
    const settings = createDefaultSettings();
    const { result } = renderHook(() => useAutoSavingSettings(settings, 1, save, vi.fn()));
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.saveSectionNow('sources', { ...settings.sources, youtube: { enabled: false, target: '@changed' } }).catch(() => undefined);
      second = result.current.saveSectionNow('sources', saved => ({ ...saved, twitch: { enabled: true, channel: 'viewer' } }), settings.sources);
    });
    await act(async () => { finish(); await Promise.all([first, second]); });
    expect(save).toHaveBeenLastCalledWith('sources', expect.objectContaining({
      youtube: { enabled: false, target: success ? '@changed' : settings.sources.youtube.target },
      twitch: { enabled: true, channel: 'viewer' },
    }));
  });

  afterEach(() => { vi.useRealTimers(); });

  it('スマホの公開設定と音質を同期し、保存待ちの入力を同期で巻き戻さない', async () => {
    vi.useFakeTimers();
    const settings = createDefaultSettings();
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ current, revision }) => useAutoSavingSettings(current, revision, save, vi.fn()),
      { initialProps: { current: settings, revision: 1 } },
    );
    const external = structuredClone(settings);
    external.mobileSpeech = { lanEnabled: true, tailscaleEnabled: true, bitrateKbps: 48 };
    rerender({ current: external, revision: 2 });
    expect(result.current.draft?.mobileSpeech).toEqual(external.mobileSpeech);
    act(() => result.current.changeSection('mobileSpeech', { ...external.mobileSpeech, bitrateKbps: 64 }));
    rerender({ current: settings, revision: 3 });
    expect(result.current.draft?.mobileSpeech.bitrateKbps).toBe(64);
    await act(async () => vi.advanceTimersByTime(500));
    expect(save).toHaveBeenLastCalledWith('mobileSpeech', { ...external.mobileSpeech, bitrateKbps: 64 });
  });

  it('読み上げ設定の同期を反映し、保存待ちのミキサー値は上書きしない', () => {
    vi.useFakeTimers();
    const settings = createDefaultSettings();
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ current, revision }) => useAutoSavingSettings(current, revision, save, vi.fn()),
      { initialProps: { current: settings, revision: 1 } },
    );
    const synchronized = structuredClone(settings);
    synchronized.commentSpeech.volumeScale = 1.2;
    rerender({ current: synchronized, revision: 2 });
    expect(result.current.draft?.commentSpeech.volumeScale).toBe(1.2);
    act(() => result.current.changeSection('commentSpeech', { ...synchronized.commentSpeech, volumeScale: 1.7 }));
    rerender({ current: settings, revision: 3 });
    expect(result.current.draft?.commentSpeech.volumeScale).toBe(1.7);
  });

  it('異なるセクションを直列保存し、待機中の同一セクションは最新値へ置き換える', async () => {
    let finishFirst: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => { finishFirst = resolve; });
    const save = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined);
    const settings = createDefaultSettings();
    const { result } = renderHook(() => useAutoSavingSettings(
      settings,
      1,
      save,
      vi.fn(),
    ));

    let firstOperation!: Promise<unknown>;
    let oldQueuedOperation!: Promise<unknown>;
    let latestQueuedOperation!: Promise<unknown>;
    act(() => {
      firstOperation = result.current.saveSectionNow('sources', {
        ...settings.sources,
        autoConnect: true,
      });
      oldQueuedOperation = result.current.saveSectionNow('commentList', {
        ...settings.commentList,
        showSource: false,
      });
      latestQueuedOperation = result.current.saveSectionNow('commentList', {
        ...settings.commentList,
        showAuthor: false,
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, 'sources', expect.objectContaining({ autoConnect: true }));

    await act(async () => {
      finishFirst?.();
      await Promise.all([firstOperation, oldQueuedOperation, latestQueuedOperation]);
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, 'commentList', {
      ...settings.commentList,
      showAuthor: false,
    });
  });

  it('状態同期では未保存セクションを保持し、変更のないセクションだけを反映する', () => {
    vi.useFakeTimers();
    const settings = createDefaultSettings();
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ current, revision }) => useAutoSavingSettings(current, revision, save, vi.fn()),
      { initialProps: { current: settings, revision: 1 } },
    );

    act(() => {
      result.current.changeSection('commentOverlay', {
        ...settings.commentOverlay,
        fontFamily: 'Meiryo UI',
      });
    });
    const synchronized = structuredClone(settings);
    synchronized.commentOverlay.fontFamily = '同期側の旧値';
    synchronized.application.port = 4000;
    rerender({ current: synchronized, revision: 2 });

    expect(result.current.draft?.commentOverlay.fontFamily).toBe('Meiryo UI');
    expect(result.current.draft?.application.port).toBe(4000);
  });

  it('キュー待ちの即時保存を後続の遅延入力へ置き換える', async () => {
    vi.useFakeTimers();
    let finishFirst: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => { finishFirst = resolve; });
    const save = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined);
    const settings = createDefaultSettings();
    const { result } = renderHook(() => useAutoSavingSettings(settings, 1, save, vi.fn()));

    let firstOperation!: Promise<unknown>;
    let queuedOperation!: Promise<unknown>;
    act(() => {
      firstOperation = result.current.saveSectionNow('sources', {
        ...settings.sources,
        autoConnect: true,
      });
      queuedOperation = result.current.saveSectionNow('commentOverlay', {
        ...settings.commentOverlay,
        fontFamily: '即時保存の旧値',
      });
      result.current.changeSection('commentOverlay', {
        ...settings.commentOverlay,
        fontFamily: '遅延入力の最新値',
      });
    });

    await act(async () => {
      finishFirst?.();
      await firstOperation;
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await queuedOperation;
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(
      2,
      'commentOverlay',
      expect.objectContaining({ fontFamily: '遅延入力の最新値' }),
    );
  });
});
