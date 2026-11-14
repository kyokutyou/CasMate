import { BrowserWindow, screen } from 'electron';
import { readFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { reactionRecord as record, REACTION_WINDOW_INVENTORY_MAX_AGE_MS, type ReactionDesktopMarker, type ReactionWindow, type ReactionDesktopEvent } from '../../shared/listener-reactions';
import type { ReactionDesktop } from './reaction-controller';

// Allow the tracker’s maximum window count and title lengths, including JSON escaping.
const MAX_TRACKER_LINE_LENGTH = 4 * 1024 * 1024;

function trackedWindow(value: unknown): value is ReactionWindow {
  return record(value) &&
    ['id', 'title', 'processName', 'className'].every(key => typeof value[key] === 'string') &&
    ['pid', 'x', 'y', 'width', 'height'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key])) &&
    typeof value.minimized === 'boolean' &&
    (value.label == null || typeof value.label === 'string') &&
    (value.displayName == null || typeof value.displayName === 'string');
}

export class NativeReactionDesktop implements ReactionDesktop {
  private window: BrowserWindow | null = null;
  private helper: ChildProcess | null = null;
  private children = new Set<Promise<void>>();
  private wanted = false;
  private starting = false;
  private disposed = false;
  private retryAfter = 0;
  private preparing: Promise<void> | null = null;
  private state: ReturnType<ReactionDesktop['inventory']> = { windows: [], foreground: '', observedAt: 0 };
  private readonly inventoryListeners = new Set<() => void>();
  private bounds = '';
  constructor(private readonly resources: string, private readonly baseUrl: () => string) {}
  inventory() {
    const state = this.state;
    if (state.observedMonotonicAt !== undefined && performance.now() - state.observedMonotonicAt >= REACTION_WINDOW_INVENTORY_MAX_AGE_MS) {
      // Keep the timestamp so a stale snapshot never looks like a new empty list.
      return { ...state, windows: [], foreground: '' };
    }
    return state;
  }
  subscribeInventory(listener: () => void): () => void {
    this.inventoryListeners.add(listener);
    return () => { this.inventoryListeners.delete(listener); };
  }
  private expireInventory() {
    this.state = { windows: [], foreground: '', observedAt: 0 };
  }
  demand(value: boolean) {
    this.wanted = value;
    if (!value) { this.helper?.kill(); this.helper = null; this.expireInventory(); return; }
    if (!this.helper && !this.starting && !this.disposed && performance.now() >= this.retryAfter) void this.track();
  }
  private async track() {
    this.starting = true;
    try {
      const script = await readFile(join(this.resources, 'window-tracker.ps1'), 'utf8');
      if (!this.wanted || this.disposed) return;
      const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, CASMATE_OVERLAY_PID: String(process.pid) } });
      this.helper = child;
      const ended = new Promise<void>(resolve => child.once('close', () => resolve())); this.children.add(ended); void ended.then(() => this.children.delete(ended));
      let buffer = '', skippingLine = false;
      child.stdout?.setEncoding('utf8'); child.stdout?.on('data', (data: string) => {
        if (this.helper !== child || !this.wanted) return;
        if (skippingLine) {
          const newline = data.indexOf('\n');
          if (newline < 0) return;
          data = data.slice(newline + 1);
          skippingLine = false;
        }
        buffer += data;
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = end <= MAX_TRACKER_LINE_LENGTH ? buffer.slice(0, end) : '';
          buffer = buffer.slice(end + 1);
          if (!line) continue;
          try {
            const value: unknown = JSON.parse(line);
            if (!record(value) || !Array.isArray(value.windows) || value.windows.length > 256 ||
                typeof value.foreground !== 'string' || !value.windows.every(trackedWindow)) continue;
            this.state = { windows: value.windows, foreground: value.foreground, observedAt: Date.now(), observedMonotonicAt: performance.now() };
          } catch { continue; }
          for (const listener of this.inventoryListeners) listener();
          if (this.helper !== child || !this.wanted) return;
        }
        if (buffer.length > MAX_TRACKER_LINE_LENGTH) {
          buffer = '';
          skippingLine = true;
        }
      });
      const failed = () => { if (this.helper === child) { this.expireInventory(); this.render(null); } };
      child.stderr?.resume();
      child.on('error', failed); child.on('close', () => { failed(); if (this.helper === child) { this.helper = null; this.retryAfter = performance.now() + 5000; } });
    } catch { this.expireInventory(); this.retryAfter = performance.now() + 5000; } finally { this.starting = false; }
  }
  prepare() {
    if (this.preparing) return this.preparing;
    this.preparing = this.createWindow().finally(() => { this.preparing = null; });
    return this.preparing;
  }
  private async createWindow() {
    if (this.disposed) throw new Error('アプリを終了しています。');
    if (this.window && !this.window.isDestroyed()) return;
    const window = new BrowserWindow({ show: false, frame: false, transparent: true, focusable: false, skipTaskbar: true, movable: false, resizable: false, hasShadow: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, preload: join(this.resources, 'desktop-preload.cjs') } });
    this.window = window; window.setAlwaysOnTop(true, 'screen-saver'); window.setIgnoreMouseEvents(true, { forward: true }); window.setContentProtection(true);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault());
    try { await window.loadURL(`${this.baseUrl()}/overlay/reactions?desktop=1`); }
    catch { window.destroy(); this.window = null; throw new Error('PC表示を読み込めません。'); }
    if (this.disposed) { window.destroy(); throw new Error('アプリを終了しています。'); }
  }
  render(value: { x: number; y: number; width: number; height: number } | null) {
    const window = this.window; if (!window || window.isDestroyed()) return;
    if (!value) { window.hide(); this.bounds = ''; return; }
    const bounds = screen.screenToDipRect(null, value), key = JSON.stringify(bounds);
    if (key !== this.bounds) { window.setBounds(bounds, false); this.bounds = key; }
    if (!window.isVisible()) window.showInactive();
  }
  marker(data: ReactionDesktopMarker) { if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.webContents.send('reaction-marker', data); }
  reaction(data: ReactionDesktopEvent) { if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.webContents.send('reaction-particles', data); }
  clear() { if (this.window && !this.window.isDestroyed()) this.window.webContents.send('reaction-clear'); }
  async close() { this.disposed = true; this.demand(false); this.inventoryListeners.clear(); if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null; await Promise.all(this.children); }
}
