import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeReceiverFactory } from '../src/main/outdoor/outdoor-receivers';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
function setup() {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn(() => true) });
  spawn.mockReturnValue(child);
  const fail = vi.fn();
  const worker = nativeReceiverFactory('receiver.exe')({ id: 'A:lan', network: 'lan', address: '192.168.1.2',
    port: 10000, localPort: 12000, passphrase: 'a'.repeat(32) }, vi.fn(), fail);
  return { child, worker, fail };
}
it('正常終了は強制停止せず、1.5秒を超える受信へ強制停止して実exitを確認する', async () => {
  const f = setup(); const close = f.worker.close();
  await vi.advanceTimersByTimeAsync(1500); expect(f.child.kill).toHaveBeenCalledOnce();
  f.child.emit('exit', 0); await close; await f.worker.exited;
  expect(f.fail).not.toHaveBeenCalled();
});
it.each(['throw', 'async-error'] as const)('killの%sと繰り返すerrorでアプリを落とさず、3秒で停止不明とし遅延exitを通知する', async failure => {
  const f = setup(); f.child.kill.mockImplementation(() => {
    if (failure === 'throw') throw new Error('kill failed');
    process.nextTick(() => f.child.emit('error', new Error('kill failed asynchronously'))); return false;
  });
  let exited = false; void f.worker.exited!.then(() => { exited = true; });
  const close = expect(f.worker.close()).rejects.toThrow('RECEIVER_STOP_UNKNOWN');
  f.child.emit('error', new Error('running child error'));
  await vi.advanceTimersByTimeAsync(3000); await close;
  expect(exited).toBe(false); expect(f.child.kill).toHaveBeenCalledOnce();
  f.child.emit('exit', 1); await f.worker.exited; expect(exited).toBe(true);
});
it('実プロセスを起動できなかったerrorは終了確認として扱う', async () => {
  const f = setup(); Object.assign(f.child, { pid: undefined });
  f.child.emit('error', new Error('spawn failed')); await f.worker.close(); await f.worker.exited;
  expect(f.child.kill).not.toHaveBeenCalled(); expect(f.fail).toHaveBeenCalledOnce();
});
