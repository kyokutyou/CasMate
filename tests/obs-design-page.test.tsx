// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSnapshot } from '../src/shared/types';
import type { Target } from '../src/shared/obs-style';
import { obsPresets } from '../src/shared/obs-style';
import { createObsDesignPreset, validateObsDesign } from '../src/shared/obs-design';
import { addSavedObsDesign, emptySavedObsDesigns, removeSavedObsDesign } from '../src/shared/saved-obs-designs';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';

// Rendering preset thumbnails in jsdom can exceed five seconds during parallel
// runs. This is the test's wall-clock limit; fake-timer save boundaries stay intact.
vi.setConfig({ testTimeout: 15_000 });

const mock = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null, error: null as string | null, mutate: vi.fn(async (..._args: unknown[]) => ({})), fonts: vi.fn(async () => ['Yu Gothic UI', 'Meiryo']) }));
vi.mock('../src/renderer/api', () => ({ useApplicationState: () => ({ snapshot: mock.snapshot, error: mock.error, mutate: mock.mutate }) }));
vi.mock('../src/renderer/windows-fonts', () => ({ loadWindowsFonts: mock.fonts }));
vi.mock('../src/renderer/obs-style-editor/Preview', () => ({ Preview: () => <section aria-label="OBS表示プレビュー"/> }));
import { ObsDesignPage } from '../src/renderer/pages/ObsDesignPage';

