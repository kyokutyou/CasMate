import { defaultObsControlSettings, ObsControlStore } from '../src/main/obs/obs-control-store';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compatibilityNotice, replaceRetiredBytes } from '../src/main/core/compatibility-storage';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename), readFile: vi.fn(actual.readFile) };
});
afterEach(() => vi.restoreAllMocks());

describe('互換リセットの置換障害', () => {
  it.each(['rename', 'readback'])('%s失敗は原本を復元し次回も失敗を通知する', async failure => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-replacement-')); const file = join(root, 'settings.json');
    const original = Buffer.from('original-raw'); const replacement = Buffer.from('new-raw');
    await writeFile(file, original);
    const actual = await vi.importActual<typeof fs>('node:fs/promises');
    let failed = false;
    if (failure === 'rename') vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to) === file && !failed) { failed = true; throw new Error('injected replacement failure'); }
      await actual.rename(from, to);
    });
    else vi.mocked(readFile).mockImplementation(async (...args: Parameters<typeof readFile>) => {
      const value = await actual.readFile(...args);
      if (String(args[0]) === file && Buffer.isBuffer(value) && value.equals(replacement) && !failed) {
        failed = true; return Buffer.from('injected readback mismatch');
      }
      return value;
    });
    await expect(replaceRetiredBytes(file, original, replacement, 'reset')).rejects.toThrow('置換');
    expect(failed).toBe(true); expect(await readFile(file)).toEqual(original);
    const journal = JSON.parse(await readFile(`${file}.compatibility-reset.json`, 'utf8'));
    expect(journal.state).toBe('failed');
    await expect(compatibilityNotice(file)).rejects.toThrow('保存に失敗');
    expect(await readFile(`${file}.retired-${journal.originalHash}.backup`)).toEqual(original);
  });
  it('OBSの置換失敗では原本を保持し、起動状態へ手動復旧手順を示す', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-obs-failure-')); const file = join(root, 'obs-control.protected');
    const original = Buffer.from(JSON.stringify({ version: 1, settings: defaultObsControlSettings(), registration: {
      registrationId: '550e8400-e29b-41d4-a716-446655440000', revision: 1, token: 'a'.repeat(64),
      endpoints: [{ network: 'lan', address: '192.168.1.2', port: 3002 }] } }));
    await writeFile(file, original);
    const actual = await vi.importActual<typeof fs>('node:fs/promises'); let failed = false;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to) === file && !failed) { failed = true; throw new Error('injected OBS replacement failure'); }
      await actual.rename(from, to);
    });
    const store = new ObsControlStore(file, { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() });
    const controller = new ObsControlController({ store });
    try {
      await controller.start(); expect(await readFile(file)).toEqual(original);
      const error = controller.view().error; expect(error).toContain(file); expect(error).toContain('.compatibility-reset.json');
      expect(error).toContain('手動で退避'); expect(error).toContain('削除しない'); expect(error).not.toContain('a'.repeat(64));
      const restarted = new ObsControlController({ store }); await restarted.start(); expect(restarted.view().error).toContain('手動で退避');
      await restarted.stop();
    } finally { await controller.stop(); }
  });
});
