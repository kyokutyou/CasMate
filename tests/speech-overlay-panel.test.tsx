// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import { SpeechRecognitionOverlayPanel } from '../src/renderer/components/SpeechRecognitionOverlayPanel';
import { useAutoSavingSettings } from '../src/renderer/use-auto-saving-settings';
import type { SpeechRecognitionOverlaySettings } from '../src/shared/types';

const persist = vi.fn(async (_value: SpeechRecognitionOverlaySettings) => undefined);
const fonts = vi.fn(async () => ['Yu Gothic UI', 'Meiryo']);
const onError = vi.fn();
function Harness() {
  const [saved, setSaved] = useState(createDefaultSettings);
  const auto = useAutoSavingSettings(saved, 0, async (section, value) => {
    if (section !== 'speechRecognitionOverlay') throw new Error('Unexpected settings section');
    await persist(value);
    setSaved(current => ({ ...current, speechRecognitionOverlay: value }));
  }, onError);
  if (!auto.draft) return null;
  return <SpeechRecognitionOverlayPanel settings={auto.draft.speechRecognitionOverlay} saveError={auto.saveErrors.speechRecognitionOverlay}
    onChange={value => auto.changeSection('speechRecognitionOverlay', value)} onSave={value => auto.saveSectionNow('speechRecognitionOverlay', value)} loadFonts={fonts} onOperationStart={() => undefined}/>;
}
const flush = async (ms = 500) => { await act(async () => vi.advanceTimersByTime(ms)); };
beforeEach(() => { vi.useFakeTimers(); persist.mockReset().mockResolvedValue(undefined); fonts.mockReset().mockResolvedValue(['Yu Gothic UI', 'Meiryo']); onError.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('表示時間と独立した外観だけを置き、プレビュー・URL・ON/OFFを追加しない', async () => {
  render(<Harness/>); await flush(0);
  expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['字幕の表示']);
  expect(screen.getByLabelText('表示時間（秒）')).toHaveValue(10);
  expect(screen.getByText('(1〜60 秒)')).toBeVisible();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByText(/プレビュー|URL|共用|反映されます/)).toBeNull();
  expect(document.querySelector('dialog')).toBeNull();
});
it('表示秒数と外観を専用セクションへ自動保存する', async () => {
  render(<Harness/>); await flush(0);
  fireEvent.change(screen.getByLabelText('表示時間（秒）'), { target: { value: '12' } }); await flush();
  expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ displayDurationSeconds: 12 }));

});
it('不正入力を保存せず、保存失敗後も入力を保持して再編集できる', async () => {
  render(<Harness/>); await flush(0);
  const input = screen.getByLabelText('表示時間（秒）');
  fireEvent.change(input, { target: { value: '61' } }); await flush();
  expect(input).toHaveValue(61); expect(input).toHaveAttribute('aria-invalid', 'true'); expect(persist).not.toHaveBeenCalled();
  persist.mockRejectedValueOnce(new Error('保存できません'));
  fireEvent.change(input, { target: { value: '14' } }); await flush();
  expect(input).toHaveValue(14); expect(onError).toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '15' } }); await flush();
  expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ displayDurationSeconds: 15 }));
});
it('文字と背景を削除し、別ウィンドウのデザイン編集に進む', async () => {
  const open = vi.fn(async () => undefined);
  const settings = createDefaultSettings().speechRecognitionOverlay;
  render(<SpeechRecognitionOverlayPanel settings={settings} onEditDesign={open} onChange={() => undefined} onSave={async () => undefined} onOperationStart={() => undefined}/>);
  expect(screen.queryByText('文字と背景')).toBeNull(); expect(screen.queryByLabelText('フォント')).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name:'デザインを編集' })));
  expect(open).toHaveBeenCalledOnce(); expect(fonts).not.toHaveBeenCalled();
});
