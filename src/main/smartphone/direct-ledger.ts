import { randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { win32 } from 'node:path';
import { isAllowedObsEndpointAddress, isRegistrationId } from '../../shared/obs-control';
import { isDirectCredential, isPublicAddress, type DirectCredential } from '../../shared/direct-connection';
import { validateDirectIdentity, type DirectIdentity } from './direct-identity';
import type { DirectAdapter, MappingRequest, RouterMapping } from './direct-gateway';
import type { FirewallGrant } from './direct-windows';

export interface DirectDeviceAllocation {
  comments: DirectCredential; obs: DirectCredential;
  outdoor?: DirectCredential & { passphrase: string; internalPort: number; localPort?: number };
  registered: boolean; pending: boolean;
}
export interface DirectOwnedEntry {
  request: MappingRequest; deviceId?: string; key: string; adapter: DirectAdapter; firewall: FirewallGrant;
  router: RouterMapping | null; intent: RouterMapping | null;
  manual: { address: string; publicPort: number } | null;
  status: 'pending' | 'ready' | 'closing' | 'residual';
  firewallRemoved: boolean; routerRemoved: boolean;
  candidateId?: string;
}
export interface DirectLedger {
  identity: DirectIdentity | null;
  invitation: { token: string; revision: number };
  revision: number; tcpSignature: string;
  confirmed: { tcp: number | null; devices: Record<string, number>; signatures?: Record<string, string> };
  devices: Record<string, DirectDeviceAllocation>;
  entries: DirectOwnedEntry[];
}
export function newDirectLedger(): DirectLedger {
  return { identity: null, invitation: { token: randomBytes(32).toString('hex'), revision: 1 }, revision: 1, tcpSignature: '',
    confirmed: { tcp: null, devices: {} }, devices: {}, entries: [] };
}
export function rotateDirectInvitation(ledger: DirectLedger) {
  ledger.invitation = { token: randomBytes(32).toString('hex'), revision: ledger.invitation.revision + 1 };
}
export function newDirectCredential(): DirectCredential {
  return { registrationId: randomUUID(), revision: 1, token: randomBytes(32).toString('hex') };
}
export function validateDirectLedger(value: DirectLedger, pcId: string, reservedPorts: number[], deviceIds: string[], legacyObsPorts = true): DirectLedger {
  const fail = () => { throw new Error('直接接続の保護保存を復元できません。元の登録を保持しています。'); };
  if (!value || !/^[a-f0-9]{64}$/u.test(value.invitation?.token ?? '') || !Number.isSafeInteger(value.invitation.revision) || value.invitation.revision < 1 ||
    !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.tcpSignature !== 'string' || !value.confirmed ||
    !value.devices || Array.isArray(value.devices) || !Array.isArray(value.entries) || value.entries.length > 2048 ||
    !value.confirmed.devices || Array.isArray(value.confirmed.devices) ||
    value.confirmed.tcp !== null && (!Number.isSafeInteger(value.confirmed.tcp) || value.confirmed.tcp < 1 || value.confirmed.tcp > value.revision)) return fail();
  for (const [id, revision] of Object.entries(value.confirmed.devices)) if (!isRegistrationId(id) || !Number.isSafeInteger(revision) || revision < 1 || revision > value.revision) return fail();
  if (value.confirmed.signatures) for (const [id, signature] of Object.entries(value.confirmed.signatures)) if ((id !== 'tcp' && !isRegistrationId(id)) || !/^[a-f0-9]{64}$/u.test(signature)) return fail();
  if (value.identity) validateDirectIdentity(value.identity, pcId);
  const ports = new Set<number>();
  for (const [id, device] of Object.entries(value.devices)) {
    if (!isRegistrationId(id) || !deviceIds.includes(id) || !device || !isDirectCredential(device.comments) || !isDirectCredential(device.obs) ||
      typeof device.registered !== 'boolean' || typeof device.pending !== 'boolean') return fail();
    if (device.outdoor) {
      const video = device.outdoor;
      if (!isDirectCredential(video) || !/^[a-zA-Z0-9]{32}$/u.test(video.passphrase) || video.internalPort === video.localPort ||
          !legacyObsPorts && Object.hasOwn(video, 'localPort')) return fail();
      for (const port of legacyObsPorts ? [video.internalPort, video.localPort!] : [video.internalPort]) {
        if (!Number.isInteger(port) || port < 1024 || port > 65535 || !reservedPorts.includes(port) || ports.has(port)) return fail(); ports.add(port);
      }
    }
  }
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (!entry || !entry.request || !isRegistrationId(entry.request.id) || ids.has(entry.request.id) || entry.request.pcId !== pcId ||
      !/^[a-f0-9]{24}$/u.test(entry.request.nonce) || typeof entry.key !== 'string' || entry.key.length > 1024 ||
      !['ipv4', 'ipv6'].includes(entry.request.family) || !['tcp', 'udp'].includes(entry.request.protocol) ||
      !localAddress(entry.request.family, entry.request.localAddress) ||
      !Number.isInteger(entry.request.localPort) || entry.request.localPort < 1024 || entry.request.localPort > 65535 ||
      !validAdapter(entry.adapter) || !entry.adapter.addresses.some(a => a.family === entry.request.family && a.address === entry.request.localAddress) ||
      (entry.request.protocol === 'udp' ? !isRegistrationId(entry.deviceId) || !reservedPorts.includes(entry.request.localPort) : entry.deviceId !== undefined) ||
      !entry.firewall || entry.firewall.id !== entry.request.id || entry.firewall.pcId !== pcId || entry.firewall.nonce !== entry.request.nonce ||
      entry.firewall.address !== entry.request.localAddress || entry.firewall.port !== entry.request.localPort || entry.firewall.protocol !== entry.request.protocol ||
      typeof entry.firewall.program !== 'string' || !win32.isAbsolute(entry.firewall.program) || entry.firewall.program.length > 32768 ||
      entry.firewall.interfaceId !== entry.adapter.id || entry.firewall.interfaceName !== entry.adapter.name || entry.firewall.profile !== entry.adapter.profile ||
      entry.manual && (!isPublicAddress(entry.request.family, entry.manual.address) || !publicPort(entry.manual.publicPort)) ||
      !['pending', 'ready', 'closing', 'residual'].includes(entry.status) ||
      typeof entry.firewallRemoved !== 'boolean' || typeof entry.routerRemoved !== 'boolean' || entry.candidateId !== undefined && !isRegistrationId(entry.candidateId)) return fail();
    ids.add(entry.request.id);
    for (const mapping of [entry.router, entry.intent]) if (mapping &&
      (mapping.id !== entry.request.id || mapping.pcId !== pcId || mapping.nonce !== entry.request.nonce || mapping.localAddress !== entry.request.localAddress ||
       mapping.localPort !== entry.request.localPort || mapping.family !== entry.request.family || mapping.protocol !== entry.request.protocol ||
       !validMapping(mapping, entry.adapter, mapping === entry.intent))) return fail();
  }
  return structuredClone(value);
}
function publicPort(port: number) { return Number.isInteger(port) && port > 0 && port <= 65535; }
function localAddress(family: string, address: string) { return (family === 'ipv4' || family === 'ipv6') && (isPublicAddress(family, address) || family === 'ipv4' && isAllowedObsEndpointAddress('lan', address)); }
function validAdapter(adapter: DirectAdapter): boolean {
  if (!adapter || !/^[a-zA-Z0-9{}-]{1,80}$/u.test(adapter.id) || typeof adapter.name !== 'string' || !adapter.name || adapter.name.length > 256 ||
    !['Domain', 'Private', 'Public'].includes(adapter.profile) || !Number.isInteger(adapter.index) || adapter.index < 1 || !Array.isArray(adapter.addresses) ||
    !adapter.addresses.length || adapter.addresses.length > 128 || adapter.addresses.some(a => !a || !localAddress(a.family, a.address))) return false;
  if (adapter.gateway4 !== null && (isIP(adapter.gateway4) !== 4 || !localAddress('ipv4', adapter.gateway4))) return false;
  if (adapter.gateway6 !== null) {
    const [address, zone, extra] = adapter.gateway6.split('%');
    if (extra !== undefined || isIP(address!) !== 6 || zone !== undefined && zone !== String(adapter.index) ||
      !isPublicAddress('ipv6', address) && !/^fe80:/u.test(address!)) return false;
  }
  return true;
}
function validMapping(mapping: RouterMapping, adapter: DirectAdapter, intent: boolean): boolean {
  if (!['upnp', 'pcp', 'unnecessary'].includes(mapping.method) || !publicPort(mapping.publicPort) || !Number.isSafeInteger(mapping.renewedAt) || mapping.renewedAt < 0 ||
    mapping.expiresAt !== null && (!Number.isSafeInteger(mapping.expiresAt) || mapping.expiresAt < mapping.renewedAt) ||
    !isPublicAddress(mapping.family, mapping.address) && !(intent && (mapping.address === '' || mapping.family === 'ipv4' && mapping.address === '0.0.0.0'))) return false;
  if (mapping.method === 'unnecessary') return mapping.address === mapping.localAddress && mapping.publicPort === mapping.localPort;
  if (mapping.gateway !== (mapping.family === 'ipv6' ? adapter.gateway6 : adapter.gateway4) || !mapping.gateway) return false;
  if (mapping.method === 'pcp') return mapping.expiresAt !== null && (mapping.epoch === undefined || Number.isInteger(mapping.epoch) && mapping.epoch >= 0 && mapping.epoch <= 0xffffffff);
  if (!/^urn:schemas-upnp-org:service:(?:WANIPConnection:[12]|WANPPPConnection:1|WANIPv6FirewallControl:1)$/u.test(mapping.service ?? '')) return false;
  try { const url = new URL(mapping.controlUrl!); return url.protocol === 'http:' && !url.username && !url.password && !url.hash && url.hostname.replace(/^\[|\]$/gu, '') === mapping.gateway; }
  catch { return false; }
}
