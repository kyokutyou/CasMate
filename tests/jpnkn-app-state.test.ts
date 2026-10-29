import { describe, expect, it, vi } from 'vitest';
import { AppState, type AppStateOptions } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { connectionService } from '../src/main/sources/source-connections';
import { createSourceStatus, type SourceCallbacks } from '../src/main/sources/source-adapter';
import type { AppSettings, IncomingComment } from '../src/shared/types';

const currentUrl = 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/123/';
const nextUrl = 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/456/';
const shitarabaUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/1/123/';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function settings() {
  const value = createDefaultSettings();
  value.sources.shitaraba.threadUrl = currentUrl;
  value.sources.shitaraba.nextThread = { ...value.sources.shitaraba.nextThread,
    titleMode: 'manual', manualTitle: '新スレ2', bodyMode: 'manual', manualBody: '本文', announceUrl: false };
  return value;
}
const writer: NonNullable<AppStateOptions['boardWriteAdapter']> = {
  fetchThreadContent: async () => ({ title: '新スレ1', body: '本文' }),
  findThreadsByTitle: async () => [],
  createNextThread: async () => ({ threadUrl: nextUrl }),
  announceNextThread: vi.fn(async () => undefined),
};
const incoming: IncomingComment = { source: 'jpnkn', externalId: 'kyokutyou:123:1', authorName: '視聴者',
  content: [{ type: 'text', text: 'コメント' }], initialHistory: false };

