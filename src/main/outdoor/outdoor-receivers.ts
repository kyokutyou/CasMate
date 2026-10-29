import { spawn } from 'node:child_process';
import type { OutdoorReceiverSample, OutdoorReceiverView } from '../../shared/outdoor';
import { isOutdoorPort } from '../../shared/outdoor';
import { isAllowedObsEndpointAddress, isRegistrationId } from '../../shared/obs-control';
import type { SmartphoneNetwork } from '../../shared/smartphone';
import { randomUUID } from 'node:crypto';
import { isPublicAddress } from '../../shared/direct-connection';

export interface ReceiverConfig { id: string; network: SmartphoneNetwork | 'direct'; address: string; port: number; localPort: number; passphrase: string;
  listeners?: { family: 'ipv4' | 'ipv6'; address: string; port: number }[]; }
export interface RecognitionTap { port: number; connectionRevision: number }
export interface OutdoorRecognitionSource {
  receiverInstance: string; connectionRevision: number; sessionId: string; generation: number; receiving: boolean;
}
export interface ReceiverWorker { close(): Promise<void>; exited?: Promise<void>; update?(config: ReceiverConfig): void; setRecognitionTap?(tap: RecognitionTap | null): void; }
export type ReceiverWorkerFactory = (config: ReceiverConfig, change: (sample: OutdoorReceiverSample) => void, fail: () => void) => ReceiverWorker;
interface Entry {
  config: ReceiverConfig; worker?: ReceiverWorker; sample?: OutdoorReceiverSample;
  at: number; startedAt: number; failedAt?: number;
  instance: string;
  epoch: number; closing?: Promise<boolean>; stopStatus?: 'stopping' | 'unknown';
}

interface ReceiverOwner { config: ReceiverConfig; retire(): Promise<boolean> }
const deviceKey = (id: string) => id.replace(/:(lan|tailscale|direct)$/u, '');

/** Both route managers share ownership of each device's loopback writer. */
export class ReceiverOwnership {
  private readonly owners = new Map<string, ReceiverOwner>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private route: SmartphoneNetwork | null | undefined;
  private revision = 0;
  private guard: (config: ReceiverConfig) => boolean = () => true;
  get epoch(): number { return this.revision; }
  setGuard(guard: (config: ReceiverConfig) => boolean): void { this.guard = guard; this.invalidate(); }
  activate(route: SmartphoneNetwork | null): void {
    if (this.route !== route) { this.route = route; this.revision += 1; }
    this.invalidate();
  }
  invalidate(): void {
    for (const owner of this.owners.values()) if (!this.accepts(owner.config)) void owner.retire();
  }
  accepts(config: ReceiverConfig, epoch = this.revision): boolean {
    return epoch === this.revision && (this.route === undefined || this.route === config.network) && this.guard(config);
  }
  run(id: string, action: () => Promise<void>): Promise<void> {
    const key = deviceKey(id);
    const next = (this.queues.get(key) ?? Promise.resolve()).then(action, action);
    this.queues.set(key, next);
    void next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); }).catch(() => undefined);
    return next;
  }
  async claim(owner: ReceiverOwner, epoch: number, current: () => boolean): Promise<boolean> {
    const key = deviceKey(owner.config.id);
    const previous = this.owners.get(key);
    if (previous && previous !== owner) await previous.retire();
    // A route may have changed away and back while waiting for the old process.
    if (!this.accepts(owner.config, epoch) || !current() || this.owners.has(key)) return false;
    this.owners.set(key, owner); return true;
  }
  release(owner: ReceiverOwner): void {
    const key = deviceKey(owner.config.id);
    if (this.owners.get(key) === owner) this.owners.delete(key);
  }
}

