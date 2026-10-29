// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PcStatus } from '../src/renderer/components/PcStatus';
import { emptyPcStatus, type PcGpu, type PcMeasurement, type PcStatusSnapshot } from '../src/shared/pc-status';

const metric = (value: number): PcMeasurement => ({ value, status: 'valid', lastSuccessAt: Date.now() });
const gpu = (id: string, name: string, capacity: number, kind: PcGpu['kind'] = 'dedicated'): PcGpu => ({ id, name, kind, capacity: metric(capacity * 2 ** 30), usage: metric(10), dedicatedMemory: metric(2 ** 30), sharedMemory: metric(512 * 2 ** 20) });
let response: PcStatusSnapshot;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  response = { ...emptyPcStatus(), state: 'running', measuredAt: Date.now(), gpuStatus: 'valid', gpus: [gpu('small', '小さい専用GPU', 4), gpu('large', '大きい専用GPU', 8), gpu('uma', '内蔵GPU', 0, 'integrated')], memory: { used: metric(9.9 * 2 ** 30), total: metric(16 * 2 ** 30) }, application: { cpu: metric(2), memory: metric(300 * 2 ** 20), incomplete: false } };
  fetcher = vi.fn(async () => ({ ok: true, json: async () => response })); vi.stubGlobal('fetch', fetcher);
  const meta = document.createElement('meta'); meta.name = 'casmate-management'; meta.content = 'test'; document.head.append(meta);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); document.querySelector('meta[name="casmate-management"]')?.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { render(<PcStatus />); await act(async () => { await Promise.resolve(); }); }
async function tick(ms = 2000) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
it('最大容量の専用GPUを選び、共有メモリをVRAMと混同せず選択を保持する', async () => {
  await mount(); fireEvent.click(screen.getByRole('button', { name: 'PC状態の詳細を開く' }));
  const select = screen.getByLabelText('対象GPU'); expect(select).toHaveValue('large');
  fireEvent.change(select, { target: { value: 'uma' } }); await tick();
  expect(select).toHaveValue('uma'); expect(screen.getByText('専用メモリがありません。共有メモリはVRAMへ含めません。')).toBeVisible();
  const button = screen.getByRole('button', { name: 'PC状態の詳細を開く' }); expect(button).toHaveTextContent('VRAM—');
  response = { ...response, gpus: response.gpus.filter(g => g.id !== 'uma') }; await tick();
  expect(select).toHaveValue('uma'); expect(screen.getByText('選択したGPUは取得不能')).toBeInTheDocument();
  expect(button).toHaveTextContent('?');
});
it('内蔵GPUしかない場合も選択できる', async () => {
  response.gpus = [gpu('uma', '内蔵のみ', 0, 'integrated')]; await mount();
  fireEvent.click(screen.getByRole('button', { name: 'PC状態の詳細を開く' })); expect(screen.getByLabelText('対象GPU')).toHaveValue('uma');
});
it('同時刻キャッシュは連続サンプルに数えず、鮮度切れで数値と緑表示を消す', async () => {
  await mount();
  const button = screen.getByRole('button', { name: 'PC状態の詳細を開く' });
  response = { ...response, measuredAt: Date.now() + 1, gpus: response.gpus.map(g => ({ ...g, usage: { ...metric(95), lastSuccessAt: Date.now() + 1 } })) };
  await tick(); expect(button.querySelector('.pc-high')).toBeNull();
  await tick(); expect(button.querySelector('.pc-high')).toBeNull();
  await tick(8001); expect(button).toHaveTextContent('GPU—'); expect(button.querySelector('.pc-normal')).toBeNull();
});
it('非表示では取得を停止し復帰で再取得、モーダルを閉じると入口へ戻る', async () => {
  await mount(); const calls = fetcher.mock.calls.length;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); fireEvent(document, new Event('visibilitychange')); await tick(6000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); fireEvent(document, new Event('visibilitychange')); await tick(0);
  expect(fetcher).toHaveBeenCalledTimes(calls + 1);
  const button = screen.getByRole('button', { name: 'PC状態の詳細を開く' }); fireEvent.click(button);
  const dialog = screen.getByRole('dialog'); expect(within(dialog).getByText('きゃすメイト')).toBeVisible();
  fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(button).toHaveFocus(); expect(screen.queryByRole('dialog')).toBeNull();
});