let closeRequest: () => void; let targetRequest: (target: Target) => void;
const closeReady = vi.fn();
const panel = () => within(document.querySelector<HTMLElement>('.design-editing-fields > [role=tabpanel]:not([hidden])')!);
const chooseTab = (name: string) => fireEvent.click(within(panel().getByRole('tablist')).getByRole('tab', { name: new RegExp(`^${name}`) }));
const flush = async (ms = 0) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
function syncMutation(...args: unknown[]) {
  const [path, method, body] = args;
  if (typeof path !== 'string' || !mock.snapshot) throw new Error('不正なテスト要求');
  const settings = mock.snapshot.settings;
  const target = path.includes('/comments') ? 'comments' : 'speech';
  if (path.includes('/saved')) {
    const library = settings.application.obsSavedDesigns ?? emptySavedObsDesigns();
    settings.application = { ...settings.application, obsSavedDesigns: method === 'POST' ? addSavedObsDesign(library, target, body) : removeSavedObsDesign(library, target, path.split('/').at(-1)) };
  } else if (target === 'comments') settings.commentOverlay = { ...settings.commentOverlay, design: validateObsDesign('comments', body) };
  else settings.speechRecognitionOverlay = { ...settings.speechRecognitionOverlay, design: validateObsDesign('speech', body) };
  return Promise.resolve({});
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.useFakeTimers(); mock.snapshot = obsRegistrationSnapshot(); mock.error = null; mock.mutate.mockReset().mockResolvedValue({}); mock.fonts.mockReset().mockResolvedValue(['Yu Gothic UI', 'Meiryo']); closeReady.mockReset();
  window.casmateObsDesign = { closeReady, onTarget: listener => { targetRequest = listener; return () => undefined; }, onCloseRequest: listener => { closeRequest = listener; return () => undefined; } };
});
afterEach(() => { cleanup(); delete window.casmateObsDesign; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('詳細を開いて効果を有効化し、数値・カラーコードを編集して保存と取り消しができる', async () => {
  render(<ObsDesignPage/>); await flush();
  fireEvent.click(panel().getByText('詳細なデザイン'));
  const details = within(panel().getByText('詳細なデザイン').closest('details')!);
  const border = details.getByRole<HTMLInputElement>('switch', { name: '枠線', exact: true });
  if (!border.checked) fireEvent.click(border);
  const shadow = details.getByRole<HTMLInputElement>('switch', { name: '文字の影', exact: true });
  if (!shadow.checked) fireEvent.click(shadow);
  const outline = details.getByRole<HTMLInputElement>('switch', { name: '文字の縁取り', exact: true });
  if (!outline.checked) fireEvent.click(outline);
  expect(details.getByRole('spinbutton', { name: '枠線の太さ', exact: true })).toBeEnabled();
  fireEvent.change(details.getByLabelText('枠線の太さ'), { target: { value: '2' } });
  fireEvent.change(details.getByLabelText('枠線の色 カラーコード'), { target: { value: '#123456' } });
  fireEvent.change(details.getByLabelText('文字の影・左右のずれ'), { target: { value: '-3' } });
  fireEvent.change(details.getByLabelText('文字の影・ぼかし'), { target: { value: '12' } }); await flush(500);
  expect(mock.mutate).toHaveBeenLastCalledWith('/api/obs-design/comments', 'PUT', expect.objectContaining({ style: expect.objectContaining({ border: expect.objectContaining({ enabled: true, width: 2, color: '#123456' }), textShadow: expect.objectContaining({ enabled: true, x: -3, blur: 12 }) }) }));
  fireEvent.change(details.getByLabelText('縁取りの太さ'), { target: { value: '2' } }); await flush(500);
  fireEvent.change(details.getByLabelText('縁取りの太さ'), { target: { value: '2.5' } }); await flush(500);
  fireEvent.click(panel().getByRole('button', { name: '取り消し' })); await flush(500);
  expect(details.getByLabelText('縁取りの太さ')).toHaveDisplayValue('2');
});

it('調整を分類し、横並びの文字・背景・余白と基本の行間を対象別に保存する', async () => {
  render(<ObsDesignPage/>); await flush();
  const text = panel().getByRole('region', { name: '文字', exact: true });
  const background = panel().getByRole('region', { name: '背景', exact: true });
  const spacing = panel().getByRole('region', { name: '余白・形' });
  expect(within(text).getByLabelText('文字サイズ')).toBeVisible();
  expect(within(background).getByLabelText('デザインの種類')).toBeVisible();
  expect(within(spacing).getByLabelText('行間')).toBeVisible();
  expect(panel().getAllByLabelText('行間')).toHaveLength(1);
  expect(panel().getByRole('spinbutton', { name: '文字サイズ', exact: true })).toHaveAttribute('step', '1');
  expect(panel().getByRole('spinbutton', { name: '行間', exact: true })).toHaveAttribute('step', '0.05');
  expect(panel().getByRole('spinbutton', { name: '内側余白・左右', exact: true })).toHaveAttribute('max', '96');
  expect(panel().getByText(/フォントはこのPCとOBSのPCに必要です/)).not.toBeVisible();
  fireEvent.click(panel().getByText('フォントについて'));
  expect(panel().getByText(/フォントはこのPCとOBSのPCに必要です/)).toBeVisible();
  fireEvent.change(within(text).getByLabelText('文字の太さ'), { target: { value: '500' } });
  fireEvent.change(within(text).getByLabelText('文字色 カラーコード'), { target: { value: '#123456' } });
  fireEvent.change(within(spacing).getByLabelText('内側余白・左右'), { target: { value: '80' } });
  fireEvent.change(within(spacing).getByLabelText('行間'), { target: { value: '1.75' } }); await flush(500);
  expect(mock.mutate).toHaveBeenLastCalledWith('/api/obs-design/comments', 'PUT', expect.objectContaining({ style: expect.objectContaining({ fontWeight: 500, textColor: '#123456', paddingX: 80, lineHeight: 1.75 }) }));
  await act(async () => targetRequest('speech'));
  expect(panel().getByLabelText('上下の位置')).toBeVisible();
  expect(panel().getAllByLabelText('行間')).toHaveLength(1);
});

it('カラーコードの不正入力を保持し、コピーと終了を止め、呼び出し・取り消しで入力値も復元する', async () => {
  render(<ObsDesignPage/>); await flush();
  const code = () => panel().getByLabelText<HTMLInputElement>('文字色 カラーコード');
  const originalColor = code().value;
  fireEvent.change(code(), { target: { value: '#bad' } });
  fireEvent.change(panel().getByLabelText('角丸'), { target: { value: '8' } }); await flush(500);
  expect(code()).toHaveValue('#bad'); expect(code()).toHaveAttribute('aria-invalid', 'true');
  expect(mock.mutate).toHaveBeenLastCalledWith('/api/obs-design/comments', 'PUT', expect.objectContaining({ style: expect.objectContaining({ textColor: originalColor, radius: 8 }) }));
  const calls = mock.mutate.mock.calls.length;
  chooseTab('保存済み');
  fireEvent.click(panel().getByRole('button', { name: '今のデザインを控えとして保存' })); await flush();
  expect(mock.mutate).toHaveBeenCalledTimes(calls);
  await act(async () => closeRequest()); expect(closeReady).not.toHaveBeenCalled();
  chooseTab('プリセット'); fireEvent.click(panel().getByRole('button', { name: '標準', exact: true })); await flush(500);
  chooseTab('調整'); expect(code()).toHaveAttribute('aria-invalid', 'false');
  const standard = createObsDesignPreset('comments', 'standard').style.textColor;
  expect(code()).toHaveValue(standard);
  fireEvent.change(code(), { target: { value: '#ABCDEF' } }); await flush(500);
  expect(panel().getByLabelText('文字色')).toHaveValue('#abcdef');
  fireEvent.click(panel().getByRole('button', { name: '取り消し' })); await flush(500);
  expect(code()).toHaveValue(standard);
});

it.each([
  ['読込中', null], ['読込失敗', 'デザイン設定を取得できません。'],
] as const)('初回%sで編集値がない場合は閉じられる', async (_state, error) => {
  mock.snapshot = null; mock.error = error;
  render(<ObsDesignPage/>); await flush();
  expect(screen.getByText(error ?? 'デザイン設定を読み込み中…')).toBeVisible();
  await act(async () => closeRequest());
  expect(closeReady).toHaveBeenCalledOnce();
  expect(mock.mutate).not.toHaveBeenCalled();
});

it('既存値を表示し、表示切替を重複させず、開く・対象切替・見本調整だけでは保存しない', async () => {
  render(<ObsDesignPage/>); await flush();
  expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('36');
  expect(panel().queryByRole('switch', { name: 'サービス名を表示' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'OBS用CSSをコピー' })).toBeNull();
  fireEvent.change(panel().getByLabelText('見本の幅'), { target: { value: '900' } }); await flush(500);
  expect(mock.mutate).not.toHaveBeenCalled();
  await act(async () => targetRequest('speech'));
  expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('32');
  expect(panel().getByLabelText('上下の位置')).toHaveValue('bottom');
  expect(mock.mutate).not.toHaveBeenCalled();
});
it('使い方を必要時に開け、注意書きの展開では保存しない', async () => {
  render(<ObsDesignPage/>); await flush();
  const help = screen.getByText('使い方・OBSへの反映について');
  const note = screen.getByText(/文字や背景を、見本を見ながら調整します。OBSにカスタムCSS/);
  expect(note).not.toBeVisible();
  fireEvent.click(help);
  expect(note).toBeVisible();
  fireEvent.click(help);
  expect(note).not.toBeVisible();
  expect(mock.mutate).not.toHaveBeenCalled();
});
it('両対象に同名の見本付き10カードを表示し、適用値を対象別に保存する', async () => {
  render(<ObsDesignPage/>); await flush();
  for (const target of ['comments', 'speech'] as const) {
    await act(async () => targetRequest(target));
    chooseTab('プリセット');
    const cards = panel().getByRole('group', { name: 'デザインのプリセット' });
    expect(within(cards).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(obsPresets.map(item => item.label));
    for (const { id, label } of obsPresets) {
      const card = within(cards).getByRole('button', { name: label, exact: true });
      const calls = mock.mutate.mock.calls.length;
      card.focus(); fireEvent.click(card); await flush(500);
      expect(card).toHaveFocus();
      if (id === 'standard') expect(mock.mutate).toHaveBeenCalledTimes(calls);
      else expect(mock.mutate).toHaveBeenLastCalledWith(`/api/obs-design/${target}`, 'PUT', createObsDesignPreset(target, id));
      expect(card.parentElement!.querySelector('.preset-thumbnail')!.shadowRoot!.querySelector('main')).not.toBeNull();
    }
  }
});
it('有効な変更を対象別に自動保存し、取り消し・プリセット・他方への切替で保持する', async () => {
  render(<ObsDesignPage/>); await flush();
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '50' } }); await flush(499);
  expect(mock.mutate).not.toHaveBeenCalled(); await flush(1);
  expect(mock.mutate).toHaveBeenLastCalledWith('/api/obs-design/comments', 'PUT', expect.objectContaining({ variant: 'paper', style: expect.objectContaining({ fontSize: 50 }) }));
  chooseTab('プリセット');
  fireEvent.click(panel().getByRole('button', { name: '背景なし' })); await flush(500);
  expect(mock.mutate).toHaveBeenLastCalledWith('/api/obs-design/comments', 'PUT', expect.objectContaining({ variant: 'card', style: expect.objectContaining({ backgroundOpacity: 0 }) }));
  fireEvent.click(panel().getByRole('button', { name: '取り消し' })); await flush(500);
  expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('50');
  fireEvent.click(screen.getByRole('tab', { name: '音声認識' }));
  fireEvent.change(panel().getByLabelText('上下の位置'), { target: { value: 'center' } }); await flush(500);
  expect(mock.mutate).toHaveBeenLastCalledWith('/api/obs-design/speech', 'PUT', expect.objectContaining({ style: expect.objectContaining({ vertical: 'center' }) }));
  fireEvent.click(screen.getByRole('tab', { name: 'コメント' })); expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('50');
});
it('不正入力と保存待ち・失敗で閉じる操作を止め、再保存後に閉じられる', async () => {
  render(<ObsDesignPage/>); await flush();
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '' } }); await flush(500);
  expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue(''); expect(mock.mutate).not.toHaveBeenCalled();
  await act(async () => closeRequest()); expect(closeReady).not.toHaveBeenCalled();
  mock.mutate.mockRejectedValueOnce(new Error('保存できません'));
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '48' } });
  await act(async () => closeRequest()); expect(closeReady).not.toHaveBeenCalled(); await flush(500);
  expect(panel().getByText('保存できません')).toBeVisible(); expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('48');
  await act(async () => closeRequest()); expect(closeReady).not.toHaveBeenCalled();
  const retry = panel().getByRole('button', { name: '再保存' }); retry.focus();
  await act(async () => fireEvent.click(retry));
  expect(retry).toHaveFocus(); expect(retry).toHaveAttribute('aria-disabled', 'true');
  await act(async () => closeRequest()); expect(closeReady).toHaveBeenCalledOnce();
  expect(panel().getByLabelText('文字サイズ')).toBeDisabled();
  await act(async () => targetRequest('comments'));
  expect(panel().getByLabelText('文字サイズ')).toBeEnabled();
  expect(document.querySelector('.design-close-status')).not.toHaveTextContent('未保存');
});
it('保存中の連続編集を直列化し、最後の値まで保存する', async () => {
  let release!: () => void;
  mock.mutate.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({}); }));
  render(<ObsDesignPage/>); await flush();
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '40' } }); await flush(500);
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '42' } }); await flush(500);
  expect(mock.mutate).toHaveBeenCalledOnce();
  await act(async () => release());
  expect(mock.mutate).toHaveBeenCalledTimes(2);
  expect(mock.mutate).toHaveBeenLastCalledWith('/api/obs-design/comments', 'PUT', expect.objectContaining({ style: expect.objectContaining({ fontSize: 42 }) }));
});
it('保存待ち中の取り消しで保存済みに戻れば、要求を送らず閉じられる', async () => {
  render(<ObsDesignPage/>); await flush();
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '50' } });
  fireEvent.click(panel().getByRole('button', { name: '取り消し' })); await flush(500);
  expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('36');
  expect(mock.mutate).not.toHaveBeenCalled();
  await act(async () => closeRequest()); expect(closeReady).toHaveBeenCalledOnce();
});
it('フォント取得失敗で保存値を維持し、再取得したフォントを選択できる', async () => {
  mock.fonts.mockRejectedValueOnce(new Error('失敗'));
  render(<ObsDesignPage/>); await flush();
  expect(panel().getByLabelText('フォント')).toHaveValue('Yu Gothic UI');
  expect(panel().getByText(/フォント一覧を取得できませんでした/)).toBeVisible();
  let release!: (fonts: string[]) => void;
  mock.fonts.mockImplementationOnce(() => new Promise<string[]>(resolve => { release = resolve; }));
  const reload = panel().getByRole('button', { name: '一覧を再取得' }); reload.focus();
  fireEvent.click(reload); await flush();
  expect(reload).toHaveFocus(); expect(reload).toHaveAttribute('aria-disabled', 'true');
  const calls = mock.fonts.mock.calls.length;
  fireEvent.click(reload); await flush(); expect(mock.fonts).toHaveBeenCalledTimes(calls);
  await act(async () => release(['Yu Gothic UI', 'Meiryo']));
  expect(reload).toHaveFocus(); expect(reload).toHaveAttribute('aria-disabled', 'false');
  fireEvent.change(panel().getByLabelText('フォント'), { target: { value: 'Meiryo' } }); await flush(500);
  expect(mock.mutate).toHaveBeenLastCalledWith('/api/obs-design/comments', 'PUT', expect.objectContaining({ style: expect.objectContaining({ fontFamily: 'Meiryo' }) }));
});

