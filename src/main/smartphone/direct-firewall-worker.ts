import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { trackOwnedProcess } from '../pc-status/owned-processes';
import type { FirewallGrant } from './direct-windows';

type FirewallResponse = { protocolVersion: 1; ok: boolean; error?: 'cancelled' | 'ownership' | 'policy' | 'adapter' | 'failed'; results?: FirewallResponse[] };
const incomplete = 'Windowsの受信許可が未完了です。権限要求・既存のブロック・組織の設定を確認してください。';
const cancelled = '受信準備を取り消しました。';
/** Only a validated native response can authorize a bounded removal recheck. */
export class DirectFirewallOperationError extends Error {
  constructor(readonly code: FirewallResponse['error']) { super(code === 'cancelled' ? cancelled : incomplete); }
}
function response(value: unknown, count = 1): FirewallResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['protocolVersion', 'ok', 'error', ...(count > 1 ? ['results'] : [])].includes(key)) || raw.protocolVersion !== 1 || typeof raw.ok !== 'boolean' ||
    raw.error !== undefined && (raw.ok || typeof raw.error !== 'string' || !['cancelled', 'ownership', 'policy', 'adapter', 'failed'].includes(raw.error))) throw new Error();
  if (count > 1) {
    if (raw.results === undefined) { if (raw.ok || !raw.error) throw new Error(); }
    else {
      if (!Array.isArray(raw.results) || raw.results.length !== count || raw.error !== undefined) throw new Error();
      const results = raw.results.map(item => response(item));
      if (raw.ok !== results.every(item => item.ok)) throw new Error();
      return { protocolVersion: 1, ok: raw.ok, results };
    }
  }
  return raw as FirewallResponse;
}

/** The bundled native host owns Windows elevation, protected jobs and rule changes. */
export class DirectFirewallWorker {
  constructor(private readonly executable: string) {}

  async run(grant: FirewallGrant, action: 'allow' | 'remove', signal?: AbortSignal): Promise<void> {
    const result = await this.runBatch([grant], action, signal);
    if (result[0]) throw result[0];
  }

  runBatch(grants: FirewallGrant[], action: 'allow' | 'remove', signal?: AbortSignal): Promise<(Error | null)[]> {
    if (!grants.length || grants.length > 32) return Promise.reject(new Error(incomplete));
    const [grant, ...extra] = grants;
    if (signal?.aborted) return Promise.reject(new Error(cancelled));
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try { child = trackOwnedProcess(() => spawn(this.executable, ['--direct-firewall'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })); }
      catch { reject(new Error('Windowsの受信準備を開始できません。')); return; }
      let settled = false; let buffer = ''; let bytes = 0; let result: FirewallResponse | undefined;
      const done = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        if (error) {
          child.stdin.destroy();
          try { child.kill(); } catch { /* A failed or closed handle must not hide the operation failure. */ }
          reject(error);
        }
        else resolve((result!.results ?? grants.map(() => result!)).map(item => item.ok ? null : new DirectFirewallOperationError(item.error)));
      };
      const failed = () => done(new Error(incomplete));
      const cancel = () => {
        if (settled || result) return;
        // Keep the host alive so a late elevation can observe cancellation and roll back.
        try { child.stdin.write(JSON.stringify({ protocolVersion: 1, type: 'cancel' }) + '\n'); }
        catch { failed(); }
      };
      const timer = setTimeout(() => done(new Error('受信準備の応答を確認できません。')), 125_000);
      child.once('error', failed); child.once('exit', code => { if (code !== 0) failed(); });
      child.stdin.on('error', failed); child.stdout.on('error', failed); child.stderr.on('error', failed); child.stderr.resume();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk, 'utf8'); buffer += chunk;
        if (bytes > 65_536) { done(new Error('受信準備の応答形式が正しくありません。')); return; }
        const end = buffer.indexOf('\n');
        if (end < 0 && !result) return;
        try {
          if (result) { if (buffer.trim()) throw new Error(); return; }
          result = response(JSON.parse(buffer.slice(0, end)), grants.length); buffer = buffer.slice(end + 1);
          if (buffer.trim()) throw new Error();
          child.stdin.end();
        } catch { done(new Error('受信準備の応答形式が正しくありません。')); }
      });
      child.once('close', code => {
        if (settled) return;
        if (code !== 0 || !result) { failed(); return; }
        done(signal?.aborted ? new Error(cancelled) : undefined);
      });
      signal?.addEventListener('abort', cancel, { once: true });
      try { child.stdin.write(JSON.stringify({ protocolVersion: 1, type: 'firewall', action, grant, ...(extra.length ? { grants: extra } : {}), ownerPid: process.pid }) + '\n'); }
      catch { failed(); }
      if (signal?.aborted) cancel();
    });
  }
}
