import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHttpApplication } from '../src/main/server/local-server';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { PcStatusController } from '../src/main/pc-status/pc-status-controller';
import { emptyPcStatus, freshPcStatus, parsePcSample } from '../src/shared/pc-status';
import { nextLoad } from '../src/renderer/pc-load';
import { managementWindowBounds, restoreManagementSize } from '../src/main/management-window-bounds';

const valid = (value: number): { value: number | null; status: string } => ({ value, status: 'valid' });
const sample = () => ({ gpuStatus: 'valid', gpus: [{ id: '00000000:00000001', name: 'GPU', kind: 'dedicated', capacity: valid(8 * 2 ** 30), usage: valid(42), dedicatedMemory: valid(2 ** 30), sharedMemory: valid(123) }], memory: { used: valid(8 * 2 ** 30), total: valid(16 * 2 ** 30) }, application: { cpu: valid(12), memory: valid(1234567), incomplete: false } });
afterEach(() => vi.useRealTimers());
describe('PC状態の管理境界', () => {
  it('認証・Host・Originを検証し、不正要求を利用要求に数えない', async () => {
    const getStatus = vi.fn(() => emptyPcStatus());
    const state = new AppState(createDefaultSettings());
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret', pcStatus: { getStatus } });
    try {
      for (const [host, token, origin] of [['127.0.0.1:3000', '', ''], ['127.0.0.1:3000', 'wrong', ''], ['evil:3000', 'secret', ''], ['127.0.0.1:3000', 'secret', 'https://evil.example']]) {
        const response = await request(app).get('/api/management/pc-status').set('Host', host).set('X-CasMate-Management', token).set(origin ? { Origin: origin } : {});
        expect(response.status).toBe(403); expect(response.body).not.toHaveProperty('gpus');
      }
      expect(getStatus).not.toHaveBeenCalled();
      for (const origin of ['', 'http://127.0.0.1:3000', 'http://localhost:3000']) {
        const response = await request(app).get('/api/management/pc-status').set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'secret').set(origin ? { Origin: origin } : {});
        expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store'); expect(response.body.application.cpu.value).toBeNull();
      }
      const bootstrap = await request(app).get('/api/bootstrap?view=management').set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'secret');
      expect(JSON.stringify(bootstrap.body)).not.toMatch(/gpuStatus|lastSuccessAt|pcStatus/);
    } finally { await state.shutdown(); }
  });
  it('複数画面は一つの計測を共有し、2秒周期・10秒無利用で停止・再表示で再開する', async () => {
    vi.useFakeTimers();
    const samplers: { sample: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
    const factory = vi.fn(() => { const s = { sample: vi.fn(async () => sample()), stop: vi.fn() }; samplers.push(s); return s; });
    const controller = new PcStatusController(factory);
    controller.getStatus(); controller.getStatus();
    await vi.advanceTimersByTimeAsync(0);
    expect(factory).toHaveBeenCalledTimes(1); expect(samplers[0].sample).toHaveBeenCalledTimes(1);
    const at = controller.getStatus().measuredAt;
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getStatus().measuredAt).toBe(at);
    await vi.advanceTimersByTimeAsync(1000);
    expect(samplers[0].sample).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9000);
    expect(samplers[0].stop).toHaveBeenCalledTimes(1);
    controller.getStatus(); await vi.advanceTimersByTimeAsync(0);
    expect(factory).toHaveBeenCalledTimes(2);
    controller.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('3秒無応答で隔離し、利用中だけ30秒間隔で再試行する', async () => {
    vi.useFakeTimers(); const stop = vi.fn();
    const factory = vi.fn(() => ({ sample: () => new Promise(() => undefined), stop }));
    const controller = new PcStatusController(factory);
    expect(controller.getStatus().state).toBe('starting');
    await vi.advanceTimersByTimeAsync(3000);
    expect(stop).toHaveBeenCalledOnce(); expect(controller.getStatus().state).toBe('retrying');
    for (let i = 0; i < 14; i++) { await vi.advanceTimersByTimeAsync(2000); controller.getStatus(); }
    expect(factory).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000); controller.getStatus();
    expect(factory).toHaveBeenCalledTimes(2);
    controller.stop(); await vi.advanceTimersByTimeAsync(3000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('欠測をnullで返し、キャッシュ取得で最終成功を延長せず、公開値を許可リスト化する', () => {
    const current = parsePcSample({ ...sample(), pid: 123, commandLine: 'secret' }, 1000, emptyPcStatus());
    expect(current).not.toHaveProperty('pid'); expect(current).not.toHaveProperty('commandLine');
    expect(freshPcStatus(current, 11000).memory.used.value).not.toBeNull();
    expect(freshPcStatus(current, 11001).memory.used).toEqual({ value: null, status: 'stopped', lastSuccessAt: 1000 });
    const partial = sample(); partial.gpus[0].usage = { value: null, status: 'denied' };
    const result = parsePcSample(partial, 3000, current);
    expect(result.gpus[0].usage).toEqual({ value: null, status: 'denied', lastSuccessAt: 1000 });
    expect(result.memory.used.value).not.toBeNull();
    expect(() => parsePcSample({ ...sample(), gpus: [{ ...sample().gpus[0], usage: valid(NaN) }] }, 3000, current)).toThrow();
  });
  it('計測呼出し自体の同期例外も管理APIから隔離する', async () => {
    vi.useFakeTimers(); const stop = vi.fn();
    const controller = new PcStatusController(() => ({ sample: () => { throw new Error('Unavailable'); }, stop }));
    expect(() => controller.getStatus()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getStatus().state).toBe('retrying');
    expect(stop).toHaveBeenCalledOnce();
    controller.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('管理窓の下限だけを補正して保存設定を保持する', () => {
    const saved = { x: 10, y: 20, width: 319, height: 700, maximized: false };
    expect(managementWindowBounds(saved)).toEqual({ ...saved, width: 320 });
    expect(saved.width).toBe(319);
    expect(managementWindowBounds({ ...saved, width: 560, height: 300 })).toEqual({ ...saved, width: 560, height: 360 });
  });
  it('Windowsの外寸丸めを補正し、再起動で幅を増やさない', () => {
    let actual = [327, 360];
    const window = { getSize: () => actual, setSize: (width: number, height: number) => { actual = [width === 322 ? 323 : Math.max(322, width), Math.max(360, height)]; } };
    for (let launch = 0; launch < 3; launch++) {
      restoreManagementSize(window, { width: 322, height: 360 });
      expect(actual).toEqual([322, 360]);
    }
    restoreManagementSize(window, { width: 320, height: 360 });
    expect(actual).toEqual([322, 360]);
    restoreManagementSize(window, { width: 760, height: 560 });
    expect(actual).toEqual([760, 560]);
  });
});
describe('負荷色の境界とヒステリシス', () => {
  it.each([[79.999, 'normal'], [80, 'raised'], [94.999, 'raised'], [95, 'high']] as const)('初回 %s', (v, tone) => expect(nextLoad(null, v, 1)?.tone).toBe(tone));
  it('2回連続とキャッシュ重複排除、直接赤、赤から緑を扱う', () => {
    let h = nextLoad(null, 10, 1);
    h = nextLoad(h, 95, 2); expect(h?.tone).toBe('normal');
    h = nextLoad(h, 95, 2); expect(h?.tone).toBe('normal');
    h = nextLoad(h, 95, 3); expect(h?.tone).toBe('high');
    h = nextLoad(h, 74.9, 4); h = nextLoad(h, 74.9, 5); expect(h?.tone).toBe('normal');
  });
  it('下降境界ちょうどでは変わらず、途切れた連続回数をリセットする', () => {
    let h = nextLoad(null, 99, 1);
    for (const [i, v] of [89, 90, 89, 90].entries()) h = nextLoad(h, v, i + 2);
    expect(h?.tone).toBe('high');
    h = nextLoad(h, 89, 6); h = nextLoad(h, 75, 7); expect(h?.tone).toBe('raised');
    h = nextLoad(h, 74, 8); h = nextLoad(h, 75, 9); h = nextLoad(h, 74, 10); expect(h?.tone).toBe('raised');
    h = nextLoad(h, 74, 11); expect(h?.tone).toBe('normal');
    expect(nextLoad(h, null, 12)).toBeNull(); expect(nextLoad(null, 95, 13)?.tone).toBe('high');
  });
});
