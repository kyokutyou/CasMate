import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import request from 'supertest';
import { setupConfigured } from '../src/shared/initial-setup';
import { smartphoneDeviceDataReceiving } from '../src/shared/smartphone';
import { InitialSetupStore } from '../src/main/core/initial-setup-store';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication } from '../src/main/server/local-server';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';

function fixture() {
  const snapshot = obsRegistrationSnapshot(); const phone = snapshot.smartphone!;
  phone.available = true; phone.settings.activeNetwork = 'lan';
  const device = phone.devices[0]!;
  device.profiles.lan.registered = true;
  device.profiles.lan.preparation = { video: 'ready', obsControl: 'disabled' };
  device.profiles.lan.receiver = { state: 'receiving', receivedBytes: 1316 };
  return { snapshot, phone, device, profile: device.profiles.lan };
}
it.each(['lan', 'tailscale', 'direct'] as const)('%sは同じ登録端末の現在のデータ受信だけで確認でき、デコードを要求しない', network => {
  const f = fixture(); f.device.profiles[network] = structuredClone(f.profile); f.phone.settings.activeNetwork = network;
  expect(smartphoneDeviceDataReceiving(f.device, network, network)).toBe(true);
  expect(setupConfigured('smartphone', f.snapshot, ['video'])).toBe(true);
});
it.each(['stopped', 'starting', 'listening', 'reconnecting', 'error'] as const)('累積データが残っても%sなら確認できない', state => {
  const f = fixture(); f.profile.receiver!.state = state;
  expect(setupConfigured('smartphone', f.snapshot, ['video'])).toBe(false);
});
it('0バイト・未登録・経路OFF/別経路・準備失敗・停止待ち/不明は受信成功にしない', () => {
  const cases = [
    (f: ReturnType<typeof fixture>) => { f.profile.receiver!.receivedBytes = 0; },
    (f: ReturnType<typeof fixture>) => { f.profile.registered = false; },
    (f: ReturnType<typeof fixture>) => { f.phone.settings.activeNetwork = null; },
    (f: ReturnType<typeof fixture>) => { f.phone.settings.activeNetwork = 'tailscale'; },
    (f: ReturnType<typeof fixture>) => { f.profile.preparation!.video = 'error'; },
    (f: ReturnType<typeof fixture>) => { f.profile.preparation!.video = 'preparing'; },
    (f: ReturnType<typeof fixture>) => { f.profile.receiver!.stopStatus = 'stopping'; },
    (f: ReturnType<typeof fixture>) => { f.device.profiles.tailscale.receiver = { state: 'stopped', receivedBytes: 0, stopStatus: 'unknown' }; },
    (f: ReturnType<typeof fixture>) => { f.phone.available = false; },
  ];
  for (const change of cases) { const f = fixture(); change(f); expect(setupConfigured('smartphone', f.snapshot, ['video'])).toBe(false); }
});
it('確認保存も共通受信条件を使い、停止中の確認取消は許可する', async () => {
  const f = fixture(); const store = new InitialSetupStore(join(await mkdtemp(join(tmpdir(), 'casmate-data-confirm-')), 'setup.json'), false); await store.load();
  const update = (command: object) => store.update({ revision: store.view(f.snapshot).revision, ...command }, () => f.snapshot);
  await update({ action: 'select', selected: ['smartphone'], smartphoneUses: ['video'] });
  const confirm = () => update({ action: 'confirm', step: 'smartphone', fingerprint: store.view(f.snapshot).fingerprints.smartphone });
  f.profile.receiver!.state = 'listening'; await expect(confirm()).rejects.toThrow('必要な設定');
  f.profile.receiver!.state = 'receiving'; await confirm();
  expect(store.view(f.snapshot).confirmations.smartphone).toBeTruthy();
  f.profile.receiver!.state = 'stopped'; await update({ action: 'unconfirm', step: 'smartphone' });
  expect(store.view(f.snapshot).confirmations.smartphone).toBeUndefined();
  await expect(confirm()).rejects.toThrow('必要な設定');
});
it('削除したプレビューAPIを公開しない', async () => {
  const state = new AppState(createDefaultSettings());
  const app = createHttpApplication({ state, port: 3000, operationToken: 'test-operation' });
  try {
    for (const action of ['start', 'poll', 'stop']) {
      const result = await request(app).post('/api/management/smartphone-preview/' + action).set({ Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'test-operation' }).send({ deviceId: 'unused' });
      expect(result.status).toBe(404);
    }
  } finally { await state.shutdown(); }
});
