// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObsUrlsPanel } from '../src/renderer/components/ObsUrlsPanel';
import { ManagementShell } from '../src/renderer/components/ManagementShell';

const paths = [
  ['コメント', '/overlay/comments'], ['音声認識', '/overlay/speech-recognition'],
  ['キャラクター', '/overlay/character'], ['文字演出', '/overlay/text-effects'],
  ['管理画面', ''], ['コメント一覧', '/comments'],
];
function setup() {
  const props = { baseUrl: 'http://127.0.0.1:3000', onSuccess: vi.fn(), onError: vi.fn(), onOperationStart: vi.fn() };
  return { ...render(<ObsUrlsPanel {...props}/>), props };
}
describe('OBSにソースを追加・用途別カード', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
  it('4つのOBS表示と補助領域に分け、6つの現在URLをコピーする', async () => {
    const { props } = setup();
    const cards = within(screen.getByRole('region', { name: 'OBSに追加する表示一覧' })).getAllByRole('article');
    expect(cards).toHaveLength(4);
    expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(paths.slice(0, 4).map(([title]) => title));
    expect(screen.queryByText('アプリ設定')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('ブラウザで使う画面'));
    for (const [title, path] of paths) {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: `${title}のURLをコピー` })); });
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(`http://127.0.0.1:3000${path}`);
      expect(props.onSuccess).toHaveBeenLastCalledWith(`${title}のURLをコピーしました。`);
    }

  });
  it('コピー中の二重要求を防ぎ、失敗は手動コピーを案内して再試行できる', async () => {
    const { props } = setup();
    let reject!: (error: Error) => void;
    vi.mocked(navigator.clipboard.writeText).mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const button = screen.getByRole('button', { name: 'コメントのURLをコピー' });
    fireEvent.click(button); fireEvent.click(button);
    expect(button).toBeDisabled(); expect(button).toHaveTextContent('コピー');
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    await act(async () => { reject(new Error('denied')); });
    expect(button).toBeEnabled(); expect(props.onError).toHaveBeenCalledWith(expect.stringContaining('URLを選択してコピー'));
    expect(props.onSuccess).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(button); });
    expect(props.onSuccess).toHaveBeenCalledTimes(1);
  });
  it('ブラウザ用の2画面を安全な別ウィンドウで開く', () => {
    setup(); const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(screen.getByText('ブラウザで使う画面'));
    fireEvent.click(screen.getByRole('button', { name: '管理画面をブラウザで開く' }));
    expect(open).toHaveBeenLastCalledWith('http://127.0.0.1:3000', '_blank', 'noopener');
    fireEvent.click(screen.getByRole('button', { name: 'コメント一覧をブラウザで開く' }));
    expect(open).toHaveBeenLastCalledWith('http://127.0.0.1:3000/comments', '_blank', 'noopener');
  });
  it('4枚のカードに操作を残し、URL文字列は手動追加の詳細で確認できる', () => {
    setup();
    for (const [title, path] of paths.slice(0, 4)) {
      const card = screen.getByRole('article', { name: title });
      expect(card).toBeVisible();
      expect(within(card).getByRole('heading', { name: title })).toBeVisible();
      expect(within(card).queryByText(`http://127.0.0.1:3000${path}`)).not.toBeInTheDocument();
      expect(screen.getByText(`http://127.0.0.1:3000${path}`)).not.toBeVisible();
      expect(within(card).getByRole('button', { name: `${title}をOBSに追加` })).toBeVisible();
      expect(within(card).getByRole('button', { name: `${title}のURLをコピー` })).toHaveTextContent('URLをコピー');
    }
    fireEvent.click(screen.getByText('手動でOBSに追加する'));
    for (const [, path] of paths.slice(0, 4)) expect(screen.getByText(`http://127.0.0.1:3000${path}`)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'OBSに追加する表示を選択' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('実際の表示はOBSで確認してください。')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /表示例/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/起動しておいて|起動したまま/)).not.toBeInTheDocument();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
  it('画面を往復しても4枚のカードと補助領域の開閉を保持する', () => {
    render(<ManagementShell home={null} connected pcStatus={null} windows={null} warnings={[]} activities={[]}>
      <ObsUrlsPanel baseUrl="http://127.0.0.1:3000" onSuccess={vi.fn()} onError={vi.fn()} onOperationStart={vi.fn()}/>
    </ManagementShell>);
    fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
    fireEvent.click(document.getElementById('settings-urls')!);
    const browser = screen.getByText('ブラウザで使う画面').closest('details')!;
    const manual = screen.getByText('手動でOBSに追加する').closest('details')!;
    expect(browser.open).toBe(false); expect(manual.open).toBe(false);
    fireEvent.click(screen.getByText('ブラウザで使う画面'));
    fireEvent.click(screen.getByText('手動でOBSに追加する'));
    fireEvent.click(screen.getByRole('button', { name: '← 設定に戻る' }));
    fireEvent.click(document.getElementById('settings-urls')!);
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(browser.open).toBe(true); expect(manual.open).toBe(true);
  });
});
