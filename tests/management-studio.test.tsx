// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useContext, useState } from 'react';
import { ManagementShell } from '../src/renderer/components/ManagementShell';
import { ManagementNavigation } from '../src/renderer/management-navigation';
import { ManagementCommentFeed, ManagementLive, ObsWorkspaceStatus, SmartphoneWorkspaceStatus } from '../src/renderer/components/ManagementWorkspace';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { SettingsCard } from '../src/renderer/components/SettingsCard';
import type { ManagementHomeProps } from '../src/renderer/components/ManagementHome';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

it('スマホが未接続でもURL準備済みは接続準備として示し、実接続と混同しない', () => {
  const snapshot = obsRegistrationSnapshot();
  snapshot.smartphone!.settings.activeNetwork = 'lan';
  snapshot.smartphone!.devices = [];
  snapshot.mobileSpeech.clientCount = 0;
  render(<SmartphoneWorkspaceStatus snapshot={snapshot} />);
  expect(screen.getByText('接続準備', { exact: true })).toBeVisible();
  expect(screen.getByText('準備済み', { exact: true })).toBeVisible();
  expect(screen.queryByText('コメント接続', { exact: true })).not.toBeInTheDocument();
});
afterEach(cleanup);

it('ホーム・設定一覧は見出しだけを示し、ページ移動時のフォーカスを保つ', () => {
  render(<ManagementShell home={null} connected pcStatus={null} windows={null} warnings={[]} activities={[]}>{null}</ManagementShell>);
  const nav=within(screen.getByRole('navigation'));
  expect(nav.getAllByRole('button').map(button => button.getAttribute('data-page')).filter(Boolean)).toEqual(['home', 'live', 'settings']);
  expect(nav.queryByRole('button', { name: '配信準備', exact: true })).toBeNull();
  for(const [tab,title] of [['ホーム','配信のホーム'],['設定','設定']]) {
    fireEvent.click(nav.getByRole('button',{name:tab,exact:true}));
    const heading=screen.getByRole('heading',{level:1,name:title,exact:true});
    expect(heading).toHaveFocus(); expect(heading.parentElement!.querySelector('p')).toBeNull();
  }
});

function Entry({ prefix }: { prefix: string }) {
  const navigation = useContext(ManagementNavigation);
  return <button id={`${prefix}-entry`} onClick={event => navigation?.open('commentFilter', event.currentTarget)}>フィルターを開く</button>;
}
function Editor() {
  const [value, setValue] = useState('');
  return <SettingsCard cardId="commentFilter" title="フィルター" eyebrow=""><label>編集値<input value={value} onChange={event => setValue(event.target.value)} /></label></SettingsCard>;
}

it.each([['home', 'ホーム'], ['live', '配信中']] as const)('%sから編集して戻るとページ・入力・スクロール・フォーカスを復元する', (page, label) => {
  render(<ManagementShell home={<Entry prefix="home" />} live={<Entry prefix="live" />} connected pcStatus={null} windows={null} warnings={[]} activities={[]}><Editor /></ManagementShell>);
  const nav = within(screen.getByRole('navigation'));
  const buttons = nav.getAllByRole('button');
  expect(buttons).toHaveLength(4);
  ['ホーム', '配信中', '設定', '要確認 0件'].forEach((name, index) => {
    expect(buttons[index]).toHaveAccessibleName(name);
  });
  fireEvent.click(nav.getByRole('button', { name: label, exact: true }));
  const body = document.querySelector('.management-body')!;
  Object.defineProperties(body, { scrollHeight: { value: 1800 }, clientHeight: { value: 400 } }); body.scrollTop = 180;
  const entry = document.getElementById(`${page}-entry`)!;
  fireEvent.click(entry); fireEvent.change(screen.getByLabelText('編集値'), { target: { value: '入力途中' } });
  expect(nav.getByRole('button', { name: '設定', exact: true })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: `← ${label}に戻る` }));
  expect(body.scrollTop).toBe(180); expect(entry).toHaveFocus();
  expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(entry); expect(screen.getByLabelText('編集値')).toHaveValue('入力途中');
});

