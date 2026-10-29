import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import { SmartphoneController } from '../src/main/smartphone/smartphone-controller';
import { OutdoorReceivers } from '../src/main/outdoor/outdoor-receivers';
import type { ReceiverWorkerFactory } from '../src/main/outdoor/outdoor-receivers';
import type { SmartphoneRecord } from '../src/main/smartphone/smartphone-store';
import { createSmartphoneRecord, SmartphoneStorageError } from '../src/main/smartphone/smartphone-store';
import type { OutdoorReport } from '../src/shared/outdoor';
import request from 'supertest';
import { createHttpApplication } from '../src/main/server/local-server';
import commonFixture from './fixtures/common-registration-invitation.json';
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { SmartphoneEnrollment } from '../src/shared/smartphone';

const issued = new Map<string, import('../src/shared/smartphone').SmartphoneRegistration>();
async function registerPhone(controller: SmartphoneController, name: string) {
  const result = await controller.enroll('lan', 'Bearer ' + controller.invitation('lan').token, { invitationVersion: 11, clientId: randomUUID(), clientSecret: 'f'.repeat(64), name });
  issued.set(result.deviceId, result); await controller.refresh(); return result;
}
function currentRegistration(controller: SmartphoneController, id: string, network: 'lan' | 'tailscale') {
  return controller.updatedRegistration(id, network, issued.get(id)!.registrationUpdate);
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const finish of cleanup.splice(0)) await finish(); });
async function setup(saved: SmartphoneRecord | null = null, invitationSaveFails = false, includeDirect = false, lanNetwork?: Pick<import('../src/main/smartphone/direct-windows').DirectWindows, 'list'>) {
  const receiverFactory = vi.fn<ReceiverWorkerFactory>((_config, change) => {
    change({ version: 1, state: 'listening', sessionId: null, generation: 0, receivedBytes: 0,
      videoFrames: 0, audioFrames: 0, videoPts: -1, audioPts: -1, lostPackets: 0, droppedPackets: 0 });
    return { close: vi.fn(async () => undefined) };
  });
  const receivers = new OutdoorReceivers(receiverFactory);
  const directReceivers = new OutdoorReceivers(receiverFactory);
  const state = new AppState(createDefaultSettings());
  const obsStore = { load: vi.fn(async () => null), save: vi.fn(async () => undefined) };
  const obs = new ObsControlController({ store: obsStore }); await obs.start();
  const store = { load: vi.fn(async (): Promise<SmartphoneRecord | null> => saved), save: vi.fn(async (_record: SmartphoneRecord) => undefined) };
  if (invitationSaveFails) store.save.mockRejectedValueOnce(new Error('disk'));
  const calls: string[] = [];
  const mobile = {
    start: vi.fn(async () => {
      const settings = state.snapshot().settings.mobileSpeech;
      const network = settings.lanEnabled ? 'lan' : settings.tailscaleEnabled ? 'tailscale' : null;
      calls.push(`start:${network}`);
      state.setMobileUrls(network ? [{ kind: network, url: `http://${network === 'lan' ? '192.168.1.2' : '100.64.0.1'}:3000/comments`, available: true }] : []);
    }),
    stop: vi.fn(async () => { calls.push('stop:comments'); state.setMobileUrls([]); }),
  };
  const failures = new Map<number, () => void>();
  const listen = vi.fn(async (_app, address: string, port: number, onError: () => void) => {
    failures.set(port, onError);
    calls.push(`listen:${address}:${port}`);
    return { close: async () => { calls.push(`close:${address}:${port}`); } };
  });
  const controller = new SmartphoneController({ store, state, obs, mobile,
    managementPorts: () => [3000], listen, receivers, lanNetwork,
    direct: includeDirect ? { receivers: directReceivers, program: 'casmate.exe', workerProgram: 'receiver.exe',
      listen: async () => { throw new Error('Unexpected direct listener'); } } : undefined });
  cleanup.push(async () => { await controller.stop(); await obs.stop(); await state.shutdown(); });
  await controller.start();
  return { controller, store, state, obs, calls, listen, failures, receiverFactory, receivers, directReceivers, mobile };
}

