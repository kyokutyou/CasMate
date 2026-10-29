import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartphoneStore, addSmartphoneDevice, allocateVideo, createSmartphoneRecord } from '../src/main/smartphone/smartphone-store';
import { newDirectCredential } from '../src/main/smartphone/direct-ledger';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename), readFile: vi.fn(actual.readFile) };
});
beforeEach(async () => {
  const actual = await vi.importActual<typeof fs>('node:fs/promises');
  vi.mocked(rename).mockImplementation(actual.rename);
  vi.mocked(readFile).mockImplementation(actual.readFile);
});
const protection = { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(text),
  decryptString: (bytes: Buffer) => bytes.toString() };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-phone-migration-'));
  const path = join(directory, 'smartphone.protected');
  const record = createSmartphoneRecord(); record.settings.activeNetwork = 'lan';
  const device = addSmartphoneDevice(record, '既存端末'); allocateVideo(record, device, 'lan');
  device.video.lan!.localPort = device.obsLocalPort; delete device.obsLocalPort;
  const original = Buffer.from(JSON.stringify({ ...record, version: 4, devices: [{ ...device,
    updates: { lan: { credential: newDirectCredential(), updateRevision: 7, projectionHash: 'a'.repeat(64) } } }] }));
  await writeFile(path, original);
  return { directory, path, original, store: new SmartphoneStore(path, protection) };
}

describe('版4スマホ台帳移行の置換と中断復旧', () => {
  it.each(['rename', 'readback'])('%s失敗では原本を復元し、失敗記録を次回へ維持する', async failure => {
    const { path, original, store } = await setup();
    const actual = await vi.importActual<typeof fs>('node:fs/promises');
    let failed = false;
    if (failure === 'rename') vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to) === path && !failed) { failed = true; throw new Error('injected replacement failure'); }
      await actual.rename(from, to);
    });
    else vi.mocked(readFile).mockImplementation(async (...args: Parameters<typeof readFile>) => {
      const value = await actual.readFile(...args);
      if (String(args[0]) === path && Buffer.isBuffer(value) && !value.equals(original) && !failed) {
        failed = true; return Buffer.from('injected readback mismatch');
      }
      return value;
    });
    await expect(store.load()).rejects.toThrow('置換');
    expect(failed).toBe(true); expect(await readFile(path)).toEqual(original);
    const journal = JSON.parse(await readFile(`${path}.compatibility-reset.json`, 'utf8'));
    expect(journal.state).toBe('failed'); expect(journal.notice).toContain('端末・登録資格');
    expect(await readFile(`${path}.retired-${journal.originalHash}.backup`)).toEqual(original);
    await expect(new SmartphoneStore(path, protection).load()).rejects.toThrow('保存に失敗');
    expect(await readFile(path)).toEqual(original);
  });

  it.each(['original', 'replacement', 'unexpected'])('pending中断後の%sを照合し、登録と原本を保全する', async current => {
    const { directory, path, original, store } = await setup();
    const migrated = (await store.load())!;
    const replacement = await readFile(path);
    const journal = JSON.parse(await readFile(`${path}.compatibility-reset.json`, 'utf8'));
    expect(journal.originalHash).toBe(hash(original)); expect(journal.replacementHash).toBe(hash(replacement));
    await writeFile(`${path}.compatibility-reset.json`, JSON.stringify({ ...journal, state: 'pending' }));
    const interrupted = current === 'original' ? original : current === 'replacement' ? replacement : Buffer.from('unrecognized-current-bytes');
    await writeFile(path, interrupted);
    if (current === 'unexpected') {
      await expect(store.load()).rejects.toThrow('中断');
      expect(await readFile(path)).toEqual(interrupted);
      expect(JSON.parse(await readFile(`${path}.compatibility-reset.json`, 'utf8')).state).toBe('failed');
    } else {
      const restored = (await store.load())!;
      expect(restored.pcId).toBe(migrated.pcId); expect(restored.settings).toEqual(migrated.settings);
      expect(restored.reservedPorts).toEqual(migrated.reservedPorts);
      expect(restored.devices[0].obs).toEqual(migrated.devices[0].obs);
      expect(restored.devices[0].video).toEqual(migrated.devices[0].video);
      expect(restored.devices[0].updates!.lan!.credential).toEqual(migrated.devices[0].updates!.lan!.credential);
      if (current === 'replacement') expect(restored.devices[0].updates).toEqual(migrated.devices[0].updates);
      expect(await store.load()).toEqual(restored);
      expect(JSON.parse(await readFile(`${path}.compatibility-reset.json`, 'utf8')).state).toBe('complete');
    }
    expect(await readFile(`${path}.retired-${hash(original)}.backup`)).toEqual(original);
    expect((await readdir(directory)).filter(file => file.endsWith('.backup'))).toHaveLength(1);
  });
});
