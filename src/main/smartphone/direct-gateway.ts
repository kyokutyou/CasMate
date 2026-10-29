import { createSocket } from 'node:dgram';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { isPublicAddress, type DirectFamily } from '../../shared/direct-connection';

export interface DirectAdapter {
  id: string; name: string; profile: 'Domain' | 'Private' | 'Public'; index: number;
  addresses: { family: DirectFamily; address: string }[];
  gateway4: string | null; gateway6: string | null;
}
export interface MappingRequest {
  id: string; pcId: string; family: DirectFamily; protocol: 'tcp' | 'udp';
  localAddress: string; localPort: number; nonce: string;
}
export interface RouterMapping extends MappingRequest {
  method: 'upnp' | 'pcp' | 'unnecessary'; gateway: string; address: string; publicPort: number;
  expiresAt: number | null; renewedAt: number; epoch?: number; controlUrl?: string; service?: string; pinholeId?: number;
  processId?: string;
}
export class MappingFailure extends Error {
  constructor(readonly kind: 'unsupported' | 'upstream' | 'unknown', readonly uncertain = false) { super('直接接続の開放を確認できません。'); }
}
export interface DirectGateway {
  prepare(adapter: DirectAdapter, request: MappingRequest, processId: string, beforeCreate: (intent: RouterMapping) => Promise<void>, signal?: AbortSignal): Promise<RouterMapping>;
  renew(adapter: DirectAdapter, mapping: RouterMapping, signal?: AbortSignal): Promise<RouterMapping>;
  remove(adapter: DirectAdapter, mapping: RouterMapping, processId: string, signal?: AbortSignal): Promise<void>;
}
export function pcpRequest(request: MappingRequest, lifetime: number, previous?: RouterMapping): Buffer {
  if (!/^[a-f0-9]{24}$/u.test(request.nonce) || !Number.isInteger(lifetime) || lifetime < 0 || lifetime > 3600) throw new MappingFailure('unknown');
  const data = Buffer.alloc(60); data[0] = 2; data[1] = 1; data.writeUInt32BE(lifetime, 4);
  ipBytes(request.localAddress).copy(data, 8); Buffer.from(request.nonce, 'hex').copy(data, 24);
  data[36] = request.protocol === 'tcp' ? 6 : 17; data.writeUInt16BE(request.localPort, 40);
  const previousPort = previous?.publicPort;
  const suggestedPort = previousPort !== undefined && Number.isInteger(previousPort) && previousPort >= 1024 && previousPort <= 65535 &&
    (request.protocol !== 'tcp' || previousPort !== 4455) ? previousPort : request.localPort;
  data.writeUInt16BE(lifetime === 0 ? 0 : suggestedPort, 42);
  ipBytes(lifetime === 0 ? (request.family === 'ipv4' ? '0.0.0.0' : '::') : previous?.address ?? (request.family === 'ipv4' ? '0.0.0.0' : request.localAddress)).copy(data, 44);
  // External address/port are hints; ownership is the nonce, not PREFER_FAILURE.
  return data;
}
function ipBytes(address: string): Buffer {
  const value = Buffer.alloc(16);
  if (isIP(address) === 4) { value[10] = value[11] = 255; Buffer.from(address.split('.').map(Number)).copy(value, 12); return value; }
  if (isIP(address) !== 6) throw new MappingFailure('unknown');
  const halves = address.split('::');
  const left = halves[0] ? halves[0].split(':') : []; const right = halves[1] ? halves[1].split(':') : [];
  const words = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  words.forEach((word, i) => value.writeUInt16BE(parseInt(word, 16), i * 2)); return value;
}
function bytesIp(data: Buffer, family: DirectFamily): string {
  if (family === 'ipv4') {
    if (!data.subarray(0, 12).equals(Buffer.from('00000000000000000000ffff', 'hex'))) throw new MappingFailure('upstream');
    return [...data.subarray(12)].join('.');
  }
  const expanded = Array.from({ length: 8 }, (_, i) => data.readUInt16BE(i * 2).toString(16)).join(':');
  return new URL(`https://[${expanded}]/`).hostname.slice(1, -1);
}
export function parsePcpResponse(data: Buffer, request: MappingRequest, now: number, deletion = false): RouterMapping {
  if (data.length < 24 || data.length > 1100 || data[0] !== 2 || data[1] !== 0x81) throw new MappingFailure('unknown');
  if (data[3] !== 0) throw new MappingFailure('unsupported');
  if (data.length < 60 ||
    !data.subarray(24, 36).equals(Buffer.from(request.nonce, 'hex')) || data[36] !== (request.protocol === 'tcp' ? 6 : 17) ||
    data.readUInt16BE(40) !== request.localPort) throw new MappingFailure('unknown');
  const lifetime = data.readUInt32BE(4);
  if ((!deletion && (lifetime < 1 || lifetime > 86400)) || (deletion && lifetime !== 0)) throw new MappingFailure('unknown', true);
  const address = bytesIp(data.subarray(44, 60), request.family); const publicPort = data.readUInt16BE(42);
  if (deletion) {
    if (publicPort !== 0 || address !== (request.family === 'ipv4' ? '0.0.0.0' : '::')) throw new MappingFailure('unknown', true);
    return { ...request, method: 'pcp', gateway: '', address, publicPort, expiresAt: now, renewedAt: now, epoch: data.readUInt32BE(8) };
  }
  if (!isPublicAddress(request.family, address) || publicPort < 1 || publicPort > 65535 ||
    (request.family === 'ipv6' && address !== request.localAddress)) throw new MappingFailure('upstream', true);
  return { ...request, method: 'pcp', gateway: '', address, publicPort, expiresAt: deletion ? now : now + lifetime * 1000,
    renewedAt: now, epoch: data.readUInt32BE(8) };
}
function closeSocket(socket: ReturnType<typeof createSocket>): void {
  try { socket.close(); } catch { /* A failed bind or an earlier socket failure can leave no open handle. */ }
}
async function exchange(adapter: DirectAdapter, request: MappingRequest, lifetime: number, previous?: RouterMapping, signal?: AbortSignal): Promise<RouterMapping> {
  checkCancellation(signal);
  const gateway = previous?.gateway || (request.family === 'ipv6' ? adapter.gateway6 : adapter.gateway4);
  if (!gateway) throw new MappingFailure('unsupported');
  const packet = pcpRequest(request, lifetime, previous);
  const socket = createSocket({ type: request.family === 'ipv6' ? 'udp6' : 'udp4', ipv6Only: request.family === 'ipv6' });
  return new Promise<RouterMapping>((resolve, reject) => {
    let sent = false; let settled = false; const done = (error?: Error, mapping?: RouterMapping) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); closeSocket(socket); if (error) reject(error); else resolve(mapping!); };
    const cancel = () => done(new MappingFailure('unknown', sent));
    const timer = setTimeout(() => done(new MappingFailure('unknown', sent)), 5000);
    signal?.addEventListener('abort', cancel, { once: true });
    socket.on('error', () => done(new MappingFailure('unknown', sent)));
    socket.on('message', (data, remote) => {
      if (remote.address.split('%')[0] !== gateway.split('%')[0] || remote.port !== 5351) return;
      try { done(undefined, { ...parsePcpResponse(data, request, Date.now(), lifetime === 0), gateway }); }
      catch (error) { if (error instanceof MappingFailure && !error.uncertain && error.kind === 'unknown') return; done(error as Error); }
    });
    try {
      socket.bind(0, request.localAddress, () => {
        if (settled) return;
        try { sent = true; socket.send(packet, 5351, gateway); }
        catch { done(new MappingFailure('unknown', sent)); }
      });
    } catch { done(new MappingFailure('unknown', sent)); }
  });
}
interface Service { url: string; type: string; }
function gatewayUrl(value: string, gateway: string, base?: string): string {
  const url = new URL(value, base);
  if (url.protocol !== 'http:' || url.hostname.replace(/^\[|\]$/gu, '') !== gateway || url.username || url.password || url.hash || isIP(gateway) === 0) throw new MappingFailure('unsupported');
  return url.href;
}
function xmlValue(xml: string, name: string): string | null {
  if (xml.length > 65536 || /<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new MappingFailure('unsupported');
  const match = xml.match(new RegExp(`<(?:(?:[a-zA-Z0-9_-]+):)?${name}(?:\\s[^>]*)?>([^<]{0,4096})<\\/`));
  return match ? match[1]!.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/giu, entity => {
    const basic: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (basic[entity]) return basic[entity];
    const code = entity.startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new MappingFailure('unsupported');
    return String.fromCodePoint(code);
  }).trim() : null;
}
function checkCancellation(signal?: AbortSignal): void { if (signal?.aborted) throw new MappingFailure('unknown'); }
function cancellable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new MappingFailure('unknown'));
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(new MappingFailure('unknown')); };
    signal.addEventListener('abort', cancel, { once: true });
    work.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}
