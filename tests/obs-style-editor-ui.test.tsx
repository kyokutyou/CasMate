// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NumericControl } from '../src/renderer/obs-style-editor/controls';
import { createHistory, historyReducer } from '../src/renderer/obs-style-editor/history';
import { createDefaultDocument, createPreset, obsPresets, parseDocument } from '../src/renderer/obs-style-editor/model';
import type { EditorDocument } from '../src/renderer/obs-style-editor/model';

vi.mock('../src/renderer/obs-style-editor/Preview', () => ({
  Preview: ({ document }: { document: EditorDocument }) => <div data-testid="preview-document">{JSON.stringify(document)}</div>,
}));
import { ObsStyleEditorApp } from '../src/renderer/obs-style-editor/App';

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function designControls() { return within(screen.getByRole('tabpanel')); }
function navigation() { return within(screen.getByRole('navigation', { name: '編集対象' })); }
function sampleControls() { return within(screen.getByText('見本を調整', { exact: true }).closest('details')!); }
function outputControls() { return within(screen.getByRole('region', { name: '出力と保存' })); }

// Name lookup avoids recomputing names/styles for every input in both panels.
// Keep the original role, accessible name and visibility requirements on the result.
function namedControl(queries: Pick<typeof screen, 'getByLabelText'>, role: string, name: string, label: string | RegExp = name) {
  const control = queries.getByLabelText(label);
  // getByRole keeps its default first-role-token and accessibility semantics.
  expect(within(control.parentElement!).getByRole(role, { name })).toBe(control);
  expect(control).toBeVisible();
  expect(control.closest('[aria-hidden="true"], [hidden]')).toBeNull();
  return control;
}

function designControl(role: string, name: string) { return namedControl(designControls(), role, name); }

function currentDocument() {
  return parseDocument(screen.getByTestId('preview-document').textContent ?? '');
}