describe('排他的なスマホ公開と端末認証', () => {
  it('移行失敗と再起動後も原本・進行記録の手動退避を案内し、秘密や内部例外を公開しない', async () => {
    const { controller, store, state } = await setup(); await controller.stop();
    const error = new SmartphoneStorageError('C:/profile/smartphone.protected', new Error('secret-token-should-not-leak'));
    store.load.mockRejectedValue(error);
    for (let restart = 0; restart < 2; restart++) {
      await controller.start(); const view = controller.snapshot();
      expect(view.available).toBe(false); expect(view.warning).toContain('smartphone.protected.compatibility-reset.json');
      expect(view.warning).toContain('手動で退避'); expect(view.warning).toContain('.retired-*.backup');
      expect(JSON.stringify(state.snapshot())).not.toContain('secret-token-should-not-leak');
      await controller.stop();
    }
  });
  it.each(['configure', 'add'] as const)('招待の初期保存中は %s を受け付けず、保存完了後に元の台帳で編集できる', async operation => {
    const record = createSmartphoneRecord();
    record.settings.activeNetwork = 'tailscale';
    delete record.invitations;
    const { controller, store, mobile, listen } = await setup();
    await controller.stop();
    store.load.mockResolvedValue(record);
    let finishSave!: () => void;
    store.save.mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
    store.save.mockClear(); mobile.start.mockClear(); listen.mockClear();
    const starting = controller.start();
    await new Promise<void>(resolve => setImmediate(resolve));
    try {
      expect(store.save).toHaveBeenCalledOnce();
      const edit = () => operation === 'configure'
        ? controller.configure({ activeNetwork: 'lan' }) : controller.add('先行する端末');
      await expect(edit()).rejects.toThrow('スマホ台帳を利用できません');
      expect(controller.snapshot().available).toBe(false);
      expect(store.save).toHaveBeenCalledOnce();
      expect(mobile.start).not.toHaveBeenCalled(); expect(listen).not.toHaveBeenCalled();

      finishSave(); await starting;
      expect(controller.snapshot().available).toBe(true);
      expect(controller.snapshot().settings.activeNetwork).toBe('tailscale');
      expect(controller.snapshot().devices).toEqual([]);
      expect(record.invitations).toBeUndefined();
      await edit();
      if (operation === 'configure') expect(controller.snapshot().settings.activeNetwork).toBe('lan');
      else expect(controller.snapshot().devices.map(device => device.name)).toEqual(['先行する端末']);
    } finally { finishSave(); await starting; }
  });

  it('起動時の台帳読込中に終了しても遅い読込結果から公開を再開しない', async () => {
    const { controller, store, state, mobile, listen } = await setup();
    await controller.stop();
    let finishLoad!: (record: SmartphoneRecord) => void;
    store.load.mockReturnValueOnce(new Promise(resolve => { finishLoad = resolve; }));
    mobile.start.mockClear(); listen.mockClear(); store.save.mockClear();
    const subscribe = vi.spyOn(state, 'subscribe');
    const intervals = vi.spyOn(global, 'setInterval');
    const starting = controller.start();
    try {
      await controller.stop();
      finishLoad(createSmartphoneRecord()); await starting;
      expect(mobile.start).not.toHaveBeenCalled(); expect(listen).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
      expect(intervals).not.toHaveBeenCalled();
      expect(controller.snapshot().available).toBe(false);
    } finally { finishLoad(createSmartphoneRecord()); await starting; intervals.mockRestore(); subscribe.mockRestore(); }
  });

  it('起動時の新規台帳保存中に終了しても保存後に公開を開始しない', async () => {
    const { controller, store, mobile, listen } = await setup();
    await controller.stop();
    let finishSave!: () => void;
    store.save.mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
    mobile.start.mockClear(); listen.mockClear();
    const starting = controller.start();
    await new Promise<void>(resolve => setImmediate(resolve));
    try {
      await controller.stop();
      finishSave(); await starting;
      expect(mobile.start).not.toHaveBeenCalled(); expect(listen).not.toHaveBeenCalled();
      expect(controller.snapshot().available).toBe(false);
    } finally { finishSave(); await starting; }
  });

  it('起動時のコメント公開準備中に終了しても状態購読と更新タイマーを再作成しない', async () => {
    const { controller, state, mobile, listen } = await setup();
    await controller.stop();
    let finishMobile!: () => void;
    mobile.start.mockReturnValueOnce(new Promise(resolve => { finishMobile = resolve; }));
    const subscribe = vi.spyOn(state, 'subscribe');
    const intervals = vi.spyOn(global, 'setInterval');
    const refresh = vi.spyOn(controller, 'refresh');
    listen.mockClear(); mobile.stop.mockClear();
    const starting = controller.start();
    await new Promise<void>(resolve => setImmediate(resolve));
    try {
      await controller.stop();
      finishMobile(); await starting;
      expect(mobile.stop).toHaveBeenCalledOnce(); expect(listen).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
      expect(intervals).not.toHaveBeenCalled();
    } finally { finishMobile(); await starting; intervals.mockRestore(); subscribe.mockRestore(); refresh.mockRestore(); }
  });

  it('終了した起動の遅い台帳読込が次の起動の選択と待受を上書きしない', async () => {
    const { controller, store, mobile, listen } = await setup();
    await controller.stop();
    const previous = createSmartphoneRecord(); previous.settings.activeNetwork = 'tailscale';
    const current = createSmartphoneRecord(); current.settings.activeNetwork = 'lan';
    let finishLoad!: (record: SmartphoneRecord) => void;
    store.load.mockReturnValueOnce(new Promise(resolve => { finishLoad = resolve; })).mockResolvedValueOnce(current);
    mobile.start.mockClear(); listen.mockClear();
    const previousStart = controller.start();
    await controller.stop();
    try {
      await controller.start();
      finishLoad(previous); await previousStart;
      expect(controller.snapshot().settings.activeNetwork).toBe('lan');
      expect(controller.snapshot().networks.lan.registrationReady).toBe(true);
      expect(controller.snapshot().networks.tailscale.registrationReady).toBe(false);
      expect(mobile.start).toHaveBeenCalledOnce(); expect(listen).toHaveBeenCalledOnce();
    } finally { finishLoad(previous); await previousStart; }
  });

  it('起動時の接続先保存中に終了した場合は保存後に登録待受を開かない', async () => {
    const { controller, state, store, mobile, listen } = await setup();
    await controller.configure({ activeNetwork: 'lan' }); await controller.add('A');
    const record = structuredClone(store.save.mock.calls.at(-1)![0]);
    record.devices[0].video.lan!.address = '192.168.1.9';
    await controller.stop(); store.load.mockResolvedValue(record);
    let finishSave!: () => void;
    store.save.mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
    const subscribe = vi.spyOn(state, 'subscribe');
    listen.mockClear(); mobile.stop.mockClear();
    const starting = controller.start();
    await new Promise<void>(resolve => setImmediate(resolve));
    const stopping = controller.stop();
    try {
      finishSave(); await starting; await stopping;
      expect(listen).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
      expect(mobile.stop).toHaveBeenCalledOnce();
    } finally { finishSave(); await starting; await stopping; subscribe.mockRestore(); }
  });

  it('起動時の登録待受準備中に終了した場合は遅い待受を閉じて更新を再開しない', async () => {
    const record = createSmartphoneRecord(); record.settings.activeNetwork = 'lan';
    const { controller, state, store, listen } = await setup(record);
    await controller.stop(); store.load.mockResolvedValue(record);
    let finishListener!: (listener: { close(): Promise<void> }) => void;
    listen.mockReturnValueOnce(new Promise(resolve => { finishListener = resolve; }));
    const close = vi.fn(async () => undefined);
    const subscribe = vi.spyOn(state, 'subscribe');
    const intervals = vi.spyOn(global, 'setInterval');
    const starting = controller.start();
    await new Promise<void>(resolve => setImmediate(resolve));
    const stopping = controller.stop();
    try {
      finishListener({ close }); await starting; await stopping;
      expect(close).toHaveBeenCalledOnce(); expect(subscribe).not.toHaveBeenCalled();
      expect(intervals).not.toHaveBeenCalled();
      expect(controller.snapshot().networks.lan.registrationReady).toBe(false);
    } finally { finishListener({ close }); await starting; await stopping; intervals.mockRestore(); subscribe.mockRestore(); }
  });

  it('終了時に遅い映像受信の停止を待たず登録待受とコメント公開の停止を開始する', async () => {
    const { controller, receivers, mobile, calls } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    let finishReceiver!: () => void;
    const receiverStopped = new Promise<void>(resolve => { finishReceiver = resolve; });
    vi.spyOn(receivers, 'stop').mockReturnValueOnce(receiverStopped);
    mobile.stop.mockClear(); calls.length = 0;
    const stopping = controller.stop();
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(calls).toContain('close:192.168.1.2:3001');
      expect(mobile.stop).toHaveBeenCalledOnce();
    } finally { finishReceiver(); await stopping; }
  });

  it('終了時の受信停止に失敗しても登録待受とコメント公開を停止する', async () => {
    const { controller, receivers, mobile, calls } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    vi.spyOn(receivers, 'stop').mockRejectedValueOnce(new Error('receiver close'));
    mobile.stop.mockClear(); calls.length = 0;
    await expect(controller.stop()).rejects.toThrow('receiver close');
    expect(calls).toContain('close:192.168.1.2:3001');
    expect(mobile.stop).toHaveBeenCalledOnce();
  });

  it('終了時に遅い直接接続の閉鎖を待たずLANの待受とコメント公開の停止を開始する', async () => {
    const { controller, directReceivers, mobile, calls } = await setup(null, false, true);
    await controller.configure({ activeNetwork: 'lan' });
    await new Promise<void>(resolve => setImmediate(resolve));
    let finishDirect!: () => void;
    const directStopped = new Promise<void>(resolve => { finishDirect = resolve; });
    vi.spyOn(directReceivers, 'stop').mockReturnValueOnce(directStopped);
    mobile.stop.mockClear(); calls.length = 0;
    const stopping = controller.stop();
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(calls).toContain('close:192.168.1.2:3001');
      expect(mobile.stop).toHaveBeenCalledOnce();
    } finally { finishDirect(); await stopping; }
  });

  it('終了時は台帳保存の完了を待たず公開停止を始め、保存順序と変更内容を保つ', async () => {
    const { controller, store, mobile, calls } = await setup();
    await controller.configure({ activeNetwork: 'lan' }); await controller.add('A');
    const id = controller.snapshot().devices[0].id;
    let finishSave!: () => void;
    const saved = new Promise<void>(resolve => { finishSave = resolve; });
    store.save.mockReturnValueOnce(saved);
    const renaming = controller.rename(id, 'B');
    await new Promise<void>(resolve => setImmediate(resolve));
    mobile.stop.mockClear(); calls.length = 0;
    const stopping = controller.stop();
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(calls).toContain('close:192.168.1.2:3001'); expect(mobile.stop).toHaveBeenCalledOnce();
    } finally { finishSave(); await renaming; await stopping; }
    expect(controller.snapshot().devices[0].name).toBe('B');
    expect(calls).toContain('close:192.168.1.2:3001');
    expect(mobile.stop).toHaveBeenCalledOnce();
  });

  it.each([false, true])('保存済み更新案内を実際の警告から分離する（起動保存失敗=%s）', async failed => {
    const record = createSmartphoneRecord(); record.migrationNotice = '受信方式を更新しました。共通QRで再登録してください。';
    if (failed) delete record.invitations;
    const { controller } = await setup(record, failed);
    expect(controller.updateNotice).toBe(record.migrationNotice);
    if (failed) expect(controller.snapshot().warning).toContain('保存できません');
    else expect(controller.snapshot().warning).toBeNull();
  });
  it('PC保存の登録成立を経路ごとに投影し、準備割当・OFF・保存失敗と区別する', async () => {
    const { controller, store, state } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    const initial = await registerPhone(controller, 'A');
    const profile = () => controller.snapshot().devices.find(device => device.id === initial.deviceId)!.profiles;
    expect(profile().lan.registered).toBe(true); expect(profile().tailscale.registered).toBe(false);
    await controller.configure({ activeNetwork: 'tailscale' });
    expect(controller.snapshot().devices[0].obsLocalPort).toBeGreaterThan(0);
    expect(profile().tailscale.registered).toBe(false);
    const saved = store.save.mock.calls.at(-1)![0].devices.find(device => device.id === initial.deviceId)!;
    const request = { invitationVersion: 11, clientId: saved.client!.id, clientSecret: 'f'.repeat(64), name: 'A' };
    store.save.mockRejectedValueOnce(new Error('disk'));
    const authorization = 'Bearer ' + controller.invitation('tailscale').token;
    await expect(controller.enroll('tailscale', authorization, request)).rejects.toThrow('disk');
    expect(profile().tailscale.registered).toBe(false);
    await controller.enroll('tailscale', authorization, request);
    expect(profile().tailscale.registered).toBe(true);
    await controller.configure({ activeNetwork: null });
    expect(profile().lan.registered).toBe(true); expect(profile().tailscale.registered).toBe(true);
    expect(JSON.stringify(state.snapshot())).not.toContain(initial.registrationUpdate.token);
  });
  it('映像OFF・削除・経路切替で受信を実際に閉じ、別端末とOBS用ポートを維持する', async () => {
    const { controller, receiverFactory } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    await controller.add('A'); await controller.add('B');
    const [a, b] = controller.snapshot().devices;
    const input = controller.obsInput(a.id);
    const first = receiverFactory.mock.results[0].value;
    const second = receiverFactory.mock.results[1].value;
    await controller.regenerate(a.id);
    expect(first.close).toHaveBeenCalledOnce(); expect(second.close).not.toHaveBeenCalled();
    expect(controller.obsInput(a.id)).toBe(input);
    const renewed = receiverFactory.mock.results[2].value;
    await controller.remove(a.id);
    expect(renewed.close).toHaveBeenCalledOnce(); expect(second.close).not.toHaveBeenCalled();
    await controller.configure({ activeNetwork: null });
    expect(second.close).toHaveBeenCalledOnce();
    expect(controller.snapshot().devices[0].profiles.lan.receiver?.state).toBe('stopped');
    await controller.configure({ activeNetwork: 'tailscale' });
    expect(receiverFactory.mock.calls.at(-1)![0]).toMatchObject({ id: `${b.id}:tailscale`, address: '100.64.0.1' });
    await controller.configure({ activeNetwork: null });
    expect(receiverFactory.mock.results.at(-1)!.value.close).toHaveBeenCalledOnce();
  });

  it('用途別資格を照合し、映像の世代と他端末を分離する', async () => {
    const { controller, receiverFactory, obs, store } = await setup();
    vi.spyOn(obs, 'view').mockReturnValue({ ...obs.view(), enabled: true, androidEnabled: true });
    await controller.configure({ activeNetwork: 'lan' });
    await registerPhone(controller, 'A'); await registerPhone(controller, 'B');
    const [a, b] = controller.snapshot().devices;
    const qa = await currentRegistration(controller, a.id, 'lan'), qb = await currentRegistration(controller, b.id, 'lan');
    const token = (value: string) => 'Bearer ' + value;
    expect(controller.authenticateControl('lan', token(qa.obsControl!.token), token(qa.outdoor!.token), token(qa.registrationUpdate.token)))
      .toMatchObject({ deviceId: a.id, video: true });
    expect(controller.authenticateControl('lan', undefined, token(qa.outdoor!.token), token(qa.registrationUpdate.token)))?.toMatchObject({ obs: null });
    expect(controller.authenticateControl('lan', token(qa.outdoor!.token))).toBeNull();
    expect(controller.authenticateControl('lan', token(qa.obsControl!.token), token(qb.outdoor!.token))).toBeNull();
    expect(controller.authenticateControl('tailscale', token(qa.obsControl!.token))).toBeNull();
    const sessionId = randomUUID(); const payload = { sessionId, generation: 2 };
    const sample = { version: 1 as const, state: 'receiving' as const, sessionId, generation: 2,
      receivedBytes: 10000, videoFrames: 10, audioFrames: 20, lostPackets: 0, droppedPackets: 0, videoPts: 90000, audioPts: 90000 };
    receiverFactory.mock.calls[0][1](sample);
    expect(controller.feedback(a.id, 'lan', payload)).toEqual({ version: 1, sample });
    expect(controller.feedback(a.id, 'lan', { ...payload, generation: 1 }).sample).toBeNull();
    expect(controller.feedback(b.id, 'lan', payload).sample).toBeNull();
    expect(() => controller.feedback(a.id, 'lan', { ...payload, extra: true })).toThrow();
    expect(qa.outdoor).not.toHaveProperty('statusPort'); expect(qa.obsControl).not.toHaveProperty('endpoints');
    const saved = store.save.mock.calls.at(-1)![0];
    expect(saved.devices.find(d => d.id === a.id)!.video.lan.token).toBe(qa.outdoor!.token);
    await controller.regenerate(a.id);
    expect(controller.authenticateControl('lan', token(qa.obsControl!.token))).toBeNull();
  });

  it('保存成功後に旧待受をすべて閉じてから新待受を開き、非選択側の編集では接続を変えない', async () => {
    const { controller, store, calls, state } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    calls.length = 0;
    await controller.configure({ network: 'tailscale', statusPort: 3001 });
    expect(calls).toEqual([]);
    store.save.mockRejectedValueOnce(new Error('disk'));
    await expect(controller.configure({ activeNetwork: 'tailscale' })).rejects.toThrow('disk');
    expect(controller.snapshot().settings.activeNetwork).toBe('lan'); expect(calls).toEqual([]);
    await controller.configure({ activeNetwork: 'tailscale' });
    expect(calls).toEqual(['close:192.168.1.2:3001', 'stop:comments', 'start:tailscale', 'listen:100.64.0.1:3001']);
    expect(state.snapshot().settings.mobileSpeech).toMatchObject({ lanEnabled: false, tailscaleEnabled: true });
    await state.updateSettings('mobileSpeech', { lanEnabled: true, tailscaleEnabled: true, bitrateKbps: 64 });
    expect(state.snapshot().settings.mobileSpeech).toEqual({ lanEnabled: false, tailscaleEnabled: true, bitrateKbps: 64 });
    await controller.configure({ activeNetwork: null });
    expect(controller.snapshot().settings.activeNetwork).toBeNull();
  });

  it('複数端末へ異なるポートと秘密を発行し、状態報告の認証先を他端末に偽装できない', async () => {
    const { controller, state } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    await registerPhone(controller, 'A'); await registerPhone(controller, 'B');
    const [a, b] = controller.snapshot().devices;
    const qa = await currentRegistration(controller, a.id, 'lan'); const qb = await currentRegistration(controller, b.id, 'lan');
    expect(qa).toMatchObject({ version: 15, network: 'lan', comments: { url: 'http://192.168.1.2:3000/comments' } });
    expect(qa.outdoor).not.toHaveProperty('localPort');
    expect(qa.outdoor!.obsPort).not.toBe(qb.outdoor!.obsPort);
    expect(qa.outdoor!.token).not.toBe(qb.outdoor!.token);
    expect(JSON.stringify(state.snapshot())).not.toContain(qa.outdoor!.token);
    expect(controller.authenticateVideo('lan', `Bearer ${qa.outdoor!.token}`)).toBe(a.id);
    const report: OutdoorReport = { version: 1, registrationId: qa.outdoor!.registrationId, revision: qa.outdoor!.revision,
      sessionId: 'session', sequence: 1, status: 'sending', microphone: 'enabled', errorCode: 'NONE' };
    expect(controller.acceptReport(b.id, 'lan', report)).toBe(false);
    expect(controller.acceptReport(a.id, 'lan', report)).toBe(true);
    controller.touchReport(a.id, 'lan', 'video-connection');
    controller.releaseReport(a.id, 'lan', 'obs-only-connection');
    expect(controller.snapshot().devices.find(d => d.id === a.id)!.profiles.lan.stale).toBe(false);
    controller.releaseReport(a.id, 'lan', 'video-connection');
    expect(controller.snapshot().devices.find(d => d.id === a.id)!.profiles.lan.stale).toBe(true);
    controller.touchReport(a.id, 'lan', 'replacement');
    expect(controller.snapshot().devices.find(d => d.id === a.id)!.profiles.lan.stale).toBe(false);
    await controller.remove(a.id);
    expect(controller.authenticateVideo('lan', `Bearer ${qa.outdoor!.token}`)).toBeNull();
    expect(controller.authenticateVideo('lan', `Bearer ${qb.outdoor!.token}`)).toBe(b.id);
    await controller.add('C');
    expect(controller.snapshot().devices.at(-1)!.profiles.lan.obsPort).not.toBe(qa.outdoor!.obsPort);
  });

  it('待受失敗では選択を保持し、自動的に旧経路へ戻さない', async () => {
    const { controller, listen } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    listen.mockRejectedValueOnce(new Error('listen'));
    await controller.configure({ activeNetwork: 'tailscale' });
    expect(controller.snapshot()).toMatchObject({ settings: { activeNetwork: 'tailscale' }, networks: { tailscale: { videoReady: false } } });
    expect(controller.snapshot().networks.tailscale.warning).toContain('待受');
  });

  it('コメントの待受失敗で映像状態とOBS操作を止めず、QRだけは準備完了を待つ', async () => {
    const { controller, state, obs, calls } = await setup();
    vi.spyOn(obs, 'view').mockReturnValue({ ...obs.view(), enabled: true, androidEnabled: true });
    await controller.configure({ activeNetwork: 'lan' });
    await controller.add('A'); const id = controller.snapshot().devices[0].id;
    calls.length = 0;
    state.setMobileUrls([{ kind: 'lan', url: 'http://192.168.1.2:3000/comments', available: false }]);
    await controller.refresh();
    expect(controller.snapshot().networks.lan).toMatchObject({ commentsUrl: null, videoReady: true, obsReady: true });
    expect(calls).toEqual([]);
    expect(controller.obsInput(id)).toMatch(/^udp:\/\/127\.0\.0\.1:\d+\?localaddr=127\.0\.0\.1&/u);
    expect(controller.obsInput(id)).not.toContain('passphrase');
    expect(() => controller.invitation('lan')).toThrow();
  });

  it('連続切替を直列化し、最後がOFFなら遅い待受を残さない', async () => {
    const { controller, calls, state } = await setup();
    await Promise.all([
      controller.configure({ activeNetwork: 'lan' }),
      controller.configure({ activeNetwork: 'tailscale' }),
      controller.configure({ activeNetwork: null }),
    ]);
    expect(controller.snapshot().settings.activeNetwork).toBeNull();
    expect(state.snapshot().mobileSpeech.urls).toEqual([]);
    expect(calls.filter(call => call.startsWith('listen:'))).toHaveLength(2);
    expect(calls.filter(call => call.startsWith('close:'))).toHaveLength(2);
  });

  it('待受成功後のエラーは対象だけを閉じ、古いエラーで再開済み待受を閉じない', async () => {
    const { controller, obs, failures, calls, listen, state } = await setup();
    vi.spyOn(obs, 'view').mockReturnValue({ ...obs.view(), enabled: true, androidEnabled: true });
    await controller.configure({ activeNetwork: 'lan' });
    const fail = failures.get(3001)!; calls.length = 0;
    fail(); listen.mockRejectedValueOnce(new Error('retry failed')); await controller.refresh();
    expect(controller.snapshot().networks.lan).toMatchObject({ videoReady: false, obsReady: false });
    expect(calls).toEqual(['close:192.168.1.2:3001']);
    expect(state.snapshot().mobileSpeech.urls[0].available).toBe(true);
    await controller.refresh(); expect(controller.snapshot().networks.lan.videoReady).toBe(true);
    calls.length = 0; fail(); await controller.refresh();
    expect(calls).toEqual([]); expect(controller.snapshot().networks.lan.videoReady).toBe(true);
  });



  it('台帳の読込失敗を未使用と扱わず、原本を保持して編集を停止する', async () => {
    const state = new AppState(createDefaultSettings());
    const obs = new ObsControlController({ store: { load: async () => null, save: async () => undefined } });
    const store = { load: async () => { throw new Error('decrypt'); }, save: vi.fn() };
    const mobile = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    const controller = new SmartphoneController({ store, state, obs, mobile, managementPorts: () => [3000], receivers: new OutdoorReceivers(() => ({ close: async () => undefined })) });
    await obs.start(); await controller.start();
    expect(controller.snapshot().available).toBe(false); expect(controller.snapshot().settings.activeNetwork).toBeNull();
    await expect(controller.add('A')).rejects.toThrow(); expect(store.save).not.toHaveBeenCalled(); expect(mobile.start).toHaveBeenCalledOnce();
    await controller.stop(); await obs.stop(); await state.shutdown();
  });
});

