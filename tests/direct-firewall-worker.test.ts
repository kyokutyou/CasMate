import { afterEach, expect, it, vi } from 'vitest';
import { ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { DirectFirewallWorker } from '../src/main/smartphone/direct-firewall-worker';
import { WindowsDirectNetwork, type FirewallGrant } from '../src/main/smartphone/direct-windows';
import { ownedProcessIdentities } from '../src/main/pc-status/owned-processes';

vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

const executable = 'C:/CasMate/resources/pc-status-worker/CasMate.PcStatus.Worker.exe';
const grant: FirewallGrant = { id: '00000000-0000-4000-8000-000000000001', pcId: '00000000-0000-4000-8000-000000000002', nonce: 'a'.repeat(24),
  program: 'C:/CasMate.exe', address: '192.168.1.9', protocol: 'tcp', port: 3001, interfaceId: '00000000-0000-4000-8000-000000000003', interfaceName: 'イーサネット', profile: 'Private' };
function child() {
  const process = new ChildProcess(); process.stdin = new PassThrough(); process.stdout = new PassThrough(); process.stderr = new PassThrough();
  vi.spyOn(process, 'kill').mockReturnValue(true);
  return process;
}
function reply(process: ChildProcess, value: unknown = { protocolVersion: 1, ok: true }, code = 0) {
  process.stdout!.emit('data', JSON.stringify(value) + '\n'); process.emit('exit', code); process.emit('close', code);
}

it.each(['allow', 'remove'] as const)('%sの対象だけをJSON Linesで渡し、標準入力を応答まで維持する', async action => {
  const process = child(); const requests: unknown[] = []; vi.mocked(spawn).mockReturnValue(process);
  process.stdin!.on('data', data => requests.push(JSON.parse(String(data))));
  const pending = new DirectFirewallWorker(executable).run(grant, action);
  expect(spawn).toHaveBeenCalledExactlyOnceWith(executable, ['--direct-firewall'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  expect(requests).toEqual([{ protocolVersion: 1, type: 'firewall', action, grant, ownerPid: globalThis.process.pid }]);
  expect(process.stdin!.writableEnded).toBe(false);
  let complete = false; void pending.then(() => { complete = true; });
  process.stdout!.emit('data', '{"protocolVersion":1,"ok":');
  process.stdout!.emit('data', 'true}\r\n');
  await Promise.resolve(); expect(complete).toBe(false); expect(process.stdin!.writableEnded).toBe(true);
  process.emit('exit', 0); process.emit('close', 0); await expect(pending).resolves.toBeUndefined();
  expect(process.kill).not.toHaveBeenCalled();
});

it('許可処理の子プロセスをPC状態の所有プロセスとして追跡する', async () => {
  const process = child(); process.pid = 8675309; vi.mocked(spawn).mockReturnValue(process);
  const pending = new DirectFirewallWorker(executable).run(grant, 'allow');
  expect(ownedProcessIdentities()).toContainEqual(expect.objectContaining({ pid: 8675309, descendants: true }));
  reply(process); await pending;
  expect(ownedProcessIdentities().some(item => item.pid === 8675309)).toBe(false);
});

it('起動前の取消では子プロセスを作らない', async () => {
  const cancellation = new AbortController(); cancellation.abort();
  await expect(new DirectFirewallWorker(executable).run(grant, 'allow', cancellation.signal)).rejects.toThrow('取り消しました');
  expect(spawn).not.toHaveBeenCalled();
});

it('取消はホストへ通知して遅い昇格の後始末を待ち、即座に強制終了しない', async () => {
  const process = child(); const requests: unknown[] = []; vi.mocked(spawn).mockReturnValue(process);
  process.stdin!.on('data', data => requests.push(JSON.parse(String(data))));
  const cancellation = new AbortController();
  const pending = expect(new DirectFirewallWorker(executable).run(grant, 'allow', cancellation.signal)).rejects.toThrow('取り消しました');
  cancellation.abort();
  expect(requests).toEqual([{ protocolVersion: 1, type: 'firewall', action: 'allow', grant, ownerPid: globalThis.process.pid }, { protocolVersion: 1, type: 'cancel' }]);
  expect(process.kill).not.toHaveBeenCalled(); expect(process.stdin!.writableEnded).toBe(false);
  reply(process, { protocolVersion: 1, ok: false, error: 'cancelled' }); await pending;
});

it.each(['ownership', 'policy', 'adapter', 'failed', undefined])('ネイティブの失敗=%sを成功扱いしない', async error => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const pending = expect(new DirectFirewallWorker(executable).run(grant, 'remove')).rejects.toThrow('受信許可が未完了');
  reply(process, { protocolVersion: 1, ok: false, error }); await pending;
});

it.each(['spawn', 'stdin', 'stdout', 'stderr', 'exit', 'close', 'missing', 'write', 'launch'] as const)('起動・パイプ・終了の故障=%sを拒否し診断内容を漏らさない', async fault => {
  const process = child(); vi.mocked(spawn).mockImplementation(() => {
    if (fault === 'launch') throw new Error('private diagnostic');
    return process;
  });
  if (fault === 'write') vi.spyOn(process.stdin!, 'write').mockImplementation(() => { throw new Error('private diagnostic'); });
  const pending = expect(new DirectFirewallWorker(executable).run(grant, 'allow')).rejects.toThrow(/Windowsの受信/u);
  if (fault === 'spawn') process.emit('error', new Error('private diagnostic'));
  else if (['stdin', 'stdout', 'stderr'].includes(fault)) process[fault as 'stdin' | 'stdout' | 'stderr']!.emit('error', new Error('private diagnostic'));
  else if (fault === 'exit') process.emit('exit', 1);
  else if (fault === 'close') reply(process, { protocolVersion: 1, ok: true }, 1);
  else if (fault === 'missing') { process.stdout!.emit('data', '{"protocolVersion":1,"ok":true}'); process.emit('close', 0); }
  await pending;
});

it.each([
  'null\n', '[]\n', 'bad\n', '{"protocolVersion":2,"ok":true}\n', '{"protocolVersion":1,"ok":"true"}\n',
  '{"protocolVersion":1}\n', '{"protocolVersion":1,"ok":true,"error":"failed"}\n',
  '{"protocolVersion":1,"ok":false,"error":"unknown"}\n', '{"protocolVersion":1,"ok":false,"error":["cancelled"]}\n',
  '{"protocolVersion":1,"ok":true,"secret":"hidden"}\n', '{"protocolVersion":1,"ok":true}\n{"protocolVersion":1,"ok":true}\n',
  'あ'.repeat(21_846),
])('不正・複数・64KiBを超える応答を拒否する（ケース %#）', async output => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const pending = expect(new DirectFirewallWorker(executable).run(grant, 'remove')).rejects.toThrow('応答形式');
  process.stdout!.emit('data', output); await pending; expect(process.kill).toHaveBeenCalledOnce();
});

it('次のデータで届いた2つ目の応答も拒否する', async () => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const pending = expect(new DirectFirewallWorker(executable).run(grant, 'remove')).rejects.toThrow('応答形式');
  process.stdout!.emit('data', '{"protocolVersion":1,"ok":true}\n');
  process.stdout!.emit('data', '{"protocolVersion":1,"ok":true}\n'); await pending;
});

