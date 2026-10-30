// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import type { AppSnapshot } from '../src/shared/types';

const mocks = vi.hoisted(() => ({
  snapshot: null as AppSnapshot | null,
  previewCharacterMotion: vi.fn(async () => undefined),
  saveCharacterMotion: vi.fn(async () => undefined),
  uploadAsset: vi.fn(async () => undefined),
  clearAsset: vi.fn(async () => undefined),
  reportCharacterAssetError: vi.fn(),
}));

vi.mock('../src/renderer/api', () => ({
  useApplicationState: () => ({
    snapshot: mocks.snapshot,
    connected: true,
    error: null,
    previewCharacterMotion: mocks.previewCharacterMotion,
    saveCharacterMotion: mocks.saveCharacterMotion,
    uploadAsset: mocks.uploadAsset,
    clearAsset: mocks.clearAsset,
    reportCharacterAssetError: mocks.reportCharacterAssetError,
  }),
}));

import { SimpleCharacterSettingsPage } from '../src/renderer/pages/SimpleCharacterSettingsPage';

describe('簡易キャラクター専用設定画面', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    const settings = createDefaultSettings();
    settings.character.simple.closedAsset = null;
    settings.character.simple.openAsset = null;
    mocks.snapshot = {
      settings,
      settingsRevision: 1,
      character: {
        mouthShape: 'closed',
        motion: { ...settings.character.simple.motion },
        motionStartedAtMs: null,
        assetWarning: null,
      },
    } as AppSnapshot;
  });

  it('同梱の初期画像を表示し、登録操作なしで口パクテストを利用できる', () => {
    mocks.snapshot!.settings.character = createDefaultSettings().character;
    render(<SimpleCharacterSettingsPage />);
    expect(screen.getByRole('img', { name: '簡易キャラクターのプレビュー' })).toHaveAttribute('src', '/assets/characters/casmate-girl-idle-closed.png');
    expect(screen.getByLabelText('口を開けた画像（PNG）を選択')).toBeEnabled();
    expect(screen.getByRole('button', { name: '口パクをテスト' })).toBeEnabled();
  });

  it('大プレビュー、PNG素材操作、6スライダー、標準復元を提供する', () => {
    render(<SimpleCharacterSettingsPage />);

    expect(screen.getByRole('img', { name: '簡易キャラクターのプレビュー' })).toBeInTheDocument();
    expect(screen.getByLabelText('口を閉じた画像（PNG）を選択')).toHaveAttribute('accept', 'image/png');
    expect(screen.getByLabelText('口を開けた画像（PNG）を選択')).toBeDisabled();
    expect(screen.getByRole('button', { name: '口パクをテスト' })).toBeDisabled();
    expect(screen.getAllByRole('slider')).toHaveLength(6);
    expect(screen.getByRole('button', { name: '標準に戻す' })).toBeInTheDocument();
    expect(screen.getByLabelText('接続状態')).toHaveTextContent('接続済み');
    expect(screen.getByLabelText('微動の保存状態')).toHaveTextContent('保存済み');
    expect(screen.getByText('変更はOBS・独立ウィンドウにも即時反映され、自動保存されます。')).toBeVisible();
    expect(screen.getByText('このプレビューのみ・2秒')).toBeVisible();
    for (const name of ['上下', '傾き', '呼吸']) expect(screen.getByRole('group', { name })).toBeVisible();
    expect(screen.getByText('まず口を閉じた画像（PNG）を登録してください。')).toBeVisible();
    expect(screen.getByRole('button', { name: '画像をすべて解除', exact: true })).toBeDisabled();
  });

  it('素材の解除を選択欄と区別し、明示した対象だけを既存APIで解除する', async () => {
    mocks.snapshot!.settings.character.simple.closedAsset = '/assets/closed.png';
    mocks.snapshot!.settings.character.simple.openAsset = '/assets/open.png';
    render(<SimpleCharacterSettingsPage />);
    expect(screen.queryByText('まず口を閉じた画像（PNG）を登録してください。')).not.toBeInTheDocument();
    expect(screen.getByText('口を開けた画像（PNG）は口を閉じた画像（PNG）と同じ大きさにしてください。')).toBeVisible();
    const removals = within(screen.getByRole('group', { name: '登録素材の解除' }));
    await act(async () => fireEvent.click(removals.getByRole('button', { name: '口を開けた画像だけ解除', exact: true })));
    expect(mocks.clearAsset).toHaveBeenNthCalledWith(1, 'open');
    await act(async () => fireEvent.click(removals.getByRole('button', { name: '画像をすべて解除', exact: true })));
    expect(mocks.clearAsset).toHaveBeenNthCalledWith(2, 'closed');
    expect(mocks.clearAsset).toHaveBeenCalledTimes(2);
    expect(mocks.uploadAsset).not.toHaveBeenCalled();
  });

  it('保存待ち・保存中を区別し、古い保存の完了で新しい編集を保存済みにしない', async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      mocks.saveCharacterMotion.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
      render(<SimpleCharacterSettingsPage />);
      const slider = screen.getByLabelText('上下移動');
      const status = screen.getByLabelText('微動の保存状態');
      fireEvent.change(slider, { target: { value: '1.2' } });
      expect(status).toHaveTextContent('保存待ち');
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(status).toHaveTextContent('保存中');
      fireEvent.change(slider, { target: { value: '1.8' } });
      expect(status).toHaveTextContent('保存待ち');
      await act(async () => finish());
      expect(status).toHaveTextContent('保存待ち');
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(status).toHaveTextContent('保存済み');
      expect(mocks.saveCharacterMotion).toHaveBeenLastCalledWith(expect.objectContaining({ verticalAmplitudePercent: 1.8 }));
    } finally { vi.useRealTimers(); }
  });

  it('保存失敗を保持し、保存済みの動きへ戻して再操作で復旧する', async () => {
    mocks.saveCharacterMotion.mockRejectedValueOnce(new Error('動きを保存できませんでした。'));
    render(<SimpleCharacterSettingsPage />);
    const slider = screen.getByLabelText('上下移動');
    fireEvent.change(slider, { target: { value: '1.2' } });
    await act(async () => fireEvent.pointerUp(slider));
    expect(screen.getByLabelText('微動の保存状態')).toHaveTextContent('保存失敗');
    expect(screen.getByLabelText('操作の問題')).toHaveTextContent('動きを保存できませんでした。');
    expect(slider).toHaveValue('0.5');
    expect(mocks.previewCharacterMotion).toHaveBeenLastCalledWith(mocks.snapshot!.settings.character.simple.motion);
    fireEvent.change(slider, { target: { value: '1.5' } });
    await act(async () => fireEvent.pointerUp(slider));
    expect(screen.getByLabelText('微動の保存状態')).toHaveTextContent('保存済み');
    expect(screen.getByLabelText('操作の問題')).toBeEmptyDOMElement();
  });

  it('新しい保存成功後に古い保存が失敗しても、値・プレビュー・保存状態を巻き戻さない', async () => {
    vi.useFakeTimers();
    try {
      let reject!: (error: Error) => void;
      mocks.saveCharacterMotion.mockImplementationOnce(() => new Promise<void>((_resolve, failure) => { reject = failure; }));
      render(<SimpleCharacterSettingsPage />);
      const slider = screen.getByLabelText('上下移動');
      fireEvent.change(slider, { target: { value: '1.2' } });
      await act(async () => { vi.advanceTimersByTime(500); });
      fireEvent.change(slider, { target: { value: '1.8' } });
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(screen.getByLabelText('微動の保存状態')).toHaveTextContent('保存済み');
      await act(async () => reject(new Error('古い保存の失敗')));
      expect(slider).toHaveValue('1.8');
      expect(mocks.previewCharacterMotion).toHaveBeenLastCalledWith(expect.objectContaining({ verticalAmplitudePercent: 1.8 }));
      expect(screen.getByLabelText('微動の保存状態')).toHaveTextContent('保存済み');
      expect(screen.getByLabelText('操作の問題')).toBeEmptyDOMElement();
    } finally { vi.useRealTimers(); }
  });

  it('前の保存のsnapshotが届いても入力中の次の値を置き換えない', async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      mocks.saveCharacterMotion.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
      const view = render(<SimpleCharacterSettingsPage />);
      const slider = screen.getByLabelText('上下移動');
      fireEvent.change(slider, { target: { value: '1.2' } });
      await act(async () => { vi.advanceTimersByTime(500); });
      fireEvent.change(slider, { target: { value: '1.8' } });
      mocks.snapshot = { ...mocks.snapshot!, settingsRevision: 2, settings: { ...mocks.snapshot!.settings,
        character: { ...mocks.snapshot!.settings.character, simple: { ...mocks.snapshot!.settings.character.simple,
          motion: { ...mocks.snapshot!.settings.character.simple.motion, verticalAmplitudePercent: 1.2 } } } } };
      view.rerender(<SimpleCharacterSettingsPage />);
      await act(async () => finish());
      expect(slider).toHaveValue('1.8');
      expect(screen.getByLabelText('微動の保存状態')).toHaveTextContent('保存待ち');
    } finally { vi.useRealTimers(); }
  });

  it('現在の保存が失敗したときは、開始時点ではなく最新の保存済み値へ戻す', async () => {
    let reject!: (error: Error) => void;
    mocks.saveCharacterMotion.mockImplementationOnce(() => new Promise<void>((_resolve, failure) => { reject = failure; }));
    const view = render(<SimpleCharacterSettingsPage />);
    const slider = screen.getByLabelText('上下移動');
    fireEvent.change(slider, { target: { value: '1.2' } });
    await act(async () => fireEvent.pointerUp(slider));
    const motion = { ...mocks.snapshot!.settings.character.simple.motion, verticalAmplitudePercent: 2 };
    mocks.snapshot = { ...mocks.snapshot!, settingsRevision: 2, settings: { ...mocks.snapshot!.settings,
      character: { ...mocks.snapshot!.settings.character, simple: { ...mocks.snapshot!.settings.character.simple, motion } } } };
    view.rerender(<SimpleCharacterSettingsPage />);
    expect(slider).toHaveValue('1.2');
    await act(async () => reject(new Error('最新の保存に失敗しました。')));
    expect(slider).toHaveValue('2');
    expect(mocks.previewCharacterMotion).toHaveBeenLastCalledWith(motion);
    expect(screen.getByLabelText('微動の保存状態')).toHaveTextContent('保存失敗');
  });

  it('微動保存の成功で、後から発生したPNG登録のエラーを消さない', async () => {
    let finish!: () => void;
    mocks.saveCharacterMotion.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    mocks.uploadAsset.mockRejectedValueOnce(new Error('PNGを登録できませんでした。'));
    render(<SimpleCharacterSettingsPage />);
    const slider = screen.getByLabelText('上下移動');
    fireEvent.change(slider, { target: { value: '1.2' } });
    await act(async () => fireEvent.pointerUp(slider));
    const file = new File(['png'], 'closed.png', { type: 'image/png' });
    await act(async () => fireEvent.change(screen.getByLabelText('口を閉じた画像（PNG）を選択'), { target: { files: [file] } }));
    expect(screen.getByLabelText('操作の問題')).toHaveTextContent('PNGを登録できませんでした。');
    await act(async () => finish());
    expect(screen.getByLabelText('微動の保存状態')).toHaveTextContent('保存済み');
    expect(screen.getByLabelText('操作の問題')).toHaveTextContent('PNGを登録できませんでした。');
  });

  it('口を閉じた画像（PNG）を対応する登録欄へドロップして登録する', () => {
    render(<SimpleCharacterSettingsPage />);
    const file = new File(['png'], 'closed.png', { type: 'image/png' });

    fireEvent.drop(screen.getByRole('group', { name: '口を閉じた画像（PNG）登録' }), {
      dataTransfer: { files: [file] },
    });

    expect(mocks.uploadAsset).toHaveBeenCalledWith('closed', file);
  });

  it('閉口素材がある場合だけ口を開けた画像（PNG）のドロップを受け付ける', () => {
    const file = new File(['png'], 'open.png', { type: 'image/png' });
    const { unmount } = render(<SimpleCharacterSettingsPage />);
    fireEvent.drop(screen.getByRole('group', { name: '口を開けた画像（PNG）登録' }), {
      dataTransfer: { files: [file] },
    });
    expect(mocks.uploadAsset).not.toHaveBeenCalled();
    unmount();

    mocks.snapshot!.settings.character.simple.closedAsset = '/assets/closed.png';
    render(<SimpleCharacterSettingsPage />);
    fireEvent.drop(screen.getByRole('group', { name: '口を開けた画像（PNG）登録' }), {
      dataTransfer: { files: [file] },
    });
    expect(mocks.uploadAsset).toHaveBeenCalledWith('open', file);
  });

  it('設定画面の大プレビューだけを2秒間口パクテストする', async () => {
    vi.useFakeTimers();
    try {
      mocks.snapshot!.settings.character.simple.closedAsset = '/assets/closed.png';
      mocks.snapshot!.settings.character.simple.openAsset = '/assets/open.png';
      const { container } = render(<SimpleCharacterSettingsPage />);
      const images = container.querySelectorAll('.character-settings-preview img');

      fireEvent.click(screen.getByRole('button', { name: '口パクをテスト' }));
      expect(images[0]).toHaveStyle({ opacity: '0' });
      expect(images[1]).toHaveStyle({ opacity: '1' });

      await act(async () => { vi.advanceTimersByTime(200); });
      expect(images[0]).toHaveStyle({ opacity: '1' });
      expect(images[1]).toHaveStyle({ opacity: '0' });

      await act(async () => { vi.advanceTimersByTime(200); });
      expect(images[0]).toHaveStyle({ opacity: '0' });
      expect(images[1]).toHaveStyle({ opacity: '1' });

      await act(async () => { vi.advanceTimersByTime(1_600); });
      expect(images[0]).toHaveStyle({ opacity: '1' });
      expect(images[1]).toHaveStyle({ opacity: '0' });
      expect(mocks.previewCharacterMotion).not.toHaveBeenCalled();
      expect(mocks.saveCharacterMotion).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('連続入力を50ms以内に一時配信し、停止から500ms後に正式保存する', async () => {
    vi.useFakeTimers();
    try {
      render(<SimpleCharacterSettingsPage />);
      const slider = screen.getByLabelText('上下移動');
      fireEvent.change(slider, { target: { value: '1.2' } });
      fireEvent.change(slider, { target: { value: '1.3' } });

      expect(mocks.previewCharacterMotion).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(50); await Promise.resolve(); });
      expect(mocks.previewCharacterMotion).toHaveBeenCalledTimes(1);
      expect(mocks.previewCharacterMotion).toHaveBeenLastCalledWith(expect.objectContaining({ verticalAmplitudePercent: 1.3 }));

      await act(async () => { vi.advanceTimersByTime(450); await Promise.resolve(); await Promise.resolve(); });
      expect(mocks.saveCharacterMotion).toHaveBeenCalledTimes(1);
      expect(mocks.saveCharacterMotion).toHaveBeenCalledWith(
        expect.objectContaining({ verticalAmplitudePercent: 1.3 }),
      );
      expect(screen.queryByText('微動設定を保存しました。')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