it('名前入力なしでコピーを残し、編集・呼び出し・取り消し・対象切替・削除を独立して扱う', async () => {
  mock.mutate.mockImplementation(syncMutation);
  render(<ObsDesignPage/>); await flush();
  const leave = () => panel().getByRole('button', { name: '今のデザインを控えとして保存' });
  await act(async () => fireEvent.click(leave()));
  chooseTab('保存済み');
  expect(panel().getByRole('button', { name: '保存1に戻す' })).toBeVisible();
  expect(mock.snapshot!.settings.commentOverlay.design).toBeUndefined();
  chooseTab('調整');
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '55' } }); await flush(500);
  expect(mock.snapshot!.settings.application.obsSavedDesigns!.comments.items[0].design.style.fontSize).toBe(36);
  chooseTab('保存済み');
  fireEvent.click(panel().getByRole('button', { name: '保存1に戻す' })); await flush(500);
  expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('36');
  fireEvent.click(panel().getByRole('button', { name: '取り消し' })); await flush(500);
  expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('55');
  fireEvent.click(screen.getByRole('tab', { name: '音声認識' }));
  expect(panel().queryByRole('button', { name: '保存1に戻す' })).toBeNull();
  await act(async () => fireEvent.click(leave()));
  expect(mock.snapshot!.settings.application.obsSavedDesigns!.speech.items[0].number).toBe(1);
  fireEvent.click(screen.getByRole('tab', { name: 'コメント' }));
  await act(async () => fireEvent.click(leave()));
  const remove = panel().getByRole('button', { name: '保存1を削除' }); remove.focus();
  await act(async () => fireEvent.click(remove));
  expect(leave()).toHaveFocus();
  expect(panel().queryByRole('button', { name: '保存1に戻す' })).toBeNull();
  expect(panel().getByRole('button', { name: '保存2に戻す' })).toBeVisible();
  expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('55');
  await act(async () => fireEvent.click(leave()));
  expect(panel().getByRole('button', { name: '保存3に戻す' })).toBeVisible();
}, 15000);

