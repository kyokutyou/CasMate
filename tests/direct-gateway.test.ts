import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { MappingFailure, parsePcpResponse, pcpRequest, WindowsDirectGateway, type DirectAdapter, type MappingRequest } from '../src/main/smartphone/direct-gateway';

const udp = vi.hoisted(() => ({ createSocket: vi.fn() }));
const http = vi.hoisted(() => ({ request: vi.fn<(url: string, options: { signal: AbortSignal; headers: Record<string, string> },
  callback: (response: EventEmitter & { statusCode: number; resume: () => void }) => void) => EventEmitter & { end: () => void }>() }));
vi.mock('node:dgram', () => ({ createSocket: udp.createSocket }));
vi.mock('node:http', () => ({ request: http.request }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); udp.createSocket.mockReset(); http.request.mockReset(); });

class UdpSocket extends EventEmitter {
  bound?: () => void;
  bind = vi.fn((_port: number, _address: string, callback: () => void) => { this.bound = callback; });
  setMulticastInterface = vi.fn((_address: string) => undefined);
  send = vi.fn((_data: Buffer, _port: number, _address: string) => undefined);
  close = vi.fn(() => undefined);
}
const adapter: DirectAdapter = { id: 'adapter', name: 'Ethernet', profile: 'Private', index: 1,
  addresses: [{ family: 'ipv4', address: '192.168.1.2' }], gateway4: '192.168.1.1', gateway6: null };
const mappingRequest: MappingRequest = { id: 'id', pcId: 'pc', family: 'ipv4', protocol: 'udp',
  localAddress: '192.168.1.2', localPort: 10000, nonce: 'a'.repeat(24) };

it('SSDPと説明取得の合計5秒で探索を終え、PCPへ進む', async () => {
  vi.useFakeTimers();
  const discovery = new UdpSocket(); const pcp = new UdpSocket();
  udp.createSocket.mockReturnValueOnce(discovery).mockReturnValueOnce(pcp);
  http.request.mockImplementation((_url, options) => {
    const request = Object.assign(new EventEmitter(), { end: vi.fn() });
    options.signal.addEventListener('abort', () => request.emit('error', new Error('ABORT')), { once: true }); return request;
  });
  const result = new WindowsDirectGateway().prepare(adapter, mappingRequest, 'test', async () => undefined).catch(error => error);
  discovery.bound!(); await vi.advanceTimersByTimeAsync(4000);
  discovery.emit('message', Buffer.from('LOCATION: http://192.168.1.1/description\r\n'), { address: adapter.gateway4 });
  await vi.advanceTimersByTimeAsync(999); expect(pcp.bind).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(pcp.bind).toHaveBeenCalledOnce();
  pcp.emit('error', new Error('unsupported')); expect(await result).toBeInstanceOf(MappingFailure);
  expect(discovery.close).toHaveBeenCalledOnce();
});

it('送信済みUPnP作成の取消は結果不明として保持し、PCPへ重ねて開放しない', async () => {
  const cancellation = new AbortController();
  http.request.mockImplementation((_url, options, callback) => {
    const request = Object.assign(new EventEmitter(), { end: vi.fn(() => {
      if (!options.headers.SOAPAction.includes('#GetSpecificPortMappingEntry')) return;
      const response = Object.assign(new EventEmitter(), { statusCode: 500, resume: vi.fn() }); callback(response);
      queueMicrotask(() => { response.emit('data', Buffer.from('<errorCode>714</errorCode>')); response.emit('end'); });
    }) });
    options.signal.addEventListener('abort', () => request.emit('error', new Error('ABORT')), { once: true }); return request;
  });
  const gateway = new WindowsDirectGateway();
  Reflect.get(gateway, 'services').set(`${adapter.id}:${adapter.gateway4}`, Promise.resolve([{ url: 'http://192.168.1.1/control', type: 'urn:schemas-upnp-org:service:WANIPConnection:1' }]));
  const before = vi.fn(async () => undefined);
  const result = gateway.prepare(adapter, mappingRequest, 'test', before, cancellation.signal).catch(error => error);
  await vi.waitFor(() => expect(http.request).toHaveBeenCalledTimes(2));
  cancellation.abort();
  expect(await result).toMatchObject({ kind: 'unknown', uncertain: true });
  expect(before).toHaveBeenCalledOnce(); expect(udp.createSocket).not.toHaveBeenCalled();
});

it.each([80, 4455])('PCP更新では禁止された公開TCPポート%sを希望値として再送しない', publicPort => {
  const request = { ...mappingRequest, protocol: 'tcp' as const };
  const mapping = { ...request, method: 'pcp' as const, gateway: adapter.gateway4!, address: '8.8.8.8', publicPort,
    renewedAt: 0, expiresAt: 3600000 };
  expect(pcpRequest(request, 3600, mapping).readUInt16BE(42)).toBe(request.localPort);
});

it('NIC消失によるマルチキャスト設定の同期例外を候補の失敗として扱い、PCPへ代替する', async () => {
  vi.useFakeTimers();
  const discovery = new UdpSocket(); const pcp = new UdpSocket();
  udp.createSocket.mockReturnValueOnce(discovery).mockReturnValueOnce(pcp);
  discovery.setMulticastInterface.mockImplementationOnce(() => { throw new Error('EADDRNOTAVAIL'); });
  const before = vi.fn(async () => undefined);
  const result = new WindowsDirectGateway().prepare(adapter, mappingRequest, 'process', before).catch(error => error);
  expect(discovery.bound).toBeTypeOf('function');
  expect(() => discovery.bound!()).not.toThrow();
  await vi.waitFor(() => expect(pcp.bound).toBeTypeOf('function'));
  pcp.emit('error', new Error('EADDRNOTAVAIL'));
  expect(await result).toBeInstanceOf(MappingFailure);
  expect(before).toHaveBeenCalledOnce();
  expect(discovery.close).toHaveBeenCalledOnce(); expect(pcp.close).toHaveBeenCalledOnce();
});

