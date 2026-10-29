export type OutdoorStatus = 'stopped' | 'preparing' | 'connecting' | 'sending' | 'reconnecting' | 'actionRequired';
export const outdoorErrors = ['NONE', 'PERMISSION_REQUIRED', 'QUALITY_UNSUPPORTED', 'CAMERA_FAILED',
  'SERVICE_FAILED', 'INPUT_LOST', 'CONNECTION_FAILED', 'AUTH_FAILED', 'OS_STOPPED'] as const;
export interface OutdoorReport {
  version: 1; registrationId: string; revision: number; sessionId: string; sequence: number;
  status: OutdoorStatus; microphone: 'enabled' | 'muted'; errorCode: typeof outdoorErrors[number];
}
export interface OutdoorRegistration {
  type: 'casmate.outdoor'; version: 3; registrationId: string; revision: number;
  address: string; obsPort: number; statusPort: number;
  passphrase: string; token: string;
}
export function isTailnetAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127 && parts.every(n => n <= 255);
}
export function isOutdoorPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 65535;
}
export function isOutdoorRegistration(value: unknown): value is OutdoorRegistration {
  if (!value || typeof value !== 'object') return false;
  const r = value as OutdoorRegistration;
  return r.type === 'casmate.outdoor' && r.version === 3 &&
    typeof r.registrationId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(r.registrationId) &&
    Number.isSafeInteger(r.revision) && r.revision > 0 && isTailnetAddress(r.address) &&
    isOutdoorPort(r.obsPort) && isOutdoorPort(r.statusPort) &&
    typeof r.passphrase === 'string' && /^[a-zA-Z0-9]{32}$/.test(r.passphrase) &&
    typeof r.token === 'string' && /^[a-f0-9]{64}$/.test(r.token);
}

export type OutdoorReceiverState = 'stopped' | 'starting' | 'listening' | 'receiving' | 'reconnecting' | 'error';
export interface OutdoorReceiverSample {
  version: 1;
  state: 'listening' | 'receiving' | 'reconnecting';
  sessionId: string | null;
  generation: number;
  receivedBytes: number;
  videoFrames: number;
  audioFrames: number;
  videoPts: number;
  audioPts: number;
  lostPackets: number;
  droppedPackets: number;
  listeners?: { family: 'ipv4' | 'ipv6'; address: string; port: number }[];
  activeListener?: { family: 'ipv4' | 'ipv6'; address: string; port: number } | null;
  connectionRevision?: number;
}
export interface OutdoorReceiverView {
  state: OutdoorReceiverState;
  stopStatus?: 'stopping' | 'unknown';
  receivedBytes: number;
  listeners?: { family: 'ipv4' | 'ipv6'; address: string; port: number }[];
  activeListener?: { family: 'ipv4' | 'ipv6'; address: string; port: number } | null;
  connectionIdentity?: string | null;
}
