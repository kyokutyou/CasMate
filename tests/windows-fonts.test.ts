import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import request from 'supertest';
import { WindowsFontCatalog } from '../src/main/core/windows-fonts';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication } from '../src/main/server/local-server';

vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile), spawn: vi.fn(actual.spawn) };
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('管理用フォント一覧', () => {
  it.skipIf(process.platform !== 'win32')('フォント取得はPowerShellを実行せず同梱EXEの専用モードを使う', async () => {
    vi.mocked(execFile).mockImplementation(() => { throw new Error('Stop before launching a shell'); });
    const child = new ChildProcess(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    vi.spyOn(child, 'kill').mockReturnValue(true); vi.mocked(spawn).mockReturnValue(child);
    child.stdin.on('data', request => {
      expect(JSON.parse(String(request))).toEqual({ protocolVersion: 1, type: 'fonts' });
      queueMicrotask(() => { child.stdout!.emit('data', '{"protocolVersion":1,"fonts":["Meiryo","Arial","Meiryo"]}\n'); child.emit('exit', 0); child.emit('close', 0); });
    });
    const executable = 'C:/CasMate/resources/pc-status-worker/CasMate.PcStatus.Worker.exe';
    const fonts = await new WindowsFontCatalog(undefined, executable).list().catch(() => []);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(executable, ['--font-catalog'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(execFile).not.toHaveBeenCalled(); expect(fonts).toEqual(['Arial', 'Meiryo']);
  });
  it('同時列挙を共有して成功をキャッシュし、失敗後は再試行できる', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('failure')).mockResolvedValue(['Meiryo', 'Arial', 'Meiryo']);
    const catalog = new WindowsFontCatalog(load);
    await expect(catalog.list()).rejects.toThrow('failure');
    const [a, b] = await Promise.all([catalog.list(), catalog.list()]);
    expect(a).toEqual(['Arial', 'Meiryo']); expect(b).toEqual(a);
    expect(await catalog.list()).toEqual(a); expect(load).toHaveBeenCalledTimes(2);
  });
  it('成功から5分後にだけ再列挙し、返した配列の変更でキャッシュを壊さない', async () => {
    vi.useFakeTimers(); const load = vi.fn().mockResolvedValueOnce(['Meiryo', 'Arial']).mockResolvedValueOnce(['Yu Gothic UI']);
    const catalog = new WindowsFontCatalog(load); const first = await catalog.list(); first.push('caller change');
    await vi.advanceTimersByTimeAsync(299_999); expect(await catalog.list()).toEqual(['Arial', 'Meiryo']); expect(load).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(await catalog.list()).toEqual(['Yu Gothic UI']); expect(load).toHaveBeenCalledTimes(2); catalog.stop();
  });
  it('空の取得結果を成功として保存せず、失敗後の明示的な取得を受け付ける', async () => {
    const load = vi.fn().mockResolvedValueOnce([' ', 'a'.repeat(201)]).mockResolvedValueOnce(['Arial']); const catalog = new WindowsFontCatalog(load);
    await expect(catalog.list()).rejects.toThrow('フォント一覧'); await expect(catalog.list()).resolves.toEqual(['Arial']); expect(load).toHaveBeenCalledTimes(2);
  });
  it('終了時に注入した列挙処理の保留要求も拒否し、遅い結果を保存しない', async () => {
    let finish!: (fonts: string[]) => void; const load = vi.fn(() => new Promise<string[]>(resolve => { finish = resolve; }));
    const catalog = new WindowsFontCatalog(load); const first = catalog.list(), second = catalog.list(); expect(first).toBe(second);
    const pending = expect(first).rejects.toThrow('フォント一覧'); catalog.stop(); await pending;
    finish(['Arial']); await Promise.resolve(); await expect(catalog.list()).rejects.toThrow('フォント一覧'); expect(load).toHaveBeenCalledOnce(); expect(spawn).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform !== 'win32')('終了時に同梱フォントワーカーを停止し、キャッシュ前の保留要求を拒否する', async () => {
    const child = new ChildProcess(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    vi.spyOn(child, 'kill').mockReturnValue(true); vi.mocked(spawn).mockReturnValue(child);
    const catalog = new WindowsFontCatalog(); const pending = expect(catalog.list()).rejects.toThrow('フォント一覧');
    catalog.stop(); await pending; expect(child.kill).toHaveBeenCalledOnce(); await expect(catalog.list()).rejects.toThrow('フォント一覧'); expect(spawn).toHaveBeenCalledOnce();
  });
  it('管理Host・認証・Originを要求し、失敗を他のAPIへ波及させない', async () => {
    const state = new AppState(createDefaultSettings());
    const list = vi.fn(async () => ['Yu Gothic UI']);
    const app = createHttpApplication({ state, port: 3000, operationToken: 'test', fonts: { list } });
    const path = '/api/management/fonts'; const headers = { Host: '127.0.0.1:3000', 'X-CasMate-Management': 'test' };
    try {
      expect((await request(app).get(path).set('Host', headers.Host)).status).toBe(403);
      expect((await request(app).get(path).set({ ...headers, Host: 'attacker.test' })).status).toBe(403);
      expect((await request(app).get(path).set({ ...headers, Origin: 'https://attacker.test' })).status).toBe(403);
      expect(list).not.toHaveBeenCalled();
      const ok = await request(app).get(path).set(headers);
      expect(ok.status).toBe(200); expect(ok.body).toEqual({ fonts: ['Yu Gothic UI'] }); expect(ok.headers['cache-control']).toBe('no-store');
      list.mockRejectedValueOnce(new Error('secret path'));
      const failed = await request(app).get(path).set(headers);
      expect(failed.status).toBe(503); expect(failed.text).not.toContain('secret path');
      expect((await request(app).get('/api/bootstrap').set('Host', headers.Host)).status).toBe(200);
    } finally { state.dispose(); }
  });
});