describe('ネットワーク共通QRの自動登録', () => {
  it('管理面の共通OBS入力はOFF・別経路でも同一で、旧network要求と未認証要求を拒否する', async () => {
    const { controller, state, obs } = await setup(); await controller.configure({ activeNetwork: 'lan' }); await controller.add('Pixel 10a');
    const id = controller.snapshot().devices[0].id; const input = controller.obsInput(id);
    await controller.configure({ activeNetwork: 'tailscale' }); expect(controller.obsInput(id)).toBe(input);
    await controller.configure({ activeNetwork: null }); expect(controller.obsInput(id)).toBe(input);
    const app = createHttpApplication({ state, obsControl: obs, smartphone: () => controller, port: 3000, operationToken: 'operation' });
    const endpoint = `/api/smartphone/devices/${id}/obs-input`;
    const auth = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'operation' };
    expect((await request(app).post(endpoint).set('Host', auth.Host).send({})).status).toBe(403);
    const copied = await request(app).post(endpoint).set(auth).send({});
    expect(copied.status).toBe(200); expect(copied.body.input).toBe(input); expect(copied.headers['cache-control']).toBe('no-store');
    for (const network of ['lan', 'tailscale', 'direct']) {
      const old = await request(app).post(endpoint).set(auth).send({ network });
      expect(old.status).toBe(400); expect(old.body.message).toContain('画面を更新');
    }
  });
  const phone = (): SmartphoneEnrollment => ({ invitationVersion: 11 as const, clientId: randomUUID(), clientSecret: 'a'.repeat(64), name: 'Android' });

  it('コメントだけでも共通QRを発行し、同時再試行・再起動・経路追加で端末とポートを重複させない', async () => {
    const { controller, store, state } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    const invite = controller.invitation('lan'); const a = phone(); const b = phone();
    expect(invite).toMatchObject({ version: 11, network: 'lan', registrationPort: 3001 });
    expect(controller.snapshot().networks.lan).toMatchObject({ registrationReady: true });
    const results = await Promise.all([controller.enroll('lan', `Bearer ${invite.token}`, a), controller.enroll('lan', `Bearer ${invite.token}`, a), controller.enroll('lan', `Bearer ${invite.token}`, b)]);
    expect(results[0]).toEqual(results[1]); expect(results[2].deviceId).not.toBe(results[0].deviceId);
    expect(results[0].preparation.video).toBe('preparing'); expect(controller.snapshot().devices).toHaveLength(2);
    expect(new Set(controller.snapshot().devices.map(d => d.profiles.lan.obsPort)).size).toBe(2);
    expect(controller.snapshot().devices.every(d => d.profiles.tailscale.obsPort === 0)).toBe(true);
    expect(JSON.stringify(state.snapshot())).not.toContain(invite.token);
    expect(JSON.stringify(store.save.mock.calls.at(-1)![0])).not.toContain(a.clientSecret);
    const saved = structuredClone(store.save.mock.calls.at(-1)![0]);
    const second = await setup(saved);
    expect(second.controller.invitation('lan')).toEqual(invite);
    const repeated = await second.controller.enroll('lan', `Bearer ${invite.token}`, a);
    expect(repeated.deviceId).toBe(results[0].deviceId);
    await second.controller.configure({ activeNetwork: 'tailscale' });
    const ts = second.controller.invitation('tailscale');
    const partial = await second.controller.enroll('tailscale', `Bearer ${ts.token}`, a);
    await second.controller.refresh(); const added = await second.controller.updatedRegistration(partial.deviceId, 'tailscale', partial.registrationUpdate);
    expect(added.deviceId).toBe(repeated.deviceId); expect(added.outdoor).toBeDefined();
    expect(second.controller.snapshot().devices).toHaveLength(2);
  });

  it('保存失敗、誤った秘密、旧QRの再試行で端末を作らず、削除・再発行は招待も失効する', async () => {
    const { controller, store } = await setup(); await controller.configure({ activeNetwork: 'lan' });
    const invite = controller.invitation('lan'); const a = phone();
    store.save.mockRejectedValueOnce(new Error('disk'));
    await expect(controller.enroll('lan', `Bearer ${invite.token}`, a)).rejects.toThrow();
    expect(controller.snapshot().devices).toHaveLength(0);
    const initial = await controller.enroll('lan', `Bearer ${invite.token}`, a);
    await controller.refresh(); const first = await controller.updatedRegistration(initial.deviceId, 'lan', initial.registrationUpdate);
    await expect(controller.enroll('lan', `Bearer ${invite.token}`, { ...a, clientSecret: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'REGISTRATION_MISMATCH' });
    await controller.regenerate(first.deviceId);
    await expect(controller.enroll('lan', `Bearer ${invite.token}`, a)).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
    const updated = controller.invitation('lan');
    const renewed = await controller.enroll('lan', `Bearer ${updated.token}`, a);
    expect(renewed.deviceId).toBe(first.deviceId); expect(renewed.outdoor!.obsPort).toBe(first.outdoor!.obsPort);
    expect(renewed.outdoor!.token).not.toBe(first.outdoor!.token);
    await controller.remove(first.deviceId);
    await expect(controller.enroll('lan', `Bearer ${updated.token}`, a)).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
    const freshPartial = await controller.enroll('lan', `Bearer ${controller.invitation('lan').token}`, a);
    await controller.refresh();
    const fresh = await controller.updatedRegistration(freshPartial.deviceId, 'lan', freshPartial.registrationUpdate);
    expect(fresh.deviceId).not.toBe(first.deviceId); expect(fresh.outdoor!.obsPort).not.toBe(first.outdoor!.obsPort);
  });





  it('登録POSTのHost・Origin・接続元・認証・本文を検証し、映像OFFでは状態POSTを受けない', async () => {
    const { controller, listen } = await setup(); await controller.configure({ activeNetwork: 'lan' });
    const handler = listen.mock.calls.at(-1)![0]; const app = express();
    app.use((req, _res, next) => { Object.defineProperty(req.socket, 'localAddress', { value: '192.168.1.2' }); Object.defineProperty(req.socket, 'remoteAddress', { value: '192.168.1.3' }); next(); });
    app.use(handler);
    const invite = controller.invitation('lan'); const a = phone();
    const post = () => request(app).post('/smartphone/enroll').set('Host', '192.168.1.2:3001').set('Authorization', `Bearer ${invite.token}`);
    const ok = await post().send(a); expect(ok.status).toBe(200); expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body.registration).toMatchObject({ version: 12, control: { protocolVersion: 2 } }); expect(ok.body.registration).not.toHaveProperty('speechRecognition');
    const modern = await post().set('X-CasMate-Control-Version', '3').send(a);
    expect(modern.status).toBe(200); expect(modern.body.registration).toMatchObject({ version: 15, control: { protocolVersion: 3 } });
    expect(modern.body.registration.speechRecognition.token).toMatch(/^[a-f0-9]{64}$/u);
    expect(modern.body.registration.registrationUpdate).toEqual(ok.body.registration.registrationUpdate);
    expect(modern.body.registration.updateRevision).toBeGreaterThan(ok.body.registration.updateRevision);
    expect((await post().set('X-CasMate-Control-Version', '99').send(a)).status).toBe(400);
    expect((await post().set('X-CasMate-Speech', 'Bearer unexpected').send(a)).status).toBe(403);
    expect((await post().set('Origin', 'http://192.168.1.2:3001').send(a)).status).toBe(403);
    expect((await post().set('Host', 'attacker.example').send(a)).status).toBe(403);
    expect((await post().set('Authorization', 'Bearer wrong').send(a)).status).toBe(403);
    expect((await post().send({ ...a, extra: true })).status).toBe(400);
    expect((await request(app).post('/outdoor/status').set('Host', '192.168.1.2:3001').send({})).status).toBe(404);
    await controller.configure({ activeNetwork: null }); expect((await post().send(a)).status).toBe(403);
  });

  it('管理面だけで共通QR版11を返し、有効なOBS待受の失敗を黙って省略しない', async () => {
    const { controller, state, obs, listen } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    const app = createHttpApplication({ state, obsControl: obs, smartphone: () => controller, port: 3000, operationToken: 'operation' });
    const endpoint = '/api/smartphone/invitation';
    expect((await request(app).post(endpoint).set('Host', '127.0.0.1:3000').send({ network: 'lan' })).status).toBe(403);
    const result = await request(app).post(endpoint).set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').set('X-CasMate-Token', 'operation').send({ network: 'lan' });
    expect(result.body.invitation).toEqual({ ...commonFixture, version: 11, pcId: expect.any(String), token: expect.any(String) });
    vi.spyOn(obs, 'view').mockReturnValue({ ...obs.view(), enabled: true, androidEnabled: true });
    listen.mockRejectedValueOnce(new Error('listen')); await controller.configure({ network: 'lan', statusPort: 3005 });
    expect(() => controller.invitation('lan')).toThrow();
  });
});

