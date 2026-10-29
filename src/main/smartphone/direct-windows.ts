import { isAllowedObsEndpointAddress, isRegistrationId } from '../../shared/obs-control';
import { isPublicAddress, type DirectFamily } from '../../shared/direct-connection';
import type { DirectAdapter } from './direct-gateway';
import { DirectNetworkWorker } from './direct-network-worker';
import { DirectFirewallOperationError, DirectFirewallWorker } from './direct-firewall-worker';
import { pcStatusWorkerExecutablePath } from '../pc-status/worker-path';

export interface FirewallGrant {
  id: string; pcId: string; nonce: string; program: string; address: string; protocol: 'tcp' | 'udp'; port: number;
  interfaceId: string; interfaceName: string; profile: DirectAdapter['profile'];
}
export interface DirectWindows {
  list(): Promise<DiscoveredDirectAdapter[]>;
  adapter(id: string | null): Promise<DirectAdapter>;
  allow(grant: FirewallGrant, signal?: AbortSignal): Promise<void>;
  remove(grant: FirewallGrant): Promise<void>;
  stop?(): void;
}
type DiscoveredDirectAdapter = DirectAdapter & { description: string; preferred: boolean };
export function validateDirectAdapters(value: unknown): DiscoveredDirectAdapter[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error('ネットワークの接続状態を確認できません。');
  const result: DiscoveredDirectAdapter[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as DiscoveredDirectAdapter;
    if (!/^[a-zA-Z0-9{}-]{1,80}$/u.test(row.id) || typeof row.name !== 'string' || !row.name || row.name.length > 256 ||
      !['Domain', 'Private', 'Public'].includes(row.profile) || !Number.isInteger(row.index) || row.index < 1 || !Array.isArray(row.addresses)) continue;
    const addresses = row.addresses.filter(a => a && (isPublicAddress(a.family, a.address) || (a.family === 'ipv4' && isAllowedObsEndpointAddress('lan', a.address))));
    if (!addresses.length) continue;
    result.push({ ...row, description: typeof row.description === 'string' && row.description.length <= 256 ? row.description.trim() : '', addresses, gateway4: typeof row.gateway4 === 'string' ? row.gateway4 : null,
      gateway6: typeof row.gateway6 === 'string' ? row.gateway6 : null, preferred: row.preferred === true });
  }
  return result;
}
export class WindowsDirectNetwork implements DirectWindows {
  private queue: Promise<unknown> = Promise.resolve();
  private pending: { grant: FirewallGrant; action: 'allow' | 'remove'; signal?: AbortSignal; resolve: () => void; reject: (error: unknown) => void }[] = [];
  private batchTimer?: NodeJS.Timeout;
  private readonly network: DirectNetworkWorker;
  private readonly firewall: DirectFirewallWorker;
  constructor(executable = pcStatusWorkerExecutablePath(false, process.cwd(), ''), lan = false) {
    this.network = new DirectNetworkWorker(executable, Date.now, lan); this.firewall = new DirectFirewallWorker(executable);
  }
  async list(): Promise<DiscoveredDirectAdapter[]> {
    if (process.platform !== 'win32') throw new Error('直接接続のWindows受信準備を利用できません。');
    return validateDirectAdapters(await this.network.read());
  }
  stop(): void { this.network.stop(); }
  async adapter(id: string | null): Promise<DirectAdapter> {
    const adapters = await this.list();
    const adapter = id ? adapters.find(a => a.id.toLowerCase() === id.toLowerCase()) : adapters.find(a => a.preferred);
    if (!adapter) throw new Error('選択したネットワークを利用できません。直接接続のインターフェースを確認してください。');
    return adapter;
  }
  allow(grant: FirewallGrant, signal?: AbortSignal): Promise<void> { return this.mutate(grant, 'allow', signal); }
  remove(grant: FirewallGrant): Promise<void> { return this.mutate(grant, 'remove'); }
  private async mutate(grant: FirewallGrant, action: 'allow' | 'remove', signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('受信準備を取り消しました。');
    if (!isRegistrationId(grant.id) || !isRegistrationId(grant.pcId) || !/^[a-f0-9]{24}$/u.test(grant.nonce) ||
      !(['ipv4', 'ipv6'] as DirectFamily[]).some(f => isPublicAddress(f, grant.address)) && !isAllowedObsEndpointAddress('lan', grant.address)) throw new Error('受信許可の対象が正しくありません。');
    if (process.platform !== 'win32') throw new Error('直接接続のWindows受信準備を利用できません。');
    return new Promise<void>((resolve, reject) => {
      // Snapshot before the collection window: later caller mutations cannot alter a protected job.
      this.pending.push({ grant: { ...grant }, action, signal, resolve, reject });
      this.batchTimer ??= setTimeout(() => { this.batchTimer = undefined; this.flush(); }, 100);
    });
  }
  private flush(): void {
    while (this.pending.length) {
      const action = this.pending[0]!.action; const ids = new Set<string>();
      const batch: typeof this.pending = [];
      while (this.pending.length && this.pending[0]!.action === action && batch.length < 32 && !ids.has(this.pending[0]!.grant.id)) {
        const item = this.pending.shift()!; ids.add(item.grant.id); batch.push(item);
      }
      const execute = async () => {
        const current = batch.filter(item => {
          if (!item.signal?.aborted) return true;
          item.reject(new Error('受信準備を取り消しました。')); return false;
        });
        if (!current.length) return;
        const controller = new AbortController(); const cancel = () => controller.abort();
        for (const item of current) item.signal?.addEventListener('abort', cancel, { once: true });
        try {
          const results = await this.firewall.runBatch(current.map(item => item.grant), action, controller.signal);
          // A deadline may interrupt confirmation after Windows has already deleted the rules.
          // Recheck only explicit native failures, within this queue slot, before any later allow.
          const uncertain = action === 'remove' ? results.flatMap((error, index) =>
            error instanceof DirectFirewallOperationError && error.code === 'failed' ? [index] : []) : [];
          if (uncertain.length) {
            try {
              const verified = await this.firewall.runBatch(uncertain.map(index => current[index]!.grant), 'remove');
              uncertain.forEach((index, resultIndex) => { results[index] = verified[resultIndex]!; });
            } catch (error) {
              for (const index of uncertain) results[index] = error instanceof Error ? error : new Error('Windowsの受信規則の削除を確認できません。');
            }
          }
          current.forEach((item, index) => { const error = results[index]; if (error) item.reject(error); else item.resolve(); });
        } catch (error) { for (const item of current) item.reject(error); }
        finally { for (const item of current) item.signal?.removeEventListener('abort', cancel); }
      };
      this.queue = this.queue.then(execute).catch(() => undefined);
    }
  }
}
