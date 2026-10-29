import { describe, expect, it } from 'vitest';
import { isPublicAddress, validateDirectEndpoints, validateDirectSettings } from '../src/shared/direct-connection';

const id = 'de98a742-172b-470f-8aa3-8d2dfc560a21';
describe('直接接続の公開先契約', () => {
  it('公開数値アドレスだけを採用し、IPv4埋込み・特殊用途・非正規表記を拒否する', () => {
    expect(isPublicAddress('ipv4', '8.8.8.8')).toBe(true);
    expect(isPublicAddress('ipv6', '2606:4700:4700::1111')).toBe(true);
    for (const address of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.0.1', '172.16.0.1', '192.168.0.1', '192.0.2.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '8.8.8.08', 'example.com']) {
      expect(isPublicAddress('ipv4', address), address).toBe(false);
    }
    for (const address of ['::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:8.8.8.8', '2001:db8::1', '2002:808:808::1', '2606:4700:4700::1111%1']) {
      expect(isPublicAddress('ipv6', address), address).toBe(false);
    }
  });
  it('TCPとSRTを別々に検証し、重複・余分なキー・DNS・管理ポートの混入を拒否する', () => {
    const endpoint = { id, family: 'ipv4', address: '8.8.8.8', tcpPort: 3001 };
    expect(validateDirectEndpoints([endpoint], 'tcpPort')).toEqual([endpoint]);
    expect(() => validateDirectEndpoints([endpoint, endpoint], 'tcpPort')).toThrow();
    expect(() => validateDirectEndpoints([{ ...endpoint, token: 'secret' }], 'tcpPort')).toThrow();
    expect(() => validateDirectEndpoints([{ ...endpoint, tcpPort: 4455 }], 'tcpPort', [4455])).toThrow();
    expect(() => validateDirectSettings({ mode: 'manual', interfaceId: null, manualEndpoints: [{ ...endpoint, address: 'example.com' }], manualSrtEndpoints: [] })).toThrow();
  });
});
