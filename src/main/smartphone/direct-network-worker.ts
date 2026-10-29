import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { trackOwnedProcess } from '../pc-status/owned-processes';

/** Read-only networking mode of the bundled worker, independent of PC sampling. */
export class DirectNetworkWorker {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private sequence = 0;
  private retryAt = 0;
  private pending?: { id: number; promise: Promise<unknown>; resolve(value: unknown): void; reject(error: Error): void };
  private deadline?: NodeJS.Timeout;
  private idle?: NodeJS.Timeout;
  constructor(private readonly executable: string, private readonly now = Date.now, private readonly lan = false) {}

  read(): Promise<unknown> {
    if (this.pending) return this.pending.promise;
    if (this.now() < this.retryAt) return Promise.reject(new Error('Windowsの接続状態を再確認しています。しばらく待ってください。'));
    clearTimeout(this.idle);
    try { if (!this.child) this.start(); }
    catch { this.fail(); return Promise.reject(new Error('Windowsの接続状態を確認できません。')); }
    const id = ++this.sequence;
    const promise = new Promise<unknown>((resolve, reject) => { this.pending = { id, promise: undefined!, resolve, reject }; });
    this.pending!.promise = promise;
    this.deadline = setTimeout(() => this.fail(), 5000);
    try { this.child!.stdin.write(JSON.stringify({ protocolVersion: 1, type: 'adapters', id }) + '\n'); }
    catch { this.fail(); }
    return promise;
  }
  private start(): void {
    const child = trackOwnedProcess(() => spawn(this.executable, [this.lan ? '--lan-network' : '--direct-network'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    this.child = child; this.buffer = '';
    const failed = () => { if (this.child === child) this.fail(); };
    child.once('error', failed); child.once('exit', failed); child.stdin.on('error', failed); child.stdout.on('error', failed);
    child.stderr.on('error', failed); child.stderr.resume(); child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.buffer += chunk;
      if (this.buffer.length > 65_536) { this.fail(); return; }
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try {
          const response = JSON.parse(line) as { protocolVersion: number; id: number; adapters: unknown };
          if (response.protocolVersion !== 1 || !this.pending || response.id !== this.pending.id || !Array.isArray(response.adapters) || response.adapters.length > 128) throw new Error('Invalid network response');
          clearTimeout(this.deadline); this.deadline = undefined;
          const pending = this.pending; this.pending = undefined; pending.resolve(response.adapters);
          this.idle = setTimeout(() => this.stop(), 10_000); this.idle.unref?.();
        } catch { this.fail(); return; }
      }
    });
  }
  private fail(): void { this.retryAt = this.now() + 30_000; this.stop(); }
  stop(): void {
    clearTimeout(this.deadline); clearTimeout(this.idle); this.deadline = undefined; this.idle = undefined;
    const pending = this.pending; this.pending = undefined;
    const child = this.child; this.child = undefined; this.buffer = '';
    pending?.reject(new Error('Windowsの接続状態を確認できません。'));
    child?.stdin.destroy(); child?.kill();
  }
}