/** An unconfirmed exit retains its lease; stale callbacks cannot restore it. */
export class OutdoorReceivers {
  private readonly entries = new Map<string, Entry>();
  private wanted = new Map<string, ReceiverConfig>();
  private readonly leases = new WeakMap<Entry, ReceiverOwner>();
  private readonly recognitionListeners = new Set<(id: string) => void>();
  constructor(private readonly factory: ReceiverWorkerFactory, private readonly now = Date.now,
    private readonly ownership = new ReceiverOwnership()) {}
  setGuard(guard: (config: ReceiverConfig) => boolean): void { this.ownership.setGuard(guard); }
  activate(network: SmartphoneNetwork | null): void { this.ownership.activate(network); }
  invalidate(): void { this.ownership.invalidate(); }
  async sync(configs: ReceiverConfig[], waitForDevice?: string): Promise<void> {
    const wanted = new Map(configs.map(config => [config.id, structuredClone(config)]));
    this.wanted = wanted;
    const epoch = this.ownership.epoch;
    const ids = new Set([...this.entries.keys(), ...wanted.keys()]);
    const jobs = [...ids].map(id => ({ id, completion: this.ownership.run(id, async () => {
      const config = wanted.get(id);
      const current = () => this.wanted === wanted && (!config || this.ownership.accepts(config, epoch));
      if (!current()) return;
      let previous = this.entries.get(id);
      if (previous && config?.network === 'direct' && previous.worker?.update && previous.failedAt === undefined && !previous.closing &&
          JSON.stringify({ ...config, listeners: null, address: null, port: null }) === JSON.stringify({ ...previous.config, listeners: null, address: null, port: null })) {
        if (JSON.stringify(previous.config) !== JSON.stringify(config)) {
          try { previous.worker.update(config); previous.config = structuredClone(config); }
          catch { previous.failedAt = this.now(); this.recognitionChanged(id); }
        }
      }
      if (previous && JSON.stringify(previous.config) !== JSON.stringify(config)) {
        if (!await this.retire(previous) || !current()) return;
        previous = undefined;
      } else if (previous && previous.failedAt === undefined && !previous.closing && this.now() - Math.max(previous.at, previous.startedAt) > 2500) {
        previous.failedAt = this.now(); await this.retire(previous);
      }
      if (!config || !current()) return;
      if (previous && !previous.closing && (previous.failedAt === undefined || this.now() - previous.failedAt < 2000)) return;
      if (previous && (!await this.retire(previous) || !current())) return;
      const entry: Entry = { config, epoch, at: 0, startedAt: this.now(), instance: randomUUID() };
      this.entries.set(id, entry);
      const lease: ReceiverOwner = { config, retire: () => this.retire(entry) }; this.leases.set(entry, lease);
      if (!await this.ownership.claim(lease, epoch, current)) {
        if (current()) { entry.failedAt = this.now(); entry.stopStatus = 'unknown'; this.recognitionChanged(id); }
        else this.release(entry);
        return;
      }
      // Claim has awaited another manager's shutdown. Fence again before spawn.
      if (!current()) { this.release(entry); return; }
      try {
        entry.worker = this.factory(config, sample => { if (this.current(entry)) {
          const changed = entry.sample?.state !== sample.state || entry.sample?.connectionRevision !== sample.connectionRevision ||
            entry.sample?.sessionId !== sample.sessionId || entry.sample?.generation !== sample.generation;
          entry.sample = sample; entry.at = this.now(); if (changed) this.recognitionChanged(id);
        } }, () => { if (this.current(entry)) { entry.failedAt = this.now(); entry.sample = undefined;
          this.detachTap(entry); this.recognitionChanged(id); } });
        if (entry.worker.exited) void entry.worker.exited.then(() => {
          if (entry.closing) this.release(entry);
          else {
            this.ownership.release(lease); entry.failedAt ??= this.now(); entry.sample = undefined;
            this.detachTap(entry); this.recognitionChanged(id);
          }
        }, () => undefined);
      } catch { entry.failedAt = this.now(); this.ownership.release(lease); }
      this.recognitionChanged(id);
    }).catch(() => undefined) }));
    // Direct TCP and other devices can prepare while one device is retiring.
    await Promise.allSettled(jobs.filter(job => !waitForDevice || deviceKey(job.id) === deviceKey(waitForDevice)).map(job => job.completion));
  }
  private current(entry: Entry): boolean {
    return this.entries.get(entry.config.id) === entry && entry.failedAt === undefined && !entry.closing && this.ownership.accepts(entry.config, entry.epoch);
  }
  private detachTap(entry: Entry): void {
    try { entry.worker?.setRecognitionTap?.(null); } catch { /* Stop still proceeds if the pipe is unavailable. */ }
  }
  private release(entry: Entry): void {
    const lease = this.leases.get(entry); if (lease) this.ownership.release(lease);
    if (this.entries.get(entry.config.id) === entry) { this.entries.delete(entry.config.id); this.recognitionChanged(entry.config.id); }
  }
  private retire(entry: Entry): Promise<boolean> {
    if (entry.closing) return entry.closing;
    entry.stopStatus = 'stopping'; entry.sample = undefined;
    this.detachTap(entry); this.recognitionChanged(entry.config.id);
    // Call every worker immediately, before awaiting any other device.
    let close: Promise<void>;
    try { close = Promise.resolve(entry.worker?.close()); } catch { close = Promise.reject(new Error('RECEIVER_STOP')); }
    const completion = close.then(() => { this.release(entry); return true; }, () => false);
    entry.closing = bounded(completion, 3000, false).then(confirmed => {
      if (!confirmed && this.entries.get(entry.config.id) === entry) {
        entry.stopStatus = 'unknown'; entry.failedAt = this.now(); this.recognitionChanged(entry.config.id);
      }
      return confirmed;
    });
    return entry.closing;
  }
  subscribeRecognition(listener: (id: string) => void): () => void {
    this.recognitionListeners.add(listener); return () => this.recognitionListeners.delete(listener);
  }
  recognitionSource(id: string): OutdoorRecognitionSource | null {
    const entry = this.entries.get(id); const sample = entry?.sample;
    if (!entry || !this.current(entry) || !sample?.sessionId || !sample.connectionRevision) return null;
    return { receiverInstance: entry.instance, connectionRevision: sample.connectionRevision, sessionId: sample.sessionId,
      generation: sample.generation, receiving: sample.state === 'receiving' && this.now() - entry.at < 1000 };
  }
  setRecognitionTap(id: string, tap: RecognitionTap | null): boolean {
    const entry = this.entries.get(id);
    if (!entry?.worker?.setRecognitionTap || !this.current(entry)) return false;
    if (tap && (!isOutdoorPort(tap.port) || tap.port === entry.config.localPort || tap.port === entry.config.port ||
        entry.config.listeners?.some(endpoint => endpoint.port === tap.port) ||
        !Number.isSafeInteger(tap.connectionRevision) || tap.connectionRevision <= 0 ||
        this.recognitionSource(id)?.connectionRevision !== tap.connectionRevision || !this.recognitionSource(id)?.receiving)) return false;
    try { entry.worker.setRecognitionTap(tap); return true; } catch { return false; }
  }
  private recognitionChanged(id: string): void {
    for (const listener of this.recognitionListeners) listener(id);
  }
  view(id: string): OutdoorReceiverView {
    const entry = this.entries.get(id);
    return { state: !entry ? 'stopped' : entry.stopStatus === 'stopping' ? 'stopped' : entry.failedAt !== undefined ? 'error' : this.now() - Math.max(entry.at, entry.startedAt) > 2500
      ? 'error' : entry.sample?.state ?? 'starting', receivedBytes: entry?.sample?.receivedBytes ?? 0,
      ...(entry?.sample?.listeners ? { listeners: structuredClone(entry.sample.listeners) } : {}),
      ...(entry?.sample?.activeListener !== undefined ? { activeListener: structuredClone(entry.sample.activeListener) } : {}),
      connectionIdentity: entry?.sample?.connectionRevision ? `${entry.instance}:${entry.sample.connectionRevision}` : null,
      ...(entry?.stopStatus ? { stopStatus: entry.stopStatus } : {}) };
  }
  feedback(id: string, session: string, generation: number): OutdoorReceiverSample | null {
    const entry = this.entries.get(id); const sample = entry?.sample;
    return entry && this.current(entry) && this.now() - entry.at < 1000 && sample?.state === 'receiving' &&
      sample.sessionId === session && sample.generation === generation ? {
        version: 1, state: sample.state, sessionId: sample.sessionId, generation: sample.generation, receivedBytes: sample.receivedBytes,
        videoFrames: sample.videoFrames, audioFrames: sample.audioFrames, videoPts: sample.videoPts, audioPts: sample.audioPts,
        lostPackets: sample.lostPackets, droppedPackets: sample.droppedPackets,
      } : null;
  }
  async stop(): Promise<void> {
    this.wanted = new Map();
    await Promise.allSettled([...this.entries.values()].map(entry => this.retire(entry)));
  }
}

