import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SmartphoneStore, createSmartphoneRecord, addSmartphoneDevice, allocateVideo, allocateSmartphonePort, type SmartphoneRecord } from '../src/main/smartphone/smartphone-store';
import { newDirectCredential } from '../src/main/smartphone/direct-ledger';
import { compatibilityPolicy } from '../src/shared/compatibility-policy.generated';

const protection = { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(text), decryptString: (bytes: Buffer) => bytes.toString() };
async function setup() { const directory = await mkdtemp(join(tmpdir(), 'casmate-phone-reset-')); const path = join(directory, 'smartphone.protected'); return { directory, path, store: new SmartphoneStore(path, protection) }; }
function retired(version: number) {
  const record = createSmartphoneRecord(); const device = addSmartphoneDevice(record, '旧端末');
  allocateVideo(record, device, 'lan'); allocateVideo(record, device, 'tailscale');
  legacyObsPorts(record);
  return { ...record, version, settings: { ...record.settings, activeNetwork: 'lan', videoEnabled: { lan: true, tailscale: true, direct: false } } };
}
function legacyObsPorts(record: SmartphoneRecord) {
  for (const device of record.devices) {
    delete device.obsLocalPort;
    for (const video of Object.values(device.video)) video.localPort = allocateSmartphonePort(record);
  }
  for (const allocation of Object.values(record.direct!.devices)) if (allocation.outdoor) allocation.outdoor.localPort = allocateSmartphonePort(record);
}
describe('スマホ台帳の対応基準と原本保持', () => {
  it.each([1, 2, 3])('既知の旧版%sは生バイトを退避して端末・開放台帳をリセットし、再起動で繰り返さない', async version => {
    const { directory, path, store } = await setup(); const bytes = Buffer.from(JSON.stringify(retired(version)));
    await writeFile(path, bytes); const fresh = await store.load();
    expect(fresh).toMatchObject({ version: compatibilityPolicy.contracts.pcSmartphoneStore.current, settings: { activeNetwork: null }, devices: [], reservedPorts: [] });
    expect(fresh?.pcId).not.toBe(JSON.parse(bytes.toString()).pcId); expect(fresh?.migrationNotice).toContain('退避');
    const backups = (await readdir(directory)).filter(p => p.endsWith('.backup')); expect(backups).toHaveLength(1);
    expect(await readFile(join(directory, backups[0]))).toEqual(bytes);
    expect((await store.load())?.pcId).toBe(fresh?.pcId); expect((await readdir(directory)).filter(p => p.endsWith('.backup'))).toEqual(backups);
  });
  it('現行の登録前端末と準備済み映像の端末・ポート・選択を保持する', async () => {
    const { store } = await setup(); const record = createSmartphoneRecord(); record.settings.activeNetwork = 'lan';
    addSmartphoneDevice(record, '登録前'); const allocated = addSmartphoneDevice(record, '準備済み'); allocateVideo(record, allocated, 'lan');
    await store.save(record); expect(await store.load()).toEqual(record);
    record.devices = record.devices.filter(d => d.id !== allocated.id); await store.save(record);
    const next = (await store.load())!; const device = addSmartphoneDevice(next, '新端末'); allocateVideo(next, device, 'lan');
    expect(device.video.lan!.obsPort).not.toBe(allocated.video.lan!.obsPort); expect(next.reservedPorts).toEqual(expect.arrayContaining(record.reservedPorts));
  });
  it('版4を明示移行し、既存資格・端末・予約を保って認識資格を一度追加し共通入力は未割当にする', async () => {
    const { store, path, directory } = await setup(); const record = createSmartphoneRecord(); record.settings.activeNetwork = 'lan';
    const device = addSmartphoneDevice(record, '登録済み'); allocateVideo(record, device, 'lan'); allocateVideo(record, device, 'tailscale');
    legacyObsPorts(record);
    const updates = {
      lan: { credential: newDirectCredential(), updateRevision: 5, projectionHash: 'a'.repeat(64) },
      tailscale: { credential: newDirectCredential(), updateRevision: 2, projectionHash: 'b'.repeat(64) },
      direct: { credential: newDirectCredential(), updateRevision: 3, projectionHash: 'c'.repeat(64) },
    };
    record.direct!.devices[device.id] = { comments: newDirectCredential(), obs: newDirectCredential(), registered: true, pending: false };
    const old = { ...record, devices: [{ ...device, updates }], version: 4 }; const original = Buffer.from(JSON.stringify(old)); await writeFile(path, original);
    const migrated = (await store.load())!;
    expect(migrated.version).toBe(6); expect(migrated.pcId).toBe(record.pcId); expect(migrated.settings).toEqual(record.settings);
    expect(migrated.reservedPorts).toEqual(record.reservedPorts); expect(migrated.direct).toEqual(record.direct);
    expect(migrated.devices[0]).toMatchObject({ id: device.id, obs: device.obs });
    expect(migrated.devices[0].obsLocalPort).toBeUndefined();
    for (const network of ['lan', 'tailscale'] as const) {
      const video = structuredClone(device.video[network]!); delete video.localPort;
      expect(migrated.devices[0].video[network]).toEqual(video);
    }
    const credentials = Object.values(migrated.devices[0].updates!);
    for (const network of ['lan', 'tailscale', 'direct'] as const) {
      const update = migrated.devices[0].updates![network]!;
      expect(update.credential).toEqual(updates[network].credential); expect(update.updateRevision).toBe(updates[network].updateRevision);
      expect(update.projectionHash).toBe(''); expect(update.speechRecognition).toMatchObject({ revision: 1, token: expect.stringMatching(/^[a-f0-9]{64}$/u) });
      expect(update.speechRecognition.registrationId).not.toBe(update.credential.registrationId);
    }
    expect(new Set(credentials.map(update => update.speechRecognition.token)).size).toBe(3);
    const backups = (await readdir(directory)).filter(p => p.endsWith('.backup')); expect(backups).toHaveLength(1);
    expect(await readFile(join(directory, backups[0]))).toEqual(original);
    expect(await store.load()).toEqual(migrated); expect((await readdir(directory)).filter(p => p.endsWith('.backup'))).toEqual(backups);
  });
  it('版5の認識資格と投影情報・直接接続資格を保持して移行し、旧ポートへ戻らない', async () => {
    const { store, path } = await setup(); const record = createSmartphoneRecord(); const device = addSmartphoneDevice(record, 'Pixel 10a');
    allocateVideo(record, device, 'lan');
    device.updates = { lan: { credential: newDirectCredential(), speechRecognition: newDirectCredential(), updateRevision: 9,
      projectionHash: 'a'.repeat(64), legacyProjectionHash: 'b'.repeat(64) } };
    record.direct!.devices[device.id] = { comments: newDirectCredential(), obs: newDirectCredential(), registered: true, pending: false,
      outdoor: { ...newDirectCredential(), passphrase: 'a'.repeat(32), internalPort: allocateSmartphonePort(record) } };
    legacyObsPorts(record);
    await writeFile(path, JSON.stringify({ ...record, version: 5 }));
    const migrated = (await store.load())!;
    expect(migrated.devices[0].updates).toEqual(device.updates);
    expect(migrated.reservedPorts).toEqual(record.reservedPorts);
    expect(migrated.direct!.devices[device.id].outdoor).not.toHaveProperty('localPort');
    expect(migrated.devices[0].obsLocalPort).toBeUndefined();
    allocateVideo(migrated, migrated.devices[0], 'lan');
    expect(record.reservedPorts).not.toContain(migrated.devices[0].obsLocalPort);
    expect(migrated.devices[0].video.lan!.obsPort).toBe(device.video.lan!.obsPort);
    await store.save(migrated); expect((await store.load())?.devices[0].obsLocalPort).toBe(migrated.devices[0].obsLocalPort);
  });
  it('共通入力を経路追加で保持し、ポート不足では未確定の割当だけ戻す', () => {
    const record = createSmartphoneRecord(); const device = addSmartphoneDevice(record, '共通入力');
    allocateVideo(record, device, 'lan'); const port = device.obsLocalPort;
    allocateVideo(record, device, 'tailscale'); expect(device.obsLocalPort).toBe(port);
    const exhausted = createSmartphoneRecord(); const pending = addSmartphoneDevice(exhausted, '準備待ち');
    exhausted.reservedPorts = Array.from({ length: 65535 - 1024 }, (_, index) => index + 1024);
    expect(() => allocateVideo(exhausted, pending, 'lan')).toThrow();
    expect(pending.obsLocalPort).toBeUndefined(); expect(pending.video).toEqual({}); expect(exhausted.reservedPorts).not.toContain(65535);
  });
  it.each(['missing', 'reused-token', 'reused-id'])('新版の認識資格%sを受け入れず、用途資格の混同を防ぐ', async kind => {
    const { store, path } = await setup(); const record = createSmartphoneRecord(); const device = addSmartphoneDevice(record, '用途別');
    const update = { credential: newDirectCredential(), speechRecognition: newDirectCredential(), updateRevision: 1, projectionHash: '' };
    const speechRecognition = kind === 'missing' ? undefined : { ...update.speechRecognition,
      token: kind === 'reused-token' ? update.credential.token : update.speechRecognition.token,
      registrationId: kind === 'reused-id' ? device.obs.registrationId : update.speechRecognition.registrationId };
    const original = JSON.stringify({ ...record, devices: [{ ...device, updates: { lan: { ...update, speechRecognition } } }] });
    await writeFile(path, original); await expect(store.load()).rejects.toThrow(); expect(await readFile(path, 'utf8')).toBe(original);
  });
  it('版4移行の暗号化・退避失敗で既存登録を上書きしない', async () => {
    const { store, path } = await setup(); const record = { ...createSmartphoneRecord(), version: 4 };
    const original = Buffer.from(JSON.stringify(record)); await writeFile(path, original);
    await expect(new SmartphoneStore(path, { ...protection, encryptString: () => { throw new Error('protect'); } }).load()).rejects.toThrow();
    expect(await readFile(path)).toEqual(original);
    const hash = createHash('sha256').update(original).digest('hex'); await mkdir(`${path}.retired-${hash}.backup`);
    await expect(store.load()).rejects.toThrow(); expect(await readFile(path)).toEqual(original);
  });
  it.each(['{', '{"version":1}', '{"version":5}'])('壊れた形状・未知・未来版を上書きしない (%s)', async raw => {
    const { store, path } = await setup(); await writeFile(path, raw); await expect(store.load()).rejects.toThrow(); expect(await readFile(path, 'utf8')).toBe(raw);
  });
  it.each(['unreserved-local-port', 'duplicate-port', 'wrong-network', 'invalid-invitation', 'old-video-in-native-store'])('不正な旧台帳%sは初期化で隠さない', async kind => {
    const { store, path, directory } = await setup(); const value = retired(2);
    if (kind === 'unreserved-local-port') value.devices[0].video.lan!.localPort = 60000;
    if (kind === 'duplicate-port') value.devices[0].video.tailscale!.obsPort = value.devices[0].video.lan!.obsPort;
    if (kind === 'wrong-network') value.settings.activeNetwork = 'direct';
    if (kind === 'invalid-invitation') value.invitations!.lan.token = 'x';
    if (kind === 'old-video-in-native-store') (value.devices[0].video.lan as unknown as { version: number }).version = 2;
    const original = JSON.stringify(value); await writeFile(path, original);
    await expect(store.load()).rejects.toThrow(); expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['smartphone.protected']);
  });
  it('復号不能・暗号化不可・退避失敗では原本を保持する', async () => {
    const { path } = await setup(); const bytes = Buffer.from(JSON.stringify(retired(3))); await writeFile(path, bytes);
    await expect(new SmartphoneStore(path, { ...protection, decryptString: () => { throw new Error('key'); } }).load()).rejects.toThrow();
    await expect(new SmartphoneStore(path, { ...protection, isEncryptionAvailable: () => false }).load()).rejects.toThrow();
    const hash = createHash('sha256').update(bytes).digest('hex'); await mkdir(`${path}.retired-${hash}.backup`);
    await expect(new SmartphoneStore(path, protection).load()).rejects.toThrow(); expect(await readFile(path)).toEqual(bytes);
  });
});

it('LAN識別子の任意追加を保持し、旧保存を再登録なしで読み、不正型を保存しない', async () => {
  const { store } = await setup(); const record = createSmartphoneRecord();
  await store.save(record); expect((await store.load())?.settings.lanInterfaceId).toBeUndefined();
  record.settings.lanInterfaceId = 'indoor'; await store.save(record);
  expect((await store.load())?.settings.lanInterfaceId).toBe('indoor');
  const invalid = structuredClone(record); Reflect.set(invalid.settings, 'lanInterfaceId', 12);
  await expect(store.save(invalid)).rejects.toThrow();
  expect((await store.load())?.settings.lanInterfaceId).toBe('indoor');
});
