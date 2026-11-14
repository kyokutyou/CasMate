// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListenerPollPanel } from '../src/renderer/components/ListenerPollPanel';
import { ListenerPollPage } from '../src/renderer/poll/ListenerPollPage';
import { PollController } from '../src/main/poll/poll-controller';
import { emptyPollData } from '../src/main/poll/poll-store';
import type { PollManagementSnapshot, PollPublicationState, PollPublicSnapshot } from '../src/shared/listener-poll';
import { newerPollState } from '../src/renderer/poll/poll-state';

const controllers: PollController[] = [];
afterEach(async () => { cleanup(); for (const c of controllers.splice(0)) await c.shutdown(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function fixture() {
  const polls = new PollController({ load: async () => emptyPollData(), save: async () => undefined }); await polls.initialize(); controllers.push(polls);
  await polls.draft({ question: '次の企画は？', options: ['ゲーム', '雑談'], durationMinutes: null });
  const publication: PollPublicationState = { status: 'online', url: `https://${'a'.repeat(26)}.srv.us/`, message: '' };
  let failDraft = false;
  const request = vi.fn(async (action?: string, body?: unknown): Promise<PollManagementSnapshot> => {
    if (action === 'draft') { if (failDraft) { failDraft = false; throw new Error('保存に失敗しました。'); } await polls.draft(body); }
    if (action === 'appearance') await polls.appearance(body);
    if (action === 'start') await polls.start();
    if (action === 'close') await polls.close();
    if (action === 'reveal') await polls.reveal((body as { visible: boolean }).visible);
    if (action === 'duplicate') await polls.duplicate((body as { id: string }).id);
    if (action === 'delete') await polls.delete((body as { id: string }).id);
    return { ...polls.view(), publication };
  });
  return { polls, request, fail: () => { failDraft = true; } };
}
describe('poll management controls', () => {
  it('saves drafts after 500ms, starts a frozen question, reveals and closes without changing reveal', async () => {
    const f = await fixture(), notice = vi.fn(); render(<ListenerPollPanel request={f.request} baseUrl="http://127.0.0.1:3000" onNotice={notice} onRegisterSource={vi.fn()}/>);
    await waitFor(() => expect(screen.getByRole('button', { name: '投票を開始', exact: true })).toBeEnabled());
    vi.useFakeTimers(); fireEvent.change(screen.getByLabelText('お題'), { target: { value: '保存したお題' } });
    await act(() => vi.advanceTimersByTimeAsync(499)); expect(f.request.mock.calls.some(([action]) => action === 'draft')).toBe(false);
    expect(screen.getByRole('button', { name: '投票を開始', exact: true })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(1)); expect(f.polls.view().draft.question).toBe('保存したお題');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '投票を開始', exact: true })); });
    expect(f.polls.view().current?.question).toBe('保存したお題'); expect(f.polls.view().current?.resultsVisible).toBe(false);
    fireEvent.change(screen.getByLabelText('お題'), { target: { value: '次のお題' } }); await act(() => vi.advanceTimersByTimeAsync(500));
    expect(f.polls.view().current?.question).toBe('保存したお題');
    await act(async () => { fireEvent.click(screen.getByLabelText('投票ページとOBSに結果を公開')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '締め切る', exact: true })); });
    expect(f.polls.view().current?.resultsVisible).toBe(true); expect(f.polls.view().history).toHaveLength(1);
    expect(notice).toHaveBeenCalledWith('投票を締め切りました。', 'success');
  });
  it('retains failed edits without automatic retry and keeps their error through an independent appearance save', async () => {
    const f = await fixture(); render(<ListenerPollPanel request={f.request} baseUrl="http://127.0.0.1:3000" onNotice={vi.fn()} onRegisterSource={vi.fn()}/>);
    await waitFor(() => expect(screen.getByLabelText('お題')).toHaveValue('次の企画は？')); vi.useFakeTimers(); f.fail();
    fireEvent.change(screen.getByLabelText('お題'), { target: { value: '残す入力' } }); await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByLabelText('お題')).toHaveValue('残す入力'); expect(f.polls.view().draft.question).toBe('次の企画は？');
    await act(() => vi.advanceTimersByTimeAsync(3000)); expect(f.request.mock.calls.filter(([action]) => action === 'draft')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('文字サイズ（px）'), { target: { value: '35' } }); await act(() => vi.advanceTimersByTimeAsync(500));
    expect(f.polls.view().appearance.fontSize).toBe(35); expect(screen.getAllByText('保存に失敗しました。').length).toBeGreaterThan(0);
    const section = screen.getByRole('heading', { name: '投票を作成' }).closest('section')!;
    fireEvent.click(within(section).getByRole('button', { name: '再保存' })); await act(() => vi.advanceTimersByTimeAsync(500));
    expect(f.polls.view().draft.question).toBe('残す入力'); expect(screen.queryByText('保存に失敗しました。')).not.toBeInTheDocument();
  });
  it('requires confirmation to delete history and provides the new OBS registration target', async () => {
    const f = await fixture(); await f.polls.start(); await f.polls.close(); const register = vi.fn();
    render(<ListenerPollPanel request={f.request} baseUrl="http://127.0.0.1:3000" onNotice={vi.fn()} onRegisterSource={register}/>);
    await waitFor(() => expect(screen.getByText(/次の企画は？ ·/u)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/次の企画は？ ·/u)); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '履歴を削除' })); }); expect(f.polls.view().history).toHaveLength(1);
    confirm.mockReturnValue(true); await act(async () => { fireEvent.click(screen.getByRole('button', { name: '履歴を削除' })); }); expect(f.polls.view().history).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'OBSに追加', exact: true })); expect(register).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'overlay', overlay: 'poll' }, entry: expect.any(HTMLElement) }));
  });
});