it.each(['bind', 'send', 'close'] as const)('SSDPの%s同期例外を候補内で処理してソケットを一度だけ閉じる', async fault => {
  vi.useFakeTimers();
  const discovery = new UdpSocket(); const pcp = new UdpSocket();
  udp.createSocket.mockReturnValueOnce(discovery).mockReturnValueOnce(pcp);
  discovery[fault].mockImplementationOnce(() => { throw new Error('EADDRNOTAVAIL'); });
  const result = new WindowsDirectGateway().prepare(adapter, mappingRequest, 'process', async () => undefined).catch(error => error);
  if (fault === 'close') expect(() => discovery.emit('error', new Error('EADDRNOTAVAIL'))).not.toThrow();
  else if (fault === 'send') expect(() => discovery.bound!()).not.toThrow();
  await vi.waitFor(() => expect(pcp.bound).toBeTypeOf('function'));
  pcp.emit('error', new Error('EADDRNOTAVAIL'));
  expect(await result).toBeInstanceOf(MappingFailure);
  expect(discovery.close).toHaveBeenCalledOnce(); expect(pcp.close).toHaveBeenCalledOnce();
  discovery.emit('error', new Error('late error'));
  if (discovery.bound) expect(() => discovery.bound!()).not.toThrow();
  expect(discovery.send).toHaveBeenCalledTimes(fault === 'send' ? 1 : 0);
  expect(discovery.close).toHaveBeenCalledOnce();
});

it.each(['bind', 'send', 'close'] as const)('PCPの%s同期例外を結果不明の区別を保って候補内で処理する', async fault => {
  vi.useFakeTimers();
  const pcp = new UdpSocket(); udp.createSocket.mockReturnValueOnce(pcp);
  pcp[fault].mockImplementationOnce(() => { throw new Error('EADDRNOTAVAIL'); });
  const request: MappingRequest = { ...mappingRequest, family: 'ipv6', localAddress: '2001:4860::1' };
  const network: DirectAdapter = { ...adapter, addresses: [{ family: 'ipv6', address: request.localAddress }], gateway6: 'fe80::1%1' };
  const before = vi.fn(async () => undefined);
  const result = new WindowsDirectGateway().prepare(network, request, 'process', before).catch(error => error);
  await vi.waitFor(() => expect(pcp.bind).toHaveBeenCalledOnce());
  if (fault === 'close') expect(() => pcp.emit('error', new Error('EADDRNOTAVAIL'))).not.toThrow();
  else if (fault === 'send') expect(() => pcp.bound!()).not.toThrow();
  const error = await result;
  expect(error).toBeInstanceOf(MappingFailure); expect(error).toMatchObject({ kind: 'unknown', uncertain: fault === 'send' });
  expect(before).toHaveBeenCalledOnce(); expect(pcp.close).toHaveBeenCalledOnce();
  pcp.emit('error', new Error('late error'));
  if (pcp.bound) expect(() => pcp.bound!()).not.toThrow();
  expect(pcp.send).toHaveBeenCalledTimes(fault === 'send' ? 1 : 0); expect(pcp.close).toHaveBeenCalledOnce();
});

it('PCPは保存したnonce・内部ポート・プロトコルを照合し、有限期限と公開割当を返す', () => {
  const request: MappingRequest = { id: 'id', pcId: 'pc', family: 'ipv4', protocol: 'udp', localAddress: '192.168.1.2', localPort: 10000, nonce: 'a'.repeat(24) };
  const sent = pcpRequest(request, 3600);
  expect(sent.length).toBe(60); expect(sent.subarray(24, 36).toString('hex')).toBe(request.nonce);
  const reply = Buffer.from(sent.subarray(0, 60)); reply[1] = 0x81;
  Buffer.from('00000000000000000000ffff08080808', 'hex').copy(reply, 44); reply.writeUInt16BE(20000, 42);
  expect(parsePcpResponse(reply, request, 100)).toMatchObject({ address: '8.8.8.8', publicPort: 20000, expiresAt: 3600100 });
  const renewed = pcpRequest(request, 3600, parsePcpResponse(reply, request, 100));
  expect(renewed.length).toBe(60); expect(renewed.subarray(24, 36)).toEqual(sent.subarray(24, 36));
  Buffer.from('00000000000000000000ffff01010101', 'hex').copy(reply, 44); reply.writeUInt16BE(20001, 42);
  expect(parsePcpResponse(reply, request, 200)).toMatchObject({ address: '1.1.1.1', publicPort: 20001 });
  const wrong = Buffer.from(reply); wrong[24] ^= 1;
  expect(() => parsePcpResponse(wrong, request, 100)).toThrow();
  const deletion = pcpRequest(request, 0, parsePcpResponse(reply, request, 100));
  expect(deletion.readUInt16BE(42)).toBe(0); expect(deletion.subarray(44)).toEqual(Buffer.from('00000000000000000000ffff00000000', 'hex'));
  deletion[1] = 0x81; expect(() => parsePcpResponse(deletion, request, 100)).toThrow();
  expect(parsePcpResponse(deletion, request, 100, true).expiresAt).toBe(100);
});
