import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectCommentAssets } from '../src/main/smartphone/direct-assets';

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:https', () => ({ request: network.request }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.resetAllMocks(); });

function fixture() {
  const assets = new DirectCommentAssets();
  const comment = assets.project({ id: 'one', externalId: 'one', sequence: 1, source: 'twitch', authorName: 'viewer',
    receivedAt: new Date().toISOString(), content: [{ type: 'emote', alt: ':wave:', url: 'https://static-cdn.jtvnw.net/emote.png' }] });
  const part = comment.content[0]!;
  if (part.type !== 'emote') throw new Error('Expected projected emote');
  return { assets, id: part.url.split('/').at(-1)! };
}
function controlledDeadline() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(new DOMException('deadline', 'TimeoutError')), milliseconds);
    return abort.signal;
  });
}
it('DNSが停止しても取得全体を5秒で終了し、遅延DNSからHTTPSを開始しない', async () => {
  controlledDeadline(); const { assets, id } = fixture();
  let finish!: (value: Array<{ address: string; family: number }>) => void;
  network.lookup.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let status = 'pending'; const pending = assets.get(id).then(() => { status = 'resolved'; }, () => { status = 'rejected'; });
  await vi.advanceTimersByTimeAsync(4999); expect(status).toBe('pending');
  await vi.advanceTimersByTimeAsync(1); expect(status).toBe('rejected');
  finish([{ address: '8.8.8.8', family: 4 }]); await pending; await vi.advanceTimersByTimeAsync(0);
  expect(network.request).not.toHaveBeenCalled();
});
it('DNS待機中の呼出元取消でも終了し、後のDNS成功を採用しない', async () => {
  const { assets, id } = fixture(); let finish!: (value: Array<{ address: string; family: number }>) => void;
  network.lookup.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const abort = new AbortController(); let status = 'pending';
  const pending = assets.get(id, abort.signal).then(() => { status = 'resolved'; }, () => { status = 'rejected'; });
  abort.abort(); await new Promise(resolve => setTimeout(resolve, 10));
  expect(status).toBe('rejected'); finish([{ address: '8.8.8.8', family: 4 }]);
  await pending; await new Promise(resolve => setTimeout(resolve, 0)); expect(network.request).not.toHaveBeenCalled();
});
it('DNSに4秒かかってもHTTPSに新しい5秒を与えず、開始から5秒で取消する', async () => {
  controlledDeadline(); const { assets, id } = fixture();
  network.lookup.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([{ address: '8.8.8.8', family: 4 }]), 4000)));
  let signal!: AbortSignal;
  network.request.mockImplementation((_url, options) => {
    signal = options.signal;
    const req = new EventEmitter(); Object.assign(req, { end: () => undefined });
    signal.addEventListener('abort', () => req.emit('error', signal.reason), { once: true });
    return req;
  });
  let status = 'pending'; const pending = assets.get(id).then(() => { status = 'resolved'; }, () => { status = 'rejected'; });
  await vi.advanceTimersByTimeAsync(4000); expect(network.request).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(999); expect(status).toBe('pending');
  await vi.advanceTimersByTimeAsync(1); expect(status).toBe('rejected'); expect(signal.aborted).toBe(true); await pending;
});
