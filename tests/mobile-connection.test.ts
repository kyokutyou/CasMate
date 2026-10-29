// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { MobileBrowserConnection, MobileCommentFeed } from '../src/renderer/mobile/mobile-connection';
import type { MobileCommentsBootstrap } from '../src/shared/types';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('half-open接続のclose完了を待たず4秒で音声を解放し、0.5秒後に再接続する', () => {
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onclose: ((event: { code: number }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    sent: string[] = [];
    constructor() { sockets.push(this); }
    close() { this.readyState = 2; }
    send(value: string) { this.sent.push(value); }
    hello(id: string) { this.onmessage?.({ data: JSON.stringify({ type: 'mobile.hello', connectionId: id, payload: { protocolVersion: 2 } }) }); }
  }
  vi.stubGlobal('WebSocket', Socket);
  const connected = vi.fn(); const discard = vi.fn();
  const connection = new MobileBrowserConnection({ connected, discard, comments: vi.fn(), audio: vi.fn(), available: vi.fn(), error: vi.fn() });
  connection.start(); sockets[0]!.hello('first');
  vi.advanceTimersByTime(4000);
  expect(connected).toHaveBeenLastCalledWith(false); expect(discard).toHaveBeenCalled();
  vi.advanceTimersByTime(500); expect(sockets).toHaveLength(2);
  sockets[1]!.hello('second');
  sockets[0]!.onclose?.({ code: 1006 });
  expect(connected).toHaveBeenLastCalledWith(true);
  connection.close(); vi.advanceTimersByTime(10000); expect(sockets).toHaveLength(2);
});

it('履歴分割の途中に届いた新着・削除をrevision順に反映し、旧世代の断片を無視する', () => {
  let state: MobileCommentsBootstrap | undefined;
  const feed = new MobileCommentFeed(value => { state = value; });
  const send = (type: string, payload: Record<string, unknown>, revision = 10, generation = 2) =>
    feed.receive({ type, payload, revision, generation, connectionId: 'current' });
  send('mobile.snapshotBegin', { protocolVersion: 2 });
  send('mobile.snapshotChunk', { comments: [{ id: 'one' }, { id: 'two' }] });
  send('comment.received', { id: 'stale' }, 9);
  send('comment.received', { id: 'three' }, 11);
  send('comment.removed', { id: 'one' }, 12);
  send('mobile.snapshotChunk', { comments: [{ id: 'old-generation' }] }, 10, 1);
  send('mobile.snapshotEnd', {});
  expect(state?.comments.map(comment => comment.id)).toEqual(['two', 'three']);
});
