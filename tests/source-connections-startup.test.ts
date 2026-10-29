import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import { SourceConnections, type SourceAdapterFactory } from '../src/main/sources/source-connections';
import { createSourceStatus, type SourceCallbacks } from '../src/main/sources/source-adapter';
import type { CommentSource, IncomingComment } from '../src/shared/types';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(initializeShitaraba: () => Promise<void> = async () => undefined, factory?: SourceAdapterFactory) {
  const callbacks: SourceCallbacks = {
    onStatus: vi.fn(), onComment: vi.fn(), onYouTubeVideo: vi.fn(),
    onRawAuthor: vi.fn(), onShitarabaBatch: vi.fn(), onShitarabaProgress: vi.fn(),
  };
  const create = vi.fn<SourceAdapterFactory>(factory ?? ((source, _settings, callbacks) => ({
    source,
    start: async () => { callbacks.onStatus(createSourceStatus(source, 'connected')); },
    stop: async () => undefined,
  })));
  const connections = new SourceConnections({
    settings: () => createDefaultSettings().sources,
    initializeShitaraba,
    callbacks,
    factory: create,
  });
  return { connections, create, callbacks };
}

describe('コメント接続の遅延開始', () => {
  it('したらばの初期化中に停止すると、初期化完了後にも取得を開始しない', async () => {
    const initializing = deferred();
    const { connections, create } = fixture(() => initializing.promise);
    const starting = connections.start('shitaraba');
    expect(create).not.toHaveBeenCalled();

    await connections.stop('shitaraba');
    initializing.resolve();
    await starting;

    expect(create).not.toHaveBeenCalled();
    expect(connections.hasConnection('shitaraba')).toBe(false);
    expect(connections.state('shitaraba')).toBe('stopped');
  });

  it('初期化待ち中の重複開始でも、したらばの取得を一つだけ作る', async () => {
    const initializing = deferred();
    const { connections, create } = fixture(() => initializing.promise);
    const first = connections.start('shitaraba');
    const second = connections.start('shitaraba');
    initializing.resolve();
    await Promise.all([first, second]);

    expect(create).toHaveBeenCalledOnce();
    expect(connections.hasConnection('shitaraba')).toBe(true);
    expect(connections.state('shitaraba')).toBe('connected');
    await connections.stop('shitaraba');
  });

  it('停止後の再開始では、古い初期化の完了が新しい開始を代行しない', async () => {
    const oldInitialization = deferred();
    const newInitialization = deferred();
    const initialize = vi.fn<() => Promise<void>>()
      .mockReturnValueOnce(oldInitialization.promise)
      .mockReturnValueOnce(newInitialization.promise);
    const { connections, create } = fixture(initialize);
    const oldStart = connections.start('shitaraba');
    await connections.stop('shitaraba');
    const newStart = connections.start('shitaraba');

    oldInitialization.resolve();
    await oldStart;
    expect(create).not.toHaveBeenCalled();
    expect(connections.state('shitaraba')).toBe('stopped');

    newInitialization.resolve();
    await newStart;
    expect(create).toHaveBeenCalledOnce();
    expect(connections.state('shitaraba')).toBe('connected');
    await connections.stop('shitaraba');
  });

  it('したらばの初期化が遅れても、別サービスの開始と停止は継続する', async () => {
    const initializing = deferred();
    const { connections, create } = fixture(() => initializing.promise);
    const starting = connections.start('shitaraba');
    await connections.start('twitch');
    expect(connections.state('twitch')).toBe('connected');
    await connections.stop('shitaraba');
    initializing.resolve();
    await starting;

    expect(create.mock.calls.map(([source]) => source)).toEqual(['twitch']);
    expect(connections.state('twitch')).toBe('connected');
    expect(connections.state('shitaraba')).toBe('stopped');
    await connections.stop('twitch');
  });

  it('停止済みの古い開始が失敗しても、再開した接続と状態を破棄しない', async () => {
    const oldAdapterStart = deferred();
    let attempts = 0;
    const { connections } = fixture(undefined, (source, _settings, callbacks) => {
      const first = attempts++ === 0;
      return { source, start: async () => {
        if (first) await oldAdapterStart.promise;
        else callbacks.onStatus(createSourceStatus(source, 'connected'));
      }, stop: async () => undefined };
    });
    const oldStart = connections.start('twitch').catch(error => error);
    await connections.stop('twitch');
    await connections.start('twitch');
    oldAdapterStart.reject(new Error('古い接続の失敗'));
    await oldStart;

    expect(connections.hasConnection('twitch')).toBe(true);
    expect(connections.state('twitch')).toBe('connected');
    await connections.stop('twitch');
  });

  it.each(['youtube', 'twitch', 'shitaraba'] as const)('停止済みの %s が遅れて通知しても、新しい取得と状態へ混入しない', async source => {
    const adapters: SourceCallbacks[] = [];
    const { connections, callbacks } = fixture(undefined, (source, _settings, sourceCallbacks) => {
      adapters.push(sourceCallbacks);
      return { source, start: async () => { sourceCallbacks.onStatus(createSourceStatus(source, 'connected')); },
        stop: async () => undefined };
    });
    await connections.start(source);
    await connections.stop(source);
    await connections.start(source);
    const comment = (source: CommentSource): IncomingComment => ({
      source, externalId: 'message', authorName: '視聴者',
      content: [{ type: 'text', text: 'メッセージ' }], initialHistory: false,
    });

    adapters[0].onStatus(createSourceStatus(source, 'error', '古い接続'));
    adapters[0].onComment(comment(source));
    adapters[0].onYouTubeVideo?.('old-video');
    adapters[0].onRawAuthor?.(source, 'old-author', '古い視聴者');
    adapters[0].onShitarabaBatch?.([comment(source)]);
    adapters[0].onShitarabaProgress?.(900);

    expect(connections.state(source)).toBe('connected');
    for (const callback of [callbacks.onComment, callbacks.onYouTubeVideo, callbacks.onRawAuthor,
      callbacks.onShitarabaBatch, callbacks.onShitarabaProgress]) {
      expect(callback).not.toHaveBeenCalled();
    }
    adapters[1].onComment(comment(source));
    adapters[1].onYouTubeVideo?.('current-video');
    adapters[1].onRawAuthor?.(source, 'current-author', '現在の視聴者');
    adapters[1].onShitarabaBatch?.([comment(source)]);
    adapters[1].onShitarabaProgress?.(1);
    expect(callbacks.onComment).toHaveBeenCalledOnce();
    expect(callbacks.onYouTubeVideo).toHaveBeenCalledWith('current-video');
    expect(callbacks.onRawAuthor).toHaveBeenCalledWith(source, 'current-author', '現在の視聴者');
    expect(callbacks.onShitarabaBatch).toHaveBeenCalledWith([comment(source)]);
    expect(callbacks.onShitarabaProgress).toHaveBeenCalledWith(1);
    await connections.stop(source);
  });
});