async function bounded<T>(completion: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([completion, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), milliseconds); timer.unref(); })]); }
  finally { clearTimeout(timer); }
}

function parseSample(value: unknown): OutdoorReceiverSample | null {
  if (!value || typeof value !== 'object') return null;
  const sample = value as OutdoorReceiverSample;
  if (sample.version !== 1 || !['listening', 'receiving', 'reconnecting'].includes(sample.state) ||
      !(sample.sessionId === null || isRegistrationId(sample.sessionId))) return null;
  const integers = [sample.generation, sample.receivedBytes, sample.videoFrames, sample.audioFrames, sample.lostPackets, sample.droppedPackets];
  if (!integers.every(n => Number.isSafeInteger(n) && n >= 0) ||
      ![sample.videoPts, sample.audioPts].every(n => Number.isSafeInteger(n) && n >= -1 && n < 2 ** 33)) return null;
  // Construct explicitly: native output is not allowed to add fields to feedback.
  if (sample.listeners !== undefined && (!Array.isArray(sample.listeners) || sample.listeners.length > 4 || sample.listeners.some(e =>
    !e || !['ipv4', 'ipv6'].includes(e.family) || !isOutdoorPort(e.port) ||
    !(isPublicAddress(e.family, e.address) || (e.family === 'ipv4' && (isAllowedObsEndpointAddress('lan', e.address) || isAllowedObsEndpointAddress('tailscale', e.address))))))) return null;
  if (sample.activeListener !== undefined && sample.activeListener !== null && !sample.listeners?.some(e =>
    e.family === sample.activeListener!.family && e.address === sample.activeListener!.address && e.port === sample.activeListener!.port)) return null;
  if (sample.connectionRevision !== undefined && (!Number.isSafeInteger(sample.connectionRevision) || sample.connectionRevision < 0)) return null;
  return { version: 1, state: sample.state, sessionId: sample.sessionId, generation: sample.generation,
    receivedBytes: sample.receivedBytes, videoFrames: sample.videoFrames, audioFrames: sample.audioFrames,
    lostPackets: sample.lostPackets, droppedPackets: sample.droppedPackets, videoPts: sample.videoPts, audioPts: sample.audioPts,
    ...(sample.listeners ? { listeners: sample.listeners.map(e => ({ family: e.family, address: e.address, port: e.port })) } : {}),
    ...(sample.activeListener !== undefined ? { activeListener: sample.activeListener ? { family: sample.activeListener.family, address: sample.activeListener.address, port: sample.activeListener.port } : null } : {}),
    ...(sample.connectionRevision !== undefined ? { connectionRevision: sample.connectionRevision } : {}) };
}

