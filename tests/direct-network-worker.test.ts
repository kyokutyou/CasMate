import { afterEach, expect, it, vi } from 'vitest';
import { ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { WindowsDirectNetwork } from '../src/main/smartphone/direct-windows';
import { DirectNetworkWorker } from '../src/main/smartphone/direct-network-worker';

vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

const row = { id: 'de98a742-172b-470f-8aa3-8d2dfc560a21', name: 'イーサネット 2', description: 'USB Ethernet', profile: 'Private',
  index: 3, addresses: [{ family: 'ipv4', address: '192.168.1.9' }], gateway4: '192.168.1.1', gateway6: null, preferred: true };
function child() {
  const process = new ChildProcess(); process.stdin = new PassThrough(); process.stdout = new PassThrough(); process.stderr = new PassThrough();
  vi.spyOn(process, 'kill').mockReturnValue(true);
  return process;
}
it('ネットワークの反復確認でPowerShellを起動せず同じワーカーから最新値を読む', async () => {
  const process = child(); let requests = 0;
  vi.mocked(spawn).mockImplementation(program => {
    // The old PowerShell discovery returns its original JSON, reproducing the repeated launch.
    if (String(program).toLowerCase().includes('powershell')) queueMicrotask(() => {
      process.stdout!.emit('data', JSON.stringify([row])); process.emit('exit', 0);
    });
    return process;
  });
  process.stdin!.on('data', data => {
    const request = JSON.parse(String(data)); requests++;
    queueMicrotask(() => process.stdout!.emit('data', JSON.stringify({ protocolVersion: 1, id: request.id,
      adapters: [{ ...row, name: requests === 1 ? row.name : '変更後', addresses: [{ family: 'ipv4', address: requests === 1 ? '192.168.1.9' : '192.168.1.10' }] }] }) + '\n'));
  });
  const windows = new WindowsDirectNetwork();
  expect((await windows.list())[0].name).toBe(row.name);
  expect(spawn).toHaveBeenCalledOnce();
  expect(String(vi.mocked(spawn).mock.calls[0][0]).toLowerCase()).not.toContain('powershell');
  expect((await windows.adapter(row.id)).addresses[0].address).toBe('192.168.1.10');
  expect(spawn).toHaveBeenCalledOnce();
  windows.stop(); expect(process.kill).toHaveBeenCalledOnce();
});

it('同時要求をまとめ、分割されたJSON Linesを読む', async () => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const worker = new DirectNetworkWorker('worker.exe');
  const first = worker.read(), second = worker.read();
  expect(second).toBe(first); expect(spawn).toHaveBeenCalledOnce();
  process.stdout!.emit('data', '{"protocolVersion":1,"id":1,"adapters":');
  process.stdout!.emit('data', JSON.stringify([row]) + '}\n');
  expect(await first).toEqual([row]); worker.stop();
});

it.each(['exit', 'error', 'stdin', 'timeout', 'json', 'id', 'version', 'oversized', 'array'] as const)('故障=%sで停止し30秒間は再起動しない', async fault => {
  vi.useFakeTimers(); const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const worker = new DirectNetworkWorker('worker.exe');
  const pending = expect(worker.read()).rejects.toThrow('接続状態');
  if (fault === 'exit') process.emit('exit', 1);
  else if (fault === 'error') process.emit('error', new Error('blocked'));
  else if (fault === 'stdin') process.stdin!.emit('error', new Error('pipe'));
  else if (fault === 'timeout') await vi.advanceTimersByTimeAsync(5000);
  else process.stdout!.emit('data', fault === 'json' ? 'bad\n' : fault === 'oversized' ? 'x'.repeat(65537) :
    JSON.stringify({ protocolVersion: fault === 'version' ? 2 : 1, id: fault === 'id' ? 99 : 1, adapters: fault === 'array' ? {} : [] }) + '\n');
  await pending;
  expect(process.kill).toHaveBeenCalledOnce();
  process.emit('exit', 1); // A late old-child event must not extend the retry deadline.
  await vi.advanceTimersByTimeAsync(29_999);
  await expect(worker.read()).rejects.toThrow(); expect(spawn).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  const next = child(); vi.mocked(spawn).mockReturnValue(next);
  const resumed = worker.read(); next.stdout!.emit('data', '{"protocolVersion":1,"id":2,"adapters":[]}\n');
  expect(await resumed).toEqual([]); expect(spawn).toHaveBeenCalledTimes(2); worker.stop();
});

it('10秒の未使用と終了で止まり、旧ワーカーの遅い応答で再開しない', async () => {
  vi.useFakeTimers(); const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const worker = new DirectNetworkWorker('worker.exe');
  const first = worker.read(); process.stdout!.emit('data', '{"protocolVersion":1,"id":1,"adapters":[]}\n'); await first;
  await vi.advanceTimersByTimeAsync(10_000); expect(process.kill).toHaveBeenCalledOnce();
  const next = child(); vi.mocked(spawn).mockReturnValue(next);
  const pending = expect(worker.read()).rejects.toThrow();
  process.emit('exit', 0); process.stdout!.emit('data', '{"protocolVersion":1,"id":2,"adapters":[]}\n');
  expect(next.kill).not.toHaveBeenCalled(); worker.stop(); await pending;
  expect(next.kill).toHaveBeenCalledOnce();
});
