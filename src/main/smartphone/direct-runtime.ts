import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { win32 } from 'node:path';
import { defaultDirectSettings, directHost, isPublicAddress, type DirectEntryView, type DirectSrtEndpoint, type DirectTcpEndpoint, type DirectView } from '../../shared/direct-connection';
import type { OutdoorReceivers, ReceiverConfig } from '../outdoor/outdoor-receivers';
import { createDirectIdentity, validateDirectIdentity, type DirectIdentity } from './direct-identity';
import { rotateDirectInvitation, type DirectOwnedEntry } from './direct-ledger';
import { MappingFailure, WindowsDirectGateway, type DirectAdapter, type DirectGateway, type RouterMapping } from './direct-gateway';
import { WindowsDirectNetwork, type DirectWindows } from './direct-windows';
import type { DirectListener } from './direct-server';
import type { SmartphoneRecord } from './smartphone-store';
import type { MobileAudioReady } from '../speech/mobile-speech-controller';

interface Desired { key: string; adapter: DirectAdapter; family: 'ipv4' | 'ipv6'; address: string; port: number;
  protocol: 'tcp' | 'udp'; deviceId?: string; manual: { address: string; publicPort: number } | null; }
class StaleDirectPreparation extends Error {}
interface DirectRuntimeOptions {
  read: () => SmartphoneRecord | null;
  update: (change: (record: SmartphoneRecord) => void) => Promise<void>;
  changed: () => void;
  receivers: Pick<OutdoorReceivers, 'sync' | 'stop' | 'view' | 'feedback'>;
  windows?: DirectWindows; gateway?: DirectGateway; program: string; workerProgram: string;
  listen: (identity: DirectIdentity, address: string, port: number, hosts: () => string[], failed: () => void) => Promise<DirectListener>;
  now?: () => number;
}

/** Each asynchronous resource owns its persisted intent. No router/UAC wait holds the host save queue. */
export class DirectRuntime {
  private readonly windows: DirectWindows;
  private readonly gateway: DirectGateway;
  private readonly processId = randomUUID();
  private desired = new Map<string, Desired>();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly closings = new Map<string, Promise<void>>();
  private stopping?: Promise<void>;
  private shutdownSignal?: AbortSignal;
  private readonly uncertainClosures = new Set<string>();
  private readonly cancellations = new Map<string, AbortController>();
  private readonly bindings = new Map<string, { listener?: DirectListener; promise: Promise<DirectListener>; failed: boolean }>();
  private readonly firewallReady = new Set<string>();
  private readonly firewallFailed = new Set<string>();
  private readonly warnings = new Map<string, string>();
  private readonly retry = new Map<string, { at: number; failures: number }>();
  private readonly connections = new Map<string, number>();
  private readonly reachedCandidates = new Set<string>();
  private readonly udpBaseline = new Map<string, string | null>();
  private refreshQueue: Promise<void> = Promise.resolve();
  private pendingRefresh?: Promise<void>;
  private stopped = false;
  private failure: DirectView['failure'] = null;
  private fatal = false;
  private networkActive = false;
  private startupResiduals?: Set<string>;