class TestEvents {
  static current: TestEvents;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { TestEvents.current = this; }
  close() {}
}
describe('listener browser', () => {
  it('votes, changes one vote, reconciles a failed request, and blocks operations after notification disconnect', async () => {
    const f = await fixture(); await f.polls.start(); vi.stubGlobal('EventSource', TestEvents);
    let failVote = false;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/vote') {
        const result = await f.polls.vote('same-browser', JSON.parse(String(init?.body)));
        if (failVote) { failVote = false; throw new Error('応答が不明です。'); }
        return new Response(JSON.stringify(result));
      }
      return new Response(JSON.stringify({ state: f.polls.publicView(), ballot: f.polls.ballot('same-browser'), cookieReady: true }));
    }); vi.stubGlobal('fetch', fetch);
    render(<ListenerPollPage/>); await waitFor(() => expect(TestEvents.current).toBeDefined());
    act(() => TestEvents.current.onopen?.());
    const game = screen.getByRole('button', { name: /ゲーム/u }), chat = screen.getByRole('button', { name: /雑談/u });
    await act(async () => { fireEvent.click(game); }); expect(game).toHaveAttribute('aria-pressed', 'true'); expect(f.polls.view().current?.counts).toEqual([1, 0]);
    failVote = true; await act(async () => { fireEvent.click(chat); }); expect(chat).toHaveAttribute('aria-pressed', 'true'); expect(f.polls.view().current?.counts).toEqual([0, 1]);
    expect(fetch.mock.calls.filter(([path]) => path === '/api/vote')).toHaveLength(2);
    act(() => TestEvents.current.onerror?.()); expect(game).toBeDisabled(); expect(chat).toBeDisabled();
  });
  it('ignores older revisions and accepts a new server instance after restart', async () => {
    const f = await fixture(); await f.polls.start(); const state = f.polls.publicView();
    const newest: PollPublicSnapshot = { ...state, revision: 10 };
    expect(newerPollState(newest, { ...state, revision: 3 })).toBe(newest);
    expect(newerPollState(newest, { ...state, instance: 'restart', revision: 0 }).instance).toBe('restart');
  });
  it('reconnects when an ambiguous vote and the first reconciliation fail while SSE remains open', async () => {
    const f = await fixture(); await f.polls.start(); TestEvents.current = undefined as unknown as TestEvents; vi.stubGlobal('EventSource', TestEvents);
    let failRead = false;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/vote') { await f.polls.vote('browser', JSON.parse(String(init?.body))); failRead = true; throw new Error('応答切断'); }
      if (failRead) { failRead = false; throw new Error('一時的な状態取得失敗'); }
      return new Response(JSON.stringify({ state: f.polls.publicView(), ballot: f.polls.ballot('browser'), cookieReady: true }));
    }); vi.stubGlobal('fetch', fetch); render(<ListenerPollPage/>);
    await waitFor(() => expect(TestEvents.current).toBeDefined()); act(() => TestEvents.current.onopen?.());
    const first = TestEvents.current; vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /ゲーム/u })); });
    expect(screen.getByRole('button', { name: /ゲーム/u })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(1500)); expect(TestEvents.current).not.toBe(first);
    act(() => TestEvents.current.onopen?.()); expect(screen.getByRole('button', { name: /ゲーム/u })).toBeEnabled();
    expect(screen.getByRole('button', { name: /ゲーム/u })).toHaveAttribute('aria-pressed', 'true');
    expect(fetch.mock.calls.filter(([path]) => path === '/api/vote')).toHaveLength(1);
  });
});
