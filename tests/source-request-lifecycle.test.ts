import { beforeAll, describe, expect, it, vi } from 'vitest';
import { abortableDelay } from '../src/main/sources/abortable-delay';
import { JpnknSource, parseJpnknDat } from '../src/main/sources/jpnkn-source';
import { ShitarabaSource } from '../src/main/sources/shitaraba-source';
import type { CommentSourceAdapter, SourceCallbacks, SourceStatus } from '../src/main/sources/source-adapter';
import { normalizeJpnknInput } from '../src/main/sources/source-inputs';
import { YouTubeSource } from '../src/main/sources/youtube-source';

const watchPage = '{"INNERTUBE_API_KEY":"key","INNERTUBE_CLIENT_VERSION":"version","continuation":"start"}';
function chatResponse(text: string): Response {
  return Response.json({ continuationContents: { liveChatContinuation: {
    actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: {
      id: text, authorName: { simpleText: 'Viewer' }, message: { runs: [{ text }] },
    } } } }],
    continuations: [{ timedContinuationData: { continuation: 'next', timeoutMs: 30_000 } }],
  } } });
}

interface SourceCase {
  name: string;
  retryWait: number;
  lateBody: string;
  make(callbacks: SourceCallbacks, fetcher: typeof fetch): CommentSourceAdapter;
  response(input: string | URL | Request): Response;
  emptyResponse(input: string | URL | Request): Response;
}
const cases: SourceCase[] = [
  {
    name: 'YouTube', retryWait: 2_000, lateBody: watchPage,
    make: (callbacks, fetcher) => new YouTubeSource({ kind: 'liveId', target: 'abcdefghijk' },
      callbacks, { fetch: fetcher, delay: abortableDelay }),
    response: input => String(input).includes('/watch') ? new Response(watchPage) : chatResponse('new'),
    emptyResponse: input => String(input).includes('/watch') ? new Response(watchPage) : Response.json({
      continuationContents: { liveChatContinuation: { actions: [],
        continuations: [{ timedContinuationData: { continuation: 'next', timeoutMs: 30_000 } }],
      } },
    }),
  },
  {
    name: 'したらば', retryWait: 5_000, lateBody: '1<>Viewer<>sage<>date<>late<>title\n',
    make: (callbacks, fetcher) => new ShitarabaSource({ category: 'game', boardId: '1', threadId: '2',
      url: 'https://jbbs.shitaraba.net/' }, callbacks, { fetch: fetcher, delay: abortableDelay }),
    response: () => new Response('1<>Viewer<>sage<>date<>new<>title\n'),
    emptyResponse: () => new Response(''),
  },
  {
    name: 'jpnkn', retryWait: 5_000, lateBody: 'Viewer<>sage<>date<>late<>title\n',
    make: (callbacks, fetcher) => new JpnknSource(normalizeJpnknInput('https://bbs.jpnkn.com/test/read.cgi/testboard/123/'),
      callbacks, { fetch: fetcher, delay: abortableDelay }),
    response: () => new Response(new TextEncoder().encode('Viewer<>sage<>date<>new<>title\n'),
      { headers: { 'content-type': 'text/plain; charset=Shift_JIS' } }),
    emptyResponse: () => new Response(new Uint8Array(), { headers: { 'content-type': 'text/plain; charset=Shift_JIS' } }),
  },
];

function pendingBody() {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start: controller => { body = controller; } }));
  return { response, complete: (text: string) => { body.enqueue(new TextEncoder().encode(text)); body.close(); } };
}

function pendingCancellation(status: number) {
  let complete!: () => void;
  const cancelled = new Promise<void>(resolve => { complete = resolve; });
  const cancel = vi.fn(() => cancelled);
  const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { status });
  return { response, cancel, complete };
}

