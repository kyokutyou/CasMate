import { describe, expect, it } from 'vitest';
import { ShitarabaSource } from '../src/main/sources/shitaraba-source';
import type { SourceStatus } from '../src/main/sources/source-adapter';
import { YouTubeSource } from '../src/main/sources/youtube-source';
import type { IncomingComment } from '../src/shared/types';

describe('コメントソースの接続ライフサイクル', () => {
  it('YouTubeの一時的なHTTP障害はreconnectingとして再試行する', async () => {
    const statuses: SourceStatus[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new YouTubeSource(
      { kind: 'liveId', target: 'abcdefghijk' },
      { onStatus: (status) => statuses.push(status), onComment: () => undefined },
      {
        fetch: async () => new Response('', { status: 503 }),
        delay: async () => {
          await source.stop();
          complete();
        },
      },
    );

    await source.start();
    await done;

    expect(statuses.some((status) => status.state === 'reconnecting')).toBe(true);
    expect(statuses.some((status) => status.state === 'error')).toBe(false);
  });

  it('YouTubeの継続情報がない場合は再試行せずerrorになる', async () => {
    const statuses: SourceStatus[] = [];
    let delayCalls = 0;
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new YouTubeSource(
      { kind: 'liveId', target: 'abcdefghijk' },
      {
        onStatus: (status) => {
          statuses.push(status);
          if (status.state === 'error') complete();
        },
        onComment: () => undefined,
      },
      {
        fetch: async () => new Response(
          '{"INNERTUBE_API_KEY":"key","INNERTUBE_CLIENT_VERSION":"version"}',
        ),
        delay: async () => {
          delayCalls += 1;
          complete();
        },
      },
    );

    await source.start();
    await done;
    const observedStatuses = [...statuses];
    await source.stop();

    expect(observedStatuses.at(-1)).toMatchObject({
      state: 'error',
      message: 'ライブチャットの継続情報を取得できません。',
    });
    expect(observedStatuses.some((status) => status.state === 'reconnecting')).toBe(false);
    expect(delayCalls).toBe(0);
  });

  it('YouTubeチャンネルにライブ配信がない場合はwaitingで再確認する', async () => {
    const statuses: SourceStatus[] = [];
    const delays: number[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new YouTubeSource(
      { kind: 'channelId', target: 'UCabcdefghijabcdefghijab' },
      {
        onStatus: (status) => {
          statuses.push(status);
          if (status.state === 'error') complete();
        },
        onComment: () => undefined,
      },
      {
        fetch: async () => new Response(
          '<script>var ytInitialData = {"videoRenderer":{"videoId":"historical1","thumbnailOverlays":[]}};</script>',
        ),
        delay: async (milliseconds) => {
          delays.push(milliseconds);
          await source.stop();
          complete();
        },
      },
    );

    await source.start();
    await done;
    await source.stop();

    expect(statuses.some((status) => status.state === 'waiting')).toBe(true);
    expect(statuses.some((status) => status.state === 'error')).toBe(false);
    expect(delays).toEqual([30_000]);
  });

  it('YouTubeチャンネルページ上の別チャンネルのライブ配信へ接続しない', async () => {
    const statuses: SourceStatus[] = [];
    const requestedUrls: string[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new YouTubeSource(
      { kind: 'channelId', target: 'UCk6_d4MCUjsSBpoy1JUzLAw' },
      {
        onStatus: (status) => {
          statuses.push(status);
          if (status.state === 'error') complete();
        },
        onComment: () => undefined,
      },
      {
        fetch: async (input) => {
          requestedUrls.push(String(input));
          return new Response(
            '<link rel="canonical" href="https://www.youtube.com/channel/UCk6_d4MCUjsSBpoy1JUzLAw"><script>var ytInitialData = {"recommendations":{"videoRenderer":{"videoId":"otherLive01","thumbnailOverlays":[{"thumbnailOverlayTimeStatusRenderer":{"style":"LIVE"}}]}}};</script>',
          );
        },
        delay: async () => {
          await source.stop();
          complete();
        },
      },
    );

    await source.start();
    await done;

    expect(statuses.some((status) => status.state === 'waiting')).toBe(true);
    expect(requestedUrls).toEqual([
      'https://www.youtube.com/channel/UCk6_d4MCUjsSBpoy1JUzLAw/live',
    ]);
  });

  it('YouTubeチャンネル自身のライブ配信URLへ接続する', async () => {
    const requestedUrls: string[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new YouTubeSource(
      { kind: 'channelId', target: 'UCk6_d4MCUjsSBpoy1JUzLAw' },
      {
        onStatus: (status) => {
          if (status.state === 'error') complete();
        },
        onComment: () => undefined,
      },
      {
        fetch: async (input) => {
          const url = String(input);
          requestedUrls.push(url);
          if (url.endsWith('/live')) {
            return new Response(
              '<link href="https://www.youtube.com/watch?v=targetLive1" rel="canonical">',
            );
          }
          return new Response('');
        },
        delay: async () => undefined,
      },
    );

    await source.start();
    await done;
    await source.stop();

    expect(requestedUrls).toEqual([
      'https://www.youtube.com/channel/UCk6_d4MCUjsSBpoy1JUzLAw/live',
      'https://www.youtube.com/watch?v=targetLive1',
    ]);
  });

  it('YouTubeハンドルを1度だけ解決し未配信はwaitingで30秒ごとに再探索する', async () => {
    const statuses: SourceStatus[] = [];
    const requestedUrls: string[] = [];
    const delays: number[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new YouTubeSource(
      { kind: 'handle', target: '@kyokutyou2061' },
      { onStatus: (status) => statuses.push(status), onComment: () => undefined },
      {
        fetch: async (input) => {
          const url = String(input);
          requestedUrls.push(url);
          if (url === 'https://www.youtube.com/@kyokutyou2061') {
            return new Response('{"externalId":"UCk6_d4MCUjsSBpoy1JUzLAw"}');
          }
          return new Response(
            '<script>var ytInitialData = {"videoRenderer":{"videoId":"historical1","thumbnailOverlays":[]}};</script>',
          );
        },
        delay: async (milliseconds) => {
          delays.push(milliseconds);
          if (delays.length === 2) {
            await source.stop();
            complete();
          }
        },
      },
    );

    await source.start();
    await done;

    expect(statuses.some((status) => status.state === 'waiting')).toBe(true);
    expect(statuses.some((status) => status.state === 'error')).toBe(false);
    expect(delays).toEqual([30_000, 30_000]);
    expect(requestedUrls).toEqual([
      'https://www.youtube.com/@kyokutyou2061',
      'https://www.youtube.com/channel/UCk6_d4MCUjsSBpoy1JUzLAw/live',
      'https://www.youtube.com/channel/UCk6_d4MCUjsSBpoy1JUzLAw/live',
    ]);
  });

  it('YouTube再接続後の復元不能な先頭バッチを再び初回履歴として扱う', async () => {
    const comments: IncomingComment[] = [];
    let chatRequest = 0;
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const fetcher: typeof fetch = async (input) => {
      if (String(input).includes('/watch')) {
        return new Response('{"INNERTUBE_API_KEY":"key","INNERTUBE_CLIENT_VERSION":"version","continuation":"start"}');
      }
      chatRequest += 1;
      return Response.json({
        continuationContents: {
          liveChatContinuation: {
            actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: {
              id: `message-${chatRequest}`,
              authorName: { simpleText: 'Viewer' },
              message: { runs: [{ text: 'hello' }] },
            } } } }],
            continuations: [{ timedContinuationData: { continuation: 'next', timeoutMs: 1000 } }],
          },
        },
      });
    };
    const source = new YouTubeSource(
      { kind: 'liveId', target: 'abcdefghijk' },
      {
        onStatus: () => undefined,
        onComment: (comment) => {
          comments.push(comment);
          if (comments.length === 2) {
            void source.stop();
            complete();
          }
        },
      },
      { fetch: fetcher, delay: async () => { throw new Error('network reset'); } },
    );

    await source.start();
    await done;

    expect(comments.map((comment) => comment.initialHistory)).toEqual([true, true]);
  });

  it('したらばは初回取得だけを履歴、次回ポーリングを新着として扱い停止できる', async () => {
    const comments: IncomingComment[] = [];
    let requestCount = 0;
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new ShitarabaSource(
      { category: 'game', boardId: '1', threadId: '2', url: 'https://jbbs.shitaraba.net/' },
      {
        onStatus: () => undefined,
        onComment: (comment) => {
          comments.push(comment);
          if (comments.length === 2) {
            void source.stop();
            complete();
          }
        },
      },
      {
        fetch: async () => {
          requestCount += 1;
          return new Response(`${requestCount}<>Viewer<>sage<>date<>message${requestCount}<>title\n`);
        },
        delay: async () => undefined,
      },
    );

    await source.start();
    await done;

    expect(comments.map((comment) => comment.initialHistory)).toEqual([true, false]);
  });

  it('したらばは設定した秒数を次回取得までの待機時間に使う', async () => {
    const delays: number[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new ShitarabaSource(
      { category: 'game', boardId: '1', threadId: '2', url: 'https://jbbs.shitaraba.net/' },
      { onStatus: () => undefined, onComment: () => undefined },
      {
        fetch: async () => new Response('1<>Viewer<>sage<>date<>message<>title\n'),
        delay: async (milliseconds) => {
          delays.push(milliseconds);
          await source.stop();
          complete();
        },
      },
      12,
    );

    await source.start();
    await done;

    expect(delays).toEqual([12_000]);
  });

  it('したらばは変換できない行を含む最大レス番号を公開コールバックへ渡す', async () => {
    const positions: number[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new ShitarabaSource(
      { category: 'game', boardId: '1', threadId: '2', url: 'https://jbbs.shitaraba.net/' },
      {
        onStatus: () => undefined,
        onComment: () => undefined,
        onShitarabaProgress: (maximum) => {
          positions.push(maximum);
          void source.stop();
          complete();
        },
      },
      {
        fetch: async () => new Response('100<>Viewer<>sage<>date<><>title\n'),
        delay: async () => undefined,
      },
    );

    await source.start();
    await done;

    expect(positions).toEqual([100]);
  });

  it('したらばは取得失敗時も設定間隔より早く再試行しない', async () => {
    const delays: number[] = [];
    const statuses: SourceStatus[] = [];
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new ShitarabaSource(
      { category: 'game', boardId: '1', threadId: '2', url: 'https://jbbs.shitaraba.net/' },
      { onStatus: (status) => statuses.push(status), onComment: () => undefined },
      {
        fetch: async () => new Response('', { status: 503 }),
        delay: async (milliseconds) => {
          delays.push(milliseconds);
          await source.stop();
          complete();
        },
      },
      60,
    );

    await source.start();
    await done;

    expect(delays).toEqual([60_000]);
    expect(statuses.some((status) => status.state === 'reconnecting')).toBe(true);
    expect(statuses.some((status) => status.state === 'error')).toBe(false);
  });

  it('したらばの恒久的なHTTPエラーは再試行せずerrorになる', async () => {
    const statuses: SourceStatus[] = [];
    let delayCalls = 0;
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    const source = new ShitarabaSource(
      { category: 'game', boardId: '1', threadId: '2', url: 'https://jbbs.shitaraba.net/' },
      {
        onStatus: (status) => {
          statuses.push(status);
          if (status.state === 'error') complete();
        },
        onComment: () => undefined,
      },
      {
        fetch: async () => new Response('', { status: 404 }),
        delay: async () => {
          delayCalls += 1;
          complete();
        },
      },
    );

    await source.start();
    await done;
    const observedStatuses = [...statuses];
    await source.stop();

    expect(observedStatuses.at(-1)).toMatchObject({ state: 'error', message: 'したらば HTTP 404' });
    expect(observedStatuses.some((status) => status.state === 'reconnecting')).toBe(false);
    expect(delayCalls).toBe(0);
  });
});