it('不正入力はコピーせず、コピー失敗の再試行は同じ内容・IDを使い、取消後は閉じられる', async () => {
  mock.mutate.mockImplementation(syncMutation);
  render(<ObsDesignPage/>); await flush();
  const leave = () => panel().getByRole('button', { name: '今のデザインを控えとして保存' });
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '' } });
  fireEvent.click(leave()); await flush();
  expect(panel().getByText(/入力エラーを修正/)).toBeVisible();
  expect(mock.mutate).not.toHaveBeenCalled();
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '36' } }); await flush();
  mock.mutate.mockRejectedValueOnce(new Error('コピーを保存できません'));
  await act(async () => fireEvent.click(leave()));
  const first = mock.mutate.mock.calls.at(-1)!;
  await act(async () => closeRequest()); expect(closeReady).not.toHaveBeenCalled();
  expect(panel().getByText('コピーを保存できません')).toBeVisible();
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '52' } }); await flush(500);
  await act(async () => fireEvent.click(panel().getByRole('button', { name: '再試行' })));
  expect(mock.mutate).toHaveBeenLastCalledWith(...first);
  expect(mock.snapshot!.settings.application.obsSavedDesigns!.comments.items[0].design.style.fontSize).toBe(36);
  expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('52');
  chooseTab('保存済み');
  mock.mutate.mockRejectedValueOnce(new Error('削除できません'));
  await act(async () => fireEvent.click(panel().getByRole('button', { name: '保存1を削除' })));
  await act(async () => closeRequest()); expect(closeReady).not.toHaveBeenCalled();
  fireEvent.click(panel().getByRole('button', { name: '取消' })); await flush();
  expect(panel().getByRole('button', { name: '保存1に戻す' })).toBeVisible();
  await act(async () => closeRequest()); expect(closeReady).toHaveBeenCalledOnce();
});

