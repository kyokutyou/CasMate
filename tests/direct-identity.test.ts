import { X509Certificate } from 'node:crypto';
import { expect, it } from 'vitest';
import { createDirectIdentity, validateDirectIdentity } from '../src/main/smartphone/direct-identity';

it('PC鍵を保持して証明書を更新し、不一致の保護保存は停止する', () => {
  const pcId = 'de98a742-172b-470f-8aa3-8d2dfc560a21';
  const now = Date.UTC(2026, 9, 4);
  const first = createDirectIdentity(pcId, now);
  expect(new X509Certificate(first.certificate).verify(new X509Certificate(first.certificate).publicKey)).toBe(true);
  expect(first.pcKey.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  const renewed = validateDirectIdentity(first, pcId, now + 350 * 86400_000);
  expect(renewed.pcKey).toEqual(first.pcKey);
  expect(renewed.privateKey).toBe(first.privateKey);
  expect(renewed.certificate).not.toBe(first.certificate);
  expect(() => validateDirectIdentity({ ...first, privateKey: createDirectIdentity(pcId, now).privateKey }, pcId, now)).toThrow();
});
