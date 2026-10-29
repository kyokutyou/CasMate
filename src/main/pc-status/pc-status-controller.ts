import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { emptyPcStatus, freshPcStatus, parsePcSample, type PcStatusSnapshot } from '../../shared/pc-status';
import type { OwnedProcessIdentity } from './owned-processes';

export interface PcSampler {
  sample(): Promise<unknown>;
  stop(): void;
}
export class PcStatusController {
  private cache = emptyPcStatus();
  private sampler: PcSampler | null = null;
  private lastRequest = 0;
  private nextRetry = 0;
  private epoch = 0;
  private pending = false;
  private disposed = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly createSampler: () => PcSampler, private readonly now = Date.now) {}

  getStatus(): PcStatusSnapshot {
    if (this.disposed) return freshPcStatus(this.cache, this.now());
    this.lastRequest = this.now();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.suspend(), 10_000);
    this.idle.unref?.();
    if (!this.timer) {
      this.cache = emptyPcStatus();
      this.tick();
      this.timer = setInterval(() => this.tick(), 2_000);
      this.timer.unref?.();
      if (this.now() < this.nextRetry) this.scheduleRetry();
    }
    return freshPcStatus(this.cache, this.now());
  }

  private tick(): void {
    if (this.disposed || this.now() - this.lastRequest >= 10_000 || this.pending) return;
    if (!this.sampler) {
      if (this.now() < this.nextRetry) return;
      try { this.sampler = this.createSampler(); }
      catch { this.fail(); return; }
    }
    const sampler = this.sampler;
    const epoch = this.epoch;
    this.pending = true;
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('PC sampler timeout')), 3_000); });
    void Promise.race([Promise.resolve().then(() => sampler.sample()), deadline]).then(sample => {
      if (epoch !== this.epoch) return;
      this.cache = parsePcSample(sample, this.now(), this.cache);
    }).catch(() => { if (epoch === this.epoch) this.fail(); }).finally(() => {
      clearTimeout(timeout);
      if (epoch === this.epoch) this.pending = false;
    });
  }

  private fail(): void {
    this.sampler?.stop(); this.sampler = null;
    this.cache = { ...this.cache, state: 'retrying' };
    this.nextRetry = this.now() + 30_000;
    this.scheduleRetry();
  }
  private scheduleRetry(): void {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => { this.retry = undefined; this.tick(); }, Math.max(0, this.nextRetry - this.now()));
    this.retry.unref?.();
  }
  private suspend(): void {
    this.epoch++; this.pending = false;
    clearInterval(this.timer); this.timer = undefined;
    clearTimeout(this.idle); this.idle = undefined;
    clearTimeout(this.retry); this.retry = undefined;
    this.sampler?.stop(); this.sampler = null;
    this.cache = { ...emptyPcStatus('stopped'), state: 'stopped' };
  }
  stop(): void { this.disposed = true; this.suspend(); }
}

export class JsonLinesPcSampler implements PcSampler {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private sequence = 0;
  private pending: { id: number; resolve(value: unknown): void; reject(error: Error): void } | null = null;
  private stopped = false;
  constructor(executable: string, private readonly identities: () => OwnedProcessIdentity[]) {
    this.child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const failed = () => { this.pending?.reject(new Error('PC sampler stopped')); this.pending = null; this.stopped = true; };
    this.child.once('error', failed); this.child.once('exit', failed);
    this.child.stdin.on('error', failed);
    this.child.stderr.resume();
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 256_000) { this.stop(); return; }
      for (let end = this.buffer.indexOf('\n'); end >= 0; end = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try {
          const message = JSON.parse(line) as { protocolVersion: number; id: number; sample: unknown };
          if (message.protocolVersion !== 1 || message.id !== this.pending?.id) throw new Error('PC protocol mismatch');
          const pending = this.pending; this.pending = null; pending.resolve(message.sample);
        } catch { this.stop(); }
      }
    });
  }
  sample(): Promise<unknown> {
    if (this.stopped || this.pending) return Promise.reject(new Error('PC sampler unavailable'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending = { id, resolve, reject };
      this.child.stdin.write(JSON.stringify({ protocolVersion: 1, type: 'sample', id, roots: this.identities() }) + '\n');
    });
  }
  stop(): void {
    this.stopped = true;
    this.pending?.reject(new Error('PC sampler stopped')); this.pending = null;
    this.child.stdin.destroy(); this.child.kill();
  }
}
