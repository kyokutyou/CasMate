import { isObsToken, isRegistrationId } from './obs-control';
import { compatibilityPolicy } from './compatibility-policy.generated';
import type { RegistrationUpdateFields } from './smartphone';

export type DirectFamily = 'ipv4' | 'ipv6';
export interface DirectAdapterOption {
  id: string; name: string; description: string;
  addresses: { family: DirectFamily; address: string }[];
  preferred: boolean;
}
export interface DirectPcKey { algorithm: 'sha256-spki'; fingerprint: string; }
export interface DirectTcpEndpoint { id: string; family: DirectFamily; address: string; tcpPort: number; }
export interface DirectSrtEndpoint { id: string; family: DirectFamily; address: string; outdoorPort: number; }
export interface DirectCredential { registrationId: string; revision: number; token: string; }
export interface DirectSettings {
  mode: 'auto' | 'manual';
  interfaceId: string | null;
  manualEndpoints: DirectTcpEndpoint[];
  manualSrtEndpoints: (DirectSrtEndpoint & { deviceId: string })[];
}
export interface DirectInvitation {
  type: 'casmate.outdoor'; version: typeof compatibilityPolicy.contracts.directInvitation.current; pcId: string; network: 'direct';
  pcKey: DirectPcKey; endpoints: DirectTcpEndpoint[]; token: string;
}
export interface DirectRegistration extends RegistrationUpdateFields {
  type: 'casmate.outdoor'; version: typeof compatibilityPolicy.contracts.directRegistration.current; pcId: string; deviceId: string; network: 'direct';
  pcKey: DirectPcKey; endpoints: DirectTcpEndpoint[];
  comments: DirectCredential & { protocolVersion: typeof compatibilityPolicy.contracts.mobileProtocol.current };
  control: { protocolVersion: typeof compatibilityPolicy.contracts.controlProtocol.current };
  outdoor?: DirectCredential & { passphrase: string; endpoints: DirectSrtEndpoint[] };
  obsControl?: DirectCredential;
}
export interface DirectEntryView {
  id: string; deviceId?: string; protocol: 'tcp' | 'udp'; family: DirectFamily;
  localAddress: string; localPort: number; address: string | null; publicPort: number | null;
  method: 'upnp' | 'pcp' | 'manual' | 'unnecessary';
  listener: boolean; firewall: boolean; prepared: boolean; expiresAt: number | null;
  reachability: 'unconfirmed' | 'connected' | 'disconnected';
  warning: string | null;
}
export interface DirectView {
  revision: number; interfaceId: string | null; entries: DirectEntryView[];
  pendingDeviceIds: string[]; residual: { id: string; kind: 'router' | 'firewall' | 'manual'; message: string }[];
  failure: 'automationUnsupported' | 'upstreamConstraint' | 'unknown' | null;
}
export function defaultDirectSettings(): DirectSettings {
  return { mode: 'auto', interfaceId: null, manualEndpoints: [], manualSrtEndpoints: [] };
}
export function directHost(address: string, port: number): string {
  return `${address.includes(':') ? `[${address}]` : address}:${port}`;
}
export function isPublicAddress(family: DirectFamily, value: unknown): value is string {
  if (!['ipv4', 'ipv6'].includes(family) || typeof value !== 'string' || value.length > 45) return false;
  if (family === 'ipv4') {
    if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/u.test(value)) return false;
    const [a, b, c, d] = value.split('.').map(Number);
    if ([a, b, c, d].some(n => n === undefined || n > 255)) return false;
    return a! > 0 && a! < 224 && a !== 10 && a !== 127 &&
      !(a === 100 && b! >= 64 && b! <= 127) && !(a === 169 && b === 254) &&
      !(a === 172 && b! >= 16 && b! <= 31) && !(a === 192 && b === 168) &&
      !(a === 192 && b === 0 && (c === 0 || c === 2)) && !(a === 192 && b === 88 && c === 99) &&
      !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
      !(a === 203 && b === 0 && c === 113);
  }
  if (!/^[23][0-9a-f]{3}:/u.test(value) || !/^[0-9a-f:]+$/u.test(value) ||
      /^(?:2001:(?:(?:db8|0):|:)|2002:)/u.test(value)) return false;
  try { return new URL(`https://[${value}]/`).hostname === `[${value}]`; } catch { return false; }
}
function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
export function validateDirectEndpoints(value: unknown, portKey: 'tcpPort', forbidden?: number[]): DirectTcpEndpoint[];
export function validateDirectEndpoints(value: unknown, portKey: 'outdoorPort', forbidden?: number[]): DirectSrtEndpoint[];
export function validateDirectEndpoints(value: unknown, portKey: 'tcpPort' | 'outdoorPort', forbidden: number[] = []): (DirectTcpEndpoint | DirectSrtEndpoint)[] {
  const fail = () => { throw new Error('公開接続先の形式が正しくありません。数値アドレス・ポート・重複を確認してください。'); };
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return fail();
  const ids = new Set<string>(); const targets = new Set<string>();
  for (const entry of value) {
    if (!exactKeys(entry, ['id', 'family', 'address', portKey]) || !isRegistrationId(entry.id) ||
      !['ipv4', 'ipv6'].includes(String(entry.family)) || !isPublicAddress(entry.family as DirectFamily, entry.address) ||
      !Number.isInteger(entry[portKey]) || Number(entry[portKey]) < 1024 || Number(entry[portKey]) > 65535 ||
      forbidden.includes(Number(entry[portKey])) || ids.has(entry.id)) return fail();
    const target = `${entry.address}:${entry[portKey]}`;
    if (targets.has(target)) return fail();
    ids.add(entry.id); targets.add(target);
  }
  return structuredClone(value);
}
export function validateDirectSettings(value: unknown): DirectSettings {
  if (!exactKeys(value, ['mode', 'interfaceId', 'manualEndpoints', 'manualSrtEndpoints']) ||
    !['auto', 'manual'].includes(String(value.mode)) ||
    !(value.interfaceId === null || (typeof value.interfaceId === 'string' && /^[a-zA-Z0-9{}-]{1,80}$/u.test(value.interfaceId))) ||
    !Array.isArray(value.manualEndpoints) || !Array.isArray(value.manualSrtEndpoints)) throw new Error('直接接続の設定形式が正しくありません。');
  if (value.manualEndpoints.length) validateDirectEndpoints(value.manualEndpoints, 'tcpPort', [4455]);
  const byDevice = new Map<string, unknown[]>();
  for (const raw of value.manualSrtEndpoints) {
    if (!exactKeys(raw, ['deviceId', 'id', 'family', 'address', 'outdoorPort']) || !isRegistrationId(raw.deviceId)) throw new Error('端末別UDP設定が正しくありません。');
    const { deviceId, ...endpoint } = raw;
    const entries = byDevice.get(deviceId) ?? []; entries.push(endpoint); byDevice.set(deviceId, entries);
  }
  const targets = new Set<string>();
  for (const entries of byDevice.values()) for (const e of validateDirectEndpoints(entries, 'outdoorPort', [4455])) {
    const target = `${e.address}:${e.outdoorPort}`;
    if (targets.has(target)) throw new Error('公開UDPポートが重複しています。');
    targets.add(target);
  }
  return structuredClone(value) as unknown as DirectSettings;
}
export function isDirectCredential(value: unknown): value is DirectCredential {
  if (!value || typeof value !== 'object') return false;
  const credential = value as DirectCredential;
  return isRegistrationId(credential.registrationId) && isObsToken(credential.token) &&
    Number.isSafeInteger(credential.revision) && credential.revision > 0;
}
