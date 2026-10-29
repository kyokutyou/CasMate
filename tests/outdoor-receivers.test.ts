import { describe, expect, it, vi } from 'vitest';
import { OutdoorReceivers, ReceiverOwnership, type ReceiverConfig, type ReceiverWorkerFactory } from '../src/main/outdoor/outdoor-receivers';
import type { OutdoorReceiverSample } from '../src/shared/outdoor';

const sample: OutdoorReceiverSample = { version: 1, state: 'receiving', sessionId: '12345678-1234-1234-1234-123456789abc',
  generation: 2, receivedBytes: 1316, videoFrames: 1, audioFrames: 4, videoPts: 90000, audioPts: 91000, lostPackets: 0, droppedPackets: 0 };
const config = (id: string, port: number): ReceiverConfig => ({ id, network: 'lan', address: '192.168.1.2', port, localPort: port + 1, passphrase: 'a'.repeat(32) });

describe('端末別ネイティブ受信の所有と鮮度', () => {
  function setup() {
    let now = 1000;
    const workers: { change: (value: OutdoorReceiverSample) => void; fail: () => void; close: ReturnType<typeof vi.fn> }[] = [];
    const factory: ReceiverWorkerFactory = vi.fn((_c, change, fail) => {
      const worker = { change, fail, close: vi.fn(async () => undefined) }; workers.push(worker); return worker;
    });
    const receivers = new OutdoorReceivers(factory, () => now);
    return { receivers, workers, advance: (ms: number) => { now += ms; } };
  }
  it('他端末を止めず対象だけ再起動し、古いワーカーのイベントを無視する', async () => {
    const { receivers, workers } = setup(); const a = config('A', 10000), b = config('B', 10002);
    await receivers.sync([a, b]); workers[0].change(sample); workers[1].change(sample);
    await receivers.sync([{ ...a, passphrase: 'b'.repeat(32) }, b]);
    expect(workers[0].close).toHaveBeenCalledOnce(); expect(workers[1].close).not.toHaveBeenCalled();
    workers[0].change(sample); expect(receivers.feedback('A', sample.sessionId!, 2)).toBeNull();
    expect(receivers.feedback('B', sample.sessionId!, 2)).toEqual(sample);
    await receivers.sync([]); expect(workers[1].close).toHaveBeenCalledOnce(); expect(workers[2].close).toHaveBeenCalledOnce();
  });
  it('欠測・違う世代・応答停止は受信成功とせず、故障した端末だけ再試行する', async () => {
    const { receivers, workers, advance } = setup(); const a = config('A', 10000);
    await receivers.sync([a]); workers[0].change(sample);
    expect(receivers.feedback('A', sample.sessionId!, 1)).toBeNull();
    advance(1100); expect(receivers.feedback('A', sample.sessionId!, 2)).toBeNull();
    workers[0].fail(); expect(receivers.view('A').state).toBe('error');
    await receivers.sync([a]); expect(workers).toHaveLength(1);
    advance(2000); await receivers.sync([a]); expect(workers).toHaveLength(2);
    await receivers.stop();
  });
  it('終了時は遅い端末を待つ前に全受信へ停止を要求し、全端末の終了を待つ', async () => {
    const { receivers, workers } = setup();
    await receivers.sync([config('A', 10000), config('B', 10002)]);
    let finishFirst!: () => void; let finishSecond!: () => void;
    const firstClosed = new Promise<void>(resolve => { finishFirst = resolve; });
    const secondClosed = new Promise<void>(resolve => { finishSecond = resolve; });
    workers[0].close.mockImplementation(() => firstClosed);
    workers[1].close.mockImplementation(() => secondClosed);
    let stopped = false;
    const stop = receivers.stop().then(() => { stopped = true; });
    try {
      expect(workers[0].close).toHaveBeenCalledOnce();
      expect(workers[1].close).toHaveBeenCalledOnce();
      expect(receivers.view('A').state).toBe('stopped');
      expect(receivers.view('B').state).toBe('stopped');
      workers[0].change(sample); workers[1].change(sample);
      expect(receivers.feedback('A', sample.sessionId!, 2)).toBeNull();
      expect(receivers.feedback('B', sample.sessionId!, 2)).toBeNull();
      finishFirst(); await Promise.resolve();
      expect(stopped).toBe(false);
      finishSecond(); await stop;
      expect(stopped).toBe(true);
    } finally { finishFirst(); finishSecond(); await stop; }
  });
  it.each(['reject', 'throw'])('終了の%sが他端末の停止要求や終了待機を妨げない', async failure => {
    const { receivers, workers } = setup();
    await receivers.sync([config('A', 10000), config('B', 10002), config('C', 10004)]);
    workers[0].close.mockImplementation(() => {
      if (failure === 'throw') throw new Error('受信停止の失敗');
      return Promise.reject(new Error('受信停止の失敗'));
    });
    let finishSecond!: () => void;
    workers[1].close.mockImplementation(() => new Promise<void>(resolve => { finishSecond = resolve; }));
    let stopped = false;
    const stop = receivers.stop().then(() => { stopped = true; });
    try {
      for (const worker of workers) expect(worker.close).toHaveBeenCalledOnce();
      await Promise.resolve();
      expect(stopped).toBe(false);
      finishSecond(); await stop;
      expect(stopped).toBe(true);
    } finally { finishSecond(); await stop; }
  });
  it('直接接続の待受候補変更は健全な受信を再起動せず、ネイティブの接続世代を識別する', async () => {
    let change!: (sample: OutdoorReceiverSample) => void;
    const worker = { close: vi.fn(async () => undefined), update: vi.fn() };
    const receivers = new OutdoorReceivers((_config, onChange) => { change = onChange; return worker; });
    const first: ReceiverConfig = { ...config('direct', 10000), network: 'direct', listeners: [{ family: 'ipv4', address: '192.168.1.2', port: 10000 }] };
    await receivers.sync([first]); change({ ...sample, listeners: first.listeners, activeListener: first.listeners![0], connectionRevision: 1 });
    const identity = receivers.view('direct').connectionIdentity;
    await receivers.sync([{ ...first, listeners: [...first.listeners!, { family: 'ipv6', address: '2001:4860:1::2', port: 10000 }] }]);
    expect(worker.close).not.toHaveBeenCalled(); expect(worker.update).toHaveBeenCalledOnce();
    expect(receivers.view('direct').connectionIdentity).toBe(identity);
    change({ ...sample, listeners: first.listeners, activeListener: first.listeners![0], connectionRevision: 2 });
    expect(receivers.view('direct').connectionIdentity).not.toBe(identity);
    await receivers.stop();
  });
  it('認識分岐は受信を再起動せず現在世代だけを認め、境界と削除を通知する', async () => {
    let change!: (sample: OutdoorReceiverSample) => void;
    const worker = { close: vi.fn(async () => undefined), setRecognitionTap: vi.fn() };
    const receivers = new OutdoorReceivers((_config, onChange) => { change = onChange; return worker; });
    const listener = vi.fn(); const unsubscribe = receivers.subscribeRecognition(listener);
    await receivers.sync([config('A', 10000)]);
    expect(receivers.recognitionSource('A')).toBeNull();
    change({ ...sample, connectionRevision: 1 });
    const first = receivers.recognitionSource('A')!;
    expect(first).toMatchObject({ sessionId: sample.sessionId, generation: 2, connectionRevision: 1, receiving: true });
    expect(receivers.setRecognitionTap('A', { port: 10000, connectionRevision: 1 })).toBe(false);
    expect(receivers.setRecognitionTap('A', { port: 10001, connectionRevision: 1 })).toBe(false);
    expect(receivers.setRecognitionTap('A', { port: 11000, connectionRevision: 2 })).toBe(false);
    expect(receivers.setRecognitionTap('A', { port: 11000, connectionRevision: 1 })).toBe(true);
    expect(worker.setRecognitionTap).toHaveBeenLastCalledWith({ port: 11000, connectionRevision: 1 });
    expect(worker.close).not.toHaveBeenCalled();
    const before = listener.mock.calls.length;
    change({ ...sample, connectionRevision: 1, receivedBytes: 2632 });
    expect(listener).toHaveBeenCalledTimes(before);
    change({ ...sample, state: 'reconnecting', connectionRevision: 1 });
    expect(receivers.recognitionSource('A')?.receiving).toBe(false);
    expect(receivers.setRecognitionTap('A', { port: 11000, connectionRevision: 1 })).toBe(false);
    change({ ...sample, generation: 3, connectionRevision: 2 });
    expect(receivers.recognitionSource('A')?.receiverInstance).toBe(first.receiverInstance);
    expect(receivers.setRecognitionTap('A', { port: 11000, connectionRevision: 1 })).toBe(false);
    expect(receivers.setRecognitionTap('A', null)).toBe(true);
    expect(worker.setRecognitionTap).toHaveBeenLastCalledWith(null);
    await receivers.stop(); expect(receivers.recognitionSource('A')).toBeNull();
    expect(listener).toHaveBeenLastCalledWith('A'); unsubscribe();
  });
});

