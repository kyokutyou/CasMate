// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectAdapterSelect } from '../src/renderer/components/DirectAdapterSelect';
import type { DirectAdapterOption } from '../src/shared/direct-connection';

afterEach(cleanup);
const adapter: DirectAdapterOption = { id: 'ethernet', name: 'イーサネット 2', description: 'ASIX USB to Gigabit Ethernet Family Adapter',
  addresses: [{ family: 'ipv6', address: '2001:4860::1' }, { family: 'ipv4', address: '192.168.10.107' }], preferred: true };
it('displays the connection, IPv4 and device name, with IPv6 and absent-description fallbacks', async () => {
  const ipv6 = { ...adapter, id: 'wifi', description: '', addresses: adapter.addresses.slice(0, 1) };
  render(<DirectAdapterSelect visible busy={false} interfaceId={adapter.id} list={async () => [adapter, ipv6]} select={vi.fn()} />);
  await screen.findByRole('option', { name: 'イーサネット 2（192.168.10.107） ASIX USB to Gigabit Ethernet Family Adapter' });
  expect(screen.getByRole('option', { name: 'イーサネット 2（2001:4860::1）' })).toBeDefined();
});
it('loads only when visible, never saves on refresh, and passes the captured ID or default null', async () => {
  const list = vi.fn(async () => [adapter]); const select = vi.fn();
  const props = { visible: false, busy: false, interfaceId: null, list, select };
  const page = render(<DirectAdapterSelect {...props} />);
  expect(list).not.toHaveBeenCalled();
  page.rerender(<DirectAdapterSelect {...props} visible />);
  await waitFor(() => expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(false));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: adapter.id } });
  expect(select).toHaveBeenLastCalledWith(adapter.id);
  page.rerender(<DirectAdapterSelect {...props} visible interfaceId={adapter.id} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
  expect(select).toHaveBeenLastCalledWith(null);
  select.mockClear(); fireEvent.click(screen.getByRole('button', { name: '一覧を更新' }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2)); expect(select).not.toHaveBeenCalled();
});
it('retains missing saved IDs, disables on failure, and recovers via explicit refresh', async () => {
  const list = vi.fn<() => Promise<DirectAdapterOption[]>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([adapter]);
  const select = vi.fn();
  render(<DirectAdapterSelect visible busy={false} interfaceId="missing" list={list} select={select} />);
  await screen.findByText('ネットワーク一覧を取得できません。一覧を更新してください。');
  expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true);
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('missing');
  fireEvent.click(screen.getByRole('button', { name: '一覧を更新' }));
  await screen.findByText('保存した接続先を利用できません。接続状態を確認するか、選択し直してください。');
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('missing'); expect(select).not.toHaveBeenCalled();
});
