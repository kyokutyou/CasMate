/** Shared by every screenshot request on the application's OBS connection. */
export class ObsCaptureCoordinator {
  private active = false;
  private backgroundAfter = 0;
  constructor(private readonly monotonicNow = () => performance.now()) {}
  noteForegroundContention(): void {
    if (this.active) this.backgroundAfter = this.monotonicNow() + 5000;
  }
  async run<T>(priority: 'foreground' | 'background', work: () => Promise<T>): Promise<T> {
    if (this.active) {
      if (priority === 'foreground') this.noteForegroundContention();
      throw new Error('BUSY');
    }
    if (priority === 'background' && this.monotonicNow() < this.backgroundAfter) throw new Error('BUSY');
    this.active = true;
    // The physical request owns the slot. A caller's cancellation cannot release it.
    try { return await work(); } finally { this.active = false; }
  }
}