it('停止要求も失敗した場合に元の操作失敗を返し、待機を残さない', async () => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  vi.mocked(process.kill).mockImplementation(() => { throw new Error('closed handle'); });
  const pending = expect(new DirectFirewallWorker(executable).run(grant, 'remove')).rejects.toThrow('受信許可が未完了');
  process.emit('error', new Error('failed process')); await pending;
});

it.each([false, true])('取消=%sでも全体の125秒期限を守り、終了しないホストを停止する', async cancel => {
  vi.useFakeTimers(); const process = child(); vi.mocked(spawn).mockReturnValue(process); const cancellation = new AbortController();
  const pending = expect(new DirectFirewallWorker(executable).run(grant, 'allow', cancellation.signal)).rejects.toThrow('応答を確認できません');
  if (cancel) cancellation.abort();
  await vi.advanceTimersByTimeAsync(124_999); expect(process.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await pending; expect(process.kill).toHaveBeenCalledOnce();
  process.emit('close', 0); process.emit('error', new Error('late')); expect(process.kill).toHaveBeenCalledOnce();
});

it.skipIf(process.platform !== 'win32')('Windows操作を直列化し、待機中の取消と前回の失敗が次の削除を妨げない', async () => {
  const first = child(), second = child(); vi.mocked(spawn).mockReturnValueOnce(first).mockReturnValueOnce(second);
  const windows = new WindowsDirectNetwork(executable); const cancellation = new AbortController();
  const initial = expect(windows.allow(grant)).rejects.toThrow('受信許可が未完了');
  const cancelled = expect(windows.allow(grant, cancellation.signal)).rejects.toThrow('取り消しました');
  const removal = windows.remove(grant);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce()); cancellation.abort();
  reply(first, { protocolVersion: 1, ok: false, error: 'policy' }); await initial; await cancelled;
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
  reply(second); await removal; windows.stop();
});

