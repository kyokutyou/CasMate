// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentListPanel } from '../src/renderer/components/CommentListPanel';
import { createDefaultSettings } from '../src/main/core/settings';

afterEach(cleanup);
function setup(options: { toggle?: () => Promise<unknown> } = {}) {
  const save = vi.fn(); const change = vi.fn(); const success = vi.fn();
  const toggle = options.toggle ?? vi.fn(async () => undefined);
  function Harness() {
    const [settings, setSettings] = useState(createDefaultSettings().commentList);
    return <CommentListPanel settings={settings} windowVisible={false}
      commentsUrl="http://127.0.0.1:3900/comments" onToggleWindow={toggle} onSuccess={success} onError={vi.fn()}
      onChange={value => { change(value); setSettings(value); }} onSave={async value => { save(value); setSettings(value); }} />;
  }
  render(<Harness />); return { save, change, toggle, success };
}

describe('コメント一覧A案', () => {
  it('不透明度とRGBを独立して編集し、不正コード中は補助操作を禁止する', () => {
    const { change } = setup();
    const code = screen.getByLabelText('背景色（#RRGGBBAA）');
    fireEvent.change(code, { target: { value: '#11223380' } });
    fireEvent.change(screen.getByLabelText('背景色の不透明度'), { target: { value: '25' } });
    expect(code).toHaveValue('#11223340');
    fireEvent.change(screen.getByLabelText('背景色を選択'), { target: { value: '#abcdef' } });
    expect(code).toHaveValue('#abcdef40');
    fireEvent.change(code, { target: { value: 'invalid' } });
    expect(screen.getByLabelText('背景色の不透明度')).toBeDisabled();
    expect(screen.getByLabelText('背景色を選択')).toBeDisabled();
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundColor: '#abcdef40' }));
    fireEvent.change(code, { target: { value: '#abcdef00' } });
    expect(screen.getByLabelText('背景色の不透明度')).toBeEnabled();
    expect(screen.getByLabelText('背景色の不透明度')).toHaveValue('0');
  });
  it('全項目をオフにせず、方向とスイッチだけを即時保存する', async () => {
    const { save, change } = setup();
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'サービス名' })));
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: '投稿者名' })));
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: '本文' })));
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('switch', { name: '本文' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('少なくとも1項目をオンにしてください。')).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '新着を上', exact: true })));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ stackDirection: 'newestTop', showContent: true }));
    expect(change).not.toHaveBeenCalled();
  });

  it('文字・RGBAを検証し、不正な入力を他項目の変更で消さない', async () => {
    const { change, save } = setup();
    const size = screen.getByLabelText('文字サイズ（px）');
    fireEvent.change(size, { target: { value: '201' } });
    expect(size).toHaveValue(201); expect(size).toHaveAttribute('aria-invalid', 'true');
    expect(change).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '新着を上', exact: true })));
    expect(size).toHaveValue(201);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ fontSizePx: 16 }));
    fireEvent.change(size, { target: { value: '16.5' } });
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ fontSizePx: 16.5 }));
    const color = screen.getByLabelText('文字色（#RRGGBBAA）');
    fireEvent.change(color, { target: { value: '#abcdef80' } });
    fireEvent.change(screen.getByLabelText('文字色を選択'), { target: { value: '#112233' } });
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ textColor: '#11223380' }));
    fireEvent.change(color, { target: { value: 'red' } });
    fireEvent.change(screen.getByLabelText('フォント'), { target: { value: 'Meiryo' } });
    expect(color).toHaveValue('red');
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ textColor: '#11223380', fontFamily: 'Meiryo' }));
    fireEvent.change(screen.getByLabelText('文字サイズのスライダー'), { target: { value: '200' } });
    expect(size).toHaveValue(200);
  });

  it('テスト文章を常時表示し、方向・表示項目・外観を即時反映する', async () => {
    setup();
    const preview = screen.getByRole('region', { name: 'コメント一覧のプレビュー' });
    expect(within(preview).queryByText('設定の変更を、その場で確認できます。')).not.toBeInTheDocument();
    expect(preview).toBeVisible();
    expect(preview.closest('details')).toBeNull();
    expect(within(preview).getByText('テスト文章')).toBeVisible();
    const bodies = () => within(preview).getAllByRole('article').map(el => el.querySelector('.comment-body')?.textContent);
    const initial = bodies();
    expect(initial).toHaveLength(3);
    expect(initial[0]).toBe('これはコメント一覧の表示サンプルです。');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '新着を上', exact: true })));
    expect(bodies()).toEqual([...initial].reverse());
    fireEvent.change(screen.getByLabelText('文字サイズ（px）'), { target: { value: '28' } });
    fireEvent.change(screen.getByLabelText('フォント'), { target: { value: 'Meiryo' } });
    fireEvent.change(screen.getByLabelText('文字色（#RRGGBBAA）'), { target: { value: '#112233ff' } });
    fireEvent.change(screen.getByLabelText('背景色（#RRGGBBAA）'), { target: { value: '#445566ff' } });
    for (const article of within(preview).getAllByRole('article')) {
      expect(article).toHaveStyle({ fontSize: '28px', fontFamily: 'Meiryo', color: '#112233ff', backgroundColor: '#445566ff' });
    }
    fireEvent.change(screen.getByLabelText('文字サイズ（px）'), { target: { value: '201' } });
    fireEvent.change(screen.getByLabelText('文字色（#RRGGBBAA）'), { target: { value: 'invalid' } });
    expect(within(preview).getAllByRole('article')[0]).toHaveStyle({ fontSize: '28px', color: '#112233ff' });
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: '本文' })));
    expect(preview.querySelector('.comment-body')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'サービス名' })));
    expect(preview.querySelector('.source-badge')).toBeNull();
    expect(within(preview).getByText('サンプル太郎')).toBeVisible();
  });

  it('履歴の取得なしでテスト文章を表示し、ブラウザ入口を既存URLに向ける', () => {
    setup();
    expect(screen.getByText('これはコメント一覧の表示サンプルです。')).toBeVisible();
    expect(screen.queryByText('コメントはまだありません。')).toBeNull();
    expect(screen.getByRole('link', { name: /ブラウザで開く/ })).toHaveAttribute('href', 'http://127.0.0.1:3900/comments');
  });

  it('ウィンドウ操作中は寸法用の同じボタンとフォーカスを保ち、重複実行しない', async () => {
    let resolve!: () => void;
    const toggle = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const { success } = setup({ toggle });
    const button = screen.getByRole('button', { name: 'ウィンドウを開く' });button.focus();
    fireEvent.click(button);fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1); expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus(); expect(button).toHaveTextContent('処理中…');
    await act(async () => resolve());
    expect(button).toHaveFocus();expect(success).toHaveBeenCalledTimes(1);
  });

  it('他画面の開閉を反映し、失敗は成功トーストにしない', async () => {
    const reportError = vi.fn();
    const { ManagementNavigation } = await import('../src/renderer/management-navigation');
    const success = vi.fn();
    const onError = vi.fn();
    const props = { settings:createDefaultSettings().commentList, windowVisible:false, commentsUrl:'/comments', onChange:vi.fn(), onSave:vi.fn(async () => {}), onToggleWindow:vi.fn(async () => { throw new Error('開けませんでした'); }), onSuccess:success, onError };
    const navigation = { editor: 'commentList' as const, reportError, open:vi.fn() };
    const view = render(<ManagementNavigation.Provider value={navigation}><CommentListPanel {...props} /></ManagementNavigation.Provider>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name:'ウィンドウを開く' })));
    expect(success).not.toHaveBeenCalled();expect(onError).toHaveBeenLastCalledWith('開けませんでした');
    view.rerender(<ManagementNavigation.Provider value={navigation}><CommentListPanel {...props} windowVisible /></ManagementNavigation.Provider>);
    expect(screen.getByRole('button', { name:'非表示にする' })).toHaveAttribute('aria-pressed', 'true');
  });
});