it('認識結果はプレビュー実行中だけを表示し、停止中は古い履歴を現在の結果にしない', () => {
  const snapshot = obsRegistrationSnapshot();
  snapshot.speechRecognition.previewHistory = [{ id: 'result', sessionId: 'session', sequence: 1, text: '声を確認しました', recognizedAt: new Date(0).toISOString(), audioDurationMilliseconds: 100, recognitionDurationMilliseconds: 100 }];
  const props: ManagementHomeProps = { snapshot, draft: snapshot.settings, toggleSource: async () => undefined, toggleSpeech: async () => undefined, toggleAi: async () => undefined, toggleRecognition: async () => undefined };
  const page = () => <ManagementNavigation.Provider value={{ editor: null, page: 'live', open: vi.fn(), reportError: vi.fn() }}><ManagementLive homeProps={props} windows={null} /></ManagementNavigation.Provider>;
  const view = render(page());
  expect(screen.queryByText('声を確認しました')).not.toBeInTheDocument();
  snapshot.speechRecognition.previewActive = true; view.rerender(page());
  expect(screen.getByText('声を確認しました')).toBeVisible();
});

it('OBSの不明状態とスマホの準備状態を実配信・実送信の成功と区別する', () => {
  const snapshot = obsRegistrationSnapshot(); snapshot.obsControl!.stream = 'unknown'; snapshot.smartphone!.settings.activeNetwork = 'lan';
  snapshot.smartphone!.networks.lan = { ...snapshot.smartphone!.networks.lan!, commentsUrl: 'http://192.168.1.5/comments', warning: null };
  render(<><ObsWorkspaceStatus snapshot={snapshot} /><SmartphoneWorkspaceStatus snapshot={snapshot} /></>);
  expect(screen.getByText('状態不明')).toBeVisible(); expect(screen.getByText('準備済み')).toBeVisible();
  expect(screen.getByText('PCの接続準備です。スマホの接続・送信は端末で開始します。')).toBeVisible();
});

