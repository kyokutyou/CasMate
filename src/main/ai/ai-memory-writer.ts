import type { AiMemory } from '../../shared/ai-listener';

interface MemoryWaiter { revision: number; resolve(): void; reject(error: Error): void }

// The controller replaces memory arrays; only the snapshot being written is cloned.
export class AiMemoryWriter {
  private revision = 0;
  private savedRevision = 0;
  private pending?: { revision: number; records: AiMemory[] };
  private running = false;
  private failed = false;
  private readonly waiters = new Set<MemoryWaiter>();

  constructor(
    private readonly save: (records: AiMemory[]) => Promise<void>,
    private readonly saved: () => void,
    private readonly failure: () => void,
  ) {}

  update(records: AiMemory[]): void {
    this.pending = { revision: ++this.revision, records };
    if (this.running || this.failed) return;
    this.running = true;
    void Promise.resolve().then(() => this.drain());
  }

  flush(): Promise<void> {
    if (this.failed) return Promise.reject(this.saveError());
    if (this.savedRevision >= this.revision) return Promise.resolve();
    return new Promise<void>((resolve, reject) => this.waiters.add({ revision: this.revision, resolve, reject }));
  }

  retry(records: AiMemory[]): Promise<void> {
    this.failed = false;
    this.update(records);
    return this.flush();
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const snapshot = this.pending; this.pending = undefined;
      try {
        await this.save(structuredClone(snapshot.records));
      } catch {
        this.failed = true; this.pending = undefined; this.running = false;
        for (const waiter of this.waiters) waiter.reject(this.saveError());
        this.waiters.clear();
        try { this.failure(); } catch { /* An observer must not break persistence cleanup. */ }
        return;
      }
      this.savedRevision = snapshot.revision;
      for (const waiter of this.waiters) {
        if (waiter.revision <= this.savedRevision) { this.waiters.delete(waiter); waiter.resolve(); }
      }
      try { this.saved(); } catch { /* An observer must not interrupt pending writes. */ }
    }
    this.running = false;
  }

  private saveError(): Error { return new Error('共有記憶を保存できません。復旧後に再開してください。'); }
}
