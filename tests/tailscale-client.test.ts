import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  WindowsTailscaleClient,
  type TailscaleCommandRunner,
} from '../src/main/server/tailscale-client';

const interfaces = (address: string): NodeJS.Dict<NetworkInterfaceInfo[]> => ({
  Tailscale: [{
    address,
    family: 'IPv4',
    internal: false,
    netmask: '255.192.0.0',
    cidr: `${address}/10`,
    mac: '00:00:00:00:00:00',
  }],
});

describe('Tailscale Windowsクライアント検出', () => {
  it('終了による取消をCLIへ渡し、取得途中の検出結果を公開しない', async () => {
    const controller = new AbortController();
    const run = vi.fn<TailscaleCommandRunner>((_executable, _args, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
    const client = new WindowsTailscaleClient({ findExecutable: async () => 'tailscale.exe', run });
    const detecting = client.detect(controller.signal);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    controller.abort();
    await expect(detecting).resolves.toEqual({ status: 'ipUnavailable' });
    expect(run.mock.calls[0][2]?.aborted).toBe(true);
  });

  it('実行ファイルの確認中に停止したらCLIを起動しない', async () => {
    const controller = new AbortController();
    let release!: (executable: string) => void;
    const run = vi.fn<TailscaleCommandRunner>();
    const client = new WindowsTailscaleClient({ findExecutable: () => new Promise(resolve => { release = resolve; }), run });
    const detecting = client.detect(controller.signal);
    controller.abort(); release('tailscale.exe');
    await expect(detecting).resolves.toEqual({ status: 'ipUnavailable' });
    expect(run).not.toHaveBeenCalled();
  });

  it('公式CLIと現行インターフェースで一致したTailscale IPv4だけを返す', async () => {
    const runner: TailscaleCommandRunner = async () => ({
      stdout: JSON.stringify({
        BackendState: 'Running',
        TailscaleIPs: ['100.100.20.30', 'fd7a:115c:a1e0::1'],
      }),
    });
    const client = new WindowsTailscaleClient({
      findExecutable: async () => 'C:\\Program Files\\Tailscale\\tailscale.exe',
      run: runner,
      interfaces: () => interfaces('100.100.20.30'),
    });

    await expect(client.detect()).resolves.toEqual({ status: 'ready', address: '100.100.20.30' });
  });

  it('CLIと一致しない任意のCGNATアドレスをTailscale IPとして扱わない', async () => {
    const client = new WindowsTailscaleClient({
      findExecutable: async () => 'tailscale.exe',
      run: async () => ({
        stdout: JSON.stringify({ BackendState: 'Running', TailscaleIPs: ['100.90.1.2'] }),
      }),
      interfaces: () => interfaces('100.90.1.3'),
    });

    await expect(client.detect()).resolves.toEqual({ status: 'ipUnavailable' });
  });

  it.each([
    ['notInstalled', async () => null, async () => ({ stdout: '' })],
    ['serviceStopped', async () => 'tailscale.exe', async () => { throw new Error('failed to connect to local tailscaled'); }],
    ['loginRequired', async () => 'tailscale.exe', async () => ({ stdout: JSON.stringify({ BackendState: 'NeedsLogin' }) })],
    ['loginRequired', async () => 'tailscale.exe', async () => ({ stdout: JSON.stringify({ BackendState: 'NeedsMachineAuth' }) })],
  ] as const)('%sを区別する', async (status, findExecutable, run) => {
    const client = new WindowsTailscaleClient({ findExecutable, run, interfaces: () => ({}) });
    await expect(client.detect()).resolves.toEqual({ status });
  });
});