describe('部分登録と用途を分離した登録更新', () => {
  const bearer = (token: string) => `Bearer ${token}`;
  it('現行端末は版2を維持し、版3の認識資格追加をQRなしで取得して版ごとの投影を安定させる', async () => {
    const { controller, store, state } = await setup(); await controller.configure({ activeNetwork: 'lan' });
    const old = await controller.enroll('lan', bearer(controller.invitation('lan').token), {
      invitationVersion: 11, clientId: randomUUID(), clientSecret: 'c'.repeat(64), name: '旧Android' }, 2);
    await controller.refresh(); const previous = await controller.updatedRegistration(old.deviceId, 'lan', old.registrationUpdate, 2);
    expect(previous).toMatchObject({ version: 12, control: { protocolVersion: 2 } }); expect(previous).not.toHaveProperty('speechRecognition');
    const modern = await controller.updatedRegistration(old.deviceId, 'lan', old.registrationUpdate, 3);
    expect(modern).toMatchObject({ version: 15, control: { protocolVersion: 3 }, registrationUpdate: old.registrationUpdate });
    expect(modern.updateRevision).toBeGreaterThan(previous.updateRevision);
    expect(modern.speechRecognition?.token).toMatch(/^[a-f0-9]{64}$/u);
    store.save.mockClear();
    for (const version of [2, 3, 2, 3] as const) await controller.updatedRegistration(old.deviceId, 'lan', old.registrationUpdate, version);
    expect(store.save).not.toHaveBeenCalled(); expect(JSON.stringify(state.snapshot())).not.toContain(modern.speechRecognition!.token);
    expect(controller.authenticateControl('lan', undefined, undefined, bearer(old.registrationUpdate.token), undefined, 3))
      .toMatchObject({ deviceId: old.deviceId, protocolVersion: 3, speechRecognition: null });
  });
  it('認識資格は用途・端末・経路を分離し、旧制御に権限を与えず、秘密再発行と削除で失効する', async () => {
    const { controller } = await setup(); await controller.configure({ activeNetwork: 'lan' });
    const a = await registerPhone(controller, 'A'), b = await registerPhone(controller, 'B');
    const speech = bearer(a.speechRecognition!.token), update = bearer(a.registrationUpdate.token);
    expect(controller.authenticateControl('lan', undefined, undefined, update, speech, 3))
      .toMatchObject({ deviceId: a.deviceId, protocolVersion: 3, speechRecognition: a.speechRecognition, obs: null, video: false });
    expect(controller.authenticateControl('lan', undefined, undefined, update, speech, 2)).toBeNull();
    for (const token of [update, bearer(b.speechRecognition!.token), 'Bearer invalid'])
      expect(controller.authenticateControl('lan', undefined, undefined, update, token, 3)).toBeNull();
    expect(controller.authenticateControl('tailscale', undefined, undefined, update, speech, 3)).toBeNull();
    await controller.configure({ activeNetwork: null }); await controller.configure({ activeNetwork: 'lan' });
    expect(controller.authenticateControl('lan', undefined, undefined, update, speech, 3)).not.toBeNull();
    await controller.regenerate(a.deviceId);
    expect(controller.authenticateControl('lan', undefined, undefined, update, speech, 3)).toBeNull();
    expect(controller.authenticateControl('lan', undefined, undefined, bearer(b.registrationUpdate.token), bearer(b.speechRecognition!.token), 3)).not.toBeNull();
    await controller.remove(b.deviceId);
    expect(controller.authenticateControl('lan', undefined, undefined, bearer(b.registrationUpdate.token), bearer(b.speechRecognition!.token), 3)).toBeNull();
  });
  it('映像未準備でも新版登録を保存し、同じ資格で準備完了を取得する。旧要求は保存前に拒否する', async () => {
    const { controller, store, receiverFactory, state } = await setup();
    await controller.configure({ activeNetwork: 'lan' });
    receiverFactory.mockImplementationOnce(() => ({ close: async () => undefined }));
    const request = { invitationVersion: 11, clientId: randomUUID(), clientSecret: 'c'.repeat(64), name: '準備待ち' };
    const initial = await controller.enroll('lan', bearer(controller.invitation('lan').token), request);
    if (initial.version !== 15) throw new Error('Expected v15');
    expect(initial.preparation).toEqual({ video: 'preparing', obsControl: 'disabled' });
    expect(initial.outdoor).toBeUndefined(); expect(initial.control.protocolVersion).toBe(3);
    expect(initial.registrationUpdate.token).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(state.snapshot())).not.toContain(initial.registrationUpdate.token);
    await controller.refresh();
    const device = store.save.mock.calls.at(-1)![0].devices.find(d => d.id === initial.deviceId)!;
    expect(device.updates!.lan!.credential).toEqual(initial.registrationUpdate);
    receiverFactory.mock.calls[0][1]({ version: 1, state: 'listening', sessionId: null, generation: 0, receivedBytes: 0,
      videoFrames: 0, audioFrames: 0, videoPts: -1, audioPts: -1, lostPackets: 0, droppedPackets: 0 });
    const ready = await controller.updatedRegistration(initial.deviceId, 'lan', initial.registrationUpdate);
    expect(ready.preparation.video).toBe('ready'); expect(ready.outdoor).toBeDefined();
    expect(ready.updateRevision).toBeGreaterThan(initial.updateRevision);
    expect(await controller.updatedRegistration(initial.deviceId, 'lan', initial.registrationUpdate)).toEqual(ready);
    await expect(controller.enroll('lan', bearer(controller.invitation('lan').token), { clientId: request.clientId, clientSecret: request.clientSecret, name: request.name })).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
  });

  it('古い管理項目と招待版の不一致は割当・保存せず、画面更新を案内する', async () => {
    const { controller, store } = await setup(); await controller.configure({ activeNetwork: 'lan' });
    const before = structuredClone(store.save.mock.calls.at(-1)![0]); store.save.mockClear();
    await expect(controller.configure({ activeNetwork: 'tailscale', videoEnabled: true } as never)).rejects.toThrow('画面を更新');
    const request = { invitationVersion: 13, clientId: randomUUID(), clientSecret: 'a'.repeat(64), name: '不正版' };
    await expect(controller.enroll('lan', bearer(controller.invitation('lan').token), request)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    expect(store.save).not.toHaveBeenCalled(); expect(controller.snapshot().settings).toEqual(before.settings);
  });

  it('更新資格は自分の経路だけに有効で、空・不正ヘッダーを版1へ降格させず、ON/OFFと失効を区別する', async () => {
    const { controller } = await setup(); await controller.configure({ activeNetwork: 'lan' });
    const enroll = (name: string) => controller.enroll('lan', bearer(controller.invitation('lan').token), {
      invitationVersion: 11, clientId: randomUUID(), clientSecret: 'd'.repeat(64), name });
    const a = await enroll('A'); const b = await enroll('B');
    if (a.version !== 15 || b.version !== 15) throw new Error('Expected v15');
    await controller.refresh(); const ready = await controller.updatedRegistration(a.deviceId, 'lan', a.registrationUpdate);
    const video = bearer(ready.outdoor!.token); const update = bearer(a.registrationUpdate.token);
    expect(controller.authenticateControl('lan', undefined, undefined, update)).toMatchObject({ deviceId: a.deviceId, protocolVersion: 2, video: false, obs: null });
    expect(controller.authenticateControl('lan', undefined, video)).toBeNull();
    for (const invalid of ['', 'Bearer invalid', video, bearer(b.registrationUpdate.token)])
      expect(controller.authenticateControl('lan', undefined, video, invalid)).toBeNull();
    expect(controller.authenticateControl('lan', update)).toBeNull();
    expect(controller.authenticateControl('tailscale', undefined, undefined, update)).toBeNull();
    await expect(controller.updatedRegistration(b.deviceId, 'lan', a.registrationUpdate)).rejects.toMatchObject({ code: 'REGISTRATION_REVOKED' });
    await controller.configure({ activeNetwork: null });
    expect(controller.registrationUpdateCurrent(a.deviceId, 'lan', a.registrationUpdate)).toBe(true);
    await controller.configure({ activeNetwork: 'lan' });
    await controller.regenerate(a.deviceId);
    expect(controller.registrationUpdateCurrent(a.deviceId, 'lan', a.registrationUpdate)).toBe(false);
    expect(controller.registrationUpdateCurrent(b.deviceId, 'lan', b.registrationUpdate)).toBe(true);
    expect(controller.authenticateControl('lan', undefined, undefined, update)).toBeNull();
    await controller.remove(b.deviceId);
    expect(controller.registrationUpdateCurrent(b.deviceId, 'lan', b.registrationUpdate)).toBe(false);
  });
});

