import { afterEach, describe, expect, it, vi } from 'vitest';
import { PollController } from '../src/main/poll/poll-controller';
import { emptyPollData } from '../src/main/poll/poll-store';
import { PollPublication, type PollPublicationServer } from '../src/main/poll/poll-publication';
import { canonicalSrvUrl, type TunnelCallbacks } from '../src/main/poll/srv-us-tunnel';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); });
async function fixture(verify = vi.fn(async () => true)) {
  const save = vi.fn(async () => undefined);
  const polls = new PollController({ load: async () => emptyPollData(), save }); await polls.initialize();
  const server: PollPublicationServer = { host: null, online: false, nonce: 'nonce', start: vi.fn(async () => 54321), stop: vi.fn(async () => undefined), disconnect: vi.fn(() => { server.online = false; }) };
  let callbacks: TunnelCallbacks;
  const close = vi.fn(async () => undefined), open = vi.fn(async (_port: number, events: TunnelCallbacks) => { callbacks = events; return { close }; });
  const publication = new PollPublication(polls, server, { open }, verify);
  cleanups.push(async () => { await publication.stop(); await polls.shutdown(); });
  return { polls, publication, server, close, open, events: () => callbacks!, verify, save };
}
const url = `https://${'a'.repeat(26)}.srv.us/`;
describe('srv.us publication lifecycle', () => {
  it('confirms the endpoint nonce before announcing online', async () => {
    const f = await fixture(); await f.publication.start(); expect(f.publication.view().status).toBe('starting');
    f.events().url(url); await vi.waitFor(() => expect(f.publication.view().status).toBe('online'));
    expect(f.verify).toHaveBeenCalledWith(url, 'nonce', expect.any(AbortSignal)); expect(f.server.online).toBe(true);
  });
  it('ignores unrelated domains and never treats URL issuance as readiness', async () => {
    const f = await fixture(vi.fn(async () => false)); await f.publication.start();
    f.events().url('https://evil.example/'); expect(f.server.host).toBeNull();
    f.events().url(url); await Promise.resolve(); expect(f.publication.view().status).toBe('starting');
    expect(canonicalSrvUrl('https://a.srv.us.evil.example/')).toBeNull();
  });
  it('reconnects with bounded backoff and rejects late readiness after stop', async () => {
    vi.useFakeTimers(); const f = await fixture(); await f.publication.start(); f.events().url(url); await Promise.resolve(); await Promise.resolve();
    f.events().disconnected('切断', false); expect(f.server.online).toBe(false); expect(f.publication.view().status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000); expect(f.open).toHaveBeenCalledTimes(2);
    const stale = f.events(); await f.publication.stop(); stale.url(url); await vi.advanceTimersByTimeAsync(60_000);
    expect(f.open).toHaveBeenCalledTimes(2); expect(f.server.online).toBe(false); expect(f.publication.view().status).toBe('off');
  });
  it('stops on changed host keys without automatic retries', async () => {
    vi.useFakeTimers(); const f = await fixture(); await f.publication.start(); f.events().disconnected('ホスト鍵変更', true);
    await vi.advanceTimersByTimeAsync(120_000); expect(f.open).toHaveBeenCalledTimes(1); expect(f.publication.view().status).toBe('error');
  });
  it('closes an open poll on explicit publication stop', async () => {
    const f = await fixture(); await f.polls.draft({ question: 'お題', options: ['A', 'B'], durationMinutes: null }); await f.polls.start();
    await f.publication.stop(); expect(f.polls.view().current?.closeReason).toBe('publicationStopped');
  });
  it('does not resurrect publication when verification completes after stop', async () => {
    let resolve!: (ok: boolean) => void;
    const f = await fixture(vi.fn(() => new Promise<boolean>(done => { resolve = done; })));
    await f.publication.start(); f.events().url(url); await f.publication.stop(); resolve(true); await Promise.resolve();
    expect(f.publication.view().status).toBe('off'); expect(f.server.online).toBe(false);
  });
  it('serializes a pending server start, duplicate stops and the next start without closing a new generation', async () => {
    const f = await fixture(); let finish!: (port: number) => void;
    vi.mocked(f.server.start).mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
    const first = f.publication.start(); await Promise.resolve();
    expect(f.publication.start()).toBe(first);
    const stop = f.publication.stop(); expect(f.publication.stop()).toBe(stop);
    expect(f.publication.view().status).toBe('stopping');
    const next = f.publication.start(); expect(f.server.start).toHaveBeenCalledTimes(1);
    finish(12345); await Promise.all([first, stop, next]);
    expect(f.server.start).toHaveBeenCalledTimes(2); expect(f.server.stop).toHaveBeenCalledTimes(1);
    expect(f.open).toHaveBeenCalledTimes(1); expect(f.publication.view().status).toBe('starting');
  });
  it('cancels start called immediately before stop, including its initial microtask', async () => {
    const f = await fixture(); const starting = f.publication.start(); await f.publication.stop(); await starting;
    expect(f.server.start).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled();
    expect(f.publication.view().status).toBe('off');
  });
  it('handles a save rejection immediately while tunnel closure is delayed', async () => {
    const f = await fixture(); await f.publication.start();
    let finish!: () => void; f.close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    f.save.mockRejectedValueOnce(new Error('disk full')); const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
    const stop = f.publication.stop();
    try { await new Promise<void>(resolve => setImmediate(resolve)); expect(unhandled).not.toHaveBeenCalled(); }
    finally { finish(); await stop; process.off('unhandledRejection', unhandled); }
    expect(f.publication.view()).toMatchObject({ status: 'error', message: expect.stringContaining('保存できません') });
  });
  it('marks stopping before accepting another queued poll start and reports key-cleanup failures', async () => {
    const f = await fixture(); await f.publication.start(); f.events().url(url);
    await vi.waitFor(() => expect(f.publication.view().status).toBe('online'));
    await f.polls.draft({ question: 'お題', options: ['A', 'B'], durationMinutes: null }); await f.polls.start();
    f.close.mockRejectedValueOnce(new Error('runtime key deletion denied'));
    const stop = f.publication.stop();
    await expect(f.polls.start(() => f.publication.view().status === 'online')).rejects.toMatchObject({ code: 'POLL_NOT_PUBLISHED' });
    await stop; expect(f.polls.view().current?.closedAt).not.toBeNull();
    expect(f.publication.view()).toMatchObject({ status: 'error', message: expect.stringContaining('接続鍵') });
    await f.publication.start(); expect(f.publication.view().status).toBe('starting');
  });
  it.each([false, true])('waits for disconnected tunnel cleanup even if manual stop cancels retry (failure=%s)', async failure => {
    const f = await fixture(); await f.publication.start();
    let finish!: () => void;
    f.close.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = () => failure ? reject(new Error('cleanup denied')) : resolve(); }));
    f.events().disconnected('切断', false); let resolved = false;
    const stop = f.publication.stop().then(() => { resolved = true; });
    try { await new Promise<void>(resolve => setImmediate(resolve)); expect(resolved).toBe(false); }
    finally { finish(); await stop; }
    expect(f.publication.view().status).toBe(failure ? 'error' : 'off'); expect(f.close).toHaveBeenCalledOnce();
  });
  it.each([false, true])('tracks a tunnel returned after startup cancellation (cleanup failure=%s)', async failure => {
    const f = await fixture(); let finish!: (tunnel: { close(): Promise<void> }) => void;
    f.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = f.publication.start(); await Promise.resolve(); await Promise.resolve();
    const stop = f.publication.stop();
    const close = vi.fn(async () => { if (failure) throw new Error('late cleanup denied'); });
    finish({ close }); await Promise.all([first, stop]);
    expect(close).toHaveBeenCalledOnce(); expect(f.publication.view().status).toBe(failure ? 'error' : 'off');
  });
});
