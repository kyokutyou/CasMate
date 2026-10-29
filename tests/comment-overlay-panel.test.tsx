// @vitest-environment jsdom
import { useCallback, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import type { AppSettings } from '../src/shared/types';
import { CommentOverlayPanel } from '../src/renderer/components/CommentOverlayPanel';
import { useAutoSavingSettings } from '../src/renderer/use-auto-saving-settings';
const loadFonts = vi.fn(async () => ['Yu Gothic UI', 'Meiryo']);
const persist = vi.fn(async (_value: AppSettings['commentOverlay']) => undefined);
const error = vi.fn();
function Harness({ speech = false }: { speech?: boolean }) {
  const [saved, setSaved] = useState(createDefaultSettings);
  const save = useCallback(async (_section: string, value: AppSettings['commentOverlay']) => {
    await persist(value); setSaved(current => ({ ...current, commentOverlay: value }));
  }, []);
  const autosave = useAutoSavingSettings(saved, 0, async (section, value) => { if (section === 'commentOverlay') await save(section, value as AppSettings['commentOverlay']); }, error);
  if (!autosave.draft) return null;
  return <CommentOverlayPanel settings={autosave.draft.commentOverlay} speechEnabled={speech} saveError={autosave.saveErrors.commentOverlay} loadFonts={loadFonts}
    onChange={value => autosave.changeSection('commentOverlay', value)} onSave={value => autosave.saveSectionNow('commentOverlay', value)} onOperationStart={() => undefined}/>;
}
const flush = async (ms = 500) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
beforeEach(() => {
  vi.useFakeTimers(); persist.mockReset().mockResolvedValue(undefined); loadFonts.mockReset().mockResolvedValue(['Yu Gothic UI', 'Meiryo']); error.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('OBSコメント表示のA案編集画面', () => {
  it('印と左寄せの数値の2行で保存済み読み上げ設定の適用先を示し、切替だけでは設定を保存しない', async () => {
    const view=render(<Harness speech/>); await flush(0);
    const on=screen.getByRole('region',{name:'読み上げ ON'}),off=screen.getByRole('region',{name:'読み上げ OFF'});
    expect(on).toHaveAttribute('data-active','true'); expect(off).toHaveAttribute('data-active','false');
    expect(within(on).getByText('適用中')).toBeVisible();
    expect(within(on).getByText('読み上げ終了 ＋ 2秒')).toBeVisible();
    expect(screen.queryByText('音声に合わせて消える')).toBeNull();
    expect(screen.queryByText(/音声を用意できない時/)).toBeNull();
    expect(within(off).getByLabelText('1件表示時間（秒）')).toBeEnabled();
    expect(within(off).getByText('(1〜60 秒)')).toBeVisible();
    expect(screen.queryByText('読み上げOFFで変更')).toBeNull();
    view.rerender(<Harness speech={false}/>); await flush(0);
    expect(on).toHaveAttribute('data-active','false'); expect(off).toHaveAttribute('data-active','true');
    expect(within(off).getByText('適用中')).toBeVisible();
    expect(screen.getByLabelText('1件表示時間（秒）')).toBeEnabled();
    expect(screen.queryByRole('switch',{name:'読み上げ'})).toBeNull(); expect(persist).not.toHaveBeenCalled();
  });
  it('読み上げONでも保存失敗後の入力を保持し、代替秒数の案内を表示しない', async () => {
    const view=render(<Harness/>); await flush(0);
    persist.mockRejectedValueOnce(new Error('保存できません'));
    fireEvent.change(screen.getByLabelText('1件表示時間（秒）'),{target:{value:'12'}}); await flush();
    view.rerender(<Harness speech/>); await flush(0);
    expect(screen.getByLabelText('1件表示時間（秒）')).toHaveValue(12);
    expect(screen.getByLabelText('1件表示時間（秒）')).toBeEnabled();
    expect(screen.queryByText(/音声を用意できない時/)).toBeNull();
  });
  it('1件ずつを左・既定にし、モードごとの入力・範囲外値を保持する', async () => {
    render(<Harness/>); await flush(0);
    const modes = within(screen.getByRole('group', { name: '表示方法' })).getAllByRole('button');
    expect(modes.map(button => button.getAttribute('aria-label'))).toEqual(['1件ずつ', '積み上げ']);
    expect(modes[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('1件表示時間（秒）'), { target: { value: '12.5' } }); await flush(499); expect(persist).not.toHaveBeenCalled(); await flush(1);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ singleDurationSeconds: 12.5 }));
    fireEvent.change(screen.getByLabelText('1件表示時間（秒）'), { target: { value: '61' } });
    await act(async () => fireEvent.click(modes[1]));
    expect(screen.getByLabelText('1件表示時間（秒）')).not.toBeVisible();
    expect(screen.getByLabelText('各コメントを表示する時間（秒）')).toHaveValue(10);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'stack', singleDurationSeconds: 12.5 }));
    await act(async () => fireEvent.click(modes[0]));
    expect(screen.getByLabelText('1件表示時間（秒）')).toHaveValue(61);
    expect(screen.getByLabelText('1件表示時間（秒）')).toHaveAttribute('aria-invalid', 'true');
  });
  it('同期中も1件表示時間を保存でき、最後の表示項目をオフにしない', async () => {
    render(<Harness speech/>); await flush(0);
    expect(screen.getByLabelText('1件表示時間（秒）')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('1件表示時間（秒）'), { target: { value: '15' } }); await flush();
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ singleDurationSeconds: 15 }));
    expect(screen.queryByText(/音声を用意できない時/)).toBeNull();
    expect(screen.getByRole('switch', { name: 'サービス名' })).toHaveAttribute('aria-checked', 'false');
    for (const name of ['投稿者名', '本文']) await act(async () => fireEvent.click(screen.getByRole('switch', { name })));
    expect(screen.getByRole('switch', { name: '本文' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('少なくとも1項目をオンにしてください。')).toBeVisible();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ singleDurationSeconds: 15, showContent: true }));
  });
  it('外観入力を削除し、デザイン編集への入口を置く', async () => {
    render(<Harness/>); await flush(0);
    expect(screen.queryByText('文字と背景')).toBeNull();
    expect(screen.queryByLabelText('フォント')).toBeNull();
    expect(screen.queryByLabelText('文字サイズ（px）')).toBeNull();
    expect(screen.getByRole('button', { name: 'デザインを編集' })).toHaveAttribute('id', 'comment-overlay-appearance');
    expect(loadFonts).not.toHaveBeenCalled();
  });
});
