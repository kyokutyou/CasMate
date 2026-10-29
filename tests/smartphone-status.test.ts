import { expect, it } from 'vitest';
import { smartphoneReceiverState } from '../src/renderer/components/smartphone-status';
import { smartphoneView } from './fixtures/smartphone-view';

it('スマホの受信表示は停止不明・停止待ち・準備失敗を受信状態より優先する', () => {
  const device = structuredClone(smartphoneView.devices[0]);
  device.profiles.lan.receiver = { state: 'receiving', receivedBytes: 100, stopStatus: 'unknown' };
  expect(smartphoneReceiverState(device, 'lan', 'lan')).toContain('旧受信の停止を確認できません');
  device.profiles.lan.receiver.stopStatus = 'stopping';
  expect(smartphoneReceiverState(device, 'lan', 'lan')).toBe('旧受信の停止を確認中');
  delete device.profiles.lan.receiver.stopStatus;
  device.profiles.lan.preparation = { video: 'error', obsControl: 'disabled' };
  expect(smartphoneReceiverState(device, 'lan', 'lan')).toBe('要確認');
  device.profiles.lan.preparation.video = 'preparing';
  expect(smartphoneReceiverState(device, 'lan', 'lan')).toBe('準備中');
  device.profiles.lan.preparation.video = 'ready';
  expect(smartphoneReceiverState(device, 'lan', 'lan')).toBe('受信中');
  expect(smartphoneReceiverState(device, 'lan', null)).toBe('受信OFF');
  expect(smartphoneReceiverState(device, 'tailscale', 'tailscale')).toBe('この経路は未登録');
});

it('別経路で停止待ちがあっても停止不明の案内を優先する', () => {
  const device = structuredClone(smartphoneView.devices[0]);
  device.profiles.lan.receiver = { state: 'stopped', receivedBytes: 0, stopStatus: 'stopping' };
  device.profiles.tailscale.receiver = { state: 'error', receivedBytes: 0, stopStatus: 'unknown' };
  expect(smartphoneReceiverState(device, 'lan', 'lan')).toContain('旧受信の停止を確認できません');
});
