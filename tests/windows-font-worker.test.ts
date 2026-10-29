import { afterEach, expect, it, vi } from 'vitest';
import { ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { WindowsFontWorker } from '../src/main/core/windows-font-worker';
import { ownedProcessIdentities } from '../src/main/pc-status/owned-processes';

vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });
const executable = 'C:/CasMate/resources/pc-status-worker/CasMate.PcStatus.Worker.exe';
function child() {
  const process = new ChildProcess(); process.stdin = new PassThrough(); process.stdout = new PassThrough(); process.stderr = new PassThrough();
  vi.spyOn(process, 'kill').mockReturnValue(true); return process;
}
function reply(process: ChildProcess, fonts: unknown = ['Arial', '游ゴシック'], code = 0) {
  process.stdout!.emit('data', JSON.stringify({ protocolVersion: 1, fonts }) + '\n'); process.emit('exit', code); process.emit('close', code);
}

it('フォントの専用要求だけを送り、分割されたJSON Linesと正常終了を待つ', async () => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process); const requests: unknown[] = [];
  process.stdin!.on('data', data => requests.push(JSON.parse(String(data))));
  const pending = new WindowsFontWorker(executable).read();
  expect(spawn).toHaveBeenCalledExactlyOnceWith(executable, ['--font-catalog'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  expect(requests).toEqual([{ protocolVersion: 1, type: 'fonts' }]); expect(process.stdin!.writableEnded).toBe(false);
  let completed = false; void pending.then(() => { completed = true; });
  process.stdout!.emit('data', '{"protocolVersion":1,"fonts":["Arial",');
  process.stdout!.emit('data', '"游ゴシック"]}\r\n');
  await Promise.resolve(); expect(completed).toBe(false); expect(process.stdin!.writableEnded).toBe(true);
  process.emit('exit', 0); process.emit('close', 0); await expect(pending).resolves.toEqual(['Arial', '游ゴシック']);
  expect(process.kill).not.toHaveBeenCalled();
});

it('所有するフォント列挙プロセスをPC状態計測で追跡する', async () => {
  const process = child(); process.pid = 8675310; vi.mocked(spawn).mockReturnValue(process);
  const pending = new WindowsFontWorker(executable).read();
  expect(ownedProcessIdentities()).toContainEqual(expect.objectContaining({ pid: 8675310, descendants: true }));
  reply(process); await pending; expect(ownedProcessIdentities().some(item => item.pid === 8675310)).toBe(false);
});

it.each(['launch', 'process', 'stdin', 'stdout', 'stderr', 'write', 'exit', 'close', 'missing'] as const)('列挙の故障=%sを拒否して内部診断を返さない', async fault => {
  const process = child(); vi.mocked(spawn).mockImplementation(() => { if (fault === 'launch') throw new Error('secret native path'); return process; });
  if (fault === 'write') vi.spyOn(process.stdin!, 'write').mockImplementation(() => { throw new Error('secret pipe detail'); });
  const pending = expect(new WindowsFontWorker(executable).read()).rejects.toThrow('フォント一覧を取得できませんでした。');
  if (fault === 'process') process.emit('error', new Error('secret native path'));
  else if (['stdin', 'stdout', 'stderr'].includes(fault)) process[fault as 'stdin' | 'stdout' | 'stderr']!.emit('error', new Error('secret native path'));
  else if (fault === 'exit') process.emit('exit', 1);
  else if (fault === 'close') reply(process, ['Arial'], 1);
  else if (fault === 'missing') { process.stdout!.emit('data', '{"protocolVersion":1,"fonts":["Arial"]}'); process.emit('close', 0); }
  await pending;
});

it.each([
  null, [], { protocolVersion: 2, fonts: ['Arial'] }, { protocolVersion: 1, fonts: 'Arial' }, { protocolVersion: 1 },
  { protocolVersion: 1, fonts: [] }, { protocolVersion: 1, fonts: [7] }, { protocolVersion: 1, fonts: [''] },
  { protocolVersion: 1, fonts: ['   '] }, { protocolVersion: 1, fonts: ['a'.repeat(201)] }, { protocolVersion: 1, fonts: ['name\nsecret'] },
  { protocolVersion: 1, fonts: ['name\u0085secret'] },
  { protocolVersion: 1, fonts: ['Arial'], extra: 'secret' }, { protocolVersion: 1, fonts: Array.from({ length: 16_385 }, () => 'Arial') },
])('不正な版・配列・名前・件数の応答を拒否する（ケース %#）', async value => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const pending = expect(new WindowsFontWorker(executable).read()).rejects.toThrow('フォント一覧');
  process.stdout!.emit('data', JSON.stringify(value) + '\n'); await pending; expect(process.kill).toHaveBeenCalledOnce();
});

