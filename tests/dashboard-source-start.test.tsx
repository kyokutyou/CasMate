// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import { smartphoneView } from './fixtures/smartphone-view';
import type { AppSnapshot } from '../src/shared/types';

const mocks = vi.hoisted(() => ({
  snapshot: null as AppSnapshot | null,
  updateSettings: vi.fn(async () => undefined),
  sourceAction: vi.fn(async () => undefined),
  mutate: vi.fn(async (): Promise<{selected?:boolean}|undefined> => undefined),
  uploadAsset: vi.fn(async () => undefined),
  listSpeechVoices: vi.fn(async () => [{ speakerUuid: 'speaker', name: 'テスト話者', styles: [{ id: 1, name: 'ノーマル' }] }]),
  connected: true,
  error: null as string | null,
}));

vi.mock('../src/renderer/api', () => ({
  useApplicationState: () => ({
    snapshot: mocks.snapshot,
    connected: mocks.connected,
    error: mocks.error,
    updateSettings: mocks.updateSettings,
    sourceAction: mocks.sourceAction,
    mutate: mocks.mutate,
    uploadAsset: mocks.uploadAsset,
    listSpeechVoices: mocks.listSpeechVoices,
  }),
}));

vi.mock('../src/renderer/windows-fonts', () => ({ loadWindowsFonts: async () => ['Yu Gothic UI', 'Meiryo'] }));

import { Dashboard } from '../src/renderer/pages/Dashboard';

