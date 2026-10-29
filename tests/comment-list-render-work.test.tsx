// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import { CommentListView } from '../src/renderer/components/CommentListView';
import type { CommonComment } from '../src/shared/types';

it('履歴1000件の状態表示更新で本文を再処理せず、新着と表示設定の変更は反映する', () => {
  let reads = 0;
  const comments: CommonComment[] = Array.from({ length: 1000 }, (_, index) => ({
    id: `twitch:${index}`, externalId: String(index), source: 'twitch', authorName: `投稿者${index}`,
    sequence: index + 1, receivedAt: new Date(0).toISOString(), initialHistory: false,
    get content() { reads++; return [{ type: 'text' as const, text: `本文${index} https://example.test/${index}` }]; },
  }));
  const settings = createDefaultSettings().commentList;
  const props = { comments, settings, connected: true, sourcesRunning: true };
  const view = render(<CommentListView {...props} />);
  expect(reads).toBe(1000);
  reads = 0;
  view.rerender(<CommentListView {...props} connected={false} />);
  expect(screen.getByText('アプリに再接続中')).toBeVisible();
  expect(reads).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: /自動スクロール/ }));
  expect(reads).toBe(0);
  const next = { ...comments[0], id: 'twitch:new', content: [{ type: 'text' as const, text: '新着本文' }] };
  reads = 0;
  view.rerender(<CommentListView {...props} comments={[...comments, next]} />);
  expect(screen.getByText('新着本文')).toBeVisible();
  expect(reads).toBe(0);
  view.rerender(<CommentListView {...props} comments={[...comments, next]} settings={{ ...settings, showAuthor: false, fontSizePx: 24 }} />);
  expect(screen.queryByText('投稿者1')).not.toBeInTheDocument();
  expect(screen.getByText('新着本文').closest('article')).toHaveStyle({ fontSize: '24px' });
  expect(reads).toBe(1000);
});