const lanNic = (id: string, address: string) => ({ id, name: id, description: 'USB LAN', profile: 'Private' as const, index: 1,
  addresses: [{ family: 'ipv4' as const, address }], gateway4: null, gateway6: null, preferred: false });
it('複数LANでは選択するまでQRを止め、選択IPへ登録・映像を統一し、消失時に別LANへ移らない', async () => {
  const a = lanNic('internet', '192.168.0.105'), b = lanNic('indoor', '192.168.10.105');
  const list = vi.fn(async () => [a, b]);
  const f = await setup(null, false, false, { list });
  await f.controller.configure({ activeNetwork: 'lan' });
  const urls = [a, b].map(n => ({ kind: 'lan' as const, available: true, url: 'http://' + n.addresses[0].address + ':3000/comments' }));
  f.state.setMobileUrls(urls); await f.controller.refresh();
  expect(() => f.controller.invitation('lan')).toThrow();
  expect(f.controller.snapshot().networks.lan.warning).toContain('選択');
  await f.controller.configure({ lanInterfaceId: b.id });
  expect(f.controller.invitation('lan')).toMatchObject({ comments: { url: urls[1].url } });
  const phone = await registerPhone(f.controller, '室内スマホ');
  expect(phone).toMatchObject({ comments: { url: urls[1].url } });
  expect(await currentRegistration(f.controller, phone.deviceId, 'lan')).toMatchObject({ outdoor: { address: b.addresses[0].address } });
  expect(f.receiverFactory.mock.calls.at(-1)![0].address).toBe(b.addresses[0].address);
  f.store.save.mockRejectedValueOnce(new Error('disk'));
  await expect(f.controller.configure({ lanInterfaceId: a.id })).rejects.toThrow('disk');
  expect(f.controller.snapshot().settings.lanInterfaceId).toBe(b.id);
  list.mockResolvedValue([a]); await f.controller.refresh();
  expect(f.controller.snapshot().networks.lan.registrationReady).toBe(false);
  expect(() => f.controller.invitation('lan')).toThrow();
  list.mockResolvedValue([a, b]); await f.controller.refresh();
  expect(f.controller.invitation('lan')).toMatchObject({ comments: { url: urls[1].url } });
  b.addresses[0].address = '192.168.10.106'; urls[1].url = 'http://192.168.10.106:3000/comments';
  f.state.setMobileUrls(urls); await f.controller.refresh();
  expect(f.controller.invitation('lan')).toMatchObject({ comments: { url: urls[1].url } });
  list.mockRejectedValueOnce(new Error('network unavailable')); await f.controller.refresh();
  expect(f.controller.snapshot().networks.lan.registrationReady).toBe(false);
});
it('単一LANは識別子だけ保存し、再起動で失われた選択は別LANへ置き換えない', async () => {
  const list = vi.fn(async () => [lanNic('indoor', '192.168.1.2')]);
  const f = await setup(null, false, false, { list });
  await f.controller.configure({ activeNetwork: 'lan' });
  expect(f.controller.snapshot().settings.lanInterfaceId).toBe('indoor');
  const saved = structuredClone(f.store.save.mock.calls.at(-1)![0]);
  const restarted = await setup(saved, false, false, { list: async () => [lanNic('internet', '192.168.1.2')] });
  expect(restarted.controller.snapshot().settings.lanInterfaceId).toBe('indoor');
  expect(restarted.controller.snapshot().networks.lan.registrationReady).toBe(false);
});