it('コピー処理中の重複操作・閉じるを止め、再起動相当の保存一覧を復元する', async () => {
  const library = addSavedObsDesign(emptySavedObsDesigns(), 'comments', { id: crypto.randomUUID(), design: createObsDesignPreset('comments', 'pastel') });
  library.comments.nextNumber = 42; library.comments.items[0].number = 41;
  mock.snapshot!.settings.application.obsSavedDesigns = library;
  let release!: () => void;
  mock.mutate.mockImplementationOnce((...args) => new Promise(resolve => { release = () => { void syncMutation(...args).then(resolve); }; }));
  render(<ObsDesignPage/>); await flush();
  chooseTab('保存済み');
  expect(panel().getByRole('button', { name: '保存41に戻す' })).toBeVisible();
  const leave = panel().getByRole('button', { name: '今のデザインを控えとして保存' });
  fireEvent.click(leave); fireEvent.click(leave); await flush();
  expect(mock.mutate).toHaveBeenCalledOnce(); expect(leave).toHaveAttribute('aria-disabled', 'true');
  expect(panel().getByRole('button', { name: '保存41に戻す' })).toHaveAttribute('aria-disabled', 'true');
  await act(async () => closeRequest()); expect(closeReady).not.toHaveBeenCalled();
  await act(async () => release());
  expect(panel().getByRole('button', { name: '保存42に戻す' })).toBeVisible();
});