function settingsFile(text: string) {
  const file = new File([], 'settings.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
}

describe('着せ替え画面', () => {
  it('両対象に10個の同名カードを描画し、対象だけを適用してフォーカスを保つ', () => {
    render(<ObsStyleEditorApp/>);
    for (const target of ['comments', 'speech'] as const) {
      fireEvent.click(navigation().getByRole('tab', { name: target === 'comments' ? 'コメント' : '音声認識' }));
      const cards = designControls().getByRole('group', { name: 'デザインのプリセット' });
      expect(within(cards).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(obsPresets.map(item => item.label));
      const other = structuredClone(currentDocument().designs[target === 'comments' ? 'speech' : 'comments']);
      for (const { id, label } of obsPresets) {
        const card = within(cards).getByRole('button', { name: label, exact: true });
        card.focus(); fireEvent.click(card);
        expect(card).toHaveFocus();
        expect(currentDocument().designs[target]).toEqual(createPreset(target, id));
        expect(currentDocument().designs[target === 'comments' ? 'speech' : 'comments']).toEqual(other);
        expect(card.parentElement!.querySelector('.preset-thumbnail')!.shadowRoot!.querySelector('main')).not.toBeNull();
      }
    }
  });
  it('有効なデザインを保ち、切替で両方の編集を保持し、初期化と取り消しを行う', () => {
    render(<ObsStyleEditorApp />);
    fireEvent.change(designControl('textbox', '文字サイズ'), { target: { value: '60' } });
    fireEvent.change(designControl('textbox', '文字サイズ'), { target: { value: '' } });
    expect(currentDocument().designs.comments.fontSize).toBe(60);
    fireEvent.click(navigation().getByRole('tab', { name: '音声認識' }));
    fireEvent.change(designControl('textbox', '文字サイズ'), { target: { value: '72' } });
    fireEvent.click(designControls().getByRole('button', { name: 'くっきり縁取り' }));
    expect(currentDocument().designs.speech.outline.enabled).toBe(true);
    fireEvent.click(navigation().getByRole('button', { name: '取り消し' }));
    expect(currentDocument().designs.speech.fontSize).toBe(72);
    fireEvent.click(navigation().getByRole('tab', { name: 'コメント' }));
    expect(designControl('textbox', '文字サイズ')).toHaveValue('60');
    fireEvent.click(designControls().getByRole('button', { name: '初期化' }));
    expect(currentDocument().designs.comments.fontSize).toBe(32);
    expect(currentDocument().designs.speech.fontSize).toBe(72);
    fireEvent.click(navigation().getByRole('button', { name: '取り消し' }));
    expect(currentDocument().designs.comments.fontSize).toBe(60);
    fireEvent.click(navigation().getByRole('button', { name: 'やり直し' }));
    expect(currentDocument().designs.comments.fontSize).toBe(32);
  });

  it('空欄や長すぎる任意フォント名を保持し、プリセットで入力と選択を戻す', () => {
    render(<ObsStyleEditorApp />);
    fireEvent.change(designControl('combobox', 'フォント'), { target: { value: 'custom' } });
    const input = designControl('textbox', 'フォント名');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    expect(currentDocument().designs.comments.fontFamily).toBe('Yu Gothic UI');
    fireEvent.change(input, { target: { value: 'a'.repeat(201) } });
    expect(input).toHaveValue('a'.repeat(201));
    expect(currentDocument().designs.comments.fontFamily).toBe('Yu Gothic UI');
    fireEvent.change(input, { target: { value: '</style>"Custom font' } });
    expect(currentDocument().designs.comments.fontFamily).toBe('</style>"Custom font');
    fireEvent.click(designControls().getByRole('button', { name: '標準', exact: true }));
    expect(screen.queryByRole('textbox', { name: 'フォント名' })).toBeNull();
    expect(designControl('combobox', 'フォント')).toHaveValue('Yu Gothic UI');
  });

  it('詳細の各効果と、見本だけの設定を編集する', () => {
    render(<ObsStyleEditorApp />);
    fireEvent.click(screen.getByText('詳細なデザイン', { exact: true, selector: '#panel-comments summary span' }));
    fireEvent.click(namedControl(designControls(), 'switch', '文字の縁取り', /^文字の縁取り(?:ON|OFF)$/u));
    fireEvent.change(designControl('textbox', '縁取りの太さ'), { target: { value: '3' } });
    fireEvent.click(namedControl(designControls(), 'switch', 'サービス別のバッジ背景色', /^サービス別のバッジ背景色(?:ON|OFF)$/u));
    fireEvent.change(designControls().getByLabelText('Twitchの背景色'), { target: { value: '#123456' } });
    expect(currentDocument().designs.comments.outline).toMatchObject({ enabled: true, width: 3 });
    expect(currentDocument().designs.comments.badgeColors.twitch).toBe('#123456');
    fireEvent.click(screen.getByText('見本を調整', { exact: true }));
    fireEvent.change(namedControl(sampleControls(), 'textbox', '見本の幅'), { target: { value: '720' } });
    fireEvent.change(namedControl(sampleControls(), 'combobox', 'サービス（見本だけ）'), { target: { value: 'twitch' } });
    fireEvent.change(namedControl(sampleControls(), 'textbox', '見本の文章'), { target: { value: '</script>\n架空の文章' } });
    expect(currentDocument().previews.comments).toMatchObject({ width: 720, source: 'twitch', text: '</script>\n架空の文章' });
    fireEvent.click(navigation().getByRole('button', { name: '取り消し' }));
    expect(currentDocument().previews.comments.text).not.toBe('</script>\n架空の文章');
  });

  it('設定読込は両方を1操作で置き換え、不正・未対応JSONで現在の内容を変更しない', async () => {
    render(<ObsStyleEditorApp />);
    const loaded = createDefaultDocument();
    loaded.designs.comments.fontSize = 77;
    loaded.designs.speech.fontSize = 99;
    loaded.previews.speech.text = '設定から読み込んだ字幕';
    fireEvent.change(outputControls().getByLabelText('再編集用設定ファイル'), { target: { files: [settingsFile(JSON.stringify(loaded))] } });
    await waitFor(() => expect(currentDocument().designs.speech.fontSize).toBe(99));
    expect(currentDocument().designs.comments.fontSize).toBe(77);
    fireEvent.click(navigation().getByRole('button', { name: '取り消し' }));
    expect(currentDocument().designs.comments.fontSize).toBe(32);
    expect(currentDocument().designs.speech.fontSize).toBe(40);
    fireEvent.click(navigation().getByRole('button', { name: 'やり直し' }));
    for (const invalid of ['{', JSON.stringify({ ...loaded, formatVersion: 2 })]) {
      fireEvent.change(outputControls().getByLabelText('再編集用設定ファイル'), { target: { files: [settingsFile(invalid)] } });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('読み込めませんでした'));
      expect(currentDocument()).toEqual(loaded);
    }
  });

  it('読込中は編集を止め、失敗すると最後の有効な編集へ戻る', async () => {
    render(<ObsStyleEditorApp />);
    let rejectRead: (reason: Error) => void = () => undefined;
    const file = new File([], 'settings.json');
    Object.defineProperty(file, 'text', { value: () => new Promise<string>((_resolve, reject) => { rejectRead = reject; }) });
    fireEvent.change(outputControls().getByLabelText('再編集用設定ファイル'), { target: { files: [file] } });
    expect(designControl('textbox', '文字サイズ')).toBeDisabled();
    fireEvent.change(designControl('textbox', '文字サイズ'), { target: { value: '120' } });
    expect(currentDocument().designs.comments.fontSize).toBe(32);
    rejectRead(new Error('読み取り失敗'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('読み取り失敗'));
    expect(designControl('textbox', '文字サイズ')).toBeEnabled();
    expect(currentDocument().designs.comments.fontSize).toBe(32);
  });

  it('コピー失敗で手動欄を開き、フォーカスと出力操作を維持する', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    render(<ObsStyleEditorApp />);
    const button = outputControls().getByRole('button', { name: /OBS用CSSをコピー/ });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('コピーできませんでした'));
    expect(document.activeElement).toBe(button);
    expect(namedControl(screen, 'textbox', '生成されたOBS用CSS')).toBeVisible();
    expect(namedControl(screen, 'textbox', '生成されたOBS用CSS').getAttribute('readonly')).not.toBeNull();
    expect(outputControls().getByRole('button', { name: /OBS用CSSをコピー/ })).toBe(button);
  });

  it('CSSと再編集用JSONを別のファイルで保存する', () => {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:sample'; }) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    render(<ObsStyleEditorApp />);
    fireEvent.click(outputControls().getByRole('button', { name: 'OBS用CSSを保存', exact: true }));
    fireEvent.click(outputControls().getByRole('button', { name: '再編集用設定を保存', exact: true }));
    expect(names).toEqual(['casmate-comments.css', 'casmate-obs-style-settings.json']);
    expect(blobs.map((blob) => blob.type)).toEqual(['text/css;charset=utf-8', 'application/json;charset=utf-8']);
  });
});

