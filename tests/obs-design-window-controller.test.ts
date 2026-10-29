import { expect, it, vi } from 'vitest';
import { ObsDesignWindowController, type ObsDesignWindow } from '../src/main/obs-design-window-controller';

it('単一窓を対象切替・最小化復元・前面化し、確認後に通常寸法と最大化状態を保存して隠す', async () => {
  const listeners = new Map<string, (event?: { preventDefault(): void }) => void>();
  const window: ObsDesignWindow = {
    show: vi.fn(), hide: vi.fn(), focus: vi.fn(), restore: vi.fn(), destroy: vi.fn(),
    isDestroyed: () => false, isMinimized: () => true, isMaximized: () => true,
    getBounds: () => ({ width: 1920, height: 1080 }), getNormalBounds: () => ({ x: 20, y: 30, width: 1200, height: 820 }),
    select: vi.fn(), requestClose: vi.fn(), on: (event, listener) => listeners.set(event, listener),
  };
  const create = vi.fn(() => window), saveBounds = vi.fn(async () => undefined);
  const controller = new ObsDesignWindowController({ create, saveBounds });
  await controller.show('comments'); await controller.show('speech');
  expect(create).toHaveBeenCalledOnce(); expect(window.select).toHaveBeenLastCalledWith('speech');
  expect(window.restore).toHaveBeenCalledTimes(2); expect(window.focus).toHaveBeenCalledTimes(2);
  const preventDefault = vi.fn(); listeners.get('close')?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce(); expect(window.requestClose).toHaveBeenCalledOnce(); expect(window.hide).not.toHaveBeenCalled();
  await controller.closeReady();
  expect(saveBounds).toHaveBeenCalledWith({ x: 20, y: 30, width: 1200, height: 820, maximized: true });
  expect(window.hide).toHaveBeenCalledOnce();
  await controller.prepareForShutdown(); expect(window.destroy).toHaveBeenCalledOnce();
  await controller.show('comments'); expect(create).toHaveBeenCalledOnce();
});
