// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import type { AppSnapshot } from '../src/shared/types';

const mocks = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null, connected: true }));

vi.mock('../src/renderer/api', () => ({
  useApplicationState: () => ({ snapshot: mocks.snapshot, connected: mocks.connected }),
}));

import { CommentListPage } from '../src/renderer/pages/CommentListPage';

describe('独立コメント一覧ウィンドウ', () => {
  beforeEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/comments?window=independent');
    mocks.snapshot = snapshot();
    mocks.connected = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it.each(['/comments', '/comments?window=independent'])('%sでアプリ接続と空の一覧の状態を区別し、切断後も履歴を保持する', path => {
    window.history.replaceState({}, '', path);
    mocks.snapshot!.comments = [];
    const view = render(<CommentListPage />);
    expect(screen.getByText('アプリ接続済み')).toBeVisible();
    expect(screen.queryByText('LIVE')).toBeNull();
    expect(screen.getByText('新着コメントを待っています。')).toBeVisible();
    mocks.snapshot!.sourceStatuses.youtube.state = 'waiting'; view.rerender(<CommentListPage />);
    expect(screen.getByText('配信開始を待っています。')).toBeVisible();
    mocks.snapshot!.sourceStatuses.youtube.state = 'error'; view.rerender(<CommentListPage />);
    expect(screen.getByText('管理画面でコメントサービスの接続状態を確認してください。')).toBeVisible();
    mocks.snapshot!.sourceStatuses.youtube.state = 'stopped'; view.rerender(<CommentListPage />);
    expect(screen.getByText('管理画面でコメントサービスに接続してください。')).toBeVisible();
    mocks.connected = false; view.rerender(<CommentListPage />);
    expect(screen.getByText('アプリに再接続中')).toBeVisible();
    expect(screen.getByText('きゃすメイトへの再接続を待っています。')).toBeVisible();
    expect(screen.queryByText('管理画面でコメントサービスに接続してください。')).toBeNull();
    expect(screen.queryByText('コメント取得は停止中です')).toBeNull();
    mocks.snapshot!.comments = snapshot().comments; view.rerender(<CommentListPage />);
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeVisible();
  });

  it('ヘッダーで自動スクロールを切り替え、オンへ戻すと新着側へ移動する', async () => {
    const user = userEvent.setup();
    const { container } = render(<CommentListPage />);
    const stream = container.querySelector<HTMLElement>('.comment-stream');
    expect(stream).not.toBeNull();
    Object.defineProperty(stream!, 'scrollHeight', { configurable: true, value: 900 });

    const button = screen.getByRole('button', { name: '自動スクロール: オン' });
    await user.click(button);
    expect(screen.getByRole('button', { name: '自動スクロール: オフ' })).toHaveAttribute('aria-pressed', 'false');

    stream!.scrollTop = 120;
    await user.click(screen.getByRole('button', { name: '自動スクロール: オフ' }));
    expect(stream!.scrollTop).toBe(900);
  });

  it('最前面表示を切り替えると独立ウィンドウ操作だけを要求する', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<CommentListPage />);

    await user.click(screen.getByRole('button', { name: '最前面表示: オフ' }));

    expect(screen.getByRole('button', { name: '最前面表示: オン' })).toHaveAttribute('aria-pressed', 'true');
    expect(open).toHaveBeenCalledWith(
      'casmate-comment-list://always-on-top/on',
      '_blank',
      'noopener',
    );
  });

  it.each([true, false])('履歴件数を保ったまま新着が入っても追従状態%sを維持する', (following) => {
    const { container, rerender } = render(<CommentListPage />);
    const stream = container.querySelector<HTMLElement>('.comment-stream')!;
    Object.defineProperties(stream, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 300 },
    });
    stream.scrollTop = following ? 600 : 120;
    fireEvent.scroll(stream);
    // At the history bound, removal and receipt keep the array length unchanged.
    mocks.snapshot!.comments = [{ ...mocks.snapshot!.comments[0]!, id: 'youtube:2',
      sequence: 2, content: [{ type: 'text', text: '新着コメント' }] }];
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, value: 1200 });
    rerender(<CommentListPage />);
    expect(screen.getByText('新着コメント')).toBeInTheDocument();
    expect(stream.scrollTop).toBe(following ? 1200 : 120);
  });

  it('スクロールで新着側を離れると自動スクロール表示をオフにする', () => {
    const { container } = render(<CommentListPage />);
    const stream = container.querySelector<HTMLElement>('.comment-stream')!;
    Object.defineProperties(stream, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 300 },
    });
    stream.scrollTop = 100;

    fireEvent.scroll(stream);

    expect(screen.getByRole('button', { name: '自動スクロール: オフ' })).toBeInTheDocument();
  });

  it('画面固有の文字・色・新着を上へ設定でコメントを描画する', () => {
    mocks.snapshot!.settings.commentList = {
      ...mocks.snapshot!.settings.commentList,
      stackDirection: 'newestTop',
      fontFamily: 'Meiryo UI',
      fontSizePx: 24,
      textColor: '#112233ff',
      backgroundColor: '#445566aa',
    };
    mocks.snapshot!.comments.push({
      id: 'youtube:2', externalId: '2', source: 'youtube', authorName: '新しい投稿者',
      content: [{ type: 'text', text: '新しいコメント' }], initialHistory: false,
      sequence: 2, receivedAt: new Date(1).toISOString(),
    });
    const { container } = render(<CommentListPage />);

    const comments = container.querySelectorAll<HTMLElement>('.comment');
    expect(comments[0]).toHaveTextContent('新しいコメント');
    expect(comments[0]).toHaveStyle({
      fontFamily: 'Meiryo UI',
      fontSize: '24px',
      color: '#112233ff',
      backgroundColor: '#445566aa',
    });
  });

  it('通常ブラウザにもURLリンクと自動スクロールを表示し最前面操作だけを除外する', () => {
    window.history.replaceState({}, '', '/comments');

    render(<CommentListPage />);

    expect(screen.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: '自動スクロール: オン' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /最前面表示/ })).not.toBeInTheDocument();
  });

  it('通常ブラウザでも全コメント取得停止を案内する', () => {
    window.history.replaceState({}, '', '/comments');
    for (const status of Object.values(mocks.snapshot!.sourceStatuses)) status.state = 'stopped';

    render(<CommentListPage />);

    expect(screen.getByText('コメント取得は停止中です')).toBeInTheDocument();
  });
});

function snapshot(): AppSnapshot {
  const settings = createDefaultSettings();
  return {
    settings,
    settingsRevision: 1,
    comments: [{
      id: 'youtube:1', externalId: '1', source: 'youtube', authorName: '視聴者',
      content: [{ type: 'text', text: 'https://example.com' }], initialHistory: false,
      sequence: 1, receivedAt: new Date(0).toISOString(),
    }],
    sourceStatuses: {
      youtube: { source: 'youtube', state: 'connected', message: null, updatedAt: '' },
      twitch: { source: 'twitch', state: 'stopped', message: null, updatedAt: '' },
      shitaraba: { source: 'shitaraba', state: 'stopped', message: null, updatedAt: '' },
    },
    commentOverlay: { active: [], queue: [] },
    character: { mouthShape: 'closed', assetWarning: null },
    commentSpeech: { engineStatus: 'disabled', currentCommentId: null, queueLength: 0, droppedCount: 0, warning: null },
    mobileSpeech: { urls: [], tailscaleStatus: 'disabled', activeClient: false, currentCommentId: null, queueLength: 0, droppedCount: 0, audioAvailable: false, warning: null },
  };
}