it('3タブをキーボードで切り替え、対象別の選択・不正入力・詳細の開閉を保持する', async () => {
  render(<ObsDesignPage/>); await flush();
  const tabs = () => panel().getAllByRole('tab');
  expect(tabs().map(tab => tab.textContent)).toEqual(['調整', 'プリセット', '保存済み0']);
  expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  const details = panel().getByText('詳細なデザイン').closest('details')!;
  fireEvent.click(panel().getByText('詳細なデザイン'));
  fireEvent.change(panel().getByLabelText('文字サイズ'), { target: { value: '' } });
  const adjust = tabs()[0]; adjust.focus();
  fireEvent.keyDown(adjust, { key: 'ArrowLeft' });
  expect(tabs()[2]).toHaveFocus(); expect(tabs()[2]).toHaveAttribute('aria-selected', 'true');
  expect(panel().getByLabelText('文字サイズ')).not.toBeVisible();
  expect(panel().getByRole('button', { name: '今のデザインを控えとして保存' })).toBeVisible();
  fireEvent.click(panel().getByRole('button', { name: '今のデザインを控えとして保存' }));
  await act(async () => closeRequest()); expect(closeReady).not.toHaveBeenCalled();
  expect(mock.mutate).not.toHaveBeenCalled();
  fireEvent.keyDown(tabs()[2], { key: 'Home' });
  expect(adjust).toHaveFocus(); expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue('');
  expect(details.open).toBe(true);
  fireEvent.keyDown(adjust, { key: 'ArrowRight' });
  expect(tabs()[1]).toHaveFocus(); expect(panel().getByRole('button', { name: 'ネオン' })).toBeVisible();
  expect(panel().queryByRole('button', { name: '保存1に戻す' })).toBeNull();
  await act(async () => targetRequest('speech'));
  expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(tabs()[0], { key: 'End' }); expect(tabs()[2]).toHaveFocus();
  await act(async () => targetRequest('comments'));
  expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(panel().getByRole('button', { name: 'ネオン' })); await flush(500);
  expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
  chooseTab('調整'); expect(panel().getByLabelText('文字サイズ')).toHaveDisplayValue(String(createObsDesignPreset('comments', 'neon').style.fontSize));
  expect(details.open).toBe(true);
});

