// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentFilterPanel } from '../src/renderer/components/CommentFilterPanel';
import type { CommentFilterSettings } from '../src/shared/types';

afterEach(cleanup);
function setup(initial: CommentFilterSettings = { ngWords: ['ネタバレ', 'spam'], asciiArtEnabled: true }) {
  const change = vi.fn(); const toggle = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState(initial);
    return <CommentFilterPanel settings={settings} onChange={value => { change(value); setSettings(value); }}
      onToggleAsciiArt={async enabled => { toggle(enabled); setSettings(value => ({ ...value, asciiArtEnabled: enabled })); }} />;
  }
  render(<Harness />); return { change, toggle };
}
describe('コメントフィルターA案', () => {
  it('末尾の適用時期の補足案内を表示しない', () => {
    setup();
    expect(screen.queryByText('保存後に受信するコメントから適用します。以前のコメントは再判定せず、除外済みのコメントも復元しません。')).not.toBeInTheDocument();
  });

  it('空入力では判定せず、サンプルと手入力のテストは設定を変更しない', () => {
    const { change, toggle } = setup();
    expect(screen.getByRole('status', { name: '判定結果' })).toHaveTextContent('コメントを入力してください');
    fireEvent.click(screen.getByRole('button', { name: '通常文' }));
    expect(screen.getByRole('status', { name: '判定結果' })).toHaveTextContent('表示・読み上げの対象です');
    fireEvent.click(screen.getByRole('button', { name: 'NGワード入り' }));
    expect(screen.getByRole('status', { name: '判定結果' })).toHaveTextContent('本文に「ネタバレ」が含まれています。');
    fireEvent.change(screen.getByLabelText('投稿者名'), { target: { value: 'ＳＰＡＭ太郎' } });
    fireEvent.change(screen.getByLabelText('コメント本文'), { target: { value: 'こんにちは' } });
    expect(screen.getByRole('status', { name: '判定結果' })).toHaveTextContent('投稿者名に「spam」が含まれています。');
    expect(change).not.toHaveBeenCalled(); expect(toggle).not.toHaveBeenCalled();
  });
  it('編集中のNGワードを正規化して数え、先頭の語をサンプルに使う', () => {
    const { change } = setup();
    const editor = screen.getByLabelText('NGワード（1行に1件）');
    fireEvent.change(editor, { target: { value: ' ＢＡＤ \nbad\n\n別の語' } });
    expect(editor).toHaveAttribute('rows', '6');
    expect(screen.getByLabelText('NGワード登録件数')).toHaveTextContent('2件');
    fireEvent.click(screen.getByRole('button', { name: 'NGワード入り' }));
    expect(screen.getByLabelText('コメント本文')).toHaveValue('このコメントにはＢＡＤが含まれます。');
    expect(change).toHaveBeenCalledTimes(1);
    fireEvent.change(editor, { target: { value: '\n  ' } });
    expect(screen.getByRole('button', { name: 'NGワード入り' })).toBeDisabled();
    expect(screen.getByText('NGワードを登録するとサンプルを選べます。')).toBeVisible();
    expect(screen.getByRole('status', { name: '判定結果' })).toHaveTextContent('表示・読み上げの対象です');
  });
  it('アート判定のスイッチを反映し、1行顔文字を通す', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'アート' }));
    expect(screen.getByRole('status', { name: '判定結果' })).toHaveTextContent('複数行のアスキーアートに該当');
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'アスキーアートを除外' })));
    expect(screen.getByRole('status', { name: '判定結果' })).toHaveTextContent('表示・読み上げの対象です');
    fireEvent.click(screen.getByRole('button', { name: '通常文' }));
    expect(screen.getByLabelText('コメント本文')).toHaveValue('こんにちは！ (^_^)');
  });
  it('保存失敗でも入力中の値で判定し、エラーの説明領域を常設する', () => {
    const props = { settings: { ngWords: ['未保存語'], asciiArtEnabled: false }, onChange: vi.fn(), onToggleAsciiArt: vi.fn(async () => {}) };
    const view = render(<CommentFilterPanel {...props} />);
    const help = screen.getByRole('status', { name: '設定の保存状態' });
    fireEvent.click(screen.getByRole('button', { name: 'NGワード入り' }));
    view.rerender(<CommentFilterPanel {...props} saveError="設定ファイルに書き込めませんでした。" />);
    expect(screen.getByRole('status', { name: '設定の保存状態' })).toBe(help);
    expect(help).toHaveTextContent('設定ファイルに書き込めませんでした。');
    expect(screen.getByRole('status', { name: '判定結果' })).toHaveTextContent('本文に「未保存語」が含まれています。');
    expect(screen.getByText('入力中の設定を使用')).toBeVisible();
  });
  it('一致語をHTMLとして解釈せず、空白だけのテストへ戻すと結果を解除する', () => {
    setup({ ngWords: ['<img src=x onerror=alert(1)>'], asciiArtEnabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'NGワード入り' }));
    const result = screen.getByRole('status', { name: '判定結果' });
    expect(result.querySelector('img')).toBeNull();
    expect(within(result).getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('投稿者名'), { target: { value: ' ' } });
    fireEvent.change(screen.getByLabelText('コメント本文'), { target: { value: '\n ' } });
    expect(result).toHaveTextContent('コメントを入力してください');
  });
});
