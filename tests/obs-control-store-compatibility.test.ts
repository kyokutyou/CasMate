import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultObsControlSettings, ObsControlStore } from '../src/main/obs/obs-control-store';

const protection = { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(text), decryptString: (bytes: Buffer) => bytes.toString() };
async function setup() { const root = await mkdtemp(join(tmpdir(), 'casmate-obs-reset-')); const path = join(root, 'obs-control.protected'); return { root, path, store: new ObsControlStore(path, protection) }; }
describe('OBS設定と旧単独登録の保全', () => {
  it('現行のOBS接続・操作許可・音声フレーズをそのまま保持する', async () => {
    const { root, path, store } = await setup();
    const value = { version: 1 as const, settings: { ...defaultObsControlSettings(), enabled: true, password: 'private-password', voiceEnabled: true }, registration: null };
    const bytes = Buffer.from(JSON.stringify(value)); await writeFile(path, bytes);
    expect(await store.load()).toEqual(value); expect(await readFile(path)).toEqual(bytes);
    expect(await readdir(root)).toEqual(['obs-control.protected']);
  });
  it('旧単独登録だけ退避して除去し、初回から退避先と再登録方法を表示する', async () => {
    const { root, path, store } = await setup();
    const settings = { ...defaultObsControlSettings(), enabled: true, password: 'keep-password', voiceEnabled: true, androidEnabled: true,
      phrases: { ...defaultObsControlSettings().phrases, startCommand: '配信開始' } };
    const registration = { registrationId: '550e8400-e29b-41d4-a716-446655440000', revision: 3, token: 'a'.repeat(64), endpoints: [{ network: 'lan', address: '192.168.1.2', port: 3002 }] };
    const original = Buffer.from(JSON.stringify({ version: 1, settings, registration })); await writeFile(path, original);
    expect(await store.load()).toEqual({ version: 1, settings, registration: null });
    const backups = (await readdir(root)).filter(name => name.endsWith('.backup'));
    expect(backups).toHaveLength(1); expect(await readFile(join(root, backups[0]))).toEqual(original);
    expect(store.resetNotice).toContain('共通QR'); expect(store.resetNotice).toContain('退避先');
    expect(await store.load()).toEqual({ version: 1, settings, registration: null });
    expect((await readdir(root)).filter(name => name.endsWith('.backup'))).toEqual(backups);
  });
  it.each(['{broken', JSON.stringify({ version: 2, settings: defaultObsControlSettings(), registration: null }),
    JSON.stringify({ version: 1, settings: defaultObsControlSettings(), registration: { token: 'broken' } })])('判別不能な保存は上書きしない', async original => {
    const { path, store } = await setup(); await writeFile(path, original);
    await expect(store.load()).rejects.toThrow(); expect(await readFile(path, 'utf8')).toBe(original);
  });
});
