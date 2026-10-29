import { describe, expect, it, vi } from 'vitest';
import {
  IndependentWindowController,
  restoreIndependentWindows,
  saveWindowStatesSequentially,
  type IndependentWindow,
  type IndependentWindowEvent,
  type IndependentWindowState,
} from '../src/main/independent-window-controller';

describe('独立ウィンドウの表示状態と配置', () => {
  it('一つの起動時復元に失敗しても他の独立窓を復元し続ける', async () => {
    const restoredWindow = new FakeWindow();
    const failing = new IndependentWindowController({
      read: () => ({ visible: true, bounds: { width: 520, height: 760 } }),
      save: async () => undefined,
      create: () => { throw new Error('作成できません。'); },
    });
    const succeeding = new IndependentWindowController({
      read: () => ({ visible: true, bounds: { width: 420, height: 520 } }),
      save: async () => undefined,
      create: () => restoredWindow,
    });

    await expect(restoreIndependentWindows([failing, succeeding])).resolves.toBeUndefined();

    expect(restoredWindow.show).toHaveBeenCalledOnce();
  });

  it('終了時はウィンドウ設定を順番に保存して同じ設定セクションの変更を失わない', async () => {
    let application = { managementWidth: 1180, commentListWidth: 520 };

    await saveWindowStatesSequentially([
      async () => {
        const current = { ...application };
        await Promise.resolve();
        application = { ...current, managementWidth: 1200 };
      },
      async () => {
        const current = { ...application };
        await Promise.resolve();
        application = { ...current, commentListWidth: 640 };
      },
    ]);

    expect(application).toEqual({ managementWidth: 1200, commentListWidth: 640 });
  });

  it('同じ操作で表示・非表示を切り替え、非表示時の配置を保存する', async () => {
    let saved: IndependentWindowState = {
      visible: false,
      bounds: { width: 520, height: 760 },
    };
    const window = new FakeWindow();
    const controller = new IndependentWindowController({
      read: () => saved,
      save: async (next) => { saved = next; },
      create: () => window,
    });

    await controller.toggle();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(saved.visible).toBe(true);

    window.bounds = { x: 30, y: 40, width: 640, height: 480 };
    await controller.toggle();
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(saved).toEqual({
      visible: false,
      bounds: { x: 30, y: 40, width: 640, height: 480, maximized: false },
    });
  });

  it('表示状態なら起動時に復元し、終了時の表示状態と最新配置を維持する', async () => {
    let saved: IndependentWindowState = {
      visible: true,
      bounds: { x: 10, y: 20, width: 420, height: 520, maximized: true },
    };
    const window = new FakeWindow();
    window.maximized = true;
    const controller = new IndependentWindowController({
      read: () => saved,
      save: async (next) => { saved = next; },
      create: () => window,
    });

    await controller.restore();
    expect(window.show).toHaveBeenCalledOnce();
    window.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
    window.normalBounds = { x: 50, y: 60, width: 700, height: 600 };
    await controller.prepareForShutdown();
    window.close();

    expect(saved).toEqual({
      visible: true,
      bounds: { x: 50, y: 60, width: 700, height: 600, maximized: true },
    });
    expect(window.lastClosePrevented).toBe(false);
  });

  it('ウィンドウの閉じる操作を非表示として保存する', async () => {
    let saved: IndependentWindowState = {
      visible: false,
      bounds: { width: 520, height: 760 },
    };
    const window = new FakeWindow();
    const controller = new IndependentWindowController({
      read: () => saved,
      save: async (next) => { saved = next; },
      create: () => window,
    });
    await controller.toggle();

    window.close();

    expect(window.lastClosePrevented).toBe(true);
    await vi.waitFor(() => expect(window.destroy).toHaveBeenCalledOnce());
    expect(saved.visible).toBe(false);
  });

  it('表示状態を保存できない場合はウィンドウ表示を変更しない', async () => {
    const window = new FakeWindow();
    const controller = new IndependentWindowController({
      read: () => ({ visible: false, bounds: { width: 520, height: 760 } }),
      save: async () => { throw new Error('保存できません。'); },
      create: () => window,
    });

    await expect(controller.toggle()).rejects.toThrow('保存できません。');

    expect(window.show).not.toHaveBeenCalled();
    expect(window.isVisible()).toBe(false);
  });

  it('非表示後はウィンドウを作り直して一時的な表示状態を持ち越さない', async () => {
    let saved: IndependentWindowState = {
      visible: false,
      bounds: { width: 520, height: 760 },
    };
    const windows = [new FakeWindow(), new FakeWindow()];
    let created = 0;
    const controller = new IndependentWindowController({
      read: () => saved,
      save: async (next) => { saved = next; },
      create: () => windows[created++]!,
    });

    await controller.toggle();
    await controller.toggle();
    await controller.toggle();

    expect(windows[0].destroy).toHaveBeenCalledOnce();
    expect(windows[1].show).toHaveBeenCalledOnce();
    expect(created).toBe(2);
  });
});

class FakeWindow implements IndependentWindow {
  bounds = { x: 0, y: 0, width: 520, height: 760 };
  normalBounds = { x: 0, y: 0, width: 520, height: 760 };
  maximized = false;
  lastClosePrevented = false;
  readonly show = vi.fn();
  readonly hide = vi.fn();
  readonly focus = vi.fn();
  readonly destroy = vi.fn();
  private visible = false;
  private destroyed = false;
  private readonly listeners = new Map<IndependentWindowEvent, Array<(event?: { preventDefault(): void }) => void>>();

  constructor() {
    this.show.mockImplementation(() => { this.visible = true; });
    this.hide.mockImplementation(() => { this.visible = false; });
    this.destroy.mockImplementation(() => {
      this.visible = false;
      this.destroyed = true;
      for (const listener of this.listeners.get('closed') ?? []) listener();
    });
  }

  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  isMaximized() { return this.maximized; }
  getBounds() { return { ...this.bounds }; }
  getNormalBounds() { return { ...this.normalBounds }; }
  on(event: IndependentWindowEvent, listener: (event?: { preventDefault(): void }) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  close() {
    this.lastClosePrevented = false;
    const event = { preventDefault: () => { this.lastClosePrevented = true; } };
    for (const listener of this.listeners.get('close') ?? []) listener(event);
    if (!this.lastClosePrevented) {
      this.destroyed = true;
      for (const listener of this.listeners.get('closed') ?? []) listener();
    }
  }
}
