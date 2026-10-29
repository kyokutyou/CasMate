import { afterEach, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { PassThrough } from 'node:stream';
import { validateDirectAdapters, WindowsDirectNetwork } from '../src/main/smartphone/direct-windows';

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
it.skipIf(process.platform !== 'win32').each(['allow', 'remove'] as const)('受信許可の%sは同梱EXEだけを実行する', async action => {
  const spawn = vi.mocked(childProcess.spawn).mockImplementation(() => {
    const child = new childProcess.ChildProcess();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    vi.spyOn(child, 'kill').mockReturnValue(true);
    queueMicrotask(() => child.emit('error', new Error('Stop before permission request')));
    return child;
  });
  const executable = 'C:/CasMate/resources/pc-status-worker/CasMate.PcStatus.Worker.exe';
  const grant = { id: '00000000-0000-4000-8000-000000000001', pcId: '00000000-0000-4000-8000-000000000002', nonce: 'a'.repeat(24),
    program: 'C:/CasMate.exe', address: '192.168.1.9', protocol: 'tcp' as const, port: 3001, interfaceId: '00000000-0000-4000-8000-000000000003', interfaceName: 'Ethernet', profile: 'Private' as const };
  await expect(new WindowsDirectNetwork(executable)[action](grant)).rejects.toThrow();
  expect(spawn).toHaveBeenCalledExactlyOnceWith(executable, ['--direct-firewall'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
});
it('OSが選んだインターフェースを維持し、公開IPv6と家庭内NATのローカルIPv4を区別する', () => {
  const adapter = { id: '{de98a742-172b-470f-8aa3-8d2dfc560a21}', name: 'イーサネット 2', profile: 'Private', index: 3, gateway4: '192.168.1.1', gateway6: 'fe80::1%3', preferred: true,
    addresses: [{ family: 'ipv4', address: '192.168.1.2' }, { family: 'ipv6', address: '2606:4700:4700::1111' }, { family: 'ipv6', address: 'fe80::1' }, { family: 'ipv4', address: '100.64.0.1' }] };
  expect(validateDirectAdapters([adapter])[0].addresses).toEqual(adapter.addresses.slice(0, 2));
  expect(validateDirectAdapters([adapter])[0].name).toBe('イーサネット 2');
  expect(validateDirectAdapters([{ ...adapter, description: 'ASIX USB to Gigabit Ethernet Family Adapter' }])[0].description).toBe('ASIX USB to Gigabit Ethernet Family Adapter');
  expect(validateDirectAdapters([adapter])[0].description).toBe('');
  expect(validateDirectAdapters([{ ...adapter, profile: 'unknown' }])).toEqual([]);
});