it('どのタブでも保存でき、処理中・失敗中に切り替えても再試行と取消を操作できる', async () => {
  mock.mutate.mockImplementation(syncMutation);
  render(<ObsDesignPage/>); await flush();
  const leave = panel().getByRole('button', { name: '今のデザインを控えとして保存' });
  for (const name of ['調整', 'プリセット', '保存済み']) {
    chooseTab(name); await act(async () => fireEvent.click(leave));
    expect(panel().getByRole('tab', { name: new RegExp('^' + name) })).toHaveAttribute('aria-selected', 'true');
  }
  expect(panel().getByRole('tab', { name: '保存済み3' })).toBeVisible();
  let reject!: (error: Error) => void;
  mock.mutate.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  fireEvent.click(leave); await flush(); chooseTab('プリセット');
  expect(leave).toHaveAttribute('aria-disabled', 'true');
  await act(async () => reject(new Error('保存失敗')));
  expect(panel().getByText('保存失敗')).toBeVisible();
  chooseTab('調整');
  const retry = panel().getByRole('button', { name: '再試行' }); retry.focus();
  await act(async () => fireEvent.click(retry));
  expect(leave).toHaveFocus();
  expect(panel().getByRole('tab', { name: '調整' })).toHaveAttribute('aria-selected', 'true');
  expect(panel().getByRole('tab', { name: '保存済み4' })).toBeVisible();
});


it('削除中に別タブへ移った場合は完了後も移動先のフォーカスを維持する', async () => {
  mock.snapshot!.settings.application.obsSavedDesigns = addSavedObsDesign(emptySavedObsDesigns(), 'comments', { id: crypto.randomUUID(), design: createObsDesignPreset('comments', 'pastel') });
  let release!: () => void;
  mock.mutate.mockImplementationOnce((...args) => new Promise(resolve => { release = () => { void syncMutation(...args).then(resolve); }; }));
  render(<ObsDesignPage/>); await flush(); chooseTab('保存済み');
  const remove = panel().getByRole('button', { name: '保存1を削除' }); remove.focus(); fireEvent.click(remove); await flush();
  chooseTab('調整');
  const input = panel().getByLabelText('文字サイズ'); input.focus();
  await act(async () => release());
  expect(input).toHaveFocus();
  expect(panel().getByRole('tab', { name: '調整' })).toHaveAttribute('aria-selected', 'true');
  expect(panel().getByRole('tab', { name: '保存済み0' })).toBeVisible();
});