it('LAN候補一覧は管理認証・Host・Originを検証し、一覧取得だけで保存や公開を行わない', async () => {
  const f = await setup(null, false, false, { list: async () => [lanNic('indoor', '192.168.10.105')] });
  const app = createHttpApplication({ state: f.state, obsControl: f.obs, smartphone: () => f.controller, port: 3000, operationToken: 'operation' });
  const url = '/api/management/smartphone-lan-adapters';
  const before = f.store.save.mock.calls.length;
  expect((await request(app).get(url).set('Host', '127.0.0.1:3000')).status).toBe(403);
  expect((await request(app).get(url).set('Host', '192.168.10.105:3000').set('X-CasMate-Management', 'operation')).status).toBe(403);
  expect((await request(app).get(url).set('Host', '127.0.0.1:3000').set('Origin', 'https://example.com').set('X-CasMate-Management', 'operation')).status).toBe(403);
  const result = await request(app).get(url).set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'operation');
  expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
  expect(result.body.adapters[0]).toEqual({ id: 'indoor', name: 'indoor', description: 'USB LAN', preferred: false, addresses: [{ family: 'ipv4', address: '192.168.10.105' }] });
  expect(f.store.save.mock.calls).toHaveLength(before); expect(f.controller.snapshot().settings.activeNetwork).toBeNull();
});
