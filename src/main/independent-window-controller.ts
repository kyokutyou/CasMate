import type { WindowBounds } from '../shared/types';

export type IndependentWindowEvent = 'close' | 'closed';

export interface IndependentWindow {
  show(): void;
  destroy(): void;
  focus(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  isMaximized(): boolean;
  getBounds(): { x: number; y: number; width: number; height: number };
  getNormalBounds(): { x: number; y: number; width: number; height: number };
  on(
    event: IndependentWindowEvent,
    listener: (event?: { preventDefault(): void }) => void,
  ): unknown;
}

export interface IndependentWindowState {
  visible: boolean;
  bounds: WindowBounds;
}

export interface IndependentWindowControllerOptions {
  read(): IndependentWindowState;
  save(state: IndependentWindowState): Promise<void>;
  create(): IndependentWindow;
}

export async function saveWindowStatesSequentially(
  savers: Array<() => Promise<void> | undefined>,
): Promise<void> {
  for (const save of savers) {
    try {
      await save();
    } catch {
      // One failed window-state save must not prevent the remaining shutdown work.
    }
  }
}

export async function restoreIndependentWindows(
  controllers: Array<IndependentWindowController | null>,
): Promise<void> {
  await Promise.allSettled(
    controllers.map((controller) => controller?.restore() ?? Promise.resolve()),
  );
}

export class IndependentWindowController {
  private window: IndependentWindow | null = null;
  private quitting = false;
  private operation = Promise.resolve();

  constructor(private readonly options: IndependentWindowControllerOptions) {}

  async restore(): Promise<void> {
    if (!this.options.read().visible) return;
    const window = this.ensureWindow();
    window.show();
    window.focus();
  }

  toggle(): Promise<void> {
    return this.enqueue(() => this.toggleNow());
  }

  prepareForShutdown(): Promise<void> {
    return this.enqueue(async () => {
      this.quitting = true;
      if (!this.window || this.window.isDestroyed()) return;
      await this.options.save({
        visible: this.window.isVisible(),
        bounds: boundsOf(this.window),
      });
    });
  }

  private async toggleNow(): Promise<void> {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      await this.hide();
      return;
    }
    const window = this.ensureWindow();
    await this.options.save({ visible: true, bounds: boundsOf(window) });
    window.show();
    window.focus();
  }

  private ensureWindow(): IndependentWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = this.options.create();
    this.window = window;
    window.on('close', (event) => {
      if (this.quitting) return;
      event?.preventDefault();
      void this.enqueue(() => this.hide());
    });
    window.on('closed', () => {
      if (this.window === window) this.window = null;
    });
    return window;
  }

  private async hide(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;
    const window = this.window;
    const bounds = boundsOf(window);
    await this.options.save({ visible: false, bounds });
    if (!window.isDestroyed()) window.destroy();
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.operation.then(operation);
    this.operation = next.catch(() => undefined);
    return next;
  }
}

function boundsOf(window: IndependentWindow): WindowBounds {
  const maximized = window.isMaximized();
  return {
    ...(maximized ? window.getNormalBounds() : window.getBounds()),
    maximized,
  };
}
