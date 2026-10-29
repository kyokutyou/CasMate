import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import { OutdoorReceivers } from '../src/main/outdoor/outdoor-receivers';
import { SmartphoneController } from '../src/main/smartphone/smartphone-controller';
import type { SmartphoneConfiguration } from '../src/shared/smartphone';

describe('スマホ設定の経路境界', () => {
  it.each([undefined, 'lan', 'tailscale'] as const)('network=%s の直接接続設定を保存前に拒否する', async network => {
    const state = new AppState(createDefaultSettings());
    const store = { load: vi.fn(async () => null), save: vi.fn(async () => undefined) };
    const obs = new ObsControlController({ store });
    const receivers = new OutdoorReceivers(() => { throw new Error('受信を開始しない'); });
    const controller = new SmartphoneController({ state, store, obs, receivers,
      managementPorts: () => [3000], mobile: { start: async () => undefined, stop: async () => undefined } });
    try {
      await obs.start();
      await controller.start();
      const before = controller.snapshot();
      store.save.mockClear();
      const request: SmartphoneConfiguration = { direct: { mode: 'manual' }, ...(network ? { network } : {}) };
      await expect(controller.configure(request)).rejects.toThrow();
      expect(store.save).not.toHaveBeenCalled();
      expect(controller.snapshot().settings).toEqual(before.settings);
    } finally {
      await controller.stop();
      await obs.stop();
      await state.shutdown();
    }
  });
});