async function http(url: string, adapter: DirectAdapter, body?: string, action?: string, signal?: AbortSignal, budget = 5000): Promise<string> {
  checkCancellation(signal);
  if (budget <= 0) throw new MappingFailure('unknown');
  const mutation = Boolean(action && /#(?:Add|Update|Delete)/u.test(action));
  return new Promise((resolve, reject) => {
    const controller = new AbortController(); const cancel = () => controller.abort();
    const timer = setTimeout(cancel, Math.min(5000, budget));
    signal?.addEventListener('abort', cancel, { once: true });
    const done = (error?: Error, value?: string) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); if (error) reject(error); else resolve(value!); };
    let length = 0; const chunks: Buffer[] = [];
    let sent = false;
    try {
      const request = httpRequest(url, { method: body ? 'POST' : 'GET', localAddress: adapter.addresses.find(a => a.family === 'ipv4')?.address,
        signal: controller.signal, headers: body ? { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${action}"`, 'Content-Length': Buffer.byteLength(body) } : {} }, response => {
        if (response.statusCode !== 200 && response.statusCode !== 500) { response.resume(); done(new MappingFailure('unsupported', mutation && sent)); return; }
        response.on('data', (data: Buffer) => { length += data.length; if (length > 65536) request.destroy(new Error('LIMIT')); else chunks.push(data); });
        response.once('error', () => done(new MappingFailure('unknown', mutation && sent)));
        response.once('end', () => done(undefined, Buffer.concat(chunks).toString('utf8')));
      });
      request.once('error', () => done(new MappingFailure('unknown', mutation && sent)));
      sent = true; request.end(body);
    } catch { done(new MappingFailure('unknown', mutation && sent)); }
  });
}
async function discover(adapter: DirectAdapter): Promise<Service[]> {
  const deadline = Date.now() + 5000;
  const gateway = adapter.gateway4; const local = adapter.addresses.find(a => a.family === 'ipv4')?.address;
  if (!gateway || !local) throw new MappingFailure('unsupported');
  const socket = createSocket('udp4');
  const location = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const done = (url?: string) => { if (settled) return; settled = true; clearTimeout(timer); closeSocket(socket); if (url) resolve(url); else reject(new MappingFailure('unsupported')); };
    const timer = setTimeout(() => done(), 5000); socket.on('error', () => done());
    socket.on('message', (data, remote) => {
      if (remote.address !== gateway || data.length > 4096) return;
      const location = /^location:\s*([^\r\n]+)$/imu.exec(data.toString('utf8'))?.[1];
      if (location) try { done(gatewayUrl(location.trim(), gateway)); } catch { /* Untrusted discovery response. */ }
    });
    try {
      socket.bind(0, local, () => {
        if (settled) return;
        try {
          socket.setMulticastInterface(local);
          socket.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n'), 1900, '239.255.255.250');
        } catch { done(); }
      });
    } catch { done(); }
  });
  const description = await http(location, adapter, undefined, undefined, undefined, deadline - Date.now()); if (/<!DOCTYPE|<!ENTITY/iu.test(description)) throw new MappingFailure('unsupported');
  const services: Service[] = [];
  for (const match of description.matchAll(/<service(?:\s[^>]*)?>([\s\S]*?)<\/service>/gu)) {
    const type = xmlValue(match[1]!, 'serviceType'); const control = xmlValue(match[1]!, 'controlURL');
    if (type && control && /^urn:schemas-upnp-org:service:(?:WANIPConnection:[12]|WANPPPConnection:1|WANIPv6FirewallControl:1)$/u.test(type))
      services.push({ url: gatewayUrl(control, gateway, location), type });
  }
  return services.sort((a, b) => Number(b.type.endsWith(':2')) - Number(a.type.endsWith(':2')));
}
function escapeXml(value: string | number): string { return String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!); }
async function soap(adapter: DirectAdapter, service: Service, action: string, args: Record<string, string | number>, signal?: AbortSignal): Promise<string> {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service.type}">${Object.entries(args).map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  const result = await http(service.url, adapter, body, `${service.type}#${action}`, signal);
  const code = xmlValue(result, 'errorCode'); if (code) throw Object.assign(new MappingFailure('unsupported'), { soapCode: Number(code) }); return result;
}
const mappingName = (r: MappingRequest) => `CasMate:${createHash('sha256').update(JSON.stringify([r.pcId, r.id, r.nonce])).digest().subarray(0, 16).toString('base64url')}`;
const legacyMappingName = (r: MappingRequest) => `CasMate:${r.pcId}:${r.id}:${r.nonce}`;
function owned(xml: string, request: MappingRequest): boolean {
  const description = xmlValue(xml, 'NewPortMappingDescription');
  return xmlValue(xml, 'NewInternalClient') === request.localAddress && Number(xmlValue(xml, 'NewInternalPort')) === request.localPort &&
    (description === mappingName(request) || description === legacyMappingName(request)) && xmlValue(xml, 'NewEnabled') === '1';
}
export class WindowsDirectGateway implements DirectGateway {
  private readonly services = new Map<string, Promise<Service[]>>();
  private readonly external = new Map<string, Promise<string>>();
  private externalFor(adapter: DirectAdapter, service: Service, signal?: AbortSignal): Promise<string> {
    const key = `${adapter.id}:${service.url}:${service.type}`;
    let pending = this.external.get(key);
    if (!pending) {
      pending = soap(adapter, service, 'GetExternalIPAddress', {}).then(xml => {
        const address = xmlValue(xml, 'NewExternalIPAddress'); if (!isPublicAddress('ipv4', address)) throw new MappingFailure('upstream', true); return address!;
      }).finally(() => this.external.delete(key));
      this.external.set(key, pending);
    }
    return cancellable(pending, signal);
  }
  private servicesFor(adapter: DirectAdapter) {
    const key = `${adapter.id}:${adapter.gateway4}`;
    let found = this.services.get(key); if (!found) { found = discover(adapter); this.services.set(key, found); found.catch(() => this.services.delete(key)); } return found;
  }
  async prepare(adapter: DirectAdapter, request: MappingRequest, processId: string, beforeCreate: (intent: RouterMapping) => Promise<void>, signal?: AbortSignal): Promise<RouterMapping> {
    checkCancellation(signal);
    try {
      // IGD IPv6 exposes only a router-wide UniqueID, with no application ownership query.
      // Creating/extending that tuple could take over another application's pinhole.
      if (request.family === 'ipv6') throw new MappingFailure('unsupported');
      const services = await cancellable(this.servicesFor(adapter), signal);
      const service = services.find(s => request.family === 'ipv6' ? s.type.includes('WANIPv6FirewallControl') : !s.type.includes('WANIPv6FirewallControl'));
      if (!service) throw new MappingFailure('unsupported');
      const started = Date.now();
      const candidate: RouterMapping = { ...request, method: 'upnp', gateway: adapter.gateway4!, address: '', publicPort: request.localPort, expiresAt: null, renewedAt: started, controlUrl: service.url, service: service.type };
      await beforeCreate({ ...candidate, expiresAt: started + 3600_000 });
      checkCancellation(signal);
      return await this.renew(adapter, candidate, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof MappingFailure && error.uncertain) throw error;
      // A router can reboot or enable UPnP without changing its gateway address.
      this.services.delete(`${adapter.id}:${adapter.gateway4}`);
      const gateway = request.family === 'ipv6' ? adapter.gateway6 : adapter.gateway4;
      if (!gateway) throw new MappingFailure('unsupported');
      await beforeCreate({ ...request, method: 'pcp', gateway, address: request.family === 'ipv6' ? request.localAddress : '0.0.0.0',
        publicPort: request.localPort, expiresAt: Date.now() + 3600_000, renewedAt: Date.now() });
      checkCancellation(signal);
      return exchange(adapter, request, 3600, undefined, signal);
    }
  }
  async renew(adapter: DirectAdapter, mapping: RouterMapping, signal?: AbortSignal): Promise<RouterMapping> {
    checkCancellation(signal);
    if (mapping.method === 'pcp') return exchange(adapter, mapping, 3600, mapping, signal);
    if (mapping.method === 'unnecessary') return mapping;
    const service = { url: gatewayUrl(mapping.controlUrl!, mapping.gateway), type: mapping.service! };
    const started = Date.now();
    if (mapping.family === 'ipv6') {
      throw new MappingFailure('unknown', true);
    }
    let existing: string | null = null;
    try { existing = await soap(adapter, service, 'GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: mapping.publicPort, NewProtocol: mapping.protocol.toUpperCase() }, signal); }
    catch (error) { if ((error as { soapCode?: number }).soapCode !== 714) throw error; }
    if (existing && !owned(existing, mapping)) throw new MappingFailure('unknown');
    await soap(adapter, service, 'AddPortMapping', { NewRemoteHost: '', NewExternalPort: mapping.publicPort, NewProtocol: mapping.protocol.toUpperCase(),
      NewInternalPort: mapping.localPort, NewInternalClient: mapping.localAddress, NewEnabled: 1, NewPortMappingDescription: mappingName(mapping), NewLeaseDuration: 3600 }, signal);
    try {
      const result = await soap(adapter, service, 'GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: mapping.publicPort, NewProtocol: mapping.protocol.toUpperCase() }, signal);
      const lifetime = Number(xmlValue(result, 'NewLeaseDuration'));
      if (!owned(result, mapping) || !Number.isInteger(lifetime) || lifetime < 1 || lifetime > 86400) throw new MappingFailure('unknown', true);
      const address = await this.externalFor(adapter, service, signal);
      return { ...mapping, address, expiresAt: started + lifetime * 1000, renewedAt: started };
    } catch (error) { throw error instanceof MappingFailure ? new MappingFailure(error.kind, true) : new MappingFailure('unknown', true); }
  }
  async remove(adapter: DirectAdapter, mapping: RouterMapping, _processId: string, signal?: AbortSignal): Promise<void> {
    checkCancellation(signal);
    if (mapping.method === 'unnecessary') return;
    if (mapping.method === 'pcp') { await exchange(adapter, mapping, 0, mapping, signal); return; }
    const service = { url: gatewayUrl(mapping.controlUrl!, mapping.gateway), type: mapping.service! };
    if (mapping.family === 'ipv6') {
      throw new MappingFailure('unknown', true);
    }
    let existing: string;
    try { existing = await soap(adapter, service, 'GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: mapping.publicPort, NewProtocol: mapping.protocol.toUpperCase() }, signal); }
    catch (error) { if ((error as { soapCode?: number }).soapCode === 714) return; throw error; }
    if (!owned(existing, mapping)) throw new MappingFailure('unknown', true);
    await soap(adapter, service, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: mapping.publicPort, NewProtocol: mapping.protocol.toUpperCase() }, signal);
  }
}