describe('ネットワーク間で共有するOBS入力の引継ぎ', () => {
  function setup() {
    const ownership = new ReceiverOwnership();
    let now = 1000;
    const workers: { config: ReceiverConfig; change(value: OutdoorReceiverSample): void; fail(): void;
      close: ReturnType<typeof vi.fn>; exit(): void; setRecognitionTap: ReturnType<typeof vi.fn> }[] = [];
    const factory: ReceiverWorkerFactory = vi.fn((config, change, fail) => {
      let exit!: () => void; const exited = new Promise<void>(resolve => { exit = resolve; });
      const worker = { config, change, fail, close: vi.fn(async () => { exit(); }), exited, exit, setRecognitionTap: vi.fn() };
      workers.push(worker); return worker;
    });
    const privateReceivers = new OutdoorReceivers(factory, () => now, ownership);
    const directReceivers = new OutdoorReceivers(factory, () => now, ownership);
    const route = (id: string, network: 'lan' | 'tailscale' | 'direct', port: number) => ({ ...config(`${id}:${network}`, port), network, localPort: 12000 });
    return { ownership, privateReceivers, directReceivers, workers, factory, route, advance: (ms: number) => { now += ms; } };
  }
  it('終了確認までは同じ端末の新経路を起動せず、旧feedbackと認識分岐を直ちに無効にする', async () => {
    const f = setup(); f.ownership.activate('lan');
    await f.privateReceivers.sync([f.route('A', 'lan', 10000)]);
    f.workers[0].change({ ...sample, connectionRevision: 1 });
    expect(f.privateReceivers.setRecognitionTap('A:lan', { port: 13000, connectionRevision: 1 })).toBe(true);
    let finish!: () => void; f.workers[0].close.mockImplementation(() => new Promise<void>(resolve => { finish = () => { f.workers[0].exit(); resolve(); }; }));
    f.ownership.activate('direct');
    const start = f.directReceivers.sync([f.route('A', 'direct', 11000)]);
    await Promise.resolve(); await Promise.resolve();
    expect(f.workers).toHaveLength(1);
    expect(f.workers[0].setRecognitionTap).toHaveBeenLastCalledWith(null);
    f.workers[0].change({ ...sample, connectionRevision: 2 });
    expect(f.privateReceivers.feedback('A:lan', sample.sessionId!, 2)).toBeNull();
    expect(f.privateReceivers.recognitionSource('A:lan')).toBeNull();
    finish(); await start;
    expect(f.workers).toHaveLength(2); expect(f.workers[1].config.network).toBe('direct');
    await f.directReceivers.stop();
  });
  it('遅い端末の停止中も他端末の引継ぎは進み、連続切替の古い起動を抑止する', async () => {
    const f = setup(); f.ownership.activate('lan');
    await f.privateReceivers.sync([f.route('A', 'lan', 10000), f.route('B', 'lan', 10002)]);
    let finish!: () => void; f.workers[0].close.mockImplementation(() => new Promise<void>(resolve => { finish = () => { f.workers[0].exit(); resolve(); }; }));
    f.ownership.activate('direct');
    const direct = f.directReceivers.sync([f.route('A', 'direct', 11000), f.route('B', 'direct', 11002)]);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(f.workers.filter(worker => worker.config.id === 'B:direct')).toHaveLength(1);
    expect(f.workers.filter(worker => worker.config.id === 'A:direct')).toHaveLength(0);
    f.ownership.activate('tailscale');
    const latest = f.privateReceivers.sync([f.route('A', 'tailscale', 10004), f.route('B', 'tailscale', 10006)]);
    finish(); await Promise.all([direct, latest]);
    expect(f.workers.filter(worker => worker.config.id === 'A:direct')).toHaveLength(0);
    expect(f.workers.filter(worker => worker.config.id === 'A:tailscale')).toHaveLength(1);
    await Promise.all([f.privateReceivers.stop(), f.directReceivers.stop()]);
  });
  it.each(['reject', 'throw'] as const)('停止%sは所有を保持し、遅延exit後は最新経路だけを再試行する', async failure => {
    const f = setup(); f.ownership.activate('lan');
    await f.privateReceivers.sync([f.route('A', 'lan', 10000)]);
    f.workers[0].close.mockImplementation(() => { if (failure === 'throw') throw new Error('kill'); return Promise.reject(new Error('kill')); });
    f.ownership.activate('direct'); await f.directReceivers.sync([f.route('A', 'direct', 11000)]);
    expect(f.workers).toHaveLength(1); expect(f.privateReceivers.view('A:lan').stopStatus).toBe('unknown');
    expect(f.directReceivers.view('A:direct').stopStatus).toBe('unknown');
    f.ownership.activate('tailscale'); await f.privateReceivers.sync([f.route('A', 'tailscale', 10004)]);
    expect(f.workers).toHaveLength(1);
    f.workers[0].exit(); await Promise.resolve(); f.advance(2000);
    await f.privateReceivers.sync([f.route('A', 'tailscale', 10004)]);
    expect(f.workers.map(worker => worker.config.network)).toEqual(['lan', 'tailscale']);
    await Promise.all([f.privateReceivers.stop(), f.directReceivers.stop()]);
  });
  it('OFFから同じ経路へ戻っても終了待ちの古い起動世代を使わない', async () => {
    const f = setup(); f.ownership.activate('lan');
    await f.privateReceivers.sync([f.route('A', 'lan', 10000)]);
    let finish!: () => void; f.workers[0].close.mockImplementation(() => new Promise<void>(resolve => { finish = () => { f.workers[0].exit(); resolve(); }; }));
    f.ownership.activate('direct'); const stale = f.directReceivers.sync([f.route('A', 'direct', 11000)]);
    f.ownership.activate(null); f.ownership.activate('direct');
    const latest = f.directReceivers.sync([f.route('A', 'direct', 11000)]);
    finish(); await Promise.all([stale, latest]);
    expect(f.workers.map(worker => worker.config.network)).toEqual(['lan', 'direct']);
    await f.directReceivers.stop();
  });
});
