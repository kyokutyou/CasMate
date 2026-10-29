import { describe, expect, it, vi } from 'vitest';
import { OutdoorReceivers, type RecognitionTap, type ReceiverConfig, type ReceiverWorkerFactory } from '../src/main/outdoor/outdoor-receivers';
import { ReceiverRecognitionInputs } from '../src/main/speech-recognition/smartphone-recognition-input';
import type { OutdoorReceiverSample } from '../src/shared/outdoor';
import type { SmartphoneView } from '../src/shared/smartphone';

const phone = '11111111-1111-4111-8111-111111111111';
const sample: OutdoorReceiverSample = { version: 1, state: 'receiving', sessionId: '33333333-3333-4333-8333-333333333333',
  generation: 1, connectionRevision: 1, receivedBytes: 1316, videoFrames: 1, audioFrames: 4, videoPts: 90000, audioPts: 90000, lostPackets: 0, droppedPackets: 0 };
function setup() {
  const workers = new Map<string, { change: (value: OutdoorReceiverSample) => void; tap: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>();
  const factory: ReceiverWorkerFactory = (config, change) => {
    const worker = { change, tap: vi.fn((_tap: RecognitionTap | null) => undefined), close: vi.fn(async () => undefined) };
    workers.set(config.id, worker); return { close: worker.close, setRecognitionTap: worker.tap };
  };
  const privateReceivers = new OutdoorReceivers(factory, () => 1000);
  const directReceivers = new OutdoorReceivers(factory, () => 1000);
  const network = { address: null, commentsUrl: null, registrationReady: false, invitationRevision: 1, videoReady: false, obsReady: false, warning: null };
  const profile = { registered: true, obsPort: 10000, revision: 1, report: null, stale: false };
  const view: SmartphoneView = { available: true, settings: { activeNetwork: 'lan', statusPorts: { lan: 3001, tailscale: 3001, direct: 3001 } },
    networks: { lan: { ...network }, tailscale: { ...network } }, warning: null,
    devices: [{ id: phone, name: '屋外スマホ', obsRevision: 1, profiles: { lan: { ...profile }, tailscale: { ...profile }, direct: { ...profile } } }] };
  const stateListeners = new Set<() => void>();
  const inputs = new ReceiverRecognitionInputs(privateReceivers, directReceivers, () => view, 'C:\\CasMate\\ffmpeg.exe', listener => {
    stateListeners.add(listener); return () => { stateListeners.delete(listener); };
  });
  const config = (network: 'lan' | 'direct', port: number): ReceiverConfig => ({ id: `${phone}:${network}`, network,
    address: '192.168.1.2', port, localPort: port + 1, passphrase: 'a'.repeat(32),
    ...(network === 'direct' ? { listeners: [{ family: 'ipv4' as const, address: '8.8.8.8', port }] } : {}) });
  return { inputs, workers, privateReceivers, directReceivers, view, config, notifyState: () => { for (const listener of stateListeners) listener(); } };
}

describe('登録受信から認識への分岐', () => {
  it('選択ネットワークの現世代だけをlocalhostポートへ分岐し、古いleaseで新分岐を解除しない', async () => {
    const f = setup(); const listener = vi.fn(); const unsubscribe = f.inputs.subscribe(listener);
    try {
      await f.privateReceivers.sync([f.config('lan', 10000)]); await f.directReceivers.sync([f.config('direct', 11000)]);
      f.workers.get(`${phone}:lan`)!.change(sample); f.workers.get(`${phone}:direct`)!.change(sample);
      expect(await f.inputs.open('unregistered')).toBeNull();
      const oldLease = await f.inputs.open(phone); expect(oldLease).not.toBeNull();
      expect(oldLease!.externalInput.udpPort).toBeGreaterThanOrEqual(1024); expect(oldLease!.externalInput.udpPort).toBeLessThanOrEqual(65535);
      expect(oldLease!.externalInput.ffmpegPath).toBe('C:\\CasMate\\ffmpeg.exe'); expect(oldLease!.enable()).toBe(true);
      const lan = f.workers.get(`${phone}:lan`)!; const direct = f.workers.get(`${phone}:direct`)!;
      expect(lan.tap).toHaveBeenLastCalledWith({ port: oldLease!.externalInput.udpPort, connectionRevision: 1 });
      expect(direct.tap).not.toHaveBeenCalled(); expect(lan.close).not.toHaveBeenCalled();
      lan.change({ ...sample, connectionRevision: 2, generation: 2 });
      const current = await f.inputs.open(phone); expect(current!.key).not.toBe(oldLease!.key); expect(current!.enable()).toBe(true);
      const calls = lan.tap.mock.calls.length; oldLease!.close();
      expect(lan.tap).toHaveBeenCalledTimes(calls); expect(oldLease!.enable()).toBe(false);
      current!.close(); expect(lan.tap).toHaveBeenLastCalledWith(null);
      f.view.settings.activeNetwork = 'direct'; f.notifyState();
      const directLease = await f.inputs.open(phone); expect(directLease!.enable()).toBe(true); expect(direct.tap).toHaveBeenCalledOnce();
      directLease!.close(); f.view.settings.activeNetwork = null; f.notifyState(); expect(await f.inputs.open(phone)).toBeNull();
      expect(listener).toHaveBeenCalled(); expect(lan.close).not.toHaveBeenCalled(); expect(direct.close).not.toHaveBeenCalled();
    } finally { unsubscribe(); await Promise.all([f.privateReceivers.stop(), f.directReceivers.stop()]); }
  });

  it('認識分岐の書込失敗は受信・OBS転送の所有ワーカーを停止しない', async () => {
    const f = setup();
    try {
      await f.privateReceivers.sync([f.config('lan', 10000)]); const worker = f.workers.get(`${phone}:lan`)!; worker.change(sample);
      worker.tap.mockImplementation(() => { throw new Error('認識分岐だけの失敗'); });
      const lease = await f.inputs.open(phone); expect(lease!.enable()).toBe(false);
      expect(f.privateReceivers.view(`${phone}:lan`).state).toBe('receiving'); expect(worker.close).not.toHaveBeenCalled();
      lease!.close(); expect(worker.close).not.toHaveBeenCalled();
      worker.change({ ...sample, state: 'reconnecting' }); expect(await f.inputs.open(phone)).toBeNull();
      expect(f.inputs.hasDevice(phone)).toBe(true); f.view.devices = []; f.notifyState(); expect(f.inputs.hasDevice(phone)).toBe(false);
    } finally { await Promise.all([f.privateReceivers.stop(), f.directReceivers.stop()]); }
  });
});
