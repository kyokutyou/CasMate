import type { WindowBounds } from '../shared/types';

export interface SettingsWindow {
  show(): void;
  hide(): void;
  destroy(): void;
  focus(): void;
  isDestroyed(): boolean;
  getBounds(): { x: number; y: number; width: number; height: number };
  on(event: 'close' | 'closed', listener: (event?: { preventDefault(): void }) => void): unknown;
}

export class SettingsWindowController {
  private window: SettingsWindow | null = null;
  private quitting = false;
  private operation = Promise.resolve();

  constructor(private readonly options: {
    create(): SettingsWindow;
    saveBounds(bounds: WindowBounds): Promise<void>;
  }) {}

  show(): Promise<void> {
    return this.enqueue(async () => {
      const window = this.ensureWindow();
      window.show();
      window.focus();
    });
  }

  prepareForShutdown(): Promise<void> {
    return this.enqueue(async () => {
      this.quitting = true;
      if (!this.window || this.window.isDestroyed()) return;
      await this.options.saveBounds(boundsOf(this.window));
      this.window.destroy();
    });
  }

  private ensureWindow(): SettingsWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = this.options.create();
    this.window = window;
    window.on('close', (event) => {
      if (this.quitting) return;
      event?.preventDefault();
      void this.enqueue(async () => {
        try {
          await this.options.saveBounds(boundsOf(window));
        } finally {
          if (!window.isDestroyed()) window.hide();
        }
      }).catch(() => undefined);
    });
    window.on('closed', () => {
      if (this.window === window) this.window = null;
    });
    return window;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.operation.then(operation);
    this.operation = next.catch(() => undefined);
    return next;
  }
}

function boundsOf(window: SettingsWindow): WindowBounds {
  return { ...window.getBounds() };
}