describe('jpnknのアプリケーション統合', () => {
  it.each([false, true])('保存待機中のAI開始を完了後まで保留して旧URLで取得を再作成しない（新サービス参加=%s）', async enabled => {
    const value = settings(); value.sources.shitaraba.threadUrl = shitarabaUrl;
    value.aiListener.participants.shitaraba.enabled = true; value.aiListener.participants.jpnkn.enabled = enabled;
    const saving = deferred(); const targets: string[] = [];
    const save = vi.fn(() => saving.promise);
    const state = new AppState(value, { boardWriteAdapter: writer, saveSettings: save,
      sourceFactory: (source, sources, callbacks) => ({ source, start: async () => {
        targets.push(sources.shitaraba.threadUrl); callbacks.onStatus(createSourceStatus(source, 'connected'));
      }, stop: async () => undefined }) });
    try {
      await state.acquireAiDependencies();
      const sources = structuredClone(state.snapshot().settings.sources); sources.shitaraba.threadUrl = currentUrl;
      const update = state.updateSettings('sources', sources);
      await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
      const acquiring = state.acquireAiDependencies();
      await Promise.resolve(); expect(targets).toEqual([shitarabaUrl]);
      saving.resolve(); await Promise.all([update, acquiring]);
      expect(targets).toEqual(enabled ? [shitarabaUrl, currentUrl] : [shitarabaUrl]);
      expect(state.snapshot().sourceStatuses.shitaraba).toMatchObject({ service: 'jpnkn', state: enabled ? 'connected' : 'stopped' });
      await state.releaseAiDependencies();
      expect(state.snapshot().sourceStatuses.shitaraba.state).toBe('stopped');
    } finally { saving.resolve(); await state.shutdown(); }
  });

  it('保存待機中のAI停止も完了後に解放し、取得を残さない', async () => {
    const value = settings(); value.aiListener.participants.jpnkn.enabled = true;
    const saving = deferred(); const save = vi.fn(() => saving.promise);
    const state = new AppState(value, { boardWriteAdapter: writer, saveSettings: save,
      sourceFactory: (source, _sources, callbacks) => ({ source,
        start: async () => { callbacks.onStatus(createSourceStatus(source, 'connected')); }, stop: async () => undefined }) });
    try {
      await state.acquireAiDependencies();
      const sources = structuredClone(state.snapshot().settings.sources); sources.shitaraba.threadUrl = nextUrl;
      const update = state.updateSettings('sources', sources);
      await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
      const releasing = state.releaseAiDependencies(); saving.resolve();
      await Promise.all([update, releasing]);
      expect(state.snapshot().sourceStatuses.shitaraba.state).toBe('stopped');
    } finally { saving.resolve(); await state.shutdown(); }
  });
  it('保存済みURLから停止中も実サービスを表示し、接続枠を3件に保つ', () => {
    const state = new AppState(settings(), { boardWriteAdapter: writer });
    try {
      expect(Object.keys(state.snapshot().sourceStatuses)).toEqual(['youtube', 'twitch', 'shitaraba']);
      expect(state.snapshot().sourceStatuses.shitaraba).toMatchObject({ source: 'shitaraba', service: 'jpnkn', state: 'stopped' });
    } finally { state.dispose(); }
  });

  it.each([false, true])('現在のjpnkn参加設定で取得を判断し、したらば参加ONを流用しない（jpnkn=%s）', async enabled => {
    const value = settings();
    value.aiListener.participants.shitaraba.enabled = true;
    value.aiListener.participants.jpnkn.enabled = enabled;
    const started: string[] = [];
    const state = new AppState(value, { boardWriteAdapter: writer,
      sourceFactory: (source, sources, callbacks) => ({ source,
        start: async () => { started.push(connectionService(source, sources)!); callbacks.onStatus(createSourceStatus(source, 'connected')); },
        stop: async () => undefined }) });
    try {
      await state.acquireAiDependencies();
      expect(started).toEqual(enabled ? ['jpnkn'] : []);
      expect(state.snapshot().settings.sources.shitaraba.enabled).toBe(false);
      await state.releaseAiDependencies();
      expect(state.snapshot().sourceStatuses.shitaraba.state).toBe('stopped');
    } finally { await state.shutdown(); }
  });

  it('AI専用のしたらば取得から参加OFFのjpnknへ変更すると取得を停止する', async () => {
    const value = settings(); value.sources.shitaraba.threadUrl = shitarabaUrl;
    value.aiListener.participants.shitaraba.enabled = true;
    const start = vi.fn(async () => undefined);
    const state = new AppState(value, { boardWriteAdapter: writer,
      sourceFactory: source => ({ source, start, stop: async () => undefined }) });
    try {
      await state.acquireAiDependencies();
      const sources = structuredClone(state.snapshot().settings.sources);
      sources.shitaraba.threadUrl = currentUrl;
      await state.updateSettings('sources', sources);
      expect(start).toHaveBeenCalledOnce();
      expect(state.snapshot().sourceStatuses.shitaraba).toMatchObject({ service: 'jpnkn', state: 'stopped' });
    } finally { await state.shutdown(); }
  });

  it('両方のAI参加がONでも現在の板だけ取得し、切替後もAIが取得を所有する', async () => {
    const value = settings(); value.sources.shitaraba.threadUrl = shitarabaUrl;
    value.aiListener.participants.shitaraba.enabled = true; value.aiListener.participants.jpnkn.enabled = true;
    const started: string[] = [];
    const stop = vi.fn(async () => undefined);
    const state = new AppState(value, { boardWriteAdapter: writer,
      sourceFactory: (source, sources, callbacks) => ({ source, start: async () => {
        started.push(connectionService(source, sources)!); callbacks.onStatus(createSourceStatus(source, 'connected'));
      }, stop }) });
    try {
      await state.acquireAiDependencies();
      const sources = structuredClone(state.snapshot().settings.sources); sources.shitaraba.threadUrl = currentUrl;
      await state.updateSettings('sources', sources);
      expect(started).toEqual(['shitaraba', 'jpnkn']);
      await state.releaseAiDependencies();
      expect(stop).toHaveBeenCalledTimes(2);
      expect(state.snapshot().sourceStatuses.shitaraba.state).toBe('stopped');
    } finally { await state.shutdown(); }
  });

  it('掲示板変更前のコールバックをコメント・進捗・状態へ混入させない', async () => {
    const value = settings(); value.sources.shitaraba.enabled = true;
    const adapters: SourceCallbacks[] = [];
    const state = new AppState(value, { boardWriteAdapter: writer,
      sourceFactory: (source, _sources, callbacks) => ({ source, start: async () => {
        adapters.push(callbacks); callbacks.onStatus(createSourceStatus(source, 'connected'));
      }, stop: async () => undefined }) });
    try {
      await state.startSource('shitaraba');
      const sources = structuredClone(state.snapshot().settings.sources); sources.shitaraba.threadUrl = nextUrl;
      await state.updateSettings('sources', sources);
      adapters[0].onComment(incoming); adapters[0].onBoardBatch?.([incoming]); adapters[0].onBoardProgress?.(999);
      adapters[0].onStatus(createSourceStatus('shitaraba', 'error', '旧接続'));
      expect(state.snapshot().comments).toEqual([]);
      expect(state.snapshot().shitarabaNextThread.maxResponseNumber).toBeNull();
      expect(state.snapshot().sourceStatuses.shitaraba.state).toBe('connected');
      adapters[1].onComment({ ...incoming, externalId: 'kyokutyou:456:1' });
      expect(state.snapshot().comments[0]).toMatchObject({ source: 'jpnkn' });
    } finally { await state.shutdown(); }
  });

  it.each(['saved', 'ai'] as const)('次スレッド切替の停止待ち中に手動停止すると新URLを保存しても取得を再開しない（%s）', async owner => {
    const value = settings(); value.sources.shitaraba.enabled = owner === 'saved'; value.sources.shitaraba.nextThread.enabled = true;
    value.aiListener.participants.jpnkn.enabled = owner === 'ai';
    const stopping = deferred(); const start = vi.fn(async () => undefined); const stop = vi.fn(() => stopping.promise);
    let callbacks!: SourceCallbacks;
    const state = new AppState(value, { boardWriteAdapter: writer,
      sourceFactory: (source, _sources, nextCallbacks) => ({ source, start: async () => {
        callbacks = nextCallbacks; await start(); callbacks.onStatus(createSourceStatus(source, 'connected'));
      }, stop }) });
    try {
      if (owner === 'ai') await state.acquireAiDependencies();
      else await state.startSource('shitaraba');
      callbacks.onBoardProgress?.(1000);
      await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
      await state.stopSource('shitaraba'); stopping.resolve();
      await vi.waitFor(() => expect(state.snapshot().settings.sources.shitaraba.threadUrl).toBe(nextUrl));
      expect(start).toHaveBeenCalledOnce(); expect(state.snapshot().sourceStatuses.shitaraba.state).toBe('stopped');
    } finally { stopping.resolve(); await state.shutdown(); }
  });

  it('切替の停止待ち中に保存された他機能の設定を巻き戻さない', async () => {
    const value = settings(); value.sources.shitaraba.enabled = true; value.sources.shitaraba.nextThread.enabled = true;
    const stopping = deferred(); const stop = vi.fn(() => stopping.promise); const saved: AppSettings[] = [];
    let callbacks!: SourceCallbacks;
    const state = new AppState(value, { boardWriteAdapter: writer, saveSettings: async value => { saved.push(value); },
      sourceFactory: (source, _sources, nextCallbacks) => ({ source, start: async () => {
        callbacks = nextCallbacks; callbacks.onStatus(createSourceStatus(source, 'connected'));
      }, stop }) });
    try {
      await state.startSource('shitaraba'); callbacks.onBoardProgress?.(1000);
      await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
      await state.updateSettings('commentFilter', { ngWords: ['保持する語'], asciiArtEnabled: true });
      stopping.resolve();
      await vi.waitFor(() => expect(state.snapshot().settings.sources.shitaraba.threadUrl).toBe(nextUrl));
      expect(state.snapshot().settings.commentFilter.ngWords).toEqual(['保持する語']);
      expect(saved.at(-1)?.commentFilter.ngWords).toEqual(['保持する語']);
    } finally { stopping.resolve(); await state.shutdown(); }
  });
});