describe('コメント取得要求の応答期限と停止', () => {
  beforeAll(async () => {
    // Prepare the asynchronous entity decoder before advancing request deadlines.
    await parseJpnknDat(new Uint8Array(), true);
  });

  it.each([416, 500, 404])('jpnknはHTTP %i本文の取消待ちでも停止で元要求を中止し、後続取得を始めない', async status => {
    vi.useFakeTimers();
    const body = pendingCancellation(status);
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      signals.push(init?.signal);
      return signals.length === 1 ? body.response : cases[2].response('');
    });
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const onBoardBatch = vi.fn();
    const source = cases[2].make({ onStatus: status => statuses.push(status), onComment, onBoardBatch }, fetcher);
    try {
      await source.start(); await vi.advanceTimersByTimeAsync(1_000);
      await source.stop(); await vi.advanceTimersByTimeAsync(0);
      expect(signals[0]?.aborted).toBe(true);
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      body.complete(); await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher).toHaveBeenCalledOnce(); expect(onComment).not.toHaveBeenCalled();
      expect(onBoardBatch).not.toHaveBeenCalled(); expect(statuses.at(-1)?.state).toBe('stopped');
      expect(statuses.some(status => status.state === 'reconnecting')).toBe(false);
    } finally { body.complete(); await source.stop(); vi.useRealTimers(); }
  });

  it.each([416, 500, 404])('jpnknはHTTP %i本文の取消待ちも要求開始から30秒で中止し、遅い取消完了を無視する', async status => {
    vi.useFakeTimers();
    const body = pendingCancellation(status);
    let headersComplete!: (response: Response) => void;
    const headers = new Promise<Response>(resolve => { headersComplete = resolve; });
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      signals.push(init?.signal);
      return signals.length === 1 ? headers : cases[2].response('');
    });
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn(); const onBoardBatch = vi.fn();
    const source = cases[2].make({ onStatus: current => statuses.push(current), onComment, onBoardBatch }, fetcher);
    try {
      await source.start(); await vi.advanceTimersByTimeAsync(20_000);
      headersComplete(body.response); await vi.advanceTimersByTimeAsync(9_999);
      expect(body.cancel).toHaveBeenCalledOnce(); expect(signals[0]?.aborted).toBe(false);
      expect(fetcher).toHaveBeenCalledOnce(); expect(statuses.at(-1)?.state).toBe('connecting');
      await vi.advanceTimersByTimeAsync(1);
      expect(signals[0]?.aborted).toBe(true); expect(statuses.at(-1)?.state).toBe('reconnecting');
      body.complete(); await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledOnce(); expect(onBoardBatch).not.toHaveBeenCalled(); expect(onComment).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetcher).toHaveBeenCalledTimes(2); expect(statuses.at(-1)?.state).toBe('connected');
      expect(onComment).toHaveBeenCalledOnce(); expect(onBoardBatch).toHaveBeenCalledOnce();
      expect(onComment.mock.calls[0][0]).toMatchObject({ initialHistory: true, content: [{ type: 'text', text: 'new' }] });
      await source.stop(); await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    } finally { body.complete(); await source.stop(); vi.useRealTimers(); }
  });

  it.each([416, 500, 404])('jpnknはHTTP %iの本文取消後に全文復旧・再試行・恒久エラーを判定する', async status => {
    vi.useFakeTimers();
    const body = pendingCancellation(status);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(body.response).mockImplementation(async () => cases[2].response(''));
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const source = cases[2].make({ onStatus: current => statuses.push(current), onComment }, fetcher);
    try {
      await source.start(); await vi.advanceTimersByTimeAsync(0);
      expect(body.cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
      body.complete(); await vi.advanceTimersByTimeAsync(0);
      if (status === 404) {
        expect(statuses.at(-1)?.state).toBe('error');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetcher).toHaveBeenCalledOnce(); expect(onComment).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
      } else {
        if (status === 500) {
          expect(statuses.at(-1)?.state).toBe('reconnecting'); expect(fetcher).toHaveBeenCalledOnce();
          await vi.advanceTimersByTimeAsync(4_999); expect(fetcher).toHaveBeenCalledOnce();
          await vi.advanceTimersByTimeAsync(1);
        }
        expect(statuses.at(-1)?.state).toBe('connected'); expect(fetcher).toHaveBeenCalledTimes(2);
        expect(onComment).toHaveBeenCalledOnce();
      }
      expect(body.cancel).toHaveBeenCalledOnce();
    } finally { body.complete(); await source.stop(); vi.useRealTimers(); }
  });

  it.each([416, 500, 404])('jpnknはHTTP %i本文が既にエラーでも受信済みステータスによる判定を維持する', async status => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream<Uint8Array>({ start: body => { body.error(new Error('body disconnected')); } }), { status });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response).mockImplementation(async () => cases[2].response(''));
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const source = cases[2].make({ onStatus: current => statuses.push(current), onComment }, fetcher);
    try {
      await source.start(); await vi.advanceTimersByTimeAsync(0);
      if (status === 404) {
        expect(statuses.at(-1)?.state).toBe('error');
        expect(statuses.at(-1)?.message).toBe('jpnkn HTTP 404');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetcher).toHaveBeenCalledOnce(); expect(onComment).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
      } else {
        if (status === 500) {
          expect(statuses.at(-1)?.state).toBe('reconnecting'); expect(statuses.at(-1)?.message).toBe('jpnkn HTTP 500');
          expect(fetcher).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(5_000);
        }
        expect(statuses.at(-1)?.state).toBe('connected'); expect(fetcher).toHaveBeenCalledTimes(2);
        expect(onComment).toHaveBeenCalledOnce();
      }
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it.each(cases)('$nameは期限前の停止で本文受信と期限タイマーを解除する', async sourceCase => {
    vi.useFakeTimers();
    const body = pendingBody();
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      requestSignal = init?.signal;
      return body.response;
    });
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const source = sourceCase.make({ onStatus: status => statuses.push(status), onComment }, fetcher);
    try {
      await source.start();
      await vi.advanceTimersByTimeAsync(1_000);
      await source.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(requestSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      body.complete(sourceCase.lateBody);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onComment).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(statuses.at(-1)?.state).toBe('stopped');
      expect(statuses.some(status => status.state === 'reconnecting')).toBe(false);
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it.each(cases)('$nameは正常な新着なし応答を繰り返しても接続を保つ', async sourceCase => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => sourceCase.emptyResponse(input));
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const source = sourceCase.make({ onStatus: status => statuses.push(status), onComment }, fetcher);
    try {
      await source.start();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(statuses.at(-1)?.state).toBe('connected');
      expect(statuses.some(status => status.state === 'reconnecting')).toBe(false);
      expect(onComment).not.toHaveBeenCalled();
      expect(fetcher.mock.calls.length).toBeGreaterThan(1);
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it.each(cases)('$nameのヘッダー無応答を30秒で中止し、停止後の遅い応答を受理しない', async sourceCase => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null | undefined;
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { complete = resolve; });
    const fetcher: typeof fetch = async (_input, init) => { requestSignal = init?.signal; return pending; };
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const onYouTubeVideo = vi.fn();
    const onBoardBatch = vi.fn();
    const source = sourceCase.make({ onStatus: status => statuses.push(status), onComment, onYouTubeVideo, onBoardBatch }, fetcher);
    try {
      await source.start();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(statuses.at(-1)?.state).toBe('connecting');
      const videoNotifications = onYouTubeVideo.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1);
      expect(statuses.at(-1)?.state).toBe('reconnecting');
      expect(requestSignal?.aborted).toBe(true);
      await source.stop();
      complete(new Response(sourceCase.lateBody));
      await vi.advanceTimersByTimeAsync(0);
      expect(onComment).not.toHaveBeenCalled();
      expect(onYouTubeVideo).toHaveBeenCalledTimes(videoNotifications);
      expect(onBoardBatch).not.toHaveBeenCalled();
      expect(statuses.at(-1)?.state).toBe('stopped');
      expect(vi.getTimerCount()).toBe(0);
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it.each(cases)('$nameはヘッダーを20秒で受け取っても本文完了の総期限を30秒から延ばさない', async sourceCase => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null | undefined;
    let completeHeaders!: (response: Response) => void;
    const headers = new Promise<Response>(resolve => { completeHeaders = resolve; });
    const body = pendingBody();
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const fetcher: typeof fetch = async (_input, init) => { requestSignal = init?.signal; return headers; };
    const source = sourceCase.make({ onStatus: status => statuses.push(status), onComment }, fetcher);
    try {
      await source.start();
      await vi.advanceTimersByTimeAsync(20_000);
      completeHeaders(body.response);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(statuses.at(-1)?.state).toBe('connecting');
      await vi.advanceTimersByTimeAsync(1);
      expect(statuses.at(-1)?.state).toBe('reconnecting');
      expect(requestSignal?.aborted).toBe(true);
      await source.stop();
      body.complete(sourceCase.lateBody);
      await vi.advanceTimersByTimeAsync(0);
      expect(onComment).not.toHaveBeenCalled();
      expect(statuses.at(-1)?.state).toBe('stopped');
      expect(vi.getTimerCount()).toBe(0);
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it.each(cases)('$nameは本文停止から次の取得で復旧し、期限超過した本文の後着を無視する', async sourceCase => {
    vi.useFakeTimers();
    const body = pendingBody();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(body.response).mockImplementation(async input => sourceCase.response(input));
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const source = sourceCase.make({ onStatus: status => statuses.push(status), onComment }, fetcher);
    try {
      await source.start();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(statuses.at(-1)?.state).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(sourceCase.retryWait);
      expect(statuses.at(-1)?.state).toBe('connected');
      expect(onComment).toHaveBeenCalledOnce();
      expect(onComment.mock.calls[0][0]).toMatchObject({ initialHistory: true, content: [{ type: 'text', text: 'new' }] });
      const count = fetcher.mock.calls.length;
      body.complete(sourceCase.lateBody);
      await vi.advanceTimersByTimeAsync(0);
      expect(onComment).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledTimes(count);
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it('YouTubeのチャットJSON本文も30秒で中止し、明示停止後に復旧しない', async () => {
    vi.useFakeTimers();
    const body = pendingBody();
    let chatSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (String(input).includes('/watch')) return new Response(watchPage);
      chatSignal = init?.signal;
      return body.response;
    });
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const source = cases[0].make({ onStatus: status => statuses.push(status), onComment }, fetcher);
    try {
      await source.start();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(statuses.at(-1)?.state).toBe('connected');
      await vi.advanceTimersByTimeAsync(1);
      expect(statuses.at(-1)?.state).toBe('reconnecting');
      expect(chatSignal?.aborted).toBe(true);
      await source.stop();
      body.complete(await chatResponse('late').text());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onComment).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(statuses.at(-1)?.state).toBe('stopped');
    } finally { await source.stop(); vi.useRealTimers(); }
  });
});
