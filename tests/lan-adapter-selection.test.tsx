// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartphonePanel } from '../src/renderer/components/SmartphonePanel';
import { ManagementNavigation } from '../src/renderer/management-navigation';
import { smartphoneView, smartphoneMobileState } from './fixtures/smartphone-view';
afterEach(cleanup);
HTMLDialogElement.prototype.close = function () { this.open = false; };
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
it.each([false, true])('LANの共通選択を即時保存し、失敗時は下書きとQR禁止を保持して再保存する setup=%s', async setup => {
  let completeRetry!: () => void;
  const configure = vi.fn().mockRejectedValueOnce(new Error('保存失敗')).mockImplementationOnce(() => new Promise<void>(resolve => { completeRetry = resolve; }));
  const success = vi.fn(); const list = vi.fn(async () => [
    { id: 'internet', name: 'イーサネット', description: 'Realtek', preferred: false, addresses: [{ family: 'ipv4' as const, address: '192.168.0.105' }] },
    { id: 'indoor', name: 'asus USBアダプタ', description: 'ASIX USB LAN', preferred: false, addresses: [{ family: 'ipv4' as const, address: '192.168.10.105' }] },
  ]);
  const navigation = { editor: 'smartphone' as const, initialSetup: setup, setupPosition: 'smartphone' as const, open: vi.fn(), reportError: vi.fn() };
  render(<ManagementNavigation.Provider value={navigation}><SmartphonePanel view={smartphoneView} mobile={smartphoneMobileState} audioSettings={{ lanEnabled: true, tailscaleEnabled: false, bitrateKbps: 32 }}
    configure={configure} listLanAdapters={list} onSuccess={success} changeAudio={vi.fn()} deviceAction={vi.fn()} invitation={vi.fn()} obsInput={vi.fn()} /></ManagementNavigation.Provider>);
  await screen.findByRole('option', { name: /asus USBアダプタ（192.168.10.105） ASIX USB LAN/ });
  expect(screen.getByText('選択すると自動保存されます。')).toBeVisible();
  const select = screen.getByRole('combobox', { name: 'スマホとつながるPCのLANアダプター' });
  expect(screen.getByRole('button', { name: '保存を再試行' })).toBeDisabled();
  fireEvent.change(select, { target: { value: 'indoor' } });
  await waitFor(() => expect(configure).toHaveBeenCalledWith({ lanInterfaceId: 'indoor' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存を再試行' })).toBeEnabled());
  expect(select).toHaveValue('indoor');
  expect(screen.getByText('保存できませんでした。「保存を再試行」を押してください。')).toBeVisible();
  if (setup) {
    fireEvent.change(screen.getByRole('combobox', { name: '初回設定の接続方法' }), { target: { value: 'tailscale' } });
    fireEvent.change(screen.getByRole('combobox', { name: '初回設定の接続方法' }), { target: { value: 'lan' } });
    await screen.findByRole('option', { name: /asus USBアダプタ/ });
    expect(screen.getByRole('combobox', { name: 'スマホとつながるPCのLANアダプター' })).toHaveValue('indoor');
  }
  expect(screen.getByRole('button', { name: '登録用QRを表示' })).toHaveAttribute('aria-disabled', 'true');
  expect(success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存を再試行' }));
  await waitFor(() => expect(configure).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: '保存を再試行' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '保存を再試行' }));
  expect(configure).toHaveBeenCalledTimes(2);
  completeRetry();
  await waitFor(() => expect(success).toHaveBeenCalledWith('LANアダプターを保存しました。'));
  expect(configure).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '保存を再試行' })).toBeDisabled();
  const reads = list.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'LAN一覧を更新' }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(reads + 1));
  expect(configure).toHaveBeenCalledTimes(2);
});