it('コメントを安全に描画し、追従停止と読み返し位置をページ移動中に保持する', () => {
  const settings = obsRegistrationSnapshot().settings.commentList;
  const comments = [{ id: 'comment', source: 'youtube' as const, sequence: 1, externalId: 'source-1', authorName: '利用者', content: [{ type: 'text' as const, text: '<script>danger()</script> https://example.com' }], receivedAt: new Date(0).toISOString(), initialHistory: false }];
  const view = render(<ManagementCommentFeed comments={comments} settings={settings} active />);
  expect(screen.getByRole('button', { name: '自動スクロール ON', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(document.querySelector('.studio-footer-links')).toHaveTextContent('自動スクロール ON');
  const stream = screen.getByRole('generic', { name: 'コメントを読み返す' });
  Object.defineProperties(stream, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
  stream.scrollTop = 220; fireEvent.scroll(stream);
  expect(screen.getByRole('button', { name: '自動スクロール OFF', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(document.querySelector('.studio-footer-links')).toHaveTextContent('読み返し中・自動スクロール OFF');
  view.rerender(<ManagementCommentFeed comments={[...comments]} settings={settings} active={false} />);
  expect(stream.scrollTop).toBe(220); stream.scrollTop = 0;
  view.rerender(<ManagementCommentFeed comments={[...comments]} settings={settings} active />); expect(stream.scrollTop).toBe(220);
  expect(document.querySelector('script')).toBeNull(); expect(screen.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('rel', 'noopener noreferrer');
  fireEvent.click(screen.getByRole('button', { name: '自動スクロール OFF', exact: true })); expect(stream.scrollTop).toBe(1000);
  expect(screen.getByRole('button', { name: '自動スクロール ON', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(document.querySelector('.studio-footer-links')).toHaveTextContent('自動スクロール ON');
});

it.each(['newestBottom', 'newestTop'] as const)('%sで読み返し中の新着だけを数え、往復・再同期・履歴削除でも保持して追従再開で解消する', stackDirection => {
  const settings = { ...obsRegistrationSnapshot().settings.commentList, stackDirection };
  const comment = (sequence: number, initialHistory = false) => ({ id: `comment-${sequence}`, source: 'youtube' as const, sequence, externalId: String(sequence), authorName: '利用者', content: [{ type: 'text' as const, text: `コメント${sequence}` }], receivedAt: new Date(0).toISOString(), initialHistory });
  const history = [comment(1, true), comment(2)];
  const view = render(<ManagementCommentFeed comments={history} settings={settings} active />);
  const footer = () => document.querySelector('.studio-live-follow-state')!;
  expect(footer()).not.toHaveTextContent('新着');
  fireEvent.click(screen.getByRole('button', { name: '自動スクロール ON', exact: true }));
  view.rerender(<ManagementCommentFeed comments={[...history, comment(3, true), comment(4), comment(5)]} settings={settings} active />);
  expect(footer()).toHaveTextContent('新着2件');
  view.rerender(<ManagementCommentFeed comments={[comment(5)]} settings={settings} active={false} />);
  expect(footer()).toHaveTextContent('新着2件');
  view.rerender(<ManagementCommentFeed comments={[comment(4), comment(5), comment(6)]} settings={settings} active={false} />);
  view.rerender(<ManagementCommentFeed comments={[comment(4), comment(5), comment(6)]} settings={settings} active />);
  expect(footer()).toHaveTextContent('新着3件');
  fireEvent.click(screen.getByRole('button', { name: '自動スクロール OFF', exact: true }));
  expect(footer()).not.toHaveTextContent('新着');
  fireEvent.click(screen.getByRole('button', { name: '自動スクロール ON', exact: true }));
  view.rerender(<ManagementCommentFeed comments={[comment(6), comment(7)]} settings={settings} active />);
  expect(footer()).toHaveTextContent('新着1件');
  const stream = screen.getByRole('generic', { name: 'コメントを読み返す' });
  Object.defineProperties(stream, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
  stream.scrollTop = stackDirection === 'newestBottom' ? 800 : 1; fireEvent.scroll(stream);
  expect(footer()).not.toHaveTextContent('新着');
  expect(screen.getByRole('button', { name: '自動スクロール ON', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

it('新着件数は履歴リセットで解消する', () => {
  const settings = obsRegistrationSnapshot().settings.commentList;
  const history = Array.from({ length: 3 }, (_, sequence) => ({ id: String(sequence), source: 'youtube' as const, sequence, externalId: String(sequence), authorName: '', content: [], receivedAt: '', initialHistory: false }));
  const view = render(<ManagementCommentFeed comments={[]} settings={settings} active />);
  fireEvent.click(screen.getByRole('button', { name: '自動スクロール ON', exact: true }));
  view.rerender(<ManagementCommentFeed comments={history} settings={settings} active />);
  expect(document.querySelector('.studio-live-follow-state')).toHaveTextContent('新着3件');
  const replacement = Array.from({ length: 5 }, (_, sequence) => ({ ...history[0], id: `replacement-${sequence}`, sequence, receivedAt: new Date(1).toISOString() }));
  view.rerender(<ManagementCommentFeed comments={replacement} settings={settings} active />);
  expect(document.querySelector('.studio-live-follow-state')).not.toHaveTextContent('新着');
  const withNew = [...replacement, { ...replacement[0], id: 'replacement-5', sequence: 5 }];
  view.rerender(<ManagementCommentFeed comments={withNew} settings={settings} active />);
  expect(document.querySelector('.studio-live-follow-state')).toHaveTextContent('新着1件');
  view.rerender(<ManagementCommentFeed comments={withNew.map(comment => ({ ...comment, receivedAt: new Date(2).toISOString() }))} settings={settings} active />);
  expect(document.querySelector('.studio-live-follow-state')).not.toHaveTextContent('新着');
  view.rerender(<ManagementCommentFeed comments={[]} settings={settings} active />);
  expect(document.querySelector('.studio-live-follow-state')).not.toHaveTextContent('新着');
});

it('接続概要は実接続数を示し、意図した停止と接続障害を区別する', () => {
  const snapshot = obsRegistrationSnapshot();
  snapshot.sourceStatuses.youtube.state = 'connected';
  const props: ManagementHomeProps = { snapshot, draft: snapshot.settings, toggleSource: vi.fn(), toggleSpeech: vi.fn(), toggleAi: vi.fn(), toggleRecognition: vi.fn() };
  const page = () => <ManagementNavigation.Provider value={{ editor: null, page: 'live', open: vi.fn(), reportError: vi.fn() }}><ManagementLive homeProps={props} windows={null} /></ManagementNavigation.Provider>;
  const view = render(page());
  const summary = () => document.getElementById('live-connections-summary')!;
  expect(summary()).toHaveTextContent('1件接続中'); expect(summary()).not.toHaveTextContent('要確認');
  for (const state of ['error', 'reconnecting'] as const) {
    snapshot.sourceStatuses.twitch.state = state; view.rerender(page());
    expect(summary()).toHaveTextContent('1件接続中・要確認'); expect(summary()).toHaveClass('live-summary-attention');
  }
  snapshot.sourceStatuses.youtube.state = 'stopped'; snapshot.sourceStatuses.twitch.state = 'stopped';
  view.rerender(page());
  expect(summary()).toHaveTextContent('0件接続中'); expect(summary()).not.toHaveClass('live-summary-attention');
});