it.each(['json', 'multiple', 'utf8-limit'] as const)('不正JSON・複数応答・1MiB超過=%sを拒否する', async fault => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const pending = expect(new WindowsFontWorker(executable).read()).rejects.toThrow('フォント一覧');
  process.stdout!.emit('data', fault === 'json' ? 'bad\n' : fault === 'utf8-limit' ? 'あ'.repeat(349_526) :
    '{"protocolVersion":1,"fonts":["Arial"]}\n{"protocolVersion":1,"fonts":["Arial"]}\n');
  await pending; expect(process.kill).toHaveBeenCalledOnce();
});

it('別データで届いた2つ目の応答も成功扱いしない', async () => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const pending = expect(new WindowsFontWorker(executable).read()).rejects.toThrow('フォント一覧');
  process.stdout!.emit('data', '{"protocolVersion":1,"fonts":["Arial"]}\n'); process.stdout!.emit('data', 'extra\n'); await pending;
});

it('起動を含む5秒の期限で無応答ワーカーを止め、自動再試行しない', async () => {
  vi.useFakeTimers(); const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const pending = expect(new WindowsFontWorker(executable).read()).rejects.toThrow('フォント一覧');
  await vi.advanceTimersByTimeAsync(4999); expect(process.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await pending; expect(process.kill).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000); expect(spawn).toHaveBeenCalledOnce();
  process.emit('close', 0); process.emit('error', new Error('late error')); expect(process.kill).toHaveBeenCalledOnce();
});

it('起動自体に5秒を使った場合も列挙要求を送らず失敗する', async () => {
  vi.useFakeTimers(); const process = child(); const request = vi.fn(); process.stdin!.on('data', request);
  vi.mocked(spawn).mockImplementation(() => { vi.setSystemTime(Date.now() + 5000); return process; });
  await expect(new WindowsFontWorker(executable).read()).rejects.toThrow('フォント一覧');
  expect(request).not.toHaveBeenCalled(); expect(process.kill).toHaveBeenCalledOnce();
});

it('正常な結果が届いても終了が期限を超えれば成功扱いしない', async () => {
  vi.useFakeTimers(); const process = child(); vi.mocked(spawn).mockReturnValue(process);
  const pending = expect(new WindowsFontWorker(executable).read()).rejects.toThrow('フォント一覧');
  process.stdout!.emit('data', '{"protocolVersion":1,"fonts":["Arial"]}\n');
  await vi.advanceTimersByTimeAsync(5000); await pending; expect(process.kill).toHaveBeenCalledOnce();
});

it('アプリ終了で稼働中の要求をすべて拒否し、終了後に起動しない', async () => {
  vi.useFakeTimers(); const first = child(), second = child(); vi.mocked(spawn).mockReturnValueOnce(first).mockReturnValueOnce(second);
  const worker = new WindowsFontWorker(executable); const a = expect(worker.read()).rejects.toThrow('フォント一覧'), b = expect(worker.read()).rejects.toThrow('フォント一覧');
  worker.stop(); await a; await b; expect(first.kill).toHaveBeenCalledOnce(); expect(second.kill).toHaveBeenCalledOnce();
  worker.stop(); reply(first); reply(second); await vi.advanceTimersByTimeAsync(5000);
  await expect(worker.read()).rejects.toThrow('フォント一覧'); expect(spawn).toHaveBeenCalledTimes(2);
});

it('停止ハンドルの失敗でも操作失敗を返して待機を残さない', async () => {
  const process = child(); vi.mocked(spawn).mockReturnValue(process);
  vi.mocked(process.kill).mockImplementation(() => { throw new Error('failed process handle'); });
  const pending = expect(new WindowsFontWorker(executable).read()).rejects.toThrow('フォント一覧');
  process.emit('error', new Error('failed launch')); await pending;
});
