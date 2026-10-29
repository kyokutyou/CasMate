import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DirectRuntime } from '../src/main/smartphone/direct-runtime';
import { createSmartphoneRecord, addSmartphoneDevice } from '../src/main/smartphone/smartphone-store';
import { newDirectCredential } from '../src/main/smartphone/direct-ledger';
import type { DirectAdapter, DirectGateway } from '../src/main/smartphone/direct-gateway';
import { OutdoorReceivers, ReceiverOwnership, type ReceiverConfig } from '../src/main/outdoor/outdoor-receivers';
import { directHost } from '../src/shared/direct-connection';
import { MappingFailure } from '../src/main/smartphone/direct-gateway';

const adapter: DirectAdapter = { id: randomUUID(), name: 'Ethernet', profile: 'Private', index: 1,
  addresses: [{ family: 'ipv4', address: '192.168.1.9' }, { family: 'ipv6', address: '2001:4860:1::9' }], gateway4: '192.168.1.1', gateway6: 'fe80::1%1' };
function setup(receiverOverride?: Pick<OutdoorReceivers, 'sync' | 'stop' | 'view' | 'feedback'>, recordInitiallyAvailable = true) {
  let time = Date.now();
  let recordAvailable = recordInitiallyAvailable;
  let saving: Promise<void> | undefined;
  const record = createSmartphoneRecord();
  record.settings.activeNetwork = 'direct';
  const windows = { list: vi.fn(async () => [{ ...adapter, description: 'USB Ethernet', preferred: true }]), adapter: vi.fn(async () => adapter), allow: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
  const gateway: DirectGateway = {
    prepare: vi.fn(async (_adapter, request, _process, before) => { const result = { ...request, method: 'pcp' as const, gateway: '192.168.1.1',
      address: request.family === 'ipv6' ? request.localAddress : '8.8.8.8', publicPort: request.localPort, renewedAt: time, expiresAt: time + 3600000 };
      await before(result); return result; }), renew: vi.fn(async (_adapter, mapping) => ({ ...mapping, renewedAt: time, expiresAt: time + 3600000 })), remove: vi.fn(async () => undefined),
  };
  const close = vi.fn(async () => undefined);
  const configs = new Map<string, ReceiverConfig>();
  const receivers = { sync: vi.fn(async (next: ReceiverConfig[]) => { configs.clear(); for (const config of next) configs.set(config.id, config); }), stop: vi.fn(async () => undefined),
    view: vi.fn<OutdoorReceivers['view']>(id => ({ state: 'listening', receivedBytes: 0, listeners: configs.get(id)?.listeners ?? [] })), feedback: vi.fn(() => null) };
  const updateIdentity = vi.fn(); const listen = vi.fn(async () => ({ close, updateIdentity, sendAudioReady: () => undefined, discardAudio: () => undefined }));
  const runtime = new DirectRuntime({ read: () => recordAvailable ? record : null, update: async change => { if (saving) await saving; change(record); }, changed: () => undefined,
    windows, gateway, receivers: receiverOverride ?? receivers, program: 'C:/CasMate.exe', workerProgram: 'C:/receiver.exe', listen, now: () => time });
  return { record, runtime, windows, gateway, close, receivers, configs, listen, updateIdentity, advance: (milliseconds: number) => { time += milliseconds; }, time: () => time,
    makeRecordAvailable: () => { recordAvailable = true; }, pauseSaves: (completion: Promise<void> | undefined) => { saving = completion; } };
}
function allocate(record: ReturnType<typeof setup>['record']) {
  const device = addSmartphoneDevice(record, 'スマホ');
  const id = device.id; device.obsLocalPort = 31001;
  record.direct!.devices[id] = { comments: newDirectCredential(), obs: newDirectCredential(), pending: false, registered: true,
    outdoor: { ...newDirectCredential(), passphrase: 'a'.repeat(32), internalPort: 31000 } };
  return id;
}
describe('direct resource lifecycle', () => {
  it('TCPの未確認・接続中・切断を区別し、旧候補の終了で新候補を変更しない', async () => {
    const f = setup();
    try {
      await f.runtime.refresh(); await f.runtime.idle();
      const endpoint = f.runtime.tcpEndpoints().find(e => e.family === 'ipv4')!;
      const entry = f.record.direct!.entries.find(e => e.request.protocol === 'tcp' && e.request.family === 'ipv4')!;
      const reachability = () => f.runtime.view().entries.find(e => e.id === entry.request.id)?.reachability;
      expect(reachability()).toBe('unconfirmed');
      const close = f.runtime.connected(entry.request.localAddress, entry.request.localPort, directHost(endpoint.address, endpoint.tcpPort));
      const closeSecond = f.runtime.connected(entry.request.localAddress, entry.request.localPort, directHost(endpoint.address, endpoint.tcpPort));
      expect(reachability()).toBe('connected');
      close(); expect(reachability()).toBe('connected');
      closeSecond(); expect(reachability()).toBe('disconnected');
      entry.candidateId = randomUUID();
      expect(reachability()).toBe('unconfirmed');
      closeSecond(); expect(reachability()).toBe('unconfirmed');
    } finally { await f.runtime.stop(); }
  });

  it('SRTの実接続後の切断と新しい候補の未確認を区別する', async () => {
    const f = setup(); const deviceId = allocate(f.record);
    try {
      await f.runtime.refresh(); await f.runtime.idle();
      const entry = f.record.direct!.entries.find(e => e.request.protocol === 'udp' && e.request.family === 'ipv4')!;
      const reachability = () => f.runtime.view().entries.find(e => e.id === entry.request.id)?.reachability;
      expect(reachability()).toBe('unconfirmed');
      f.receivers.view.mockImplementation(id => ({ state: 'receiving', receivedBytes: 10, connectionIdentity: 'srt-1',
        activeListener: { family: 'ipv4', address: entry.request.localAddress, port: entry.request.localPort }, listeners: f.configs.get(id)?.listeners ?? [] }));
      expect(f.runtime.receiver(deviceId).state).toBe('receiving');
      expect(reachability()).toBe('connected');
      f.receivers.view.mockImplementation(id => ({ state: 'listening', receivedBytes: 10, listeners: f.configs.get(id)?.listeners ?? [] }));
      expect(reachability()).toBe('disconnected');
      entry.candidateId = randomUUID();
      expect(reachability()).toBe('unconfirmed');
    } finally { await f.runtime.stop(); }
  });

  it('先行削除の成功後に許可が遅れて完了し最終削除に失敗した場合は所有記録を残す', async () => {
    const f = setup(); let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    f.windows.allow.mockImplementation(async () => pending);
    const removals = new Map<string, number>();
    f.windows.remove.mockImplementation(async grant => {
      const count = (removals.get(grant.id) ?? 0) + 1; removals.set(grant.id, count);
      if (count > 1) throw new Error('final removal failed');
    });
    await f.runtime.refresh(); await vi.waitFor(() => expect(f.windows.allow).toHaveBeenCalledTimes(2));
    const stopping = f.runtime.stop();
    try {
      await vi.waitFor(() => expect(f.record.direct!.entries.every(entry => entry.firewallRemoved)).toBe(true));
    } finally { release(); await stopping; await f.runtime.idle(); }
    expect(f.windows.remove).toHaveBeenCalledTimes(4);
    expect(f.record.direct!.entries).toHaveLength(2);
    expect(f.record.direct!.entries.every(entry => entry.status === 'residual' && !entry.firewallRemoved)).toBe(true);
  });
  it('送信後に取消となった開放は削除応答が成功しても結果不明の記録を残す', async () => {
    const f = setup();
    vi.mocked(f.gateway.prepare).mockImplementation(async (_adapter, request, _process, before, signal) => {
      await before({ ...request, method: 'pcp', gateway: '192.168.1.1', address: '0.0.0.0', publicPort: request.localPort, renewedAt: f.time(), expiresAt: f.time() + 3600000 });
      await new Promise<void>(resolve => { if (signal!.aborted) resolve(); else signal!.addEventListener('abort', () => resolve(), { once: true }); });
      throw new MappingFailure('unknown', true);
    });
    await f.runtime.refresh(); await vi.waitFor(() => expect(f.gateway.prepare).toHaveBeenCalledTimes(2));
    await f.runtime.stop();
    expect(f.record.direct!.entries).toHaveLength(2);
    expect(f.record.direct!.entries.every(entry => entry.status === 'residual' && !entry.routerRemoved && entry.firewallRemoved)).toBe(true);
    expect(f.runtime.view().residual.some(entry => entry.kind === 'router')).toBe(true);
  });
  it('OFFではローカル受信の停止完了を待たずWindows削除を開始する', async () => {
    const f = setup(); await f.runtime.refresh(); await f.runtime.idle();
    let finish!: () => void; const delayed = new Promise<void>(resolve => { finish = resolve; });
    f.receivers.stop.mockImplementation(() => delayed);
    f.record.settings.activeNetwork = null;
    const refreshing = f.runtime.refresh();
    try { await vi.waitFor(() => expect(f.windows.remove).toHaveBeenCalled(), { timeout: 500 }); }
    finally { finish(); await refreshing; await f.runtime.idle(); await f.runtime.stop(); }
  });
  it('閉鎖状態の保存待ち中も規則削除を未確認として表示し、OFFを削除完了に見せない', async () => {
    const f = setup(); await f.runtime.refresh(); await f.runtime.idle();
    let finish!: () => void; f.pauseSaves(new Promise<void>(resolve => { finish = resolve; }));
    f.record.settings.activeNetwork = null;
    const refreshing = f.runtime.refresh();
    try {
      await vi.waitFor(() => expect(f.windows.remove).toHaveBeenCalled());
      expect(f.runtime.view().residual.filter(entry => entry.kind === 'firewall')).toHaveLength(2);
    } finally { finish(); f.pauseSaves(undefined); await refreshing; await f.runtime.idle(); await f.runtime.stop(); }
  });
  it('終了時はローカル受信の停止完了を待たずWindows削除を開始する', async () => {
    const f = setup(); await f.runtime.refresh(); await f.runtime.idle();
    let release!: () => void; f.receivers.stop.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    vi.useFakeTimers(); const stopping = f.runtime.stop();
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(f.windows.remove).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(4900); await stopping;
    } finally { release(); await vi.advanceTimersByTimeAsync(5000); await stopping; await f.runtime.idle(); vi.useRealTimers(); }
  });
  it('開放応答待ちでも終了時にWindows削除と閉鎖中の保存を開始し、遅い開放も削除する', async () => {
    const f = setup(); let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    const prepare = vi.mocked(f.gateway.prepare).getMockImplementation()!;
    vi.mocked(f.gateway.prepare).mockImplementation(async (...args) => { const result = await prepare(...args); await blocked; return result; });
    await f.runtime.refresh(); await vi.waitFor(() => expect(f.gateway.prepare).toHaveBeenCalledTimes(2));
    vi.useFakeTimers(); const stopping = f.runtime.stop();
    try {
      await vi.advanceTimersByTimeAsync(5000); await stopping;
      expect(f.windows.remove).toHaveBeenCalledTimes(2);
      expect(f.record.direct!.entries.every(e => e.status === 'closing' || e.status === 'residual')).toBe(true);
      expect(f.runtime.view().residual.length).toBeGreaterThan(0);
      expect(f.gateway.remove).not.toHaveBeenCalled();
    } finally { release(); await vi.advanceTimersByTimeAsync(0); await f.runtime.idle(); vi.useRealTimers(); }
    expect(f.gateway.remove).toHaveBeenCalledTimes(2); expect(f.record.direct!.entries).toEqual([]);
  });
  it('終了時のWindows削除を遅いルーター応答で分割しない', async () => {
    const f = setup(); await f.runtime.refresh(); await f.runtime.idle();
    let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(f.gateway.remove).mockImplementation(async () => waiting);
    f.record.settings.activeNetwork = null;
    try {
      await f.runtime.refresh();
      await vi.waitFor(() => expect(f.windows.remove).toHaveBeenCalledTimes(2));
      expect(f.gateway.remove).toHaveBeenCalledTimes(2);
    } finally { finish(); await f.runtime.idle(); await f.runtime.stop(); }
  });
  it('ルーター再準備だけでは成功済みのWindows権限要求を繰り返さない', async () => {
    const f = setup(); f.windows.adapter.mockResolvedValue({ ...adapter, addresses: [adapter.addresses[0]!] });
    vi.mocked(f.gateway.prepare).mockRejectedValue(new MappingFailure('unsupported'));
    try {
      await f.runtime.refresh(); await f.runtime.idle();
      for (let i = 0; i < 3; i++) { f.advance(30000); await f.runtime.refresh(); await f.runtime.idle(); }
      await f.runtime.retryNow(); await f.runtime.idle();
      expect(f.gateway.prepare).toHaveBeenCalledTimes(5);
      expect(f.windows.allow).toHaveBeenCalledOnce();
      expect(f.runtime.tcpEndpoints()).toEqual([]);
    } finally { await f.runtime.stop(); }
  });
  it('Windows受信許可の失敗は周期更新で再要求せず明示再試行で復旧する', async () => {
    const f = setup(); f.windows.adapter.mockResolvedValue({ ...adapter, addresses: [adapter.addresses[0]!] });
    f.windows.allow.mockRejectedValueOnce(new Error('受信準備を取り消しました。'));
    try {
      await f.runtime.refresh(); await f.runtime.idle();
      for (let i = 0; i < 3; i++) { f.advance(30000); await f.runtime.refresh(); await f.runtime.idle(); }
      expect(f.windows.allow).toHaveBeenCalledOnce(); expect(f.gateway.prepare).not.toHaveBeenCalled();
      expect(f.runtime.tcpEndpoints()).toEqual([]); expect(f.runtime.view().entries[0]!.warning).toBeTruthy();
      await f.runtime.retryNow(); await f.runtime.idle();
      expect(f.windows.allow).toHaveBeenCalledTimes(2); expect(f.runtime.tcpEndpoints()).toHaveLength(1);
    } finally { await f.runtime.stop(); }
  });
  it('ネットワーク対象が変われば成功済みのWindows許可を流用しない', async () => {
    const f = setup(); f.windows.adapter.mockResolvedValue({ ...adapter, addresses: [adapter.addresses[0]!] });
    try {
      await f.runtime.refresh(); await f.runtime.idle();
      const original = structuredClone(f.windows.allow.mock.calls[0]);
      f.windows.adapter.mockResolvedValue({ ...adapter, profile: 'Public', addresses: [adapter.addresses[0]!] });
      await f.runtime.refresh(); await f.runtime.idle();
      expect(f.windows.allow).toHaveBeenCalledTimes(2);
      expect(f.windows.allow.mock.calls[1]).not.toEqual(original);
      expect(f.record.direct!.entries[0]!.firewall.profile).toBe('Public');
      expect(f.windows.remove).toHaveBeenCalledOnce();
    } finally { await f.runtime.stop(); }
  });
  it('アプリ再起動相当の新しい実行では保存済みreadyでもWindows許可を再確認する', async () => {
    const f = setup(); f.windows.adapter.mockResolvedValue({ ...adapter, addresses: [adapter.addresses[0]!] });
    await f.runtime.refresh(); await f.runtime.idle();
    const next = new DirectRuntime({ read: () => f.record, update: async change => change(f.record), changed: () => undefined,
      windows: f.windows, gateway: f.gateway, receivers: f.receivers, program: 'C:/CasMate.exe', workerProgram: 'C:/receiver.exe',
      listen: f.listen, now: f.time });
    try {
      await next.refresh(); await next.idle();
      expect(f.windows.allow).toHaveBeenCalledTimes(2); expect(next.tcpEndpoints()).toHaveLength(1);
    } finally { await next.stop(); await f.runtime.stop(); }
  });
  it('結果不明の作成意図は後続の未対応応答だけで破棄せず所有照合を続ける', async () => {
    const f = setup(); f.windows.adapter.mockResolvedValue({ ...adapter, addresses: [adapter.addresses[0]!] });
    vi.mocked(f.gateway.prepare).mockImplementationOnce(async (_adapter, request, _process, before) => {
      await before({ ...request, method: 'pcp', gateway: '192.168.1.1', address: '0.0.0.0', publicPort: request.localPort,
        renewedAt: f.time(), expiresAt: f.time() + 3600000 });
      throw new MappingFailure('unknown', true);
    });
    vi.mocked(f.gateway.renew).mockRejectedValue(new MappingFailure('unsupported'));
    try {
      await f.runtime.refresh(); await f.runtime.idle();
      const intent = structuredClone(f.record.direct!.entries[0]!.intent);
      await f.runtime.retryNow(); await f.runtime.idle();
      expect(f.record.direct!.entries[0]!.intent).toEqual(intent);
      expect(f.gateway.prepare).toHaveBeenCalledOnce(); expect(f.gateway.renew).toHaveBeenCalledOnce();
    } finally { await f.runtime.stop(); }
  });
  it('確定したPCP未対応の後も再試行でUPnPを再探索する', async () => {
    const f = setup(); f.windows.adapter.mockResolvedValue({ ...adapter, addresses: [adapter.addresses[0]!] });
    vi.mocked(f.gateway.prepare).mockImplementationOnce(async (_adapter, request, _process, before) => {
      await before({ ...request, method: 'pcp', gateway: '192.168.1.1', address: '0.0.0.0', publicPort: request.localPort,
        renewedAt: f.time(), expiresAt: f.time() + 3600000 });
      throw new MappingFailure('unsupported');
    });
    vi.mocked(f.gateway.renew).mockRejectedValue(new MappingFailure('unsupported'));
    try {
      await f.runtime.refresh(); await f.runtime.idle(); expect(f.runtime.tcpEndpoints()).toEqual([]);
      await f.runtime.retryNow(); await f.runtime.idle();
      expect(f.gateway.prepare).toHaveBeenCalledTimes(2); expect(f.runtime.tcpEndpoints()).toHaveLength(1);
    } finally { await f.runtime.stop(); }
  });
  it.each([80, 4455])('更新で禁止された公開TCPポート%sが返ったら再試行で復旧する', async publicPort => {
    const f = setup(); f.windows.adapter.mockResolvedValue({ ...adapter, addresses: [adapter.addresses[0]!] });
    try {
      await f.runtime.refresh(); await f.runtime.idle(); expect(f.runtime.tcpEndpoints()).toHaveLength(1);
      vi.mocked(f.gateway.renew).mockImplementation(async (_adapter, mapping) => ({ ...mapping, publicPort: mapping.localPort,
        renewedAt: f.time(), expiresAt: f.time() + 3600000 }));
      vi.mocked(f.gateway.renew).mockImplementationOnce(async (_adapter, mapping) => ({ ...mapping, publicPort,
        renewedAt: f.time(), expiresAt: f.time() + 3600000 }));
      f.advance(1800000); await f.runtime.refresh(); await f.runtime.idle(); expect(f.runtime.tcpEndpoints()).toHaveLength(0);
      expect(f.runtime.view().entries[0]!.warning).toBeTruthy();
      await f.runtime.retryNow(); await f.runtime.idle();
      expect(f.gateway.renew).toHaveBeenCalledTimes(2);
      expect(f.runtime.tcpEndpoints()).toHaveLength(1);
    } finally { await f.runtime.stop(); }
  });
  it('OFFへの切替とアプリ終了で読取ワーカーを停止し、OFF中の一覧取得は定期更新で妨げない', async () => {
    const f = setup(); const stop = vi.fn(); Object.assign(f.windows, { stop });
    f.record.settings.activeNetwork = null;
    await f.runtime.adapters(); await f.runtime.refresh(); expect(stop).not.toHaveBeenCalled();
    f.record.settings.activeNetwork = 'direct'; await f.runtime.refresh(); await f.runtime.idle();
    f.record.settings.activeNetwork = 'lan'; await f.runtime.refresh(); await f.runtime.idle();
    expect(stop).toHaveBeenCalledOnce();
    await f.runtime.adapters(); await f.runtime.refresh(); expect(stop).toHaveBeenCalledOnce();
    await f.runtime.stop(); expect(stop).toHaveBeenCalledTimes(2);
    const reads = f.windows.list.mock.calls.length;
    await expect(f.runtime.adapters()).rejects.toThrow('停止'); expect(f.windows.list).toHaveBeenCalledTimes(reads);
  });
  it('旧LAN端末の終了待ちで直接接続の共通TCPと他端末の公開を塞がない', async () => {
    const ownership = new ReceiverOwnership(); let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    let slowId = '';
    const factory: import('../src/main/outdoor/outdoor-receivers').ReceiverWorkerFactory = (config, change) => {
      change({ version: 1, state: 'listening', sessionId: null, generation: 0, receivedBytes: 0,
        videoFrames: 0, audioFrames: 0, videoPts: -1, audioPts: -1, lostPackets: 0, droppedPackets: 0, listeners: config.listeners });
      return { close: () => config.id === `${slowId}:lan` ? pending : Promise.resolve() };
    };
    const privateReceivers = new OutdoorReceivers(factory, Date.now, ownership);
    const directReceivers = new OutdoorReceivers(factory, Date.now, ownership);
    const f = setup(directReceivers); const a = allocate(f.record), b = allocate(f.record); slowId = a;
    f.record.devices.find(device => device.id === b)!.obsLocalPort = 31003;
    f.record.direct!.devices[b].outdoor!.internalPort = 31002;
    ownership.activate('lan');
    await privateReceivers.sync([a, b].map(id => ({ id: `${id}:lan`, network: 'lan', address: '192.168.1.2', port: 32000,
      localPort: f.record.devices.find(device => device.id === id)!.obsLocalPort!, passphrase: 'a'.repeat(32) })));
    ownership.activate('direct');
    try {
      await f.runtime.refresh();
      await vi.waitFor(() => {
        expect(f.runtime.tcpEndpoints().length).toBeGreaterThan(0);
        expect(f.runtime.srtEndpoints(b).length).toBeGreaterThan(0);
      }, { timeout: 1000 });
      expect(f.runtime.srtEndpoints(a)).toEqual([]);
      expect(f.gateway.prepare).toHaveBeenCalled();
    } finally { finish(); await f.runtime.idle(); await f.runtime.stop(); await privateReceivers.stop(); }
  });
  it('preserves persisted mapping identifiers when the connection name has not changed', async () => {
    const { runtime, record } = setup();
    await runtime.refresh(); await runtime.idle();
    for (const entry of record.direct!.entries) entry.key = JSON.stringify([adapter.id, adapter.profile, adapter.gateway4, adapter.gateway6,
      'auto', entry.request.protocol, entry.deviceId ?? '', entry.request.family, entry.request.localAddress, entry.request.localPort, '', null]);
    const ids = record.direct!.entries.map(e => e.request.id);
    await runtime.refresh(); await runtime.idle();
    expect(record.direct!.entries.map(e => e.request.id)).toEqual(ids);
    await runtime.stop();
  });
  it.each(['tcp', 'udp'] as const)('%sの保存済み実行ファイルが変わったら旧所有許可の削除を待って新IDで準備する', async protocol => {
    const { runtime, windows, record } = setup(); if (protocol === 'udp') allocate(record);
    await runtime.refresh(); await runtime.idle();
    const old = record.direct!.entries.find(entry => entry.request.protocol === protocol && entry.request.family === 'ipv4')!;
    old.firewall.program = 'C:/Previous Install/old.exe';
    const oldGrant = structuredClone(old.firewall); const currentProgram = protocol === 'tcp' ? 'C:/CasMate.exe' : 'C:/receiver.exe';
    windows.allow.mockClear(); windows.remove.mockClear();
    let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
    windows.remove.mockImplementationOnce(() => pending);
    try {
      await runtime.refresh();
      await vi.waitFor(() => expect(windows.remove).toHaveBeenCalledWith(oldGrant));
      expect(windows.allow).not.toHaveBeenCalled();
      finish(); await runtime.idle();
      const replacement = record.direct!.entries.find(entry => entry.key === old.key && entry.firewall.program === currentProgram)!;
      expect(replacement.request.id).not.toBe(old.request.id); expect(replacement.status).toBe('ready');
      expect(record.direct!.entries.some(entry => entry.request.id === old.request.id)).toBe(false);
      expect(windows.allow).toHaveBeenCalledExactlyOnceWith(replacement.firewall, expect.any(AbortSignal));
    } finally { finish(); await runtime.idle(); await runtime.stop(); }
  });
  it('旧実行ファイルの許可削除に失敗しても所有記録を残し、新しい許可を準備した後に再照合できる', async () => {
    const { runtime, windows, record } = setup(); await runtime.refresh(); await runtime.idle();
    const old = record.direct!.entries.find(entry => entry.request.family === 'ipv4')!;
    old.firewall.program = 'C:/Previous Install/old.exe'; const oldGrant = structuredClone(old.firewall);
    windows.remove.mockRejectedValueOnce(new Error('Transient cleanup failure'));
    await runtime.refresh(); await runtime.idle();
    const retained = record.direct!.entries.find(entry => entry.request.id === old.request.id)!;
    expect(retained.status).toBe('residual'); expect(retained.firewall).toEqual(oldGrant); expect(retained.firewallRemoved).toBe(false);
    expect(runtime.view().residual).toContainEqual(expect.objectContaining({ id: old.request.id, kind: 'firewall' }));
    const ready = record.direct!.entries.find(entry => entry.key === old.key && entry.firewall.program === 'C:/CasMate.exe')!;
    expect(ready.request.id).not.toBe(old.request.id); expect(ready.status).toBe('ready');
    const endpoints = runtime.tcpEndpoints(); await runtime.cleanup();
    expect(record.direct!.entries.some(entry => entry.request.id === old.request.id)).toBe(false);
    expect(runtime.tcpEndpoints()).toEqual(endpoints); await runtime.stop();
  });
  it.each([true, false])('旧実行ファイルの残存を保存した後の再起動では直接接続ON=%sでも削除を再照合する', async active => {
    const previous = setup(); await previous.runtime.refresh(); await previous.runtime.idle();
    const old = previous.record.direct!.entries.find(entry => entry.request.family === 'ipv4')!;
    old.firewall.program = 'C:/Previous Install/old.exe'; previous.windows.remove.mockRejectedValueOnce(new Error('permission denied'));
    await previous.runtime.refresh(); await previous.runtime.idle();
    const saved = structuredClone(previous.record); await previous.runtime.stop();
    const restarted = setup(); Object.assign(restarted.record, saved); restarted.record.settings.activeNetwork = active ? 'direct' : null;
    await restarted.runtime.refresh(); await restarted.runtime.idle();
    expect(restarted.windows.remove).toHaveBeenCalledWith(old.firewall);
    expect(restarted.record.direct!.entries.some(entry => entry.request.id === old.request.id)).toBe(false);
    if (active) expect(restarted.runtime.tcpEndpoints()).toHaveLength(2);
    else expect(restarted.runtime.tcpEndpoints()).toEqual([]);
    await restarted.runtime.stop();
  });
  it.each([true, false])('起動時の残存削除が失敗しても直接接続ON=%sの周期更新で権限要求を繰り返さない', async active => {
    const previous = setup(); await previous.runtime.refresh(); await previous.runtime.idle();
    const old = previous.record.direct!.entries.find(entry => entry.request.family === 'ipv4')!;
    old.firewall.program = 'C:/Previous Install/old.exe'; previous.windows.remove.mockRejectedValueOnce(new Error('permission denied'));
    await previous.runtime.refresh(); await previous.runtime.idle();
    const saved = structuredClone(previous.record); await previous.runtime.stop();
    const restarted = setup(); Object.assign(restarted.record, saved); restarted.record.settings.activeNetwork = active ? 'direct' : null;
    restarted.windows.remove.mockImplementation(async grant => { if (grant.id === old.request.id) throw new Error('permission denied'); });
    await restarted.runtime.refresh(); await restarted.runtime.idle();
    for (let refresh = 0; refresh < 3; refresh++) { restarted.advance(2000); await restarted.runtime.refresh(); await restarted.runtime.idle(); }
    expect(restarted.windows.remove.mock.calls.filter(([grant]) => grant.id === old.request.id)).toHaveLength(1);
    expect(restarted.record.direct!.entries.find(entry => entry.request.id === old.request.id)).toMatchObject({ status: 'residual', firewallRemoved: false });
    restarted.windows.remove.mockResolvedValue(undefined); await restarted.runtime.cleanup();
    expect(restarted.windows.remove.mock.calls.filter(([grant]) => grant.id === old.request.id)).toHaveLength(2);
    expect(restarted.record.direct!.entries.some(entry => entry.request.id === old.request.id)).toBe(false);
    await restarted.runtime.stop();
  });
  it('保存台帳の読込前の更新で起動時再照合を消費せず、台帳を取得してから残存を削除する', async () => {
    const previous = setup(); await previous.runtime.refresh(); await previous.runtime.idle();
    const old = previous.record.direct!.entries.find(entry => entry.request.family === 'ipv4')!;
    old.firewall.program = 'C:/Previous Install/old.exe'; previous.windows.remove.mockRejectedValueOnce(new Error('permission denied'));
    await previous.runtime.refresh(); await previous.runtime.idle();
    const saved = structuredClone(previous.record); await previous.runtime.stop();
    const restarted = setup(undefined, false); Object.assign(restarted.record, saved); restarted.record.settings.activeNetwork = null;
    await restarted.runtime.refresh(); await restarted.runtime.idle(); expect(restarted.windows.remove).not.toHaveBeenCalled();
    restarted.makeRecordAvailable(); await restarted.runtime.refresh(); await restarted.runtime.idle();
    expect(restarted.windows.remove).toHaveBeenCalledWith(old.firewall);
    expect(restarted.record.direct!.entries.some(entry => entry.request.id === old.request.id)).toBe(false); await restarted.runtime.stop();
  });
  it('Windowsの実行ファイルの大文字小文字と区切り違いだけでは所有IDを作り直さない', async () => {
    const { runtime, windows, record } = setup(); await runtime.refresh(); await runtime.idle();
    for (const entry of record.direct!.entries) entry.firewall.program = 'c:\\CASMATE.exe';
    const ids = record.direct!.entries.map(entry => entry.request.id); windows.allow.mockClear(); windows.remove.mockClear();
    await runtime.refresh(); await runtime.idle();
    expect(record.direct!.entries.map(entry => entry.request.id)).toEqual(ids);
    expect(windows.allow).not.toHaveBeenCalled(); expect(windows.remove).not.toHaveBeenCalled(); await runtime.stop();
  });
  it('旧実行ファイルの削除待ち中にOFFへ切り替えても新しい許可を作らない', async () => {
    const { runtime, windows, record } = setup(); await runtime.refresh(); await runtime.idle();
    const old = record.direct!.entries.find(entry => entry.request.family === 'ipv4')!; old.firewall.program = 'C:/Previous Install/old.exe';
    let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
    windows.remove.mockImplementationOnce(() => pending); windows.allow.mockClear();
    try {
      await runtime.refresh(); await vi.waitFor(() => expect(windows.remove).toHaveBeenCalled());
      record.settings.activeNetwork = null; await runtime.refresh(); finish(); await runtime.idle();
      expect(windows.allow).not.toHaveBeenCalled(); expect(record.direct!.entries).toEqual([]); expect(runtime.tcpEndpoints()).toEqual([]);
    } finally { finish(); await runtime.idle(); await runtime.stop(); }
  });
  it('refreshes Windows permissions after the selected connection is renamed', async () => {
    const { runtime, windows, record } = setup();
    await runtime.refresh(); await runtime.idle();
    windows.adapter.mockResolvedValue({ ...adapter, name: 'イーサネット 2' });
    await runtime.refresh(); await runtime.idle();
    expect(record.direct!.entries.filter(e => e.status === 'ready').every(e => e.firewall.interfaceName === 'イーサネット 2')).toBe(true);
    expect(windows.allow.mock.calls.at(-1)?.[0].interfaceName).toBe('イーサネット 2');
    await runtime.stop();
  });
  it('retries residual permissions from the old connection name without closing the new connection', async () => {
    const { runtime, windows, record } = setup();
    await runtime.refresh(); await runtime.idle();
    windows.remove.mockRejectedValueOnce(new Error('Transient cleanup failure'));
    windows.adapter.mockResolvedValue({ ...adapter, name: 'Renamed Ethernet' });
    await runtime.refresh(); await runtime.idle();
    const residualId = record.direct!.entries.find(e => e.status === 'residual')!.request.id;
    const endpoints = runtime.tcpEndpoints();
    await runtime.cleanup();
    expect(record.direct!.entries.some(e => e.request.id === residualId)).toBe(false);
    expect(runtime.tcpEndpoints()).toEqual(endpoints);
    await runtime.stop();
  });
  it.each(['auto', 'manual'] as const)('retains IPv4 with four stable IPv6 addresses in %s mode', async mode => {
    const { runtime, windows, record } = setup();
    windows.adapter.mockResolvedValue({ ...adapter, addresses: [...Array.from({ length: 4 }, (_, i) => ({ family: 'ipv6' as const, address: `2001:4860:1::${i + 1}` })), adapter.addresses[0]!] });
    record.settings.direct!.mode = mode;
    if (mode === 'manual') record.settings.direct!.manualEndpoints = [{ id: randomUUID(), family: 'ipv4', address: '8.8.8.8', tcpPort: 3001 }];
    await runtime.refresh(); await runtime.idle();
    if (mode === 'manual') await runtime.manualConfirm(record.direct!.revision);
    expect(runtime.tcpEndpoints().some(e => e.family === 'ipv4')).toBe(true);
    expect(runtime.tcpEndpoints().length).toBeLessThanOrEqual(4);
    await runtime.stop();
  });
  it('coalesces repeated refreshes behind a slow Windows read so explicit retry is not buried in a backlog', async () => {
    const { runtime, windows } = setup();
    let resolve!: (value: DirectAdapter) => void;
    windows.adapter.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = runtime.refresh();
    await vi.waitFor(() => expect(windows.adapter).toHaveBeenCalledOnce());
    const requests = Array.from({ length: 10 }, () => runtime.refresh());
    resolve(adapter); await Promise.all([first, ...requests]); await runtime.idle();
    expect(windows.adapter).toHaveBeenCalledTimes(2);
    await runtime.stop();
  });
  it('does not close a healthy saved NIC when a superseded NIC read fails after returning to it', async () => {
    const { record, runtime, windows, gateway, close } = setup();
    await runtime.refresh(); await runtime.idle();
    const endpoints = runtime.tcpEndpoints();
    let reject!: (error: Error) => void;
    windows.adapter.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
    const count = windows.adapter.mock.calls.length;
    record.settings.direct!.interfaceId = randomUUID(); record.direct!.revision++;
    const pending = runtime.refresh();
    await vi.waitFor(() => expect(windows.adapter).toHaveBeenCalledTimes(count + 1));
    record.settings.direct!.interfaceId = adapter.id; record.direct!.revision++;
    reject(new Error('Disconnected')); await pending; await runtime.idle();
    expect(runtime.tcpEndpoints()).toEqual(endpoints);
    expect(close).not.toHaveBeenCalled(); expect(gateway.remove).not.toHaveBeenCalled();
    await runtime.stop();
  });
  it.each([null, adapter.id])('discards a delayed NIC result after selecting another saved ID from %s', async initialId => {
    const { record, runtime, windows, gateway, listen } = setup();
    record.settings.direct!.interfaceId = initialId;
    let resolve!: (value: DirectAdapter) => void;
    windows.adapter.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = runtime.refresh();
    await vi.waitFor(() => expect(windows.adapter).toHaveBeenCalledOnce());
    record.settings.direct!.interfaceId = randomUUID(); record.direct!.revision++;
    resolve(adapter); await pending; await runtime.idle();
    expect(record.direct!.entries).toEqual([]); expect(runtime.tcpEndpoints()).toEqual([]);
    expect(windows.allow).not.toHaveBeenCalled(); expect(gateway.prepare).not.toHaveBeenCalled(); expect(listen).not.toHaveBeenCalled();
    await runtime.stop();
  });
  it('lists eligible names without changing settings or preparing listeners and mappings', async () => {
    const { record, runtime, windows, gateway } = setup();
    record.settings.activeNetwork = null;
    const before = structuredClone(record);
    expect(await runtime.adapters()).toEqual([{ id: adapter.id, name: adapter.name, description: 'USB Ethernet', preferred: true, addresses: adapter.addresses }]);
    expect(record).toEqual(before);
    expect(windows.adapter).not.toHaveBeenCalled(); expect(windows.allow).not.toHaveBeenCalled();
    expect(gateway.prepare).not.toHaveBeenCalled();
    await runtime.stop();
  });
  it('publishes TCP only until a device needs SRT, preserves intent before changing the router, and closes owned entries on OFF', async () => {
    const { record, runtime, windows, gateway, close } = setup();
    await runtime.refresh(); await runtime.idle();
    expect(runtime.tcpEndpoints()).toHaveLength(2); expect(runtime.view().entries.every(e => e.protocol === 'tcp')).toBe(true);
    expect(windows.allow).toHaveBeenCalledTimes(2);
    expect(record.direct!.entries.every(e => e.intent !== null && e.router !== null)).toBe(true);
    record.settings.activeNetwork = null; await runtime.refresh(); await runtime.idle();
    expect(runtime.tcpEndpoints()).toEqual([]); expect(close).toHaveBeenCalledTimes(2);
    expect(gateway.remove).toHaveBeenCalledTimes(2); expect(record.direct!.entries).toHaveLength(0);
  });
  it('does not publish or resurrect a mapping completed after OFF', async () => {
    const { record, runtime, gateway } = setup();
    let finish!: () => void; const blocked = new Promise<void>(resolve => { finish = resolve; });
    gateway.prepare = async (_adapter, request, _process, before) => { const mapping = { ...request, method: 'pcp' as const, gateway: '192.168.1.1', address: request.family === 'ipv6' ? request.localAddress : '8.8.8.8', publicPort: request.localPort, renewedAt: Date.now(), expiresAt: Date.now() + 3600000 };
      await before(mapping); await blocked; return mapping; };
    await runtime.refresh(); await vi.waitFor(() => expect(record.direct!.entries.some(e => e.intent)).toBe(true));
    record.settings.activeNetwork = null; await runtime.refresh(); finish(); await runtime.idle();
    expect(runtime.tcpEndpoints()).toEqual([]); expect(record.direct!.entries).toEqual([]);
  });
  it('keeps residual router failures visible and retains healthy IPv4 when IPv6 permission fails', async () => {
    const { record, runtime, windows, gateway } = setup();
    windows.allow.mockImplementation(async grant => { if (grant.address.includes(':')) throw new Error('CANCELLED'); });
    await runtime.refresh(); await runtime.idle(); expect(runtime.tcpEndpoints().map(e => e.family)).toEqual(['ipv4']);
    gateway.remove = async () => { throw new Error('OFFLINE'); };
    record.settings.activeNetwork = null; await runtime.refresh(); await runtime.idle();
    expect(runtime.view().residual.some(e => e.kind === 'router')).toBe(true); expect(runtime.tcpEndpoints()).toEqual([]);
  });
  it('does not rotate a prepared TCP invitation when a device allocation is added', async () => {
    const { record, runtime } = setup(); await runtime.refresh(); await runtime.idle(); const invitation = record.direct!.invitation.token;
    record.direct!.devices[randomUUID()] = { comments: newDirectCredential(), obs: newDirectCredential(), pending: true, registered: false };
    await runtime.refresh(); await runtime.idle(); expect(record.direct!.invitation.token).toBe(invitation);
  });
  it('公開tuple変更で候補IDと実到達の判定を更新し、正常な既存のTCP・SRT接続は維持する', async () => {
    const { record, runtime, receivers, configs, gateway, close, listen, advance, time } = setup(); const id = allocate(record);
    await runtime.refresh(); await runtime.idle(); let connection = 'worker:1';
    receivers.view.mockImplementation(key => ({ state: 'receiving', receivedBytes: 10, listeners: configs.get(key)?.listeners ?? [],
      activeListener: { family: 'ipv4', address: '192.168.1.9', port: 31000 }, connectionIdentity: connection }));
    const beforeTcp = runtime.tcpEndpoints(); const beforeSrt = runtime.srtEndpoints(id); const tcp = record.settings.statusPorts.direct!;
    const oldDisconnected = runtime.connected('192.168.1.9', tcp, directHost('8.8.8.8', tcp));
    const oldestDisconnected = runtime.connected('192.168.1.9', tcp, directHost('8.8.8.8', tcp));
    expect(runtime.view().entries.filter(e => e.family === 'ipv4').map(e => e.reachability)).toEqual(['connected', 'connected']);
    expect(runtime.view().entries.filter(e => e.protocol === 'udp' && e.family === 'ipv6').every(e => e.reachability === 'unconfirmed')).toBe(true);
    gateway.renew = async (_adapter, mapping) => ({ ...mapping, ...(mapping.family === 'ipv4' ? { address: '9.9.9.9', publicPort: mapping.publicPort + 1 } : {}), renewedAt: time(), expiresAt: time() + 3600000 });
    advance(1800000); await runtime.refresh(); await runtime.idle();
    for (const [before, after] of [[beforeTcp, runtime.tcpEndpoints()], [beforeSrt, runtime.srtEndpoints(id)]]) {
      expect(after.find(e => e.family === 'ipv4')!.id).not.toBe(before.find(e => e.family === 'ipv4')!.id);
      expect(after.find(e => e.family === 'ipv6')!.id).toBe(before.find(e => e.family === 'ipv6')!.id);
    }
    expect(runtime.view().entries.filter(e => e.family === 'ipv4').every(e => e.reachability === 'unconfirmed')).toBe(true);
    expect(listen).toHaveBeenCalledTimes(2); expect(close).not.toHaveBeenCalled();
    runtime.connected('192.168.1.9', tcp, directHost('9.9.9.9', tcp + 1));
    oldDisconnected(); connection = 'worker:2';
    expect(runtime.view().entries.filter(e => e.family === 'ipv4').every(e => e.reachability === 'connected')).toBe(true);
    gateway.renew = async (_adapter, mapping) => ({ ...mapping, ...(mapping.family === 'ipv4' ? { address: '8.8.8.8', publicPort: mapping.localPort } : {}), renewedAt: time(), expiresAt: time() + 3600000 });
    advance(1800000); await runtime.refresh(); await runtime.idle();
    expect(runtime.view().entries.filter(e => e.family === 'ipv4').every(e => e.reachability === 'unconfirmed')).toBe(true);
    runtime.connected('192.168.1.9', tcp, directHost('8.8.8.8', tcp)); oldestDisconnected(); connection = 'worker:3';
    expect(runtime.view().entries.filter(e => e.family === 'ipv4').every(e => e.reachability === 'connected')).toBe(true);
    await runtime.stop();
  });
  it('同じ内部UDP待受へ向く複数の手動公開候補は、端末が受信中でも候補別の実到達を未確認にする', async () => {
    const { record, runtime, receivers, configs } = setup(); const id = allocate(record); let connection = 'worker:1';
    record.settings.direct = { ...record.settings.direct!, mode: 'manual',
      manualEndpoints: [{ id: randomUUID(), family: 'ipv4', address: '8.8.8.8', tcpPort: 3001 }],
      manualSrtEndpoints: ['8.8.8.8', '9.9.9.9'].map(address => ({ id: randomUUID(), deviceId: id, family: 'ipv4', address, outdoorPort: 31000 })) };
    await runtime.refresh(); await runtime.idle(); await runtime.manualConfirm(record.direct!.revision); await runtime.manualConfirm(record.direct!.revision, id);
    receivers.view.mockImplementation(key => ({ state: 'receiving', receivedBytes: 10, listeners: configs.get(key)?.listeners ?? [],
      activeListener: { family: 'ipv4', address: '192.168.1.9', port: 31000 }, connectionIdentity: connection }));
    expect(runtime.srtEndpoints(id)).toHaveLength(2);
    const candidates = runtime.view().entries.filter(e => e.protocol === 'udp'); expect(candidates).toHaveLength(2);
    expect(candidates.every(e => e.prepared && e.reachability === 'unconfirmed' && e.warning?.includes('候補別'))).toBe(true);
    expect(runtime.receiver(id).state).toBe('receiving');
    record.settings.direct!.manualSrtEndpoints.splice(1); await runtime.refresh(); await runtime.idle(); await runtime.manualConfirm(record.direct!.revision, id);
    const remaining = runtime.view().entries.find(e => e.protocol === 'udp' && e.prepared)!;
    expect(remaining.address).toBe('8.8.8.8'); expect(remaining.reachability).toBe('unconfirmed'); expect(runtime.receiver(id).state).toBe('receiving');
    connection = 'worker:2'; expect(runtime.view().entries.find(e => e.id === remaining.id)!.reachability).toBe('connected');
    record.settings.direct!.manualSrtEndpoints.push({ id: randomUUID(), deviceId: id, family: 'ipv4', address: '9.9.9.9', outdoorPort: 31000 });
    await runtime.refresh(); await runtime.idle(); await runtime.manualConfirm(record.direct!.revision, id);
    const expanded = runtime.view().entries.filter(e => e.protocol === 'udp' && e.prepared);
    expect(expanded).toHaveLength(2);
    expect(expanded.every(e => e.reachability === 'unconfirmed')).toBe(true);
    record.settings.direct!.manualSrtEndpoints.splice(1);
    await runtime.refresh(); await runtime.idle(); await runtime.manualConfirm(record.direct!.revision, id);
    const reduced = runtime.view().entries.find(e => e.protocol === 'udp' && e.prepared)!;
    expect(reduced.address).toBe('8.8.8.8'); expect(reduced.reachability).toBe('unconfirmed');
    expect(runtime.receiver(id).state).toBe('receiving'); await runtime.stop();
  });
  it('ON中の証明書更新は保護保存後に既存TLS待受へ反映し、PC鍵・接続先・正常な接続を保持する', async () => {
    const { record, runtime, advance, listen, updateIdentity, close } = setup();
    await runtime.refresh(); await runtime.idle(); const original = structuredClone(record.direct!.identity); const endpoints = runtime.tcpEndpoints();
    const port = record.settings.statusPorts.direct!; runtime.connected('192.168.1.9', port, directHost('8.8.8.8', port));
    advance(350 * 86400000); await runtime.refresh(); await runtime.idle();
    expect(record.direct!.identity!.pcKey).toEqual(original!.pcKey); expect(record.direct!.identity!.certificate).not.toBe(original!.certificate);
    expect(updateIdentity).toHaveBeenCalledTimes(2); expect(updateIdentity).toHaveBeenCalledWith(record.direct!.identity);
    expect(runtime.tcpEndpoints()).toEqual(endpoints); expect(listen).toHaveBeenCalledTimes(2); expect(close).not.toHaveBeenCalled();
    expect(runtime.view().entries.find(e => e.family === 'ipv4')!.reachability).toBe('connected'); await runtime.stop();
  });
});