it.skipIf(process.platform !== 'win32').each(['allow', 'remove'] as const)('同時の%sを一つの昇格要求にまとめ、対象別の結果を返す', async action => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const requests: unknown[] = []; process.stdin!.on('data', data => requests.push(JSON.parse(String(data))));
  const second = { ...grant, id: '00000000-0000-4000-8000-000000000004', protocol: 'udp' as const, program: 'C:/receiver.exe', port: 10001 };
  const windows = new WindowsDirectNetwork(executable);
  const first = windows[action](grant);
  const other = expect(windows[action](second)).rejects.toThrow('受信許可が未完了');
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
  expect(requests).toEqual([{ protocolVersion: 1, type: 'firewall', action, grant, grants: [second], ownerPid: globalThis.process.pid }]);
  reply(process, { protocolVersion: 1, ok: false, results: [{ protocolVersion: 1, ok: true }, { protocolVersion: 1, ok: false, error: 'policy' }] });
  await first; await other;
  expect(spawn).toHaveBeenCalledOnce(); windows.stop();
});

it.each([
  { protocolVersion: 1, ok: true },
  { protocolVersion: 1, ok: false },
  { protocolVersion: 1, ok: true, results: [{ protocolVersion: 1, ok: true }] },
  { protocolVersion: 1, ok: true, results: [{ protocolVersion: 1, ok: true }, { protocolVersion: 1, ok: false, error: 'policy' }] },
  { protocolVersion: 1, ok: false, results: [{ protocolVersion: 1, ok: true }, { protocolVersion: 1, ok: false, error: 'unknown' }] },
])('一括応答の欠落・件数・結果不一致を拒否する（ケース %#）', async invalid => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const pending = expect(new DirectFirewallWorker(executable).runBatch([grant, { ...grant, id: '00000000-0000-4000-8000-000000000004' }], 'allow')).rejects.toThrow('応答形式');
  reply(process, invalid); await pending;
});

it.skipIf(process.platform !== 'win32')('一括要求の待機中取消を除外し、呼出元の後続変更を渡さない', async () => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const requests: unknown[] = []; process.stdin!.on('data', data => requests.push(JSON.parse(String(data))));
  const windows = new WindowsDirectNetwork(executable); const controller = new AbortController();
  const mutable = { ...grant }; const first = windows.allow(mutable);
  const other = expect(windows.allow({ ...grant, id: '00000000-0000-4000-8000-000000000004' }, controller.signal)).rejects.toThrow('取り消しました');
  mutable.address = '192.168.9.9'; controller.abort();
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
  expect(requests).toEqual([{ protocolVersion: 1, type: 'firewall', action: 'allow', grant, ownerPid: globalThis.process.pid }]);
  reply(process); await first; await other; windows.stop();
});

