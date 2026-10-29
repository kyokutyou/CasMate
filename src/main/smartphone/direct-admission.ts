interface Pending { source: string; close: () => void; timer?: NodeJS.Timeout; authenticated: boolean; }

/** Only this TLS listener's unauthenticated connections consume these bounded slots. */
export class DirectAdmission {
  private readonly connections = new Map<string, Pending>();
  private readonly failures = new Map<string, { count: number; until: number }>();
  constructor(private readonly now = Date.now, private readonly timeout = 5000) {}
  open(id: string, source: string, close: () => void): boolean {
    const pending = [...this.connections.values()].filter(e => !e.authenticated);
    if (pending.length >= 64 || pending.filter(e => e.source === source).length >= 8 || this.blocked(source)) { close(); return false; }
    const entry = { source, close, authenticated: false }; this.connections.set(id, entry); this.deadline(id); return true;
  }
  secure(id: string): void { if (this.connections.has(id)) this.deadline(id); }
  authenticated(id: string): void { const entry = this.connections.get(id); if (entry) { clearTimeout(entry.timer); entry.authenticated = true; } }
  failed(id: string): void {
    const entry = this.connections.get(id); if (!entry) return;
    const previous = this.failures.get(entry.source); const count = previous && previous.until > this.now() ? previous.count + 1 : 1;
    this.failures.delete(entry.source); this.failures.set(entry.source, { count, until: this.now() + 60000 });
    if (this.failures.size > 1024) this.failures.delete(this.failures.keys().next().value!);
    if (count >= 20 && !entry.authenticated) entry.close();
  }
  closed(id: string): void { clearTimeout(this.connections.get(id)?.timer); this.connections.delete(id); }
  close(): void { for (const entry of this.connections.values()) { clearTimeout(entry.timer); entry.close(); } this.connections.clear(); this.failures.clear(); }
  private blocked(source: string) { const value = this.failures.get(source); return Boolean(value && value.until > this.now() && value.count >= 20); }
  private deadline(id: string) {
    const entry = this.connections.get(id)!; clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { if (!entry.authenticated) entry.close(); }, this.timeout).unref();
  }
}
