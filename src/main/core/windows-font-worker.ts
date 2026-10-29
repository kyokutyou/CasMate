import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { trackOwnedProcess } from '../pc-status/owned-processes';

const unavailable = 'フォント一覧を取得できませんでした。';
function fontsResponse(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 2 || raw.protocolVersion !== 1 || !Array.isArray(raw.fonts) || raw.fonts.length < 1 || raw.fonts.length > 16_384 ||
    !raw.fonts.every((name): name is string => typeof name === 'string' && name.length <= 200 && Boolean(name.trim()) &&
      [...name].every(character => { const code = character.charCodeAt(0); return code >= 32 && (code < 127 || code > 159); }))) throw new Error();
  return raw.fonts;
}

/** A bounded, read-only enumeration mode of the bundled Windows worker. */
export class WindowsFontWorker {
  private readonly pending = new Set<() => void>();
  private stopped = false;
  constructor(private readonly executable: string) {}
  read(): Promise<string[]> {
    if (this.stopped) return Promise.reject(new Error(unavailable));
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams | undefined; let settled = false;
      let buffer = ''; let bytes = 0; let result: string[] | undefined;
      const deadline = Date.now() + 5000;
      const stop = () => {
        child?.stdin.destroy();
        try { child?.kill(); } catch { /* Failed process handles cannot prevent rejection. */ }
      };
      const done = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.pending.delete(failed);
        if (error) { stop(); reject(error); } else resolve(result!);
      };
      const failed = () => done(new Error(unavailable));
      const timer = setTimeout(failed, 5000);
      this.pending.add(failed);
      try { child = trackOwnedProcess(() => spawn(this.executable, ['--font-catalog'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })); }
      catch { failed(); return; }
      if (settled) { stop(); return; }
      child.once('error', failed); child.once('exit', code => { if (code !== 0) failed(); });
      child.stdin.on('error', failed); child.stdout.on('error', failed); child.stderr.on('error', failed); child.stderr.resume();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk, 'utf8'); buffer += chunk;
        if (Date.now() >= deadline || bytes > 1_048_576) { failed(); return; }
        const end = buffer.indexOf('\n');
        if (end < 0 && !result) return;
        try {
          if (result) { if (buffer.trim()) throw new Error(); return; }
          result = fontsResponse(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1);
          if (buffer.trim()) throw new Error();
          child?.stdin.end();
        } catch { failed(); }
      });
      child.once('close', code => {
        if (code !== 0 || !result || Date.now() >= deadline) failed(); else done();
      });
      if (Date.now() >= deadline) { failed(); return; }
      try { child.stdin.write(JSON.stringify({ protocolVersion: 1, type: 'fonts' }) + '\n'); }
      catch { failed(); }
    });
  }
  stop(): void {
    this.stopped = true;
    for (const failed of [...this.pending]) failed();
  }
}