  constructor(private readonly options: DirectRuntimeOptions) {
    this.windows = options.windows ?? new WindowsDirectNetwork(); this.gateway = options.gateway ?? new WindowsDirectGateway();
  }
  refresh(): Promise<void> {
    if (this.pendingRefresh) return this.pendingRefresh;
    const result = this.refreshQueue.then(() => { this.pendingRefresh = undefined; return this.reconcile(); });
    this.refreshQueue = result.catch(() => { this.failure = 'unknown'; this.options.changed(); });
    this.pendingRefresh = this.refreshQueue; return this.refreshQueue;
  }
  async idle(): Promise<void> {
    await this.refreshQueue;
    while (this.jobs.size || this.closings.size) await Promise.allSettled([...this.jobs.values(), ...this.closings.values()]);
  }
  async waitDevice(id: string, milliseconds = 5000): Promise<boolean> {
    const deadline = Date.now() + milliseconds;
    while (this.active()) {
      if (this.tcpEndpoints().length && this.srtEndpoints(id).length) return true;
      if (Date.now() >= deadline) break; await new Promise(resolve => setTimeout(resolve, 25));
    }
    return false;
  }
  tcpEndpoints(): DirectTcpEndpoint[] {
    return this.readyEntries('tcp').map(entry => ({ id: entry.candidateId ?? entry.request.id, family: entry.request.family,
      address: this.publicTarget(entry)!.address, tcpPort: this.publicTarget(entry)!.publicPort })).sort(preferIpv6);
  }
  srtEndpoints(deviceId: string): DirectSrtEndpoint[] {
    return this.readyEntries('udp', deviceId).map(entry => ({ id: entry.candidateId ?? entry.request.id, family: entry.request.family,
      address: this.publicTarget(entry)!.address, outdoorPort: this.publicTarget(entry)!.publicPort })).sort(preferIpv6);
  }
  async adapters(): Promise<import('../../shared/direct-connection').DirectAdapterOption[]> {
    if (this.stopped) throw new Error('直接接続のネットワーク確認は停止しています。');
    return (await this.windows.list()).map(({ id, name, description, addresses, preferred }) =>
      ({ id, name, description, addresses, preferred })).sort((a, b) =>
      Number(b.preferred) - Number(a.preferred) || a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id));
  }
  view(): DirectView {
    const ledger = this.options.read()?.direct;
    const currentCandidates = new Set((ledger?.entries ?? []).map(connectionKey));
    for (const key of this.reachedCandidates) if (!currentCandidates.has(key)) this.reachedCandidates.delete(key);
    const entries: DirectEntryView[] = (ledger?.entries ?? []).map(entry => {
      const target = this.publicTarget(entry); const prepared = this.ready(entry);
      const receiver = entry.deviceId ? this.options.receivers.view(`${entry.deviceId}:direct`) : null;
      const ambiguous = entry.request.protocol === 'udp' && (ledger?.entries ?? []).filter(e => e.request.protocol === 'udp' && e.deviceId === entry.deviceId &&
        this.desiredEntry(e) && bindingKey(e) === bindingKey(entry)).length > 1;
      const receiving = prepared && !ambiguous && entry.request.protocol === 'udp' && receiver?.state === 'receiving' && Boolean(receiver.connectionIdentity) &&
        receiver.activeListener?.family === entry.request.family && receiver.activeListener.address === entry.request.localAddress && receiver.activeListener.port === entry.request.localPort &&
        (!this.udpBaseline.has(entry.request.id) || this.udpBaseline.get(entry.request.id) !== receiver.connectionIdentity);
      const candidate = connectionKey(entry);
      const connected = receiving || (prepared && entry.request.protocol === 'tcp' && (this.connections.get(candidate) ?? 0) > 0);
      if (connected) this.reachedCandidates.add(candidate);
      return { id: entry.request.id, ...(entry.deviceId ? { deviceId: entry.deviceId } : {}), protocol: entry.request.protocol, family: entry.request.family,
        localAddress: entry.request.localAddress, localPort: entry.request.localPort, address: target?.address ?? null, publicPort: target?.publicPort ?? null,
        method: entry.manual ? 'manual' : entry.router?.method ?? entry.intent?.method ?? 'upnp', listener: this.bound(entry),
        firewall: this.firewallReady.has(entry.request.id), prepared, expiresAt: entry.router?.expiresAt ?? null,
        reachability: ambiguous ? 'unconfirmed' : connected ? 'connected' : this.reachedCandidates.has(candidate) ? 'disconnected' : 'unconfirmed',
        warning: this.warnings.get(entry.request.id) ?? (entry.manual && !this.manualConfirmed(entry) ? '手動開放を設定して、確認を完了してください。' : ambiguous ? '同じ内部待受に複数の公開候補があるため、候補別の実到達は未確認です。端末の受信状態を確認してください。' : null) };
    });
    const residual: DirectView['residual'] = [];
    for (const entry of ledger?.entries ?? []) if (entry.status === 'residual' || entry.status === 'closing' || this.closings.has(entry.request.id)) {
      if (!entry.routerRemoved) residual.push({ id: entry.request.id, kind: 'router', message: 'ルーターの削除を確認できません。期限切れまたは所有設定の削除を確認してください。' });
      if (!entry.firewallRemoved) residual.push({ id: entry.request.id, kind: 'firewall', message: 'Windowsの許可規則の削除を確認できません。残存設定を確認してください。' });
      if (entry.manual) residual.push({ id: entry.request.id, kind: 'manual', message: '手動開放はルーターで削除してください。PCの待受は停止しました。' });
    }
    return { revision: ledger?.revision ?? 0, interfaceId: this.options.read()?.settings.direct?.interfaceId ?? null, entries, residual,
      pendingDeviceIds: Object.entries(ledger?.devices ?? {}).filter(([, d]) => d.pending).map(([id]) => id), failure: this.failure };
  }
  connected(address: string, port: number, host: string): () => void {
    const entry = this.readyEntries('tcp').find(e => bindingKey(e) === `${address}:${port}` && directHost(this.publicTarget(e)!.address, this.publicTarget(e)!.publicPort) === host);
    if (!entry) return () => undefined;
    const key = connectionKey(entry); this.connections.set(key, (this.connections.get(key) ?? 0) + 1);
    this.reachedCandidates.add(key);
    this.options.changed();
    let closed = false;
    return () => {
      if (closed) return; closed = true;
      const count = Math.max(0, (this.connections.get(key) ?? 0) - 1);
      if (count) this.connections.set(key, count); else this.connections.delete(key);
      this.options.changed();
    };
  }
  sendAudioReady(id: string, audio: MobileAudioReady): void { for (const binding of this.bindings.values()) binding.listener?.sendAudioReady(id, audio); }
  discardAudio(id: string, audioId: string): void { for (const binding of this.bindings.values()) binding.listener?.discardAudio(id, audioId); }
  feedback(id: string, session: string, generation: number) { return this.options.receivers.feedback(`${id}:direct`, session, generation); }
  receiver(id: string) { return this.options.receivers.view(`${id}:direct`); }
  async manualConfirm(revision: number, deviceId?: string): Promise<void> {
    const record = this.options.read(); const ledger = record?.direct;
    if (!ledger || ledger.revision !== revision || record?.settings.activeNetwork !== 'direct' || record.settings.direct?.mode !== 'manual' ||
      (deviceId ? !record.settings.direct.manualSrtEndpoints.some(e => e.deviceId === deviceId) : !record.settings.direct.manualEndpoints.length)) throw new Error('設定が変更されています。公開接続先を確認してから、現在の設定を確認してください。');
    const signature = scopeSignature(record, deviceId);
    await this.options.update(next => { if (next.direct!.revision !== revision) throw new Error('設定が変更されています。');
      next.direct!.confirmed.signatures ??= {}; next.direct!.confirmed.signatures[deviceId ?? 'tcp'] = signature;
      if (deviceId) next.direct!.confirmed.devices[deviceId] = revision; else next.direct!.confirmed.tcp = revision; });
    await this.refresh();
  }
  async cleanup(): Promise<void> {
    for (const entry of this.options.read()?.direct?.entries ?? []) if (entry.status === 'residual' && !this.desiredEntry(entry)) {
      this.startupResiduals?.delete(entry.request.id); this.launch(entry, () => this.closeEntry(entry.request.id));
    }
    await bounded(this.idle(), 5000).catch(() => undefined); this.options.changed();
  }
  async retryNow(): Promise<void> { this.retry.clear(); this.firewallFailed.clear(); await this.refresh(); }
  resetIdentityFailure(): void { this.fatal = false; }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true; this.desired.clear();
    this.windows.stop?.();
    for (const controller of this.cancellations.values()) controller.abort();
    const cancellation = new AbortController(); this.shutdownSignal = cancellation.signal;
    const deadline = setTimeout(() => cancellation.abort(), 5000);
    const local = this.closeLocal();
    const entries = this.options.read()?.direct?.entries ?? [];
    const marking = entries.length ? this.options.update(next => { for (const entry of next.direct?.entries ?? []) entry.status = 'closing'; }) : Promise.resolve();
    // Firewall removals start independently of disk, local close and outstanding gateway jobs.
    const closing = entries.map(entry => this.closeEntry(entry.request.id, this.jobs.get(entry.request.id), marking));
    const late = this.refreshQueue.then(async () => {
      // A record save already in progress at stop may publish one last ownership intent.
      await Promise.allSettled((this.options.read()?.direct?.entries ?? []).map(entry => this.closeEntry(entry.request.id, this.jobs.get(entry.request.id))));
    });
    this.stopping = bounded(Promise.allSettled([local, marking, ...closing, late]), 5000).then(() => undefined, () => undefined)
      .finally(() => { clearTimeout(deadline); cancellation.abort(); });
    return this.stopping;
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private active() { return !this.stopped && !this.fatal && this.options.read()?.settings.activeNetwork === 'direct'; }
  private entry(id: string) { return this.options.read()?.direct?.entries.find(e => e.request.id === id); }
  private program(protocol: 'tcp' | 'udp') { return protocol === 'udp' ? this.options.workerProgram : this.options.program; }
  private currentProgram(entry: DirectOwnedEntry) { return win32.normalize(entry.firewall.program).toLowerCase() === win32.normalize(this.program(entry.request.protocol)).toLowerCase(); }
  private desiredEntry(entry: DirectOwnedEntry) { return this.active() &&
    this.options.read()?.settings.direct?.interfaceId?.toLowerCase() === entry.adapter.id.toLowerCase() &&
    this.desired.get(entry.key)?.adapter.name === entry.adapter.name && this.currentProgram(entry) && !this.cancellations.get(entry.request.id)?.signal.aborted; }
  private publicTarget(entry: DirectOwnedEntry) { return entry.manual ?? entry.router; }
  private validTarget(entry: DirectOwnedEntry): boolean {
    const target = this.publicTarget(entry);
    return Boolean(target && isPublicAddress(entry.request.family, target.address) && Number.isInteger(target.publicPort) &&
      target.publicPort >= 1024 && target.publicPort <= 65535 && (entry.request.protocol !== 'tcp' || target.publicPort !== 4455));
  }
  private manualConfirmed(entry: DirectOwnedEntry) {
    const record = this.options.read(); return Boolean(record && record.direct?.confirmed.signatures?.[entry.deviceId ?? 'tcp'] === scopeSignature(record, entry.deviceId));
  }
  private bound(entry: DirectOwnedEntry): boolean {
    if (!this.desiredEntry(entry)) return false;
    if (entry.request.protocol === 'tcp') { const binding = this.bindings.get(bindingKey(entry)); return Boolean(binding?.listener && !binding.failed); }
    const view = this.options.receivers.view(`${entry.deviceId}:direct`);
    return Boolean(view.listeners?.some(e => e.family === entry.request.family && e.address === entry.request.localAddress && e.port === entry.request.localPort));
  }
  private ready(entry: DirectOwnedEntry): boolean {
    const target = this.publicTarget(entry);
    return entry.status === 'ready' && this.desiredEntry(entry) && this.bound(entry) && this.firewallReady.has(entry.request.id) && Boolean(target &&
      this.validTarget(entry) &&
      (entry.manual ? this.manualConfirmed(entry) : entry.router && (entry.router.expiresAt === null || entry.router.expiresAt > this.now())));
  }
  private readyEntries(protocol: 'tcp' | 'udp', deviceId?: string) {
    return (this.options.read()?.direct?.entries ?? []).filter(e => e.request.protocol === protocol && (!deviceId || e.deviceId === deviceId) && this.ready(e));
  }
  private closeObsolete(entry: DirectOwnedEntry): void {
    if (this.jobs.has(entry.request.id) || entry.status === 'residual' && !this.startupResiduals?.has(entry.request.id)) return;
    // A saved residual gets one automatic retry; same-run failures need explicit retry.
    this.startupResiduals?.delete(entry.request.id);
    this.launch(entry, () => this.closeEntry(entry.request.id));
  }
  private async reconcile(): Promise<void> {
    const available = this.options.read();
    if (!this.stopped && available && this.startupResiduals === undefined)
      this.startupResiduals = new Set((available.direct?.entries ?? []).filter(entry => entry.status === 'residual').map(entry => entry.request.id));
    if (!this.active()) {
      if (this.networkActive) { this.networkActive = false; this.windows.stop?.(); }
      this.desired.clear();
      for (const controller of this.cancellations.values()) controller.abort();
      for (const entry of this.options.read()?.direct?.entries ?? []) this.closeObsolete(entry);
      await this.closeLocal();
      await this.publishSignature(); this.options.changed(); return;
    }
    this.networkActive = true;
    try {
      const record = this.options.read()!; const settings = record.settings.direct ?? defaultDirectSettings();
      const revision = record.direct!.revision; let expectedId = settings.interfaceId;
      const assertCurrent = (current = this.options.read()) => {
        if (!this.active() || current?.direct?.revision !== revision || current.settings.direct?.interfaceId !== expectedId) throw new StaleDirectPreparation();
      };
      const adapter = await this.windows.adapter(settings.interfaceId).catch(error => { assertCurrent(); throw error; });
      assertCurrent();
      if (!settings.interfaceId) {
        await this.options.update(next => { assertCurrent(next); next.settings.direct!.interfaceId = adapter.id; });
        expectedId = adapter.id; assertCurrent();
      }
      const identity = record.direct!.identity ? validateDirectIdentity(record.direct!.identity, record.pcId, this.now()) : createDirectIdentity(record.pcId, this.now());
      if (JSON.stringify(identity) !== JSON.stringify(record.direct!.identity)) {
        await this.options.update(next => { assertCurrent(next); next.direct!.identity = identity; });
        assertCurrent();
        for (const binding of this.bindings.values()) {
          if (binding.listener) binding.listener.updateIdentity(identity);
          else void binding.promise.then(listener => listener.updateIdentity(identity)).catch(() => { binding.failed = true; });
        }
      }
      assertCurrent();
      const nextDesired = this.plan(adapter);
      const previousUdp = udpGroups([...this.desired.values()]); const nextUdp = udpGroups(nextDesired);
      this.desired = new Map(nextDesired.map(d => [d.key, d]));
      for (const entry of this.options.read()!.direct!.entries) if (entry.deviceId && entry.request.protocol === 'udp' && this.desired.has(entry.key)) {
        const group = udpGroup(entry.deviceId, entry.request.localAddress, entry.request.localPort);
        if (previousUdp.get(group) !== nextUdp.get(group)) {
          this.udpBaseline.set(entry.request.id, this.options.receivers.view(`${entry.deviceId}:direct`).connectionIdentity ?? null);
          this.reachedCandidates.delete(connectionKey(entry));
        }
      }
      for (const [id, controller] of this.cancellations) { const e = this.entry(id); if (!e || !this.desiredEntry(e)) controller.abort(); }
      const oldEntries = this.options.read()!.direct!.entries;
      for (const old of oldEntries) if (!this.desiredEntry(old)) this.closeObsolete(old);
      for (const desired of nextDesired) {
        let entry = this.options.read()!.direct!.entries.find(e => e.key === desired.key && e.adapter.name === adapter.name && this.currentProgram(e));
        if (!entry) {
          const id = randomUUID(); const nonce = randomBytes(12).toString('hex');
          const request = { id, nonce, pcId: record.pcId, family: desired.family, protocol: desired.protocol, localAddress: desired.address, localPort: desired.port };
          entry = { request, ...(desired.deviceId ? { deviceId: desired.deviceId } : {}), key: desired.key, adapter, manual: desired.manual,
            firewall: { id, nonce, pcId: record.pcId, program: this.program(desired.protocol),
              address: desired.address, protocol: desired.protocol, port: desired.port, interfaceId: adapter.id, interfaceName: adapter.name, profile: adapter.profile },
            router: null, intent: null, status: 'pending', firewallRemoved: false, routerRemoved: true };
          const created = entry;
          await this.options.update(next => { assertCurrent(next); next.direct!.entries.push(created); });
          assertCurrent();
          if (entry.deviceId) this.udpBaseline.set(id, this.options.receivers.view(`${entry.deviceId}:direct`).connectionIdentity ?? null);
        }
      }
      void this.syncReceivers().then(() => this.options.changed()).catch(() => undefined);
      assertCurrent();
      const bindingWanted = new Set(nextDesired.filter(d => d.protocol === 'tcp').map(d => `${d.address}:${d.port}`));
      for (const [key, binding] of this.bindings) if (!bindingWanted.has(key)) { this.bindings.delete(key); await binding.listener?.close(); }
      for (const entry of this.options.read()!.direct!.entries) if (this.desiredEntry(entry) && !this.jobs.has(entry.request.id)) {
        if (entry.status !== 'ready' || !this.bound(entry) || !this.firewallReady.has(entry.request.id) || !this.validTarget(entry)) {
          if (!this.firewallFailed.has(entry.request.id) && (this.retry.get(entry.request.id)?.at ?? 0) <= this.now()) this.launch(entry, () => this.prepare(entry.request.id));
        } else if (entry.router?.expiresAt !== null && entry.router?.expiresAt !== undefined &&
          this.now() >= entry.router.renewedAt + (entry.router.expiresAt - entry.router.renewedAt) / 2 && (this.retry.get(entry.request.id)?.at ?? 0) <= this.now()) {
          this.launch(entry, () => this.renew(entry.request.id));
        }
      }
      await this.publishSignature(); this.options.changed();
    } catch (error) {
      if (error instanceof StaleDirectPreparation) return;
      if (error instanceof Error && error.message.includes('確認鍵')) this.fatal = true;
      this.failure = error instanceof MappingFailure ? classify(error) : 'unknown';
      // A missing adapter cannot be replaced silently; obsolete local listeners are closed.
      this.desired.clear();
      for (const controller of this.cancellations.values()) controller.abort();
      await this.closeLocal();
      for (const entry of this.options.read()?.direct?.entries ?? []) this.closeObsolete(entry);
      await this.publishSignature(); this.options.changed();
    }
  }
  private plan(adapter: DirectAdapter): Desired[] {
    const record = this.options.read()!; const settings = record.settings.direct!; const desired: Desired[] = [];
    const add = (protocol: 'tcp' | 'udp', port: number, deviceId?: string) => {
      const manuals = protocol === 'tcp' ? settings.manualEndpoints.map(e => ({ ...e, publicPort: e.tcpPort })) :
        settings.manualSrtEndpoints.filter(e => e.deviceId === deviceId).map(e => ({ ...e, publicPort: e.outdoorPort }));
      const sorted = [...adapter.addresses].sort(preferIpv6);
      const addresses = settings.mode === 'manual' ? sorted : sorted.slice(0, 4);
      const ipv4 = sorted.find(a => a.family === 'ipv4');
      if (settings.mode === 'auto' && ipv4 && !addresses.some(a => a.family === 'ipv4')) addresses[addresses.length - 1] = ipv4;
      const targets = settings.mode === 'manual' ? manuals.flatMap(e => {
        const local = addresses.find(a => a.family === e.family && (e.family === 'ipv4' || a.address === e.address));
        return local ? [{ local, manual: { address: e.address, publicPort: e.publicPort }, id: e.id }] : [];
      }) : addresses.map(local => ({ local, manual: null, id: '' }));
      for (const target of targets) {
        const key = JSON.stringify([adapter.id, adapter.profile, adapter.gateway4, adapter.gateway6, settings.mode, protocol, deviceId ?? '', target.local.family, target.local.address, port, target.id, target.manual]);
        desired.push({ key, adapter, family: target.local.family, address: target.local.address, port, protocol, deviceId, manual: target.manual });
      }
    };
    add('tcp', record.settings.statusPorts.direct!);
    for (const [id, device] of Object.entries(record.direct!.devices)) if (device.outdoor) add('udp', device.outdoor.internalPort, id);
    return desired;
  }
  private launch(entry: DirectOwnedEntry, action: () => Promise<void>): void {
    if (this.jobs.has(entry.request.id)) return;
    this.cancellations.set(entry.request.id, new AbortController());
    const job = action().catch(() => undefined).finally(async () => { await this.publishSignature().catch(() => undefined); this.jobs.delete(entry.request.id); this.cancellations.delete(entry.request.id); this.options.changed(); });
    this.jobs.set(entry.request.id, job);
  }
  private async prepare(id: string): Promise<void> {
    let entry = this.entry(id); if (!entry || !this.desiredEntry(entry)) return;
    const hadOwnershipIntent = Boolean(entry.router || entry.intent);
    try {
      // Retire the previous executable's owned scope before reusing its router tuple.
      // Keep this wait outside reconciliation so unrelated devices can still prepare.
      const retiring = (this.options.read()?.direct?.entries ?? []).filter(old => old.key === entry!.key && !this.currentProgram(old))
        .flatMap(old => { const job = this.jobs.get(old.request.id); return job ? [job] : []; });
      await Promise.allSettled(retiring);
      entry = this.entry(id); if (!entry) return; this.checkDesired(id);
      await this.options.update(next => { const target = next.direct!.entries.find(e => e.request.id === id)!; target.status = 'pending'; target.firewallRemoved = false; });
      if (entry.request.protocol === 'tcp') await this.bind(entry);
      else {
        await this.syncReceivers(entry.deviceId);
        const deadline = this.now() + 5000;
        while (this.desiredEntry(entry) && !this.bound(entry) && this.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (!this.bound(entry)) throw new Error('UDP_LISTENER');
      }
      this.checkDesired(id);
      if (!this.firewallReady.has(id)) {
        try { await this.windows.allow(entry.firewall, this.cancellations.get(id)?.signal); }
        catch (error) { this.firewallFailed.add(id); throw error; }
        this.checkDesired(id);
        this.firewallReady.add(id);
      }
      this.checkDesired(id);
      if (!entry.manual) {
        const previous = entry.router ?? entry.intent;
        let mapping: RouterMapping;
        if (previous && previous.expiresAt !== null && previous.expiresAt <= this.now() && previous.method === 'upnp' && previous.family === 'ipv6') {
          // UniqueID does not prove ownership in a later process. Retain evidence until finite expiry.
          await this.options.update(next => { const e = next.direct!.entries.find(e => e.request.id === id)!; e.router = null; e.intent = null; e.routerRemoved = true; });
          entry = this.entry(id)!;
        }
        const recovery = entry.router ?? entry.intent;
        if (recovery?.method === 'upnp' && recovery.family === 'ipv6') throw new MappingFailure('unknown', true);
        else if (recovery) mapping = await this.gateway.renew(entry.adapter, recovery, this.cancellations.get(id)?.signal);
        else mapping = await this.gateway.prepare(entry.adapter, entry.request, this.processId, async intent => {
          this.checkDesired(id);
          await this.options.update(next => { const e = next.direct!.entries.find(e => e.request.id === id)!; e.intent = intent; e.routerRemoved = false; });
          this.checkDesired(id);
        }, this.cancellations.get(id)?.signal);
        await this.saveMapping(id, mapping);
        if (!this.validTarget(this.entry(id)!)) throw new MappingFailure('upstream', true);
      }
      this.checkDesired(id);
      await this.options.update(next => { next.direct!.entries.find(e => e.request.id === id)!.status = 'ready'; });
      this.retry.delete(id); this.warnings.delete(id); this.failure = null;
    } catch (error) {
      entry = this.entry(id); if (!entry) return;
      if (error instanceof MappingFailure && error.uncertain && this.cancellations.get(id)?.signal.aborted) this.uncertainClosures.add(id);
      if (!this.desiredEntry(entry)) { if (!this.closings.has(id)) await this.closeEntry(id); return; }
      // A definite unsupported response proves this creation attempt did not
      // allocate a mapping. Unknown outcomes must keep their ownership intent.
      if (!hadOwnershipIntent && !entry.router && entry.intent && error instanceof MappingFailure && error.kind === 'unsupported' && !error.uncertain) {
        await this.options.update(next => { const e = next.direct!.entries.find(value => value.request.id === id);
          if (e && !e.router) { e.intent = null; e.routerRemoved = true; } });
      }
      this.failure = error instanceof MappingFailure ? classify(error) : 'unknown';
      this.warnings.set(id, error instanceof MappingFailure && error.kind === 'unsupported' ? '自動開放に対応していません。手動設定で接続先を準備してください。' :
        error instanceof MappingFailure && error.kind === 'upstream' ? '回線または上流NATの制約で公開接続先を利用できません。IPv6または別の回線を確認してください。' : '受信準備が未完了です。接続状態・権限要求・残存設定を確認してください。');
      const retry = this.retry.get(id); const failures = (retry?.failures ?? 0) + 1;
      this.retry.set(id, { failures, at: this.now() + Math.max(entry.intent?.method === 'pcp' ? 4000 : 1000, Math.min(30000, 1000 * 2 ** Math.min(5, failures - 1))) });
    }
  }
  private checkDesired(id: string) { const entry = this.entry(id); if (!entry || !this.desiredEntry(entry)) throw new Error('CANCELLED'); }
  private async renew(id: string): Promise<void> {
    const entry = this.entry(id); if (!entry?.router) return;
    try {
      const mapping = await this.gateway.renew(entry.adapter, entry.router, this.cancellations.get(id)?.signal);
      await this.saveMapping(id, mapping);
      if (!this.validTarget(this.entry(id)!)) {
        await this.options.update(next => { const e = next.direct!.entries.find(value => value.request.id === id); if (e) e.status = 'pending'; });
        throw new MappingFailure('upstream', true);
      }
      if (!this.desiredEntry(entry)) { if (!this.closings.has(id)) await this.closeEntry(id); }
      else { this.retry.delete(id); this.warnings.delete(id); }
    } catch (error) {
      if (error instanceof MappingFailure && error.uncertain && this.cancellations.get(id)?.signal.aborted) this.uncertainClosures.add(id);
      if (!this.desiredEntry(entry)) { if (!this.closings.has(id)) await this.closeEntry(id); return; }
      this.retry.set(id, { at: this.now() + (entry.router.method === 'pcp' ? 4000 : 2000), failures: 1 });
      this.warnings.set(id, '開放期限を更新できません。期限内の接続を維持し、再試行しています。');
    }
  }
  private async saveMapping(id: string, mapping: RouterMapping): Promise<void> {
    const previous = this.entry(id); const changed = previous?.router && (previous.router.address !== mapping.address || previous.router.publicPort !== mapping.publicPort);
    if (changed && previous.deviceId) this.udpBaseline.set(id, this.options.receivers.view(`${previous.deviceId}:direct`).connectionIdentity ?? null);
    await this.options.update(next => { const entry = next.direct!.entries.find(e => e.request.id === id); if (entry) {
      if (changed) entry.candidateId = randomUUID(); entry.router = mapping; entry.routerRemoved = false;
    } });
  }
  private async bind(entry: DirectOwnedEntry): Promise<void> {
    const key = bindingKey(entry); let existing = this.bindings.get(key);
    if (existing?.failed) { this.bindings.delete(key); await existing.listener?.close(); existing = undefined; }
    if (existing) { await existing.promise; return; }
    const binding: { listener?: DirectListener; promise: Promise<DirectListener>; failed: boolean } = { promise: Promise.resolve(null!), failed: false };
    binding.promise = this.options.listen(this.options.read()!.direct!.identity!, entry.request.localAddress, entry.request.localPort,
      () => this.readyEntries('tcp').filter(e => bindingKey(e) === key).map(e => { const target = this.publicTarget(e)!; return directHost(target.address, target.publicPort); }),
      () => { binding.failed = true; this.options.changed(); });
    this.bindings.set(key, binding);
    try { binding.listener = await binding.promise; if (!this.desiredEntry(entry)) {
      this.bindings.delete(key); await binding.listener.close(); throw new Error('CANCELLED'); }
    } catch (error) { if (this.bindings.get(key) === binding) this.bindings.delete(key); throw error; }
  }
  private async syncReceivers(waitForDevice?: string): Promise<void> {
    const record = this.options.read(); const configs: ReceiverConfig[] = [];
    if (this.active() && record) for (const [id, device] of Object.entries(record.direct!.devices)) {
      const listeners = [...this.desired.values()].filter(d => d.protocol === 'udp' && d.deviceId === id).map(d => ({ family: d.family, address: d.address, port: d.port }));
      const unique = [...new Map(listeners.map(e => [`${e.address}:${e.port}`, e])).values()];
      const obsLocalPort = record.devices.find(value => value.id === id)?.obsLocalPort;
      if (device.outdoor && obsLocalPort && unique.length) configs.push({ id: `${id}:direct`, network: 'direct', address: unique[0]!.address, port: device.outdoor.internalPort,
        localPort: obsLocalPort, passphrase: device.outdoor.passphrase, listeners: unique });
    }
    await this.options.receivers.sync(configs, waitForDevice);
  }
  private async closeLocal() {
    const bindings = [...this.bindings.values()]; this.bindings.clear(); this.connections.clear();
    await Promise.allSettled([this.options.receivers.stop(), ...bindings.map(b => b.listener?.close())]);
  }
  private closeEntry(id: string, pending?: Promise<void>, marked?: Promise<void>): Promise<void> {
    const existing = this.closings.get(id); if (existing) return existing;
    const entry = this.entry(id); if (!entry) return Promise.resolve();
    this.firewallReady.delete(id); this.firewallFailed.delete(id); this.udpBaseline.delete(id);
    const marking = marked ?? this.options.update(next => { const e = next.direct!.entries.find(e => e.request.id === id); if (e) e.status = 'closing'; });
    const firewall = this.removeFirewall(entry);
    const work = (async () => {
      await marking;
      let firewallRemoved: boolean | undefined;
      if (pending) {
        await Promise.allSettled([pending, firewall]);
        // A late allow cannot outlive the final removal, even for a non-cooperative backend.
        const latest = this.entry(id); if (!latest) return;
        firewallRemoved = await this.removeFirewall(latest, true);
      }
      const latest = this.entry(id); if (!latest) return;
      const mapping = latest.router ?? latest.intent;
      if (!latest.routerRemoved && mapping) {
        try {
          if (mapping.method === 'upnp' && mapping.family === 'ipv6' && mapping.processId !== this.processId && mapping.expiresAt !== null && mapping.expiresAt <= this.now()) { /* Old finite pinhole expired. */ }
          else await this.gateway.remove(latest.adapter, mapping, this.processId, this.shutdownSignal);
          // A sent mutation may execute late after its response was cancelled. Keep that uncertainty.
          if (!this.uncertainClosures.has(id)) await this.options.update(next => { const e = next.direct!.entries.find(e => e.request.id === id); if (e) e.routerRemoved = true; });
        } catch { /* Keep protected owner data for explicit cleanup/recovery. */ }
      }
      const removalConfirmed = firewallRemoved ?? await firewall;
      await this.options.update(next => {
        const e = next.direct!.entries.find(e => e.request.id === id); if (!e) return;
        e.firewallRemoved = removalConfirmed;
        if (e.routerRemoved && e.firewallRemoved && !e.manual) next.direct!.entries = next.direct!.entries.filter(e => e.request.id !== id);
        else e.status = 'residual';
      });
    })().finally(() => this.closings.delete(id));
    this.closings.set(id, work); return work;
  }
  private async removeFirewall(entry: DirectOwnedEntry, force = false): Promise<boolean> {
    if (!force && entry.firewallRemoved) return true;
    try {
      if (force) await this.options.update(next => { const e = next.direct!.entries.find(e => e.request.id === entry.request.id); if (e) e.firewallRemoved = false; });
      await this.windows.remove(entry.firewall);
      await this.options.update(next => { const e = next.direct!.entries.find(e => e.request.id === entry.request.id); if (e) e.firewallRemoved = true; });
      return true;
    } catch { /* Ownership evidence and the unconfirmed removal flag survive failure. */ }
    return false;
  }
  private async publishSignature(): Promise<void> {
    const signature = JSON.stringify(this.tcpEndpoints()); const record = this.options.read();
    if (record?.direct && record.direct.tcpSignature !== signature) await this.options.update(next => {
      if (next.direct!.tcpSignature !== signature) { next.direct!.tcpSignature = signature; rotateDirectInvitation(next.direct!); }
    });
  }
}
function bindingKey(entry: DirectOwnedEntry) { return `${entry.request.localAddress}:${entry.request.localPort}`; }
function udpGroup(deviceId: string, address: string, port: number) { return JSON.stringify([deviceId, address, port]); }
function udpGroups(desired: Desired[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const target of desired) if (target.protocol === 'udp' && target.deviceId) {
    const group = udpGroup(target.deviceId, target.address, target.port); const keys = groups.get(group) ?? [];
    keys.push(target.key); groups.set(group, keys);
  }
  return new Map([...groups].map(([group, keys]) => [group, JSON.stringify(keys.sort())]));
}
function connectionKey(entry: DirectOwnedEntry) { const target = entry.manual ?? entry.router; return JSON.stringify([bindingKey(entry), target ? directHost(target.address, target.publicPort) : '', entry.candidateId ?? entry.request.id]); }
function preferIpv6(a: { family: string }, b: { family: string }) { return Number(b.family === 'ipv6') - Number(a.family === 'ipv6'); }
function classify(error: MappingFailure): DirectView['failure'] { return error.kind === 'unsupported' ? 'automationUnsupported' : error.kind === 'upstream' ? 'upstreamConstraint' : 'unknown'; }
function scopeSignature(record: SmartphoneRecord, deviceId?: string): string {
  const settings = record.settings.direct!;
  return createHash('sha256').update(JSON.stringify([settings.mode, settings.interfaceId,
    deviceId ? settings.manualSrtEndpoints.filter(e => e.deviceId === deviceId) : settings.manualEndpoints,
    deviceId ? record.direct?.devices[deviceId]?.outdoor?.internalPort : record.settings.statusPorts.direct])).digest('hex');
}
async function bounded<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), timeout); })]); }
  finally { clearTimeout(timer); }
}