describe('管理画面のコメントソース操作', () => {
  it('初回読込失敗では日本語の対処と技術詳細を分け、復旧後は通常画面を表示する', async () => {
    const snapshot = mocks.snapshot;
    mocks.snapshot = null; mocks.error = 'Failed to fetch';
    const view = render(<Dashboard />);
    expect(screen.getByRole('heading', { name: '起動状態を読み込めませんでした' })).toBeVisible();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeVisible();
    expect(screen.getByText('Failed to fetch')).not.toBeVisible();
    fireEvent.click(screen.getByText('技術詳細'));
    expect(screen.getByText('Failed to fetch')).toBeVisible();
    await act(async () => { mocks.snapshot = snapshot; mocks.error = null; view.rerender(<Dashboard />); });
    expect(screen.queryByRole('heading', { name: '起動状態を読み込めませんでした' })).toBeNull();
    expect(document.querySelector('.startup-state')).toBeNull();
  });
  it('OBS音声認識表示の保存失敗・不正入力を画面移動後も保持し、コメント外観を変えない', async () => {
    mocks.updateSettings.mockRejectedValueOnce(new Error('保存できません'));
    render(<Dashboard/>); openEditor('speechRecognitionOverlay');
    const before = structuredClone(mocks.snapshot!.settings.commentOverlay);
    fireEvent.change(screen.getByLabelText('表示時間（秒）'), { target: { value: '12' } });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
    expect(mocks.updateSettings).toHaveBeenCalledWith('speechRecognitionOverlay', expect.objectContaining({ displayDurationSeconds: 12 }));
    fireEvent.change(screen.getByLabelText('表示時間（秒）'), { target: { value: '61' } });
    openEditor('commentOverlay'); openEditor('speechRecognitionOverlay');
    expect(screen.getByLabelText('表示時間（秒）')).toHaveValue(61);
    expect(screen.getByRole('spinbutton', { name: '表示時間（秒）' })).toHaveValue(61);
    expect(screen.getByRole('spinbutton', { name: '表示時間（秒）' })).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.snapshot!.settings.commentOverlay).toEqual(before);
  });
  it('自動接続を接続リストの最下段へまとめ、末尾の補足案内を表示しない', () => {
    render(<Dashboard />); openEditor('sources');
    expect(screen.getByRole('switch', { name: 'アプリ起動時に自動接続' })).toBeVisible();
    const list = document.querySelector('.acquisition-list')!;
    const auto = screen.getByRole('switch', { name: 'アプリ起動時に自動接続' }).closest('.acquisition-auto');
    expect(list.querySelectorAll('.acquisition-source')).toHaveLength(3);
    expect(list.lastElementChild).toBe(auto);
    expect(screen.queryByText('ログイン不要・各コメントソースにつき接続先は1件。初回履歴はコメント一覧だけに表示します。')).not.toBeInTheDocument();
  });

  it.each([false, true])('次スレ設定の即時保存=%sも編集基準を共有し、未編集の同期URLを巻き戻さない', async immediate => {
    vi.useFakeTimers();
    mocks.snapshot!.settings.sources.shitaraba.nextThread.titleMode = 'manual';
    mocks.snapshot!.settings.sources.shitaraba.nextThread.manualTitle = '元のタイトル';
    mocks.snapshot!.settings.sources.shitaraba.threadUrl = 'https://bbs.jpnkn.com/test/read.cgi/board/100/';
    let fail!: () => void;
    mocks.updateSettings.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('一時的な保存失敗')); }));
    try {
      const view = render(<Dashboard />); openEditor('nextThread');
      mocks.snapshot = structuredClone(mocks.snapshot!);
      mocks.snapshot.settingsRevision++;
      mocks.snapshot.settings.sources.shitaraba.threadUrl = 'https://bbs.jpnkn.com/test/read.cgi/board/101/';
      view.rerender(<Dashboard />);
      if (immediate) fireEvent.click(screen.getByRole('switch', { name: '次スレッド自動作成' }));
      else fireEvent.change(screen.getByLabelText('手動タイトル'), { target: { value: '編集したタイトル' } });
      await act(async () => { vi.advanceTimersByTime(500); });
      openEditor('sources');
      fireEvent.click(screen.getByRole('switch', { name: 'Twitchのコメント取得' }));
      mocks.snapshot = structuredClone(mocks.snapshot!);
      mocks.snapshot.settingsRevision++;
      mocks.snapshot.settings.sources.shitaraba.threadUrl = 'https://bbs.jpnkn.com/test/read.cgi/board/102/';
      view.rerender(<Dashboard />);
      await act(async () => { fail(); });
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(mocks.updateSettings).toHaveBeenLastCalledWith('sources', expect.objectContaining({
        shitaraba: expect.objectContaining({ threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/board/102/',
          nextThread: expect.objectContaining(immediate ? { enabled: true } : { manualTitle: '編集したタイトル' }) }),
        twitch: expect.objectContaining({ enabled: true }),
      }));
      expect(mocks.mutate).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it.each([true, false])('先行保存の成功=%sと別枠の同期補正が重なっても、後続遅延保存で補正値を戻さない', async success => {
    vi.useFakeTimers();
    let finish!: () => void;
    mocks.updateSettings.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = () => success ? resolve() : reject(new Error('一時的な保存失敗'));
    }));
    try {
      const view = render(<Dashboard />); openEditor('sources');
      fireEvent.change(screen.getByLabelText('YouTube接続先'), { target: { value: '@local_edit' } });
      await act(async () => { vi.advanceTimersByTime(500); });
      fireEvent.click(screen.getByRole('switch', { name: 'Twitchのコメント取得' }));
      const synchronized = structuredClone(mocks.snapshot!);
      synchronized.settingsRevision++;
      synchronized.settings.sources.shitaraba.threadUrl = 'https://bbs.jpnkn.com/test/read.cgi/board/123/';
      if (success) synchronized.settings.sources.youtube.target = '@local_edit';
      mocks.snapshot = synchronized; view.rerender(<Dashboard />);
      await act(async () => { finish(); });
      expect(mocks.updateSettings).toHaveBeenNthCalledWith(2, 'sources', expect.objectContaining({
        shitaraba: expect.objectContaining({ threadUrl: synchronized.settings.sources.shitaraba.threadUrl }),
      }));
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(mocks.updateSettings).toHaveBeenCalledTimes(success ? 2 : 3);
      expect(mocks.updateSettings).toHaveBeenLastCalledWith('sources', expect.objectContaining({
        shitaraba: expect.objectContaining({ threadUrl: synchronized.settings.sources.shitaraba.threadUrl }),
        youtube: expect.objectContaining({ target: '@local_edit' }),
        twitch: expect.objectContaining({ enabled: true }),
      }));
    } finally { vi.useRealTimers(); }
  });

  it('別枠の保存が失敗しても個別操作へ混入させず、失敗した入力を保持して再試行する', async () => {
    vi.useFakeTimers();
    let fail!: () => void;
    mocks.updateSettings.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('一時的な保存失敗')); }));
    try {
      render(<Dashboard />); openEditor('sources');
      fireEvent.change(screen.getByLabelText('YouTube接続先'), { target: { value: '@kept_channel' } });
      await act(async () => { vi.advanceTimersByTime(500); });
      fireEvent.click(screen.getByRole('switch', { name: 'Twitchのコメント取得' }));
      await act(async () => { fail(); });
      expect(mocks.updateSettings).toHaveBeenNthCalledWith(2, 'sources', expect.objectContaining({
        youtube: expect.objectContaining({ target: '' }), twitch: expect.objectContaining({ enabled: true }),
      }));
      expect(mocks.sourceAction).toHaveBeenCalledWith('twitch', 'start');
      expect(screen.getByLabelText('YouTube接続先')).toHaveValue('@kept_channel');
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(mocks.updateSettings).toHaveBeenLastCalledWith('sources', expect.objectContaining({
        youtube: expect.objectContaining({ target: '@kept_channel' }), twitch: expect.objectContaining({ enabled: true }),
      }));
    } finally { vi.useRealTimers(); }
  });

  it('別ソースの自動保存中に接続を切り替えても保存中の入力を巻き戻さない', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    mocks.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    try {
      render(<Dashboard />); openEditor('sources');
      fireEvent.change(screen.getByLabelText('YouTube接続先'), { target: { value: '@new_channel' } });
      await act(async () => { vi.advanceTimersByTime(500); });
      fireEvent.click(screen.getByRole('switch', { name: 'Twitchのコメント取得' }));
      await act(async () => { complete(); });
      expect(mocks.updateSettings).toHaveBeenLastCalledWith('sources', expect.objectContaining({
        youtube: expect.objectContaining({ target: '@new_channel' }),
        twitch: expect.objectContaining({ enabled: true }),
      }));
      expect(screen.getByLabelText('YouTube接続先')).toHaveValue('@new_channel');
      expect(mocks.sourceAction).toHaveBeenCalledWith('twitch', 'start');
    } finally { vi.useRealTimers(); }
  });

  it('OBS設定の入力エラーは修正で解消し、画面往復では不正入力を保持する', async () => {
    render(<Dashboard />); openEditor('commentOverlay');
    const editor = within(document.querySelector('.comment-overlay-panel')!);
    const navigation = within(document.querySelector('.management-nav')!);
    const input = editor.getByLabelText('1件表示時間（秒）');
    expect(editor.queryByText('OBSへの追加方法・URL', { exact: true })).toBeNull();
    fireEvent.change(input, { target: { value: '61' } });
    expect(navigation.getByRole('button', { name: /要確認 1件/ })).toBeVisible();
    fireEvent.change(input, { target: { value: '48' } });
    expect(navigation.getByRole('button', { name: /要確認 0件/ })).toBeVisible();
    fireEvent.change(input, { target: { value: '61' } });
    fireEvent.click(within(document.querySelector('.editor-heading-row')!).getByRole('button', { name: '← 設定に戻る' })); openEditor('commentOverlay');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(61);
    expect(navigation.getByRole('button', { name: /要確認 1件/ })).toBeVisible();
  });
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
    mocks.snapshot = snapshot();
    mocks.connected = true;
    mocks.error = null;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  });

  it('旧カード開閉記憶を無視しホームを開き、15の共通編集先へ案内する', () => {
    localStorage.setItem('casmate.management.cards.sources', 'false');
    render(<Dashboard />);
    expect(screen.getByRole('heading', { name: '配信のホーム', level: 1 })).toBeVisible();
    expect(screen.getAllByRole('switch')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
    const entries = document.querySelectorAll('.management-categories .management-entry');
    expect(entries).toHaveLength(15);
    expect(screen.getByRole('button', { name: /^OBSにソースを追加/ })).toBeVisible();
    for (const entry of entries) {
      fireEvent.click(entry);
      expect(document.getElementById('editor-heading')).toHaveFocus();
      const back = within(document.querySelector('.editor-heading-row')!).getByRole('button', { name: '← 設定に戻る' });
      expect(back).toBeVisible();
      fireEvent.click(back);
      expect(entry).toHaveFocus();
    }
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.updateSettings).not.toHaveBeenCalled();
  }, 15_000);

  it.each(['youtube', 'twitch', 'shitaraba'])('ホームの%sから接続先へフォーカスしスクロールと入口へ復帰する', source => {
    render(<Dashboard />);
    const body = document.querySelector('.management-body')!;
    Object.defineProperties(body, { scrollHeight: { value: 1600 }, clientHeight: { value: 400 } });
    body.scrollTop = 220;
    const entry = document.getElementById(`home-source-${source}`)!;
    fireEvent.click(entry);
    expect(document.getElementById(`source-${source}`)).toHaveFocus();
    expect(mocks.sourceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
    expect(entry).toHaveFocus(); expect(body.scrollTop).toBe(220);
    fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    expect(body.scrollTop).toBe(0); expect(document.getElementById('page-heading')).toHaveFocus();
  });

  it('jpnknもホームと取得画面の3番目の掲示板枠を使い、同じURL欄へ案内する', () => {
    mocks.snapshot!.settings.sources.shitaraba.threadUrl = 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791458242/';
    mocks.snapshot!.settings.sources.shitaraba.enabled = true;
    Object.assign(mocks.snapshot!.sourceStatuses.shitaraba, { service: 'jpnkn', state: 'connected' });
    render(<Dashboard />);
    expect(document.querySelectorAll('.home-source')).toHaveLength(3);
    const entry = document.getElementById('home-source-shitaraba')!;
    expect(entry).toHaveTextContent('jpnkn');
    expect(document.getElementById('home-source-jpnkn')).toBeNull();
    fireEvent.click(entry);
    const panel = screen.getByRole('region', { name: 'コメント取得' });
    expect(within(panel).getAllByRole('article')).toHaveLength(3);
    expect(within(panel).getByText('1件接続中')).toBeVisible();
    const url = within(panel).getByLabelText('掲示板スレッドURL（したらば／jpnkn）');
    expect(url).toHaveFocus();
    expect(url).toHaveValue(mocks.snapshot!.settings.sources.shitaraba.threadUrl);
    expect(url).toHaveAttribute('id', 'source-shitaraba');
    expect(within(panel).getByRole('switch', { name: 'jpnknのコメント取得' })).toBeChecked();
    expect(mocks.sourceAction).not.toHaveBeenCalled();
  });

  it('jpnknの警告を1件として数え、クリックでは接続せず共用URL欄へ戻る', () => {
    Object.assign(mocks.snapshot!.sourceStatuses.shitaraba, { service: 'jpnkn', state: 'error', message: '取得できません。' });
    render(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
    const entry = document.getElementById('warning-sources-source-shitaraba')!;
    expect(entry).toHaveTextContent('jpnkn：');
    expect(document.getElementById('warning-sources-source-jpnkn')).toBeNull();
    fireEvent.click(entry);
    expect(document.getElementById('source-shitaraba')).toHaveFocus();
    expect(mocks.sourceAction).not.toHaveBeenCalled();
  });

  it('jpnknの再接続と停止は実サービスを表示しつつshitaraba保存キーと操作APIを使う', async () => {
    mocks.snapshot!.settings.sources.shitaraba.enabled = true;
    mocks.snapshot!.settings.sources.shitaraba.threadUrl = 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791458242/';
    Object.assign(mocks.snapshot!.sourceStatuses.shitaraba, { service: 'jpnkn', state: 'connected' });
    render(<Dashboard />); openEditor('sources');
    const nextUrl = 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791459622/';
    fireEvent.change(screen.getByLabelText('掲示板スレッドURL（したらば／jpnkn）'), { target: { value: nextUrl } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'jpnknを再接続' })));
    expect(mocks.updateSettings).toHaveBeenCalledWith('sources', expect.objectContaining({ shitaraba: expect.objectContaining({ enabled: true, threadUrl: nextUrl }) }));
    expect(mocks.sourceAction).toHaveBeenLastCalledWith('shitaraba', 'reconnect');
    expect(within(screen.getByRole('region', { name: '通知' })).getByText('jpnknの再接続を要求しました。')).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'jpnknのコメント取得' })));
    expect(mocks.sourceAction).toHaveBeenLastCalledWith('shitaraba', 'stop');
    expect(mocks.updateSettings).toHaveBeenLastCalledWith('sources', expect.objectContaining({ shitaraba: expect.objectContaining({ enabled: false }) }));
    for (const [, value] of mocks.updateSettings.mock.calls) expect(value).not.toHaveProperty('jpnkn');
  });

  it('他の警告が解消しても同じ警告入口へ戻り、移動で接続を開始しない', () => {
    mocks.snapshot!.sourceStatuses.youtube.state = 'error';
    mocks.snapshot!.sourceStatuses.twitch.state = 'error';
    const view = render(<Dashboard />);
    const warningsEntry = screen.getByRole('button', { name: '要確認 2件' });
    fireEvent.click(warningsEntry);
    const entry = document.getElementById('warning-sources-source-twitch')!;
    fireEvent.click(entry); expect(document.getElementById('source-twitch')).toHaveFocus();
    mocks.snapshot!.sourceStatuses.youtube.state = 'stopped'; view.rerender(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
    expect(warningsEntry).toHaveFocus(); expect(mocks.sourceAction).not.toHaveBeenCalled();
    expect(warningsEntry).toHaveTextContent('要確認 1件');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.snapshot!.sourceStatuses.twitch.state).toBe('error');
  });

  it('追加途中の文字演出ルールは画面移動で保存・取消されない', () => {
    render(<Dashboard />); openEditor('textEffects');
    const panel = within(document.querySelector('.text-effects-panel')!);
    const navigation = within(document.querySelector('.management-nav')!);
    fireEvent.click(panel.getByRole('button', { name: 'ルールを追加' }));
    fireEvent.change(panel.getByLabelText('反応ワード'), { target: { value: '追加途中' } });
    fireEvent.click(navigation.getByRole('button', { name: 'ホーム', exact: true }));
    expect(panel.queryByRole('textbox', { name: '反応ワード' })).toBeNull();
    openEditor('textEffects');
    expect(within(document.querySelector('.text-effects-panel')!).getByLabelText('反応ワード')).toHaveValue('追加途中');
    expect(mocks.updateSettings).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('文字演出A案の共通見出しと共通設定の常時表示を保持し、テスト送信を共通通知へ渡す', async () => {
    vi.useFakeTimers();
    try {
      render(<Dashboard />); openEditor('textEffects');
      expect(screen.getByText('専用のOBS表示で、コメントに反応する文字や絵文字を出します。')).toBeVisible();
      const back = screen.getByRole('button', { name: '← 設定に戻る' });
      expect(back).toHaveTextContent('←'); expect(back).toHaveAttribute('data-icon-only', 'true');
      const panel = within(document.querySelector('.text-effects-panel')!);
      expect(panel.getByText('全ルール共通の見た目・上限').closest('details')).toBeNull();
      expect(panel.getByLabelText('基本文字サイズ（px）')).toBeVisible();
      fireEvent.click(back); openEditor('textEffects');
      expect(panel.getByLabelText('基本文字サイズ（px）')).toBeVisible();
      expect(mocks.mutate).not.toHaveBeenCalled();
      await act(async () => fireEvent.click(panel.getAllByRole('button', { name: 'OBSへテスト送信' })[0]));
      expect(mocks.mutate).toHaveBeenCalledWith('/api/text-effects/rules/default-grass/test');
      expect(document.querySelector('.management-header .toast-message')).toHaveTextContent('文字演出をOBSへ送信しました。');
      await act(async () => vi.advanceTimersByTime(4000));
      expect(document.querySelector('.toast-message')).toBeNull();
      mocks.mutate.mockRejectedValueOnce(new Error('テスト送信できませんでした。'));
      await act(async () => fireEvent.click(panel.getAllByRole('button', { name: 'OBSへテスト送信' })[0]));
      expect(screen.getByRole('button', { name: /要確認 1件/ })).toBeVisible();
      expect(panel.queryByText('テスト送信できませんでした。')).toBeNull();
      await act(async () => vi.advanceTimersByTime(5000));
      expect(screen.getByRole('button', { name: /要確認 1件/ })).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
      expect(document.getElementById('settings-textEffects')).toHaveTextContent('要確認');
      fireEvent.click(screen.getByRole('button', { name: /要確認 1件/ }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /テスト送信できませんでした/ }));
      expect(screen.getByRole('heading', { name: 'コメント文字演出', level: 1 })).toHaveFocus();
    } finally { vi.useRealTimers(); }
  });

  it('移動しても保存待ち・入力値・保存失敗を保持する', async () => {
    vi.useFakeTimers();
    try {
      mocks.updateSettings.mockRejectedValueOnce(new Error('外観を保存できません。'));
      render(<Dashboard />); openEditor('commentList');
      const card = screen.getByRole('region', { name: 'コメント一覧' });
      const font = within(card).getByLabelText('フォント');
      fireEvent.change(font, { target: { value: '入力途中' } });
      fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(mocks.updateSettings).toHaveBeenCalledWith('commentList', expect.objectContaining({ fontFamily: '入力途中' }));
      expect(font).not.toBeVisible();
      openEditor('commentList'); expect(font).toHaveValue('入力途中');
      fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
      expect(within(screen.getByRole('dialog')).getByText(/外観を保存できません。/)).toBeVisible();
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '閉じる' }));
      fireEvent.change(font, { target: { value: '修正後' } });
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(within(card).queryByText('外観を保存できません。')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('読み上げの保存待ちの値を保存してから試聴APIを呼ぶ', async () => {
    mocks.snapshot!.commentSpeech.engineStatus = 'ready';
    mocks.snapshot!.settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    let complete!: () => void;
    mocks.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    render(<Dashboard />); openEditor('commentSpeech');
    await screen.findByRole('option', { name: 'テスト話者' });
    fireEvent.change(screen.getByRole('slider', { name: '読む速さ' }), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'この声を試聴' }));
    expect(mocks.updateSettings).toHaveBeenCalledWith('commentSpeech', expect.objectContaining({ speedScale: 1.5, enabled: false }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    await act(async () => { complete(); });
    expect(mocks.mutate).toHaveBeenCalledWith('/api/speech/preview');
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('読み上げ設定の保存中と失敗後もOBS表示時間は保存済みの状態(%s)に従う', async savedEnabled => {
    mocks.snapshot!.settings.commentSpeech.enabled = savedEnabled;
    let rejectSave!: (reason: Error) => void;
    mocks.updateSettings.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    render(<Dashboard />); openEditor('commentSpeech');
    fireEvent.click(screen.getByRole('switch', { name: 'コメント読み上げ', exact: true }));
    expect(mocks.updateSettings).toHaveBeenCalledWith('commentSpeech', expect.objectContaining({ enabled: !savedEnabled }));
    openEditor('commentOverlay');
    const checkSavedTiming = () => {
      expect(screen.getByRole('region', { name: '読み上げ ON' })).toHaveAttribute('data-active', String(savedEnabled));
      expect(screen.getByRole('region', { name: '読み上げ OFF' })).toHaveAttribute('data-active', String(!savedEnabled));
      const duration = screen.getByLabelText('1件表示時間（秒）');
      expect(duration).toBeEnabled();
    };
    checkSavedTiming();
    await act(async () => { rejectSave(new Error('読み上げ設定を保存できません。')); });
    checkSavedTiming();
  });

  it('読み上げの無効な入力を画面移動で失わず、試聴や保存を実行しない', async () => {
    mocks.snapshot!.commentSpeech.engineStatus = 'ready';
    mocks.snapshot!.settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    render(<Dashboard />); openEditor('commentSpeech');
    await screen.findByRole('option', { name: 'テスト話者' });
    fireEvent.change(screen.getByRole('spinbutton', { name: '読む速さの数値' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    openEditor('commentSpeech');
    expect(screen.getByRole('spinbutton', { name: '読む速さの数値' })).toHaveValue(3);
    expect(screen.getByRole('button', { name: 'この声を試聴' })).toBeDisabled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('起動ファイル選択をキャンセルした応答では成功通知と話者一覧の再取得を行わない', async () => {
    mocks.snapshot!.commentSpeech.engineStatus='ready';
    mocks.mutate.mockResolvedValueOnce({selected:false});
    render(<Dashboard />);openEditor('commentSpeech');
    await screen.findByRole('option',{name:'テスト話者'});
    const calls=mocks.listSpeechVoices.mock.calls.length;
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'VOICEVOXの起動ファイルを指定'})));
    expect(screen.getByRole('region',{name:'通知'})).toBeEmptyDOMElement();
    expect(mocks.listSpeechVoices).toHaveBeenCalledTimes(calls);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it.each(['この声を試聴', 'VOICEVOXの起動ファイルを指定'])('%sの成功は本文に挿入せず共通通知へ送り4秒後に消す', async name => {
    if(name==='VOICEVOXの起動ファイルを指定')mocks.mutate.mockResolvedValueOnce({selected:true});
    mocks.snapshot!.commentSpeech.engineStatus = 'ready';
    mocks.snapshot!.settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
    render(<Dashboard />); openEditor('commentSpeech');
    await screen.findByRole('option', { name: 'テスト話者' });
    const card = screen.getByRole('region', { name: 'コメント読み上げ' });
    const notice = screen.getByRole('region', { name: '通知' });
    const message = name === 'この声を試聴' ? 'PCで試聴を再生しました。' : 'VOICEVOXの起動ファイルを指定しました。';
    vi.useFakeTimers();
    try {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
      expect(within(notice).getByText(message)).toBeVisible();
      expect(within(card).queryByText(message)).toBeNull();
      expect(notice.closest('.management-body')).toBeNull();
      await act(async () => { vi.advanceTimersByTime(3_999); });
      expect(within(notice).getByText(message)).toBeVisible();
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(notice).toBeEmptyDOMElement();
    } finally { vi.useRealTimers(); }
  });

  it('音声認識の保存失敗をページ移動後も保持し成功した適用で解消する', async () => {
    const user = userEvent.setup();
    mocks.updateSettings.mockRejectedValueOnce(new Error('認識設定を保存できません。'));
    render(<Dashboard />); openEditor('speechRecognition');
    const card = screen.getByRole('region', { name: '配信者音声認識' });
    await user.click(within(card).getByRole('button', { name: 'この設定を適用' }));
    fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    openEditor('sources'); await user.click(screen.getByRole('button', { name: 'すべて停止' }));
    openEditor('speechRecognition');
    expect(within(card).queryByText('認識設定を保存できません。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
    fireEvent.click(screen.getByRole('button', { name: /認識設定を保存できません。/ }));
    await user.click(within(card).getByRole('button', { name: 'この設定を適用' }));
    expect(within(card).queryByText('認識設定を保存できません。')).toBeNull();
    expect(await screen.findByRole('button', { name: '要確認 0件' })).toBeInTheDocument();
  });

  it('LAN接続先がない場合に設定から接続案内を確認できる', () => {
    mocks.snapshot!.smartphone!.settings.activeNetwork = 'lan'; mocks.snapshot!.mobileSpeech.urls = [];
    mocks.snapshot!.smartphone!.networks.lan = { address: null, commentsUrl: null, registrationReady: false, invitationRevision: 0, videoReady: false, obsReady: false, warning: null };
    render(<Dashboard />); openEditor('mobileSpeech');
    fireEvent.click(screen.getByText('家庭内LANで接続する手順'));
    expect(screen.getByText('接続先アドレスなし')).toBeVisible();
    expect(screen.getByText(/PCとスマホを信頼できる同じルーター/)).toBeVisible();
  });

  it.each(['youtube', 'twitch', 'shitaraba'] as const)('%sの接続メッセージ欄で入力案内と長文の状態を同じ領域に表示する', (source) => {
    const labels = { youtube: 'YouTube Live', twitch: 'Twitch', shitaraba: '掲示板' };
    const view = render(<Dashboard />); openEditor('sources');
    const area = screen.getByRole('status', { name: `${labels[source]}の接続メッセージ` });
    const guidance = area.textContent;
    expect(guidance).toBeTruthy();
    expect(area).toHaveClass('source-message');
    expect(area).toHaveAttribute('tabindex', '0');
    const message = '現在のライブ配信を確認できません。'.repeat(30);
    mocks.snapshot!.sourceStatuses[source].message = message;
    view.rerender(<Dashboard />);
    expect(screen.getByRole('status', { name: `${labels[source]}の接続メッセージ` })).toBe(area);
    expect(area).toHaveTextContent(message);
    expect(area).toHaveAttribute('tabindex', '0');
    mocks.snapshot!.sourceStatuses[source].message = null;
    view.rerender(<Dashboard />);
    expect(area).toHaveTextContent(guidance!);
    expect(area).toBeVisible();
  });

  it('継続する警告は件数に集約し、操作成功だけトーストに表示する', async () => {
    const user = userEvent.setup();
    mocks.connected = false;
    mocks.error = 'バックエンド操作でエラーが発生しました。';
    mocks.snapshot!.warning = '設定ファイルを既定値で読み込みました。';
    render(<Dashboard />); openEditor('sources');

    const toastRegion = await screen.findByRole('region', { name: '通知' });
    expect(toastRegion).toHaveClass('toast-region');
    expect(toastRegion.closest('header')).toHaveClass('management-header');
    expect(toastRegion).toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: '要確認 3件' }));
    const warnings = screen.getByRole('dialog');
    expect(within(warnings).getByText('ローカルバックエンドとの接続が切れています。再接続を待っています。')).toBeVisible();
    expect(within(warnings).getByText('設定ファイルを既定値で読み込みました。')).toBeVisible();
    expect(within(warnings).getByText('バックエンド操作でエラーが発生しました。')).toBeVisible();
    await user.click(within(warnings).getByRole('button', { name: '閉じる' }));

    await user.click(screen.getByRole('button', { name: 'すべて停止' }));
    expect(await within(toastRegion).findByText('すべて停止しました。')).toBeInTheDocument();
  });

  it('操作成功を4秒後に消去して接続エラーと設定警告は表示し続ける', async () => {
    mocks.connected = false;
    mocks.snapshot!.warning = '設定ファイルを既定値で読み込みました。';
    vi.useFakeTimers();
    try {
      render(<Dashboard />); openEditor('sources');
      fireEvent.click(screen.getByRole('button', { name: 'すべて停止' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('すべて停止しました。')).toBeInTheDocument();

      await act(async () => { vi.advanceTimersByTime(3_999); });
      expect(screen.getByText('すべて停止しました。')).toBeInTheDocument();

      await act(async () => { vi.advanceTimersByTime(1); });
      expect(screen.queryByText('すべて停止しました。')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '要確認 2件' }));
      expect(screen.getByText('ローカルバックエンドとの接続が切れています。再接続を待っています。')).toBeVisible();
      expect(screen.getByText('設定ファイルを既定値で読み込みました。')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('成功を続けて通知すると最後の通知から4秒を数え直す', async () => {
    vi.useFakeTimers();
    try {
      render(<Dashboard />); openEditor('sources');
      const stop = screen.getByRole('button', { name: 'すべて停止' });
      await act(async () => { fireEvent.click(stop); });
      await act(async () => { vi.advanceTimersByTime(3_000); });
      await act(async () => { fireEvent.click(stop); });
      await act(async () => { vi.advanceTimersByTime(1_001); });
      expect(screen.getByText('すべて停止しました。')).toBeVisible();
      await act(async () => { vi.advanceTimersByTime(2_999); });
      expect(screen.queryByText('すべて停止しました。')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('操作失敗は4秒経過後も表示し続ける', async () => {
    mocks.mutate.mockRejectedValueOnce(new Error('停止操作に失敗しました。'));
    vi.useFakeTimers();
    try {
      render(<Dashboard />); openEditor('sources');
      fireEvent.click(screen.getByRole('button', { name: 'すべて停止' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
      expect(within(screen.getByRole('dialog')).getByText('停止操作に失敗しました。')).toBeVisible();

      await act(async () => { vi.advanceTimersByTime(4_000); });
      expect(screen.getByText('停止操作に失敗しました。')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('トグルで入力中の接続設定を保存して対象ソースを開始・停止する', async () => {
    const user = userEvent.setup();
    const view = render(<Dashboard />); openEditor('sources');
    const card = (await screen.findByText('Twitch')).closest('article');
    expect(card).not.toBeNull();
    await user.type(
      within(card!).getByPlaceholderText('チャンネル名またはURL'),
      'https://www.twitch.tv/kyokutyou',
    );
    const toggle = within(card!).getByRole('switch');
    await user.click(toggle);

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      'sources',
      expect.objectContaining({
        twitch: expect.objectContaining({
          channel: 'https://www.twitch.tv/kyokutyou',
        }),
      }),
    );
    expect(mocks.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sourceAction.mock.invocationCallOrder[0],
    );
    expect(mocks.sourceAction).toHaveBeenCalledWith('twitch', 'start');

    mocks.snapshot!.sourceStatuses.twitch.state = 'connected';
    view.rerender(<Dashboard />);
    await user.click(screen.getByRole('switch', { name: 'Twitchのコメント取得' }));
    expect(mocks.sourceAction).toHaveBeenLastCalledWith('twitch', 'stop');
    expect(within(card!).queryByRole('button', { name: '開始' })).not.toBeInTheDocument();
    expect(within(card!).queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
  });

  it('一括停止後は有効設定を保持していてもトグルをオフ表示にする', async () => {
    mocks.snapshot!.settings.sources.twitch.enabled = true;
    mocks.snapshot!.sourceStatuses.twitch.state = 'stopped';
    render(<Dashboard />); openEditor('sources');

    expect(await screen.findByRole('switch', { name: 'Twitchのコメント取得' })).not.toBeChecked();
  });

  it('コメントフィルターを省スペースに編集してNGワードを遅延保存しアスキーアートを除外を即時保存する', async () => {
    vi.useFakeTimers();
    try {
      render(<Dashboard />); openEditor('commentFilter');
      const panel = screen.getByRole('heading', { name: 'コメントフィルター', level: 2 }).closest('section');
      expect(panel).not.toBeNull();
      const filter = within(panel!);

      expect(filter.getByLabelText('NGワード登録件数')).toHaveTextContent('0件');
      const editor = filter.getByLabelText('NGワード（1行に1件）');
      expect(editor).toHaveAttribute('rows', '6');
      expect(editor).toHaveClass('ng-word-editor');
      fireEvent.change(editor, { target: { value: '禁止語\nＢＡＤ' } });
      fireEvent.click(filter.getByRole('switch', { name: 'アスキーアートを除外' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mocks.updateSettings).toHaveBeenNthCalledWith(1, 'commentFilter', {
        ngWords: [],
        asciiArtEnabled: true,
      });

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mocks.updateSettings).toHaveBeenLastCalledWith('commentFilter', {
        ngWords: ['禁止語', 'ＢＡＤ'],
        asciiArtEnabled: true,
      });

      fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
      expect(filter.getByLabelText('NGワード（1行に1件）')).not.toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('判定テストと説明の開閉を画面往復で保持し、テストだけではAPIを呼ばない', () => {
    render(<Dashboard />); openEditor('commentFilter');
    fireEvent.change(screen.getByRole('textbox', { name: '投稿者名', exact: true }), { target: { value: 'テスト投稿者' } });
    fireEvent.change(screen.getByLabelText('コメント本文'), { target: { value: 'テスト本文' } });
    const details = screen.getByText('一致のルール').closest('details')!;
    details.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    openEditor('commentFilter');
    expect(screen.getByRole('textbox', { name: '投稿者名', exact: true })).toHaveValue('テスト投稿者');
    expect(screen.getByLabelText('コメント本文')).toHaveValue('テスト本文');
    expect(details.open).toBe(true);
    expect(mocks.updateSettings).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.sourceAction).not.toHaveBeenCalled();
  });

  it('スイッチの保存中に追加したNGワードを古い値で上書きしない', async () => {
    vi.useFakeTimers();
    try {
      let resolveSwitch!: () => void;
      mocks.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { resolveSwitch = resolve; }));
      render(<Dashboard />); openEditor('commentFilter');
      const editor = screen.getByLabelText('NGワード（1行に1件）');
      fireEvent.change(editor, { target: { value: '保存前' } });
      fireEvent.click(screen.getByRole('switch', { name: 'アスキーアートを除外' }));
      fireEvent.change(editor, { target: { value: '保存中の追加入力' } });
      await act(async () => { resolveSwitch(); await Promise.resolve(); });
      expect(editor).toHaveValue('保存中の追加入力');
      await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); });
      expect(mocks.updateSettings).toHaveBeenLastCalledWith('commentFilter', { ngWords: ['保存中の追加入力'], asciiArtEnabled: true });
    } finally { vi.useRealTimers(); }
  });

  it('NGワード保存失敗を要確認に集約し、スイッチ操作後も未保存語を保持して再試行する', async () => {
    vi.useFakeTimers();
    try {
      mocks.updateSettings.mockRejectedValueOnce(new Error('フィルター設定の保存に失敗しました。'));
      render(<Dashboard />); openEditor('commentFilter');
      const editor = screen.getByLabelText('NGワード（1行に1件）');
      fireEvent.change(editor, { target: { value: '失敗した語' } });
      await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); });
      expect(screen.getByRole('status', { name: '設定の保存状態' })).toHaveTextContent('フィルター設定の保存に失敗しました。');
      fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
      fireEvent.click(screen.getByRole('button', { name: /フィルター設定の保存に失敗しました/ }));
      expect(editor).toHaveValue('失敗した語');
      fireEvent.click(screen.getByRole('switch', { name: 'アスキーアートを除外' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(editor).toHaveValue('失敗した語');
      await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); });
      expect(mocks.updateSettings).toHaveBeenLastCalledWith('commentFilter', { ngWords: ['失敗した語'], asciiArtEnabled: true });
      expect(screen.getByRole('button', { name: '要確認 0件' })).toBeVisible();
    } finally { vi.useRealTimers(); }
  });

  it.each([
    ['youtube', 'YouTube Live'],
    ['twitch', 'Twitch'],
    ['shitaraba', '掲示板'],
  ] as const)('%sのエラー中は有効なトグルをオン表示し、オフ操作で停止する', async (source, label) => {
    const user = userEvent.setup();
    mocks.snapshot!.settings.sources[source].enabled = true;
    mocks.snapshot!.sourceStatuses[source].state = 'error';
    mocks.snapshot!.sourceStatuses[source].message = '接続を継続できません。';
    render(<Dashboard />); openEditor('sources');

    const toggle = await screen.findByRole('switch', { name: `${label}のコメント取得` });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      'sources',
      expect.objectContaining({
        [source]: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(mocks.sourceAction).toHaveBeenCalledWith(source, 'stop');
  });

  it('設定保存に失敗した場合はトグルをオン表示にしない', async () => {
    const user = userEvent.setup();
    mocks.updateSettings.mockRejectedValueOnce(new Error('接続設定を保存できません。'));
    render(<Dashboard />); openEditor('sources');

    const toggle = await screen.findByRole('switch', { name: 'Twitchのコメント取得' });
    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '要確認 1件' }));
    expect(within(screen.getByRole('dialog')).getByText('接続設定を保存できません。')).toBeVisible();
    expect(mocks.sourceAction).not.toHaveBeenCalled();
  });

  it('A案の接続リストで接続済みだけを数え、各行に再接続を配置する', () => {
    mocks.snapshot!.sourceStatuses.youtube.state = 'waiting';
    mocks.snapshot!.sourceStatuses.twitch.state = 'connected';
    render(<Dashboard />); openEditor('sources');
    const panel = screen.getByRole('region', { name: 'コメント取得' });
    expect(within(panel).getByText('1件接続中')).toBeVisible();
    const rows = within(panel).getAllByRole('article');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByRole('heading', { name: 'YouTube Live' })).toBeVisible();
    expect(within(rows[1]).getByRole('button', { name: 'Twitchを再接続' })).toBeEnabled();
    expect(within(rows[2]).getByRole('button', { name: '掲示板を再接続' })).toBeDisabled();
    expect(within(panel).queryByText('見本の状態を確認')).toBeNull();
  });

  it('取得設定の接続数を配信中と同じ件接続中の表記にし、実状態の変化を反映する', () => {
    const view = render(<Dashboard />); openEditor('sources');
    const count = () => document.querySelector('.acquisition-count');
    expect(count()).toHaveTextContent(/^0件接続中$/);
    for (const [index, source] of (['youtube', 'twitch', 'shitaraba'] as const).entries()) {
      mocks.snapshot!.sourceStatuses[source].state = 'connected'; view.rerender(<Dashboard />);
      expect(count()).toHaveTextContent(new RegExp(`^${index + 1}件接続中$`));
    }
    for (const state of ['stopped', 'connecting', 'waiting', 'reconnecting', 'error'] as const) {
      mocks.snapshot!.sourceStatuses.youtube.state = state; view.rerender(<Dashboard />);
      expect(count()).toHaveTextContent(/^2件接続中$/);
    }
    expect(mocks.sourceAction).not.toHaveBeenCalled();
  });

  it('再接続は対象の編集値を保存してから対象だけを停止・開始し二重実行しない', async () => {
    mocks.snapshot!.settings.sources.twitch.enabled = true;
    mocks.snapshot!.sourceStatuses.twitch.state = 'connected';
    let complete!: () => void;
    mocks.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    render(<Dashboard />); openEditor('sources');
    fireEvent.change(screen.getByLabelText('Twitchチャンネル名'), { target: { value: 'changed_channel' } });
    const reconnect = screen.getByRole('button', { name: 'Twitchを再接続' });
    fireEvent.click(reconnect); fireEvent.click(reconnect);
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateSettings).toHaveBeenCalledWith('sources', expect.objectContaining({
      twitch: { enabled: true, channel: 'changed_channel' },
    }));
    expect(mocks.sourceAction).not.toHaveBeenCalled();
    await act(async () => { complete(); });
    expect(mocks.sourceAction.mock.calls).toEqual([['twitch', 'reconnect']]);
    expect(within(screen.getByRole('region', { name: '通知' })).getByText('Twitchの再接続を要求しました。')).toBeVisible();
  });

  it('再接続の保存失敗で通信せず、入力とエラーを画面往復でも保持する', async () => {
    mocks.snapshot!.settings.sources.twitch.enabled = true;
    mocks.snapshot!.sourceStatuses.twitch.state = 'connected';
    mocks.updateSettings.mockRejectedValueOnce(new Error('接続設定を保存できません。'));
    render(<Dashboard />); openEditor('sources');
    const sources = within(document.querySelector('.sources-panel')!);
    const navigation = within(document.querySelector('.management-nav')!);
    fireEvent.change(sources.getByLabelText('Twitchチャンネル名'), { target: { value: 'kept_channel' } });
    await act(async () => { fireEvent.click(sources.getByRole('button', { name: 'Twitchを再接続' })); });
    expect(mocks.sourceAction).not.toHaveBeenCalled();
    fireEvent.click(navigation.getByRole('button', { name: 'ホーム', exact: true }));
    fireEvent.click(navigation.getByRole('button', { name: '要確認 1件' }));
    fireEvent.click(within(navigation.getByRole('dialog')).getByRole('button', { name: /接続設定を保存できません/ }));
    expect(sources.getByLabelText('Twitchチャンネル名')).toHaveValue('kept_channel');
    expect(sources.getByRole('switch', { name: 'Twitchのコメント取得' })).toBeChecked();
  });

  it('接続の操作失敗は次の管理操作で消去し、別機能の操作を妨げない', async () => {
    mocks.sourceAction.mockRejectedValueOnce(new Error('接続操作に失敗しました。'));
    render(<Dashboard />); openEditor('sources');
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Twitchのコメント取得' })); });
    expect(screen.getByRole('button', { name: '要確認 1件' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '独立窓を表示' })[0]); });
    expect(screen.getByRole('button', { name: '要確認 0件' })).toBeVisible();
  });

  it.each(['', '2', '61', '3.5'])('不正な取得間隔「%s」を保存せず保持し他の接続は操作できる', async value => {
    vi.useFakeTimers();
    try {
      render(<Dashboard />); openEditor('sources');
      fireEvent.change(screen.getByLabelText('コメント取得間隔（秒）'), { target: { value } });
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'ONのサービスをまとめて接続' })).toBeDisabled();
      expect(screen.getByRole('switch', { name: 'Twitchのコメント取得' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'すべて停止' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
      openEditor('sources');
      expect(screen.getByLabelText('コメント取得間隔（秒）')).toHaveValue(value ? Number(value) : null);
      expect(screen.getByLabelText('コメント取得間隔（秒）')).toHaveAttribute('aria-invalid', 'true');
      fireEvent.change(screen.getByLabelText('コメント取得間隔（秒）'), { target: { value: '8' } });
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(mocks.updateSettings).toHaveBeenCalledWith('sources', expect.objectContaining({ shitaraba: expect.objectContaining({ pollIntervalSeconds: 8 }) }));
    } finally { vi.useRealTimers(); }
  });

  it('YouTube接続先を1つの入力欄で保存する', async () => {
    const user = userEvent.setup();
    render(<Dashboard />); openEditor('sources');

    const card = (await screen.findByRole('heading', { name: 'YouTube Live', level: 3 })).closest('article');
    expect(card).not.toBeNull();
    expect(within(card!).queryByRole('combobox')).not.toBeInTheDocument();
    const input = within(card!).getByPlaceholderText('配信URL、Live ID、または @ハンドル');
    await user.type(input, 'https://www.youtube.com/@kyokutyou2061');

    await vi.waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenLastCalledWith(
        'sources',
        expect.objectContaining({
          youtube: {
            enabled: false,
            target: 'https://www.youtube.com/@kyokutyou2061',
          },
        }),
      );
    });
  });

  it('個別トグルでは別ソースの未保存入力を適用しない', async () => {
    const user = userEvent.setup();
    mocks.snapshot!.settings.sources.youtube.target = 'abcdefghijk';
    render(<Dashboard />); openEditor('sources');
    const youtubeInput = await screen.findByPlaceholderText('配信URL、Live ID、または @ハンドル');
    await user.clear(youtubeInput);
    await user.type(youtubeInput, 'lmnopqrstuv');

    await user.click(screen.getByRole('switch', { name: 'Twitchのコメント取得' }));

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      'sources',
      expect.objectContaining({
        youtube: expect.objectContaining({ target: 'abcdefghijk' }),
      }),
    );
    await vi.waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenLastCalledWith(
        'sources',
        expect.objectContaining({
          youtube: expect.objectContaining({ target: 'lmnopqrstuv' }),
        }),
      );
    }, { timeout: 1_000 });
  });

  it('設定保存ボタンを表示せず自動接続スイッチを直ちに保存する', async () => {
    const user = userEvent.setup();
    render(<Dashboard />); openEditor('sources');
    const panel = (await screen.findByRole('region', { name: 'コメント取得' })).closest('section');
    expect(panel).not.toBeNull();
    expect(screen.queryAllByRole('button', { name: '設定を保存' })).toHaveLength(0);

    await user.click(within(panel!).getByRole('switch', { name: 'アプリ起動時に自動接続' }));

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      'sources',
      expect.objectContaining({ autoConnect: true }),
    );
  });

  it('一括開始は画面で有効にした全ソースを保存してから開始する', async () => {
    const user = userEvent.setup();
    render(<Dashboard />); openEditor('sources');

    await user.click(await screen.findByRole('switch', { name: 'YouTube Liveのコメント取得' }));
    await user.click(screen.getByRole('switch', { name: 'Twitchのコメント取得' }));
    await user.click(screen.getByRole('switch', { name: '掲示板のコメント取得' }));
    vi.clearAllMocks();

    await user.click(screen.getByRole('button', { name: 'ONのサービスをまとめて接続' }));

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      'sources',
      expect.objectContaining({
        youtube: expect.objectContaining({ enabled: true }),
        twitch: expect.objectContaining({ enabled: true }),
        shitaraba: expect.objectContaining({ enabled: true }),
      }),
    );
    expect(mocks.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mutate.mock.invocationCallOrder[0],
    );
    expect(mocks.mutate).toHaveBeenCalledWith('/api/sources/start-all');
  });

  it('OBSの数値入力は最後の変更から500ミリ秒後に最新値だけを自動保存する', async () => {
    render(<Dashboard />); openEditor('commentOverlay');
    const panel = (await screen.findByRole('heading', { name: 'OBSコメント表示', level: 2 })).closest('section');
    expect(panel).not.toBeNull();
    const input = within(panel!).getByLabelText('1件表示時間（秒）');
    vi.clearAllMocks();
    vi.useFakeTimers();
    try {
      fireEvent.change(input, { target: { value: '40' } });
      fireEvent.change(input, { target: { value: '48' } });

      await act(async () => { vi.advanceTimersByTime(499); });
      expect(mocks.updateSettings).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
      expect(mocks.updateSettings).toHaveBeenCalledWith(
        'commentOverlay',
        expect.objectContaining({ singleDurationSeconds: 48 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('したらばのコメント取得間隔を3～60秒で自動保存する', async () => {
    render(<Dashboard />); openEditor('sources');
    const card = (await screen.findByText('掲示板')).closest('article');
    expect(card).not.toBeNull();
    const input = within(card!).getByLabelText('コメント取得間隔（秒）');
    expect(screen.queryByRole('button', { name: /コメント取得：/ })).toBeNull();
    expect(input).toBeVisible();
    expect(input).toHaveAttribute('min', '3');
    expect(input).toHaveAttribute('max', '60');
    expect(input).toHaveValue(5);
    vi.clearAllMocks();
    vi.useFakeTimers();
    try {
      fireEvent.change(input, { target: { value: '12' } });
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(mocks.updateSettings).toHaveBeenCalledWith(
        'sources',
        expect.objectContaining({
          shitaraba: expect.objectContaining({ pollIntervalSeconds: 12 }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('次スレッドの設定、プレビュー、手動作成、結果不明解決を状態に応じて表示する', async () => {
    const user = userEvent.setup();
    mocks.snapshot!.settings.sources.shitaraba.nextThread.enabled = true;
    mocks.snapshot!.settings.sources.shitaraba.threadUrl =
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/';
    mocks.snapshot!.shitarabaNextThread = {
      status: 'monitoring',
      maxResponseNumber: 900,
      remainingResponses: 50,
      plannedTitle: '配信10',
      plannedBody: '案内本文',
      nextThreadUrl: null,
      message: null,
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    const view = render(<Dashboard />); openEditor('nextThread');
    const panel = (await screen.findByRole('heading', { name: '掲示板の次スレッド作成', level: 2 })).closest('section');
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText('残り 50 レス')).toBeInTheDocument();
    expect(within(panel!).getByDisplayValue('配信10')).toHaveAttribute('readonly');

    await user.click(within(panel!).getByRole('button', { name: '今すぐ作成' }));
    expect(mocks.mutate).toHaveBeenCalledWith('/api/shitaraba/next-thread/create');

    mocks.snapshot!.shitarabaNextThread = {
      ...mocks.snapshot!.shitarabaNextThread,
      status: 'uncertain',
      message: '結果不明です。',
    };
    view.rerender(<Dashboard />);
    await user.click(within(panel!).getByText('ブラウザで作成・結果を確認'));
    await user.type(
      within(panel!).getByLabelText('作成済み次スレッドURL'),
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    );
    await user.click(within(panel!).getByRole('button', { name: '作成済みURLを登録' }));
    expect(mocks.mutate).toHaveBeenCalledWith('/api/shitaraba/next-thread/resolve', 'POST', {
      outcome: 'created',
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    });

    mocks.snapshot!.shitarabaNextThread = {
      ...mocks.snapshot!.shitarabaNextThread,
      status: 'failed',
      message: 'ブラウザを使用してください。',
    };
    view.rerender(<Dashboard />);
    expect(within(panel!).getByRole('button', { name: '現行掲示板をブラウザで開く' }))
      .toBeEnabled();
  });

  it('次スレッドの共通見出し、不正入力、投稿者と案内の開閉を移動後も保持する', () => {
    render(<Dashboard />); openEditor('nextThread');
    expect(screen.getByRole('button', { name: '← 設定に戻る' }).textContent).toBe('←');
    expect(screen.getByText('次スレッドの作成と、接続先の切替を設定します。')).toBeVisible();
    fireEvent.change(screen.getByRole('spinbutton', { name: '作成するレス番号' }), { target: { value: '0' } });
    expect(document.querySelector('.next-announcement')).toHaveAttribute('open');
    fireEvent.click(screen.getByText('作成後の案内'));
    fireEvent.click(screen.getByText('投稿者名・E-mail'));
    fireEvent.change(screen.getByRole('textbox', { name: '投稿者名', exact: true }), { target: { value: 'name#trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    openEditor('nextThread');
    expect(screen.getByRole('spinbutton', { name: '作成するレス番号' })).toHaveValue(0);
    expect(document.querySelector('.next-announcement')).not.toHaveAttribute('open');
    expect(screen.getByRole('textbox', { name: '投稿者名', exact: true })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '投稿者名', exact: true })).toHaveValue('name#trip');
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('保存途中に新設定と古い予定のスナップショットを受信しても手動作成を許可しない', async () => {
    vi.useFakeTimers();
    try {
    let finish!: () => void;
    mocks.updateSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    mocks.snapshot!.settings.sources.shitaraba.threadUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/';
    mocks.snapshot!.settings.sources.shitaraba.nextThread.titleMode = 'manual';
    mocks.snapshot!.settings.sources.shitaraba.nextThread.manualTitle = '古い予定';
    mocks.snapshot!.shitarabaNextThread = { status: 'manualReady', maxResponseNumber: 900, remainingResponses: 50,
      plannedTitle: '古い予定', plannedBody: '本文', nextThreadUrl: null, message: null, updatedAt: '2026-09-17T00:00:00Z' };
    const view = render(<Dashboard />); openEditor('nextThread');
    fireEvent.change(screen.getByLabelText('手動タイトル'), { target: { value: '変更後' } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    mocks.snapshot = { ...mocks.snapshot!, settingsRevision: mocks.snapshot!.settingsRevision + 1,
      settings: { ...mocks.snapshot!.settings, sources: { ...mocks.snapshot!.settings.sources,
        shitaraba: { ...mocks.snapshot!.settings.sources.shitaraba, nextThread: { ...mocks.snapshot!.settings.sources.shitaraba.nextThread, manualTitle: '変更後' } } } } };
    view.rerender(<Dashboard />);
    expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeDisabled();
    expect(screen.getByLabelText('作成予定タイトル')).toHaveValue('古い予定');
    mocks.snapshot = { ...mocks.snapshot!, shitarabaNextThread: { ...mocks.snapshot!.shitarabaNextThread, plannedTitle: '変更後' } };
    await act(async () => finish()); view.rerender(<Dashboard />);
    expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeEnabled();
    } finally { vi.useRealTimers(); }
  });

  it('即時保存の失敗後にテキストの自動保存で復旧すると古い次スレッド保存エラーを残さない', async () => {
    vi.useFakeTimers();
    try {
      mocks.updateSettings.mockRejectedValueOnce(new Error('次スレッド設定を保存できません。'));
      render(<Dashboard />); openEditor('nextThread');
      await act(async () => fireEvent.change(screen.getByRole('combobox', { name: 'タイトル' }), { target: { value: 'manual' } }));
      expect(document.querySelector('.next-state-message')).toHaveTextContent('次スレッド設定を保存できません。');
      fireEvent.change(screen.getByLabelText('手動タイトル'), { target: { value: '配信11' } });
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(document.querySelector('.next-state-message')).not.toHaveTextContent('次スレッド設定を保存できません。');
      expect(screen.getByRole('button', { name: /要確認 0件/ })).toBeVisible();
    } finally { vi.useRealTimers(); }
  });

  it('次スレッド自動作成がオフでも今すぐ作成を利用できる', async () => {
    const user = userEvent.setup();
    mocks.snapshot!.settings.sources.shitaraba.threadUrl =
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/';
    mocks.snapshot!.shitarabaNextThread = {
      status: 'manualReady',
      maxResponseNumber: 2,
      remainingResponses: 948,
      plannedTitle: '配信10',
      plannedBody: '案内本文',
      nextThreadUrl: null,
      message: null,
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    render(<Dashboard />); openEditor('nextThread');
    const panel = (await screen.findByRole('heading', { name: '掲示板の次スレッド作成', level: 2 })).closest('section');
    expect(panel).not.toBeNull();
    expect(within(panel!).getByRole('switch', { name: '次スレッド自動作成' }))
      .toHaveAttribute('aria-checked', 'false');

    const createButton = within(panel!).getByRole('button', { name: '今すぐ作成' });
    expect(createButton).toBeEnabled();
    await user.click(createButton);

    expect(mocks.mutate).toHaveBeenCalledWith('/api/shitaraba/next-thread/create');
  });

  it('したらばURLの保存とプレビュー更新が完了するまで今すぐ作成を無効にする', async () => {
    const user = userEvent.setup();
    mocks.snapshot!.settings.sources.shitaraba.threadUrl =
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/';
    mocks.snapshot!.shitarabaNextThread = {
      status: 'manualReady',
      maxResponseNumber: 2,
      remainingResponses: 948,
      plannedTitle: '旧スレッド10',
      plannedBody: '旧スレッド本文',
      nextThreadUrl: null,
      message: null,
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    render(<Dashboard />); openEditor('nextThread');
    const panel = (await screen.findByRole('heading', { name: '掲示板の次スレッド作成', level: 2 })).closest('section');
    openEditor('sources');
    const threadUrl = screen.getByPlaceholderText('スレッドURL');
    await user.clear(threadUrl);
    await user.type(
      threadUrl,
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/999/',
    );
    openEditor('nextThread');

    expect(within(panel!).getByRole('button', { name: '今すぐ作成' })).toBeDisabled();
  });

  it('コメント一覧のスイッチは変更時に直ちに自動保存する', async () => {
    const user = userEvent.setup();
    render(<Dashboard />); openEditor('commentList');
    const panel = (await screen.findByRole('heading', { name: 'コメント一覧', level: 2 })).closest('section');
    expect(panel).not.toBeNull();
    vi.clearAllMocks();

    await user.click(within(panel!).getByRole('switch', { name: 'サービス名' }));

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      'commentList',
      expect.objectContaining({ showSource: false }),
    );
  });

  it('コメント一覧の共通見出し・不正な入力・常時表示の音声認識プレビューを移動後も維持する', () => {
    mocks.snapshot!.comments = [{ id: 'private-comment', externalId: 'private-comment', source: 'youtube',
      authorName: '実際の投稿者', content: [{ type: 'text', text: '実際に取得したコメント本文' }],
      sequence: 1, receivedAt: '2026-10-18T00:00:00Z', initialHistory: false }];
    render(<Dashboard />); openEditor('commentList');
    const back = screen.getByRole('button', { name: '← 設定に戻る' });
    expect(back.textContent).toBe('←');
    expect(back.parentElement).toBe(screen.getByRole('heading', { level: 1, name: 'コメント一覧' }).parentElement);
    expect(screen.getByText('手元・ブラウザ・スマホのコメント一覧を調整します（OBS表示は別設定）。')).toBeVisible();
    const color = screen.getByRole('textbox', { name: '文字色（#RRGGBBAA）' });
    fireEvent.change(color, { target: { value: '#入力途中' } });
    const preview = screen.getByRole('region', { name: 'コメント一覧のプレビュー' });
    expect(preview).toBeVisible();
    expect(within(preview).getByText('これはコメント一覧の表示サンプルです。')).toBeVisible();
    expect(within(preview).queryByText('実際に取得したコメント本文')).toBeNull();
    fireEvent.click(back);
    expect(document.getElementById('settings-commentList')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
    fireEvent.click(screen.getByRole('button', { name: /文字色：#と8桁/ }));
    expect(color).toBeVisible();expect(color).toHaveValue('#入力途中');
    expect(screen.getByRole('region', { name: 'コメント一覧のプレビュー' })).toBeVisible();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('コメント一覧のウィンドウ操作を既存APIと共通の4秒トーストへ接続する', async () => {
    vi.useFakeTimers();
    try {
      const view = render(<Dashboard />); openEditor('commentList');
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ウィンドウを開く', exact: true })));
      expect(mocks.mutate).toHaveBeenCalledWith('/api/windows/comment-list/toggle');
      const notification = document.querySelector('.toast-region')!;
      expect(notification).toHaveTextContent('コメント一覧');
      expect(document.querySelector('.comment-list-panel .banner')).toBeNull();
      mocks.snapshot!.settings.application.commentListWindowVisible = true;
      view.rerender(<Dashboard />);
      expect(screen.getByRole('button', { name: '非表示にする', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await act(async () => { vi.advanceTimersByTime(4_000); });
      expect(notification).toBeEmptyDOMElement();
    } finally { vi.useRealTimers(); }
  });

  it('コメント一覧の開閉失敗はホームから復旧すると要確認から消える', async () => {
    mocks.mutate.mockRejectedValueOnce(new Error('一覧を開けませんでした。'));
    render(<Dashboard />); openEditor('commentList');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ウィンドウを開く', exact: true })));
    expect(screen.getByRole('button', { name: '要確認 1件' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    const controls = screen.getByRole('group', { name: '独立ウィンドウ' });
    const commentWindow = within(controls).getByText(/コメント一覧・/).parentElement!;
    await act(async () => fireEvent.click(within(commentWindow).getByRole('button', { name: '独立窓を表示' })));
    expect(screen.getByRole('button', { name: '要確認 0件' })).toBeVisible();
  });

  it('コメント一覧の文字と積み上げ方向を画面固有設定として自動保存する', async () => {
    const user = userEvent.setup();
    render(<Dashboard />); openEditor('commentList');
    const panel = (await screen.findByRole('heading', { name: 'コメント一覧', level: 2 })).closest('section');
    expect(panel).not.toBeNull();

    expect(within(panel!).getByLabelText('文字サイズ（px）')).toHaveValue(16);
    expect(within(panel!).getByLabelText('フォント')).toHaveValue('Yu Gothic UI');
    expect(within(panel!).getByLabelText('文字色（#RRGGBBAA）')).toHaveValue('#edf0ffff');
    expect(within(panel!).getByLabelText('背景色（#RRGGBBAA）')).toHaveValue('#131524ff');
    vi.clearAllMocks();

    await user.click(within(panel!).getByRole('button', { name: '新着を上', exact: true }));

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      'commentList',
      expect.objectContaining({ stackDirection: 'newestTop' }),
    );
  });

  it('全ての独立窓ボタンで表示と非表示を切り替える', async () => {
    const user = userEvent.setup();
    const view = render(<Dashboard />);
    const controls = await screen.findByRole('group', { name: '独立ウィンドウ' });
    const characterPanel = within(controls).getByText(/キャラクター・/).parentElement;
    const commentListPanel = within(controls).getByText(/コメント一覧・/).parentElement;
    expect(characterPanel).not.toBeNull();
    expect(commentListPanel).not.toBeNull();

    const characterButton = within(characterPanel!).getByRole('button', { name: '独立窓を表示' });
    const commentListButton = within(commentListPanel!).getByRole('button', { name: '独立窓を表示' });
    expect(characterButton).toHaveAttribute('aria-pressed', 'false');
    expect(commentListButton).toHaveAttribute('aria-pressed', 'false');
    await user.click(characterButton);
    await user.click(commentListButton);

    expect(mocks.mutate).toHaveBeenCalledWith('/api/windows/character/toggle');
    expect(mocks.mutate).toHaveBeenCalledWith('/api/windows/comment-list/toggle');

    mocks.snapshot!.settings.character.windowVisible = true;
    mocks.snapshot!.settings.application.commentListWindowVisible = true;
    view.rerender(<Dashboard />);
    expect(within(characterPanel!).getByRole('button', { name: '独立窓を非表示' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(commentListPanel!).getByRole('button', { name: '独立窓を非表示' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('管理画面のキャラクター欄は概要と専用設定画面への導線だけを提供する', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Dashboard />); openEditor('character');
    const panel = (await screen.findByRole('heading', { name: 'キャラクター', level: 2 })).closest('section');
    const character = within(panel!);

    expect(character.queryByRole('textbox')).not.toBeInTheDocument();
    expect(character.queryByLabelText(/PNGを選択/)).not.toBeInTheDocument();
    await user.click(character.getByRole('button', { name: '画像・動きを設定' }));
    expect(open).toHaveBeenCalledWith('/character/simple/settings', '_blank', 'noopener');
    open.mockRestore();
  });

  it('自動保存に失敗しても入力値を保持してエラーを表示する', async () => {
    render(<Dashboard />); openEditor('application');
    expect(screen.getByRole('heading', { name: 'アプリ設定', level: 1, exact: true })).toBeVisible();
    fireEvent.click(screen.getByText('接続設定'));
    const input = await screen.findByLabelText('アプリの接続ポート（再起動後に有効）');
    mocks.updateSettings.mockRejectedValueOnce(new Error('ポート設定を保存できません。'));
    vi.useFakeTimers();
    try {
      fireEvent.change(input, { target: { value: '4000' } });
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(input).toHaveValue(4000);
      fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
      expect(within(screen.getByRole('dialog')).getByText('ポート設定を保存できません。')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('音声認識の編集値は適用ボタンまで保存せず、プレビューは単独で開始できる', async () => {
    const user = userEvent.setup();
    const view = render(<Dashboard />); openEditor('speechRecognition');
    const panel = (await screen.findByRole('heading', { name: '配信者音声認識', level: 2 })).closest('section')!;
    const vad = within(panel).getByLabelText('VAD閾値');

    await user.click(within(panel).getByText('認識の調整', { exact: true }));
    await user.clear(vad);
    await user.type(vad, '0.42');
    await user.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    expect(vad).not.toBeVisible();
    openEditor('speechRecognition');
    expect(vad).toHaveValue(0.42);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    mocks.snapshot = structuredClone(mocks.snapshot!);
    mocks.snapshot.speechRecognition.previewActive = true;
    mocks.snapshot.settings.speechRecognition.enabled = true;
    view.rerender(<Dashboard />);
    expect(within(panel).getByLabelText('VAD閾値')).toHaveValue(0.42);
    await user.click(within(panel).getByRole('button', { name: 'この設定を適用' }));
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      'speechRecognition',
      expect.objectContaining({ enabled: true, vadThreshold: 0.42 }),
    );

    mocks.snapshot.speechRecognition.previewActive = false;
    view.rerender(<Dashboard />);
    const previewButton = within(panel).getByRole('button', { name: 'プレビューを開始' });
    expect(previewButton).toHaveAttribute('aria-pressed', 'false');
    expect(within(panel).queryByRole('button', { name: 'プレビューを終了' })).not.toBeInTheDocument();
    await user.click(previewButton);
    expect(mocks.mutate).toHaveBeenCalledWith('/api/speech-recognition/preview/start');

    mocks.snapshot.speechRecognition.previewActive = true;
    view.rerender(<Dashboard />);
    const stopPreviewButton = within(panel).getByRole('button', { name: 'プレビューを終了' });
    expect(screen.queryByRole('complementary', { name: '実行中の操作' })).toBeNull();
    expect(stopPreviewButton).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).queryByRole('button', { name: 'プレビューを開始' })).not.toBeInTheDocument();
    await user.click(stopPreviewButton);
    expect(mocks.mutate).toHaveBeenCalledWith('/api/speech-recognition/preview/stop');
  });

  it('認識モデル名を示し、削除した情報と旧探索設定を表示しない', async () => {
    render(<Dashboard />); openEditor('speechRecognition');
    const panel = (await screen.findByRole('heading', { name: '配信者音声認識', level: 2 })).closest('section')!;

    expect(within(panel).getByText(/Parakeet CTC（日本語）/)).toBeInTheDocument();
    expect(within(panel).queryByText('モデル情報・ライセンス')).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText('探索方式')).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText('探索候補数')).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText('Blank penalty')).not.toBeInTheDocument();
  });

  it('プレビュー中も詳細を閉じられ、再展開して終了できる', async () => {
    mocks.snapshot!.speechRecognition.previewActive = true;
    render(<Dashboard />); openEditor('speechRecognition');
    const panel = (await screen.findByRole('heading', { name: '配信者音声認識', level: 2 })).closest('section')!;

    fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    expect(within(panel).queryByRole('button', { name: 'プレビューを終了' })).toBeNull();
    expect(screen.getByRole('button', { name: '音声認識プレビュー実行中・終了はこちら ›' })).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();
    openEditor('speechRecognition');
    expect(within(panel).getByRole('button', { name: 'プレビューを終了' })).toBeInTheDocument();
    expect(within(panel).getByLabelText('プレビュー中の発話をWAV保存する')).toBeInTheDocument();
  });

  it('音声認識設定の不正値を項目ごとの日本語エラーで示す', async () => {
    const user = userEvent.setup();
    render(<Dashboard />); openEditor('speechRecognition');
    const panel = (await screen.findByRole('heading', { name: '配信者音声認識', level: 2 })).closest('section')!;
    const vad = within(panel).getByLabelText('VAD閾値');
    await user.click(within(panel).getByText('認識の調整', { exact: true }));
    await user.clear(vad);
    await user.type(vad, '1');
    await user.click(within(panel).getByRole('button', { name: 'この設定を適用' }));

    expect(within(panel).getByText('VAD閾値は0より大きく1未満で指定してください。')).toBeInTheDocument();
    expect(vad).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
    fireEvent.click(screen.getByRole('button', { name: /詳細の入力内容を確認してください。/ }));
    expect(vad).toBeVisible();
    expect(vad).toHaveValue(1);
    expect(vad).toHaveAttribute('aria-invalid', 'true');
  });

  it('スマホ連携の排他的ネットワーク設定と公式導入リンクを表示する', async () => {
    const user = userEvent.setup();
    render(<Dashboard />); openEditor('mobileSpeech');
    const panel = within(document.querySelector('.smartphone-panel'));
    await user.click(panel.getByRole('switch', { name: '外配信Tailscaleネットワーク' }));
    expect(mocks.mutate).toHaveBeenCalledWith('/api/smartphone/configure', 'POST', { activeNetwork: 'tailscale' });
    await user.click(panel.getByRole('button', { name: /^外配信Tailscaleネットワーク/ }));
    await user.click(panel.getByText('Tailscaleで接続する手順'));
    expect(panel.getByRole('link', { name: 'Windows版の導入' })).toHaveAttribute('href', 'https://tailscale.com/docs/install/windows');
    expect(panel.getByRole('link', { name: 'Android版の導入' })).toHaveAttribute('href', 'https://tailscale.com/docs/install/android');
    expect(panel.getByRole('link', { name: '料金と利用条件' })).toHaveAttribute('href', 'https://tailscale.com/pricing');
  });
});

function openEditor(id: string) {
  fireEvent.click(within(document.querySelector('.management-nav')!).getByRole('button', { name: '設定', exact: true }));
  const smartphone = id === 'mobileSpeech' || id === 'outdoor';
  fireEvent.click(document.getElementById('settings-' + (smartphone ? 'smartphone' : id))!);
}

function snapshot(): AppSnapshot {
  const settings = createDefaultSettings();
  const stopped = (source: 'youtube' | 'twitch' | 'shitaraba') => ({
    source,
    state: 'stopped' as const,
    message: null,
    updatedAt: new Date(0).toISOString(),
  });
  return {
    settings,
    settingsRevision: 1,
    smartphone: { ...structuredClone(smartphoneView), settings: { ...smartphoneView.settings, activeNetwork: null }, devices: [] },
    comments: [],
    sourceStatuses: {
      youtube: stopped('youtube'),
      twitch: stopped('twitch'),
      shitaraba: stopped('shitaraba'),
    },
    commentOverlay: { active: [], queue: [] },
    character: { mouthShape: 'closed', assetWarning: null },
    commentSpeech: { engineStatus: 'disabled', currentCommentId: null, queueLength: 0, droppedCount: 0, warning: null },
    mobileSpeech: { urls: [], tailscaleStatus: 'disabled', activeClient: false, currentCommentId: null, queueLength: 0, droppedCount: 0, audioAvailable: false, warning: null },
    shitarabaNextThread: {
      status: 'disabled',
      maxResponseNumber: null,
      remainingResponses: null,
      plannedTitle: null,
      plannedBody: null,
      nextThreadUrl: null,
      message: null,
      updatedAt: new Date(0).toISOString(),
    },
    speechRecognition: {
      status: 'disabled',
      modelStatus: 'missing',
      modelDownloadProgress: null,
      microphones: [],
      previewActive: false,
      wavSaving: false,
      previewHistory: [],
      sessionId: null,
      warning: null,
    },
    speechRecognitionOverlay: { active: null },
  };
}
