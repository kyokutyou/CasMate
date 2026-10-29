import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { WindowsDirectGateway, type DirectAdapter, type RouterMapping } from '../src/main/smartphone/direct-gateway';

interface Entry { description: string; client: string; port: number; enabled: string; }
const finishes: (() => Promise<void>)[] = [];
afterEach(async () => { for (const finish of finishes.splice(0)) await finish(); });
const value = (body: string, key: string) => body.match(new RegExp(`<${key}>([^<]*)</${key}>`))?.[1] ?? '';
const legacyName = (mapping: RouterMapping) => `CasMate:${mapping.pcId}:${mapping.id}:${mapping.nonce}`;
async function fixture() {
  let entry: Entry | null = null;
  const actions: string[] = [];
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      const action = String(request.headers.soapaction).split('#')[1]?.replace(/"/gu, '') ?? '';
      actions.push(action);
      const fault = (code: number) => { response.statusCode = 500; response.end(`<errorCode>${code}</errorCode>`); };
      if (action === 'GetSpecificPortMappingEntry') {
        if (!entry) { fault(714); return; }
        response.end(`<NewInternalClient>${entry.client}</NewInternalClient><NewInternalPort>${entry.port}</NewInternalPort><NewPortMappingDescription>${entry.description}</NewPortMappingDescription><NewEnabled>${entry.enabled}</NewEnabled><NewLeaseDuration>3600</NewLeaseDuration>`);
      } else if (action === 'AddPortMapping') {
        const description = value(body, 'NewPortMappingDescription');
        if (description.length > 30) { fault(402); return; }
        entry = { description, client: value(body, 'NewInternalClient'), port: Number(value(body, 'NewInternalPort')), enabled: value(body, 'NewEnabled') };
        response.end('<ok/>');
      } else if (action === 'DeletePortMapping') { entry = null; response.end('<ok/>'); }
      else if (action === 'GetExternalIPAddress') response.end('<NewExternalIPAddress>8.8.8.8</NewExternalIPAddress>');
      else fault(401);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  finishes.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server');
  const adapter: DirectAdapter = { id: 'test', name: 'test', profile: 'Private', index: 1,
    addresses: [{ family: 'ipv4', address: '127.0.0.1' }], gateway4: '127.0.0.1', gateway6: null };
  const mapping: RouterMapping = { id: '00000000-0000-4000-8000-000000000001', pcId: '00000000-0000-4000-8000-000000000002', nonce: 'a'.repeat(24),
    family: 'ipv4', protocol: 'tcp', localAddress: '127.0.0.1', localPort: 19301, publicPort: 19301, address: '8.8.8.8',
    gateway: '127.0.0.1', method: 'upnp', expiresAt: Date.now() + 3600000, renewedAt: Date.now(),
    controlUrl: `http://127.0.0.1:${address.port}/control`, service: 'urn:schemas-upnp-org:service:WANIPConnection:1' };
  return { adapter, mapping, gateway: new WindowsDirectGateway(), actions, entry: () => entry,
    setEntry: (next: Entry) => { entry = next; } };
}

it('30文字までのルーターで期限付き開放・再更新・所有削除に成功する', async () => {
  const f = await fixture();
  const prepared = await f.gateway.renew(f.adapter, f.mapping);
  const description = f.entry()!.description;
  expect(description).toMatch(/^CasMate:[A-Za-z0-9_-]{22}$/u);
  expect(Buffer.from(description.slice(8), 'base64url')).toHaveLength(16);
  expect(prepared.expiresAt! - prepared.renewedAt).toBe(3600000);
  await f.gateway.renew(f.adapter, prepared);
  expect(f.entry()!.description).toBe(description);
  await f.gateway.remove(f.adapter, prepared, 'test');
  expect(f.entry()).toBeNull();
});

it('新規準備は保存後の所有照合を一回にし、作成後の確認を維持する', async () => {
  const f = await fixture();
  Reflect.get(f.gateway, 'services').set(`${f.adapter.id}:${f.adapter.gateway4}`, Promise.resolve([{ url: f.mapping.controlUrl!, type: f.mapping.service! }]));
  let saved = false;
  const prepared = await f.gateway.prepare(f.adapter, f.mapping, 'test', async () => { expect(f.actions).toEqual([]); saved = true; });
  expect(saved).toBe(true); expect(prepared.expiresAt).toBeGreaterThan(Date.now());
  expect(f.actions).toEqual(['GetSpecificPortMappingEntry', 'AddPortMapping', 'GetSpecificPortMappingEntry', 'GetExternalIPAddress']);
});

it('同時の公開IP取得だけを共有し、次回の更新では新しく取得する', async () => {
  const f = await fixture();
  await Promise.all([f.gateway.renew(f.adapter, f.mapping), f.gateway.renew(f.adapter, f.mapping)]);
  expect(f.actions.filter(action => action === 'GetExternalIPAddress')).toHaveLength(1);
  await f.gateway.renew(f.adapter, f.mapping);
  expect(f.actions.filter(action => action === 'GetExternalIPAddress')).toHaveLength(2);
});

it.each(['renew', 'remove'] as const)('完全一致した旧所有説明文を%sでき、更新では短い説明へ移す', async operation => {
  const f = await fixture();
  f.setEntry({ description: legacyName(f.mapping), client: f.mapping.localAddress, port: f.mapping.localPort, enabled: '1' });
  if (operation === 'renew') {
    await f.gateway.renew(f.adapter, f.mapping);
    expect(f.entry()!.description).toMatch(/^CasMate:[A-Za-z0-9_-]{22}$/u);
  } else { await f.gateway.remove(f.adapter, f.mapping, 'test'); expect(f.entry()).toBeNull(); }
});

it.each(['pcId', 'id', 'nonce', 'client', 'port', 'enabled'] as const)('既存説明文の%sが違う割当を更新・削除しない', async field => {
  const f = await fixture();
  const other = { ...f.mapping, ...(field === 'pcId' || field === 'id' ? { [field]: '00000000-0000-4000-8000-000000000003' } : field === 'nonce' ? { nonce: 'b'.repeat(24) } : {}) };
  f.setEntry({ description: legacyName(other), client: field === 'client' ? '127.0.0.2' : f.mapping.localAddress,
    port: field === 'port' ? 19302 : f.mapping.localPort, enabled: field === 'enabled' ? '0' : '1' });
  await expect(f.gateway.renew(f.adapter, f.mapping)).rejects.toThrow();
  await expect(f.gateway.remove(f.adapter, f.mapping, 'test')).rejects.toThrow();
  expect(f.actions).not.toContain('AddPortMapping'); expect(f.actions).not.toContain('DeletePortMapping');
});

it.each(['pcId', 'id', 'nonce'] as const)('短い説明文でも%sが違う所有記録を拒否する', async field => {
  const f = await fixture();
  await f.gateway.renew(f.adapter, f.mapping);
  const other = { ...f.mapping, [field]: field === 'nonce' ? 'b'.repeat(24) : '00000000-0000-4000-8000-000000000003' };
  f.actions.length = 0;
  await expect(f.gateway.renew(f.adapter, other)).rejects.toThrow();
  await expect(f.gateway.remove(f.adapter, other, 'test')).rejects.toThrow();
  expect(f.actions).not.toContain('AddPortMapping'); expect(f.actions).not.toContain('DeletePortMapping');
});
