// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AiReplyTest } from '../src/renderer/components/AiReplyTest';
import { defaultAiSettings } from '../src/shared/ai-listener';
afterEach(cleanup);
function render(element: Parameters<typeof renderView>[0]) {
  const view = renderView(element);
  fireEvent.click(screen.getByText('人格の返答テスト'));
  return view;
}
function props() {
  const settings = defaultAiSettings(); settings.personas = [{ id: 'p', name: 'テスト人格', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];
  return { settings, blocked: false, mutate: vi.fn(async (..._args: unknown[]) => ({ reply: 'こんにちは！' })), onError: vi.fn(), onSuccess: vi.fn() };
}
it('返答テストは初期状態で折りたたみ、既存の人格編集を押し広げない', () => {
  renderView(<AiReplyTest {...props()}/>);
  expect(screen.getByLabelText('人格の返答テスト')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('人格の返答テスト'));
  expect(screen.getByRole('button', { name: '返答をテスト' })).toBeVisible();
});
it('選んだ保存済み人格とテスト本文を送り、返答を表示する', async () => {
  const p = props(); render(<AiReplyTest {...p}/>);
  expect(screen.getByRole('button', { name: '返答をテスト' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(screen.getByLabelText('テストする人格'), { target: { value: 'p' } });
  fireEvent.click(screen.getByRole('button', { name: '返答をテスト' }));
  await waitFor(() => expect(screen.getByLabelText('投稿しないテストの返答')).toHaveTextContent('こんにちは！'));
  expect(p.mutate).toHaveBeenCalledExactlyOnceWith('/api/ai-listener/test-reply', 'POST', { personaId: 'p', text: expect.any(String) });
  expect(p.onSuccess).toHaveBeenCalledOnce();
});
it('設定変更後の古い返答を表示せず、未保存時と連打を拒否する', async () => {
  const p = props(); let finish!: (value: { reply: string }) => void;
  p.mutate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<AiReplyTest {...p}/>);
  fireEvent.change(screen.getByLabelText('テストする人格'), { target: { value: 'p' } });
  const button = screen.getByRole('button', { name: '返答をテスト' }); fireEvent.click(button); fireEvent.click(button);
  expect(p.mutate).toHaveBeenCalledOnce();
  view.rerender(<AiReplyTest {...p} blocked/>);
  await act(async () => finish({ reply: '古い返答' }));
  expect(screen.getByLabelText('投稿しないテストの返答')).not.toHaveTextContent('古い返答');
  fireEvent.click(button); expect(p.mutate).toHaveBeenCalledOnce(); expect(p.onSuccess).not.toHaveBeenCalled();
});
it('失敗後に同じ設定で再試行し、前の警告を解除できる', async () => {
  const p = props(); p.mutate.mockRejectedValueOnce(new Error('接続失敗'));
  render(<AiReplyTest {...p}/>); fireEvent.change(screen.getByLabelText('テストする人格'), { target: { value: 'p' } });
  const button = screen.getByRole('button', { name: '返答をテスト' }); fireEvent.click(button);
  await waitFor(() => expect(p.onError).toHaveBeenLastCalledWith('接続失敗'));
  fireEvent.click(button); await waitFor(() => expect(screen.getByLabelText('投稿しないテストの返答')).toHaveTextContent('こんにちは！'));
  expect(p.onError).toHaveBeenLastCalledWith('');
});
it.each(['resolve', 'reject'] as const)('未保存状態を経て元の設定へ戻っても古い%sを表示しない', async outcome => {
  const p = props(); let finish!: (value: { reply: string }) => void; let fail!: (error: Error) => void;
  p.mutate.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const view = render(<AiReplyTest {...p}/>);
  fireEvent.change(screen.getByLabelText('テストする人格'), { target: { value: 'p' } });
  fireEvent.click(screen.getByRole('button', { name: '返答をテスト' }));
  view.rerender(<AiReplyTest {...p} blocked/>);
  view.rerender(<AiReplyTest {...p}/>);
  await act(async () => { if (outcome === 'resolve') finish({ reply: '古い返答' }); else fail(new Error('古いエラー')); });
  expect(screen.queryByText('古い返答')).not.toBeInTheDocument();
  expect(screen.queryByText('古いエラー')).not.toBeInTheDocument();
  expect(p.onSuccess).not.toHaveBeenCalled(); expect(p.onError).toHaveBeenCalledExactlyOnceWith('');
  fireEvent.click(screen.getByRole('button', { name: '返答をテスト' }));
  await waitFor(() => expect(screen.getByLabelText('投稿しないテストの返答')).toHaveTextContent('こんにちは！'));
});
