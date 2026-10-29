import { pcStatusWorkerExecutablePath } from '../pc-status/worker-path';
import { WindowsFontWorker } from './windows-font-worker';

/** Bounded, read-only Windows enumeration. Never runs on the comment processing path. */
export class WindowsFontCatalog {
  private cached?: { at: number; fonts: string[] };
  private pending?: Promise<string[]>;
  private rejectPending?: (error: Error) => void;
  private stopped = false;
  private readonly worker?: WindowsFontWorker;
  private readonly enumerate: () => Promise<string[]>;
  constructor(enumerate?: () => Promise<string[]>, executable = pcStatusWorkerExecutablePath(false, process.cwd(), '')) {
    if (enumerate) this.enumerate = enumerate;
    else {
      this.worker = new WindowsFontWorker(executable);
      this.enumerate = () => process.platform === 'win32' ? this.worker!.read() : Promise.reject(new Error('フォント一覧はWindowsで利用できます。'));
    }
  }
  list(): Promise<string[]> {
    if (this.stopped) return Promise.reject(new Error('フォント一覧を取得できませんでした。'));
    if (this.cached && Date.now() - this.cached.at < 300_000) return Promise.resolve([...this.cached.fonts]);
    if (this.pending) return this.pending;
    const operation = this.enumerate().then(fonts => {
      if (this.stopped) throw new Error('フォント一覧を取得できませんでした。');
      const names = [...new Set(fonts.filter(name => name.trim() && name.length <= 200))].sort((a, b) => a.localeCompare(b, 'ja'));
      if (!names.length) throw new Error('フォント一覧を取得できませんでした。');
      this.cached = { at: Date.now(), fonts: names }; return [...names];
    });
    this.pending = new Promise<string[]>((resolve, reject) => { this.rejectPending = reject; void operation.then(resolve, reject); })
      .finally(() => { this.pending = undefined; this.rejectPending = undefined; });
    return this.pending;
  }
  stop(): void {
    this.stopped = true; this.cached = undefined;
    this.rejectPending?.(new Error('フォント一覧を取得できませんでした。')); this.worker?.stop();
  }
}
