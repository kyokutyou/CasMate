import type { WindowBounds } from '../shared/types';
import type { Target } from '../shared/obs-style';

export interface ObsDesignWindow {
  show(): void; hide(): void; focus(): void; restore(): void; destroy(): void;
  isDestroyed(): boolean; isMinimized(): boolean; isMaximized(): boolean;
  getBounds(): WindowBounds; getNormalBounds(): WindowBounds;
  select(target: Target): void; requestClose(): void;
  on(event: 'close' | 'closed', listener: (event?: { preventDefault(): void }) => void): unknown;
}
export class ObsDesignWindowController {
  private window: ObsDesignWindow | null = null;
  private operation = Promise.resolve();
  private quitting = false;
  constructor(private readonly options: { create(target: Target): ObsDesignWindow; saveBounds(bounds: WindowBounds): Promise<void> }) {}
  show(target: Target): Promise<void> {
    return this.enqueue(async () => {
      if (this.quitting) return;
      if (!this.window || this.window.isDestroyed()) {
        const window = this.options.create(target); this.window = window;
        window.on('close', event => {
          if (this.quitting) return;
          event?.preventDefault(); window.requestClose();
        });
        window.on('closed', () => { if (this.window === window) this.window = null; });
      }
      const window = this.window;
      window.select(target);
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    });
  }
  closeReady(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.window || this.window.isDestroyed()) return;
      try { await this.options.saveBounds(this.bounds()); }
      finally { if (!this.window.isDestroyed()) this.window.hide(); }
    });
  }
  prepareForShutdown(): Promise<void> {
    this.quitting = true;
    return this.enqueue(async () => {
      if (!this.window || this.window.isDestroyed()) return;
      try { await this.options.saveBounds(this.bounds()); }
      finally { this.window.destroy(); }
    });
  }
  private bounds(): WindowBounds {
    const window = this.window!;
    return { ...(window.isMaximized() ? window.getNormalBounds() : window.getBounds()), maximized: window.isMaximized() };
  }
  private enqueue(action: () => Promise<void>) {
    const next = this.operation.then(action); this.operation = next.catch(() => undefined); return next;
  }
}