export function nativeReceiverFactory(executable: string): ReceiverWorkerFactory {
  return (config, change, fail) => {
    const validate = (next: ReceiverConfig) => {
    if ((next.network !== 'direct' && !isAllowedObsEndpointAddress(next.network, next.address)) || !isOutdoorPort(next.port) ||
        !isOutdoorPort(next.localPort) || next.port === next.localPort || !/^[a-zA-Z0-9]{32}$/u.test(next.passphrase)) throw new Error('RECEIVER_CONFIG');
    if (next.network === 'direct' && (!next.listeners?.length || next.listeners.length > 4 || next.listeners.some(e =>
      !isOutdoorPort(e.port) || e.port === next.localPort || !(isPublicAddress(e.family, e.address) || (e.family === 'ipv4' && isAllowedObsEndpointAddress('lan', e.address)))))) throw new Error('RECEIVER_CONFIG');
    };
    validate(config);
    const configuration = (next: ReceiverConfig) => next.network === 'direct'
      ? `2\tdirect\t${next.localPort}\t${next.passphrase}\t${next.listeners!.length}\t${next.listeners!.map(e => `${e.family}\t${e.address}\t${e.port}`).join('\t')}\n`
      : `1\t${next.address}\t${next.port}\t${next.localPort}\t${next.passphrase}\n`;
    const child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let stopped = false; let finished = false; let buffer = '';
    const completion = new Promise<void>(resolve => {
      child.once('exit', () => { finished = true; if (!stopped) fail(); resolve(); });
      child.on('error', () => {
        if (!stopped) fail();
        // An error on a running child (including kill failure) does not prove exit.
        if (child.pid === undefined) { finished = true; resolve(); }
      });
    });
    const invalid = () => { if (!stopped) fail(); try { child.kill(); } catch { /* Keep ownership until exit. */ } };
    child.stdin.on('error', invalid);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      if (stopped) return;
      buffer += data;
      if (buffer.length > 16384) { invalid(); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let sample: OutdoorReceiverSample | null = null;
        try { sample = parseSample(JSON.parse(line)); } catch { /* Never log native output. */ }
        if (!sample) { invalid(); return; }
        change(sample);
      }
    });
    child.stdin.write(configuration(config));
    let closing: Promise<void> | undefined;
    return { exited: completion, setRecognitionTap: tap => {
      if (stopped || finished || (tap && (!isOutdoorPort(tap.port) || !Number.isSafeInteger(tap.connectionRevision) || tap.connectionRevision <= 0 ||
        tap.port === config.localPort || tap.port === config.port || config.listeners?.some(endpoint => endpoint.port === tap.port)))) throw new Error('RECEIVER_TAP');
      child.stdin.write(`tap\t1\t${tap?.port ?? 0}\t${tap?.connectionRevision ?? 0}\n`);
    }, update: next => {
      validate(next);
      if (next.network !== 'direct' || config.network !== 'direct' || next.localPort !== config.localPort || next.passphrase !== config.passphrase || stopped) throw new Error('RECEIVER_UPDATE');
      child.stdin.write(configuration(next));
    }, close: () => {
      closing ??= (async () => {
        stopped = true;
        if (finished) return;
        child.stdin.end();
        if (await bounded(completion.then(() => true), 1500, false)) return;
        try { child.kill(); } catch { /* Ownership is retained until an actual exit. */ }
        if (!await bounded(completion.then(() => true), 1500, false)) throw new Error('RECEIVER_STOP_UNKNOWN');
      })();
      return closing;
    } };
  };
}