describe('着せ替えの編集履歴', () => {
  it('スライダーの連続変更を1操作にまとめ、取り消しとやり直しを行う', () => {
    let state = createHistory(32);
    state = historyReducer(state, { type: 'begin' });
    state = historyReducer(state, { type: 'edit', transform: () => 40 });
    state = historyReducer(state, { type: 'edit', transform: () => 50 });
    state = historyReducer(state, { type: 'end' });
    expect(state.past).toEqual([32]);
    state = historyReducer(state, { type: 'undo' });
    expect(state.present).toBe(32);
    state = historyReducer(state, { type: 'redo' });
    expect(state.present).toBe(50);
  });

  it('20操作を保持し、新たな編集時にやり直しを消す', () => {
    let state = createHistory(0);
    for (let value = 1; value <= 25; value += 1) state = historyReducer(state, { type: 'edit', transform: () => value });
    expect(state.past).toHaveLength(20);
    for (let index = 0; index < 20; index += 1) state = historyReducer(state, { type: 'undo' });
    expect(state.present).toBe(5);
    state = historyReducer(state, { type: 'edit', transform: () => 99 });
    expect(state.future).toHaveLength(0);
  });
});

describe('数値の入力', () => {
  it('コンパクト欄は長い小数を表示だけ丸め、入力中の有効値は丸めて保存しない', () => {
    const change = vi.fn();
    const { rerender } = render(<NumericControl compact label="不透明度" value={45.09803921568628} min={0} max={100} unit="%" onChange={change}/>);
    const input = namedControl(screen, 'spinbutton', '不透明度');
    expect(input).toHaveDisplayValue('45.1'); expect(change).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '45.123' } });
    expect(change).toHaveBeenLastCalledWith(45.123);
    rerender(<NumericControl compact label="不透明度" value={45.123} min={0} max={100} unit="%" onChange={change}/>);
    expect(input).toHaveDisplayValue('45.123');
    rerender(<NumericControl compact revision={1} label="不透明度" value={45.123} min={0} max={100} unit="%" onChange={change}/>);
    expect(input).toHaveDisplayValue('45.12');
  });
  it('先頭roleが異なる入力欄を同じ名前だけで受け付けない', () => {
    render(<input type="text" aria-label="文字サイズ" role="button textbox" />);
    expect(() => namedControl(screen, 'textbox', '文字サイズ')).toThrow();
  });

  it('空欄・範囲外は保持し、有効な数値だけ反映する', () => {
    const change = vi.fn();
    render(<NumericControl label="文字サイズ" value={32} min={8} max={200} unit="px" onChange={change} />);
    const input = namedControl(screen, 'textbox', '文字サイズ');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '201' } });
    expect(input).toHaveValue('201');
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '44' } });
    expect(change).toHaveBeenCalledWith(44);
  });
});