it.skipIf(process.platform !== 'win32')('削除後の失敗応答は未確認の対象だけ1回再照合し、後続の許可より先に完了する', async () => {
  vi.useFakeTimers();
  const initial = child(), verification = child(), allow = child();
  vi.mocked(spawn).mockReturnValueOnce(initial).mockReturnValueOnce(verification).mockReturnValueOnce(allow);
  const windows = new WindowsDirectNetwork(executable);
  const other = { ...grant, id: '00000000-0000-4000-8000-000000000004' };
  const requests: unknown[] = []; verification.stdin!.on('data', data => requests.push(JSON.parse(String(data))));
  const removed = Promise.all([windows.remove(grant), windows.remove(other)]);
  void removed.catch(() => undefined);
  await vi.advanceTimersByTimeAsync(100);
  const prepared = windows.allow(grant); await vi.advanceTimersByTimeAsync(100);
  reply(initial, { protocolVersion: 1, ok: false, results: [{ protocolVersion: 1, ok: true }, { protocolVersion: 1, ok: false, error: 'failed' }] });
  await vi.advanceTimersByTimeAsync(0);
  expect(spawn).toHaveBeenCalledTimes(2);
  expect(requests).toEqual([{ protocolVersion: 1, type: 'firewall', action: 'remove', grant: other, ownerPid: process.pid }]);
  reply(verification); await removed; await vi.advanceTimersByTimeAsync(0);
  expect(spawn).toHaveBeenCalledTimes(3); reply(allow); await prepared; windows.stop();
});

it.skipIf(process.platform !== 'win32').each(['ownership', 'policy', 'adapter', 'cancelled', 'failed'] as const)('削除の%sは再照合上限を守り、確定できない削除を成功にしない', async error => {
  vi.useFakeTimers(); const initial = child(), verification = child();
  vi.mocked(spawn).mockReset().mockReturnValueOnce(initial);
  if (error === 'failed') vi.mocked(spawn).mockReturnValueOnce(verification);
  const windows = new WindowsDirectNetwork(executable);
  const removal = expect(windows.remove(grant)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(100);
  reply(initial, { protocolVersion: 1, ok: false, error }); await vi.advanceTimersByTimeAsync(0);
  if (error === 'failed') reply(verification, { protocolVersion: 1, ok: false, error });
  await removal; expect(spawn).toHaveBeenCalledTimes(error === 'failed' ? 2 : 1); windows.stop();
});

it.skipIf(process.platform !== 'win32').each(['transport', 'format', 'allow', 'verification-transport'] as const)('削除再照合は故障境界=%sを越えて繰り返さない', async fault => {
  vi.useFakeTimers(); const initial = child(), verification = child();
  vi.mocked(spawn).mockReset().mockReturnValueOnce(initial);
  if (fault === 'verification-transport') vi.mocked(spawn).mockReturnValueOnce(verification);
  const windows = new WindowsDirectNetwork(executable);
  const operation = expect(windows[fault === 'allow' ? 'allow' : 'remove'](grant)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(100);
  if (fault === 'transport') initial.emit('error', new Error('private diagnostic'));
  else if (fault === 'format') initial.stdout!.emit('data', 'invalid\n');
  else reply(initial, { protocolVersion: 1, ok: false, error: 'failed' });
  await vi.advanceTimersByTimeAsync(0);
  if (fault === 'verification-transport') verification.emit('error', new Error('private diagnostic'));
  await operation; expect(spawn).toHaveBeenCalledTimes(fault === 'verification-transport' ? 2 : 1); windows.stop();
});

it.skipIf(process.platform !== 'win32').each([
  { id: 'bad' }, { pcId: 'bad' }, { nonce: 'z'.repeat(24) }, { address: '127.0.0.1' }, { address: 'fe80::1' },
])('許可対象の識別子・アドレスを検証してから起動する（ケース %#）', async invalid => {
  await expect(new WindowsDirectNetwork(executable).allow({ ...grant, ...invalid })).rejects.toThrow('対象が正しくありません');
  expect(spawn).not.toHaveBeenCalled();
});
