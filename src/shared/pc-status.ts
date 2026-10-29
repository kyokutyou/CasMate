export type MeasurementStatus = 'valid' | 'pending' | 'unsupported' | 'denied' | 'failed' | 'stopped';
export interface PcMeasurement {
  value: number | null;
  status: MeasurementStatus;
  lastSuccessAt: number | null;
}
export interface PcGpu {
  id: string; name: string; kind: 'dedicated' | 'integrated';
  capacity: PcMeasurement; usage: PcMeasurement; dedicatedMemory: PcMeasurement; sharedMemory: PcMeasurement;
}
export interface PcStatusSnapshot {
  measuredAt: number | null;
  state: 'starting' | 'running' | 'stopped' | 'retrying' | 'unsupported';
  gpuStatus: MeasurementStatus;
  gpus: PcGpu[];
  memory: { used: PcMeasurement; total: PcMeasurement };
  application: { cpu: PcMeasurement; memory: PcMeasurement; incomplete: boolean };
}
export const missingMeasurement = (status: MeasurementStatus = 'pending'): PcMeasurement => ({ value: null, status, lastSuccessAt: null });
export function emptyPcStatus(state: PcStatusSnapshot['state'] = 'starting'): PcStatusSnapshot {
  const status = state === 'unsupported' ? 'unsupported' : 'pending';
  return { measuredAt: null, state, gpuStatus: status, gpus: [],
    memory: { used: missingMeasurement(status), total: missingMeasurement(status) },
    application: { cpu: missingMeasurement(status), memory: missingMeasurement(status), incomplete: true } };
}
export function freshMeasurement(metric: PcMeasurement, now: number): PcMeasurement {
  return metric.value !== null && (metric.lastSuccessAt === null || now - metric.lastSuccessAt > 10_000)
    ? { ...metric, value: null, status: 'stopped' } : metric;
}
export function freshPcStatus(snapshot: PcStatusSnapshot, now: number): PcStatusSnapshot {
  const fresh = (m: PcMeasurement) => freshMeasurement(m, now);
  return { ...snapshot, gpus: snapshot.gpus.map(g => ({ ...g, capacity: fresh(g.capacity), usage: fresh(g.usage), dedicatedMemory: fresh(g.dedicatedMemory), sharedMemory: fresh(g.sharedMemory) })),
    memory: { used: fresh(snapshot.memory.used), total: fresh(snapshot.memory.total) },
    application: { cpu: fresh(snapshot.application.cpu), memory: fresh(snapshot.application.memory), incomplete: snapshot.application.incomplete } };
}

// Parse the private worker boundary by allowlist. No process identifiers or native error text reach HTTP.
export function parsePcSample(input: unknown, now: number, previous: PcStatusSnapshot): PcStatusSnapshot {
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid PC sample');
    return v as Record<string, unknown>;
  };
  const statuses: MeasurementStatus[] = ['valid', 'pending', 'unsupported', 'denied', 'failed', 'stopped'];
  const metric = (v: unknown, before?: PcMeasurement): PcMeasurement => {
    const m = record(v);
    if (!statuses.includes(m.status as MeasurementStatus)) throw new Error('Invalid PC status');
    if (m.status === 'valid') {
      if (typeof m.value !== 'number' || !Number.isFinite(m.value) || m.value < 0) throw new Error('Invalid PC value');
      return { value: m.value, status: 'valid', lastSuccessAt: now };
    }
    if (m.value !== null) throw new Error('Invalid missing PC value');
    return { value: null, status: m.status as MeasurementStatus, lastSuccessAt: before?.lastSuccessAt ?? null };
  };
  const v = record(input); const memory = record(v.memory); const application = record(v.application);
  if (!Array.isArray(v.gpus) || v.gpus.length > 64 || !statuses.includes(v.gpuStatus as MeasurementStatus) || typeof application.incomplete !== 'boolean') throw new Error('Invalid PC sample');
  const gpus = v.gpus.map(entry => {
    const g = record(entry);
    if (typeof g.id !== 'string' || !/^[\da-f]{8}:[\da-f]{8}$/i.test(g.id) || typeof g.name !== 'string' || g.name.length > 128 || !['dedicated', 'integrated'].includes(String(g.kind))) throw new Error('Invalid GPU');
    const before = previous.gpus.find(p => p.id === g.id);
    return { id: g.id, name: g.name, kind: g.kind as PcGpu['kind'], capacity: metric(g.capacity, before?.capacity), usage: metric(g.usage, before?.usage), dedicatedMemory: metric(g.dedicatedMemory, before?.dedicatedMemory), sharedMemory: metric(g.sharedMemory, before?.sharedMemory) };
  });
  if (new Set(gpus.map(g => g.id)).size !== gpus.length) throw new Error('Duplicate GPU');
  const cpu = metric(application.cpu, previous.application.cpu);
  if ((cpu.value ?? 0) > 100 || gpus.some(g => (g.usage.value ?? 0) > 100)) throw new Error('Invalid percentage');
  return { measuredAt: now, state: 'running', gpuStatus: v.gpuStatus as MeasurementStatus, gpus,
    memory: { used: metric(memory.used, previous.memory.used), total: metric(memory.total, previous.memory.total) },
    application: { cpu, memory: metric(application.memory, previous.application.memory), incomplete: application.incomplete } };
}
