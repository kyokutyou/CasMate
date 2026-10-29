import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import type { DirectPcKey } from '../../shared/direct-connection';

export interface DirectIdentity { privateKey: string; certificate: string; pcKey: DirectPcKey; }
function der(tag: number, ...parts: Buffer[]): Buffer {
  const value = Buffer.concat(parts); const n = value.length;
  const length = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), length, value]);
}
const sequence = (...parts: Buffer[]) => der(0x30, ...parts);
const algorithm = sequence(Buffer.from('06082a8648ce3d040302', 'hex'));
function date(value: Date): Buffer {
  const text = value.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return der(0x18, Buffer.from(text.replace('T', '')));
}
function fingerprint(key: ReturnType<typeof createPublicKey>): string {
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}
function certificate(pcId: string, privateKey: string, now: number): string {
  const key = createPrivateKey(privateKey);
  const name = sequence(der(0x31, sequence(Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from(`CasMate ${pcId}`)))));
  const randomSerial = randomBytes(16); randomSerial[0] |= 0x80;
  const serial = Buffer.concat([Buffer.from([0]), randomSerial]);
  const tbs = sequence(der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), algorithm, name,
    sequence(date(new Date(now - 3600_000)), date(new Date(now + 365 * 86400_000))), name,
    createPublicKey(key).export({ type: 'spki', format: 'der' }));
  const bytes = sequence(tbs, algorithm, der(0x03, Buffer.from([0]), sign('sha256', tbs, key)));
  return `-----BEGIN CERTIFICATE-----\n${bytes.toString('base64').match(/.{1,64}/gu)!.join('\n')}\n-----END CERTIFICATE-----\n`;
}
export function createDirectIdentity(pcId: string, now = Date.now()): DirectIdentity {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { privateKey, certificate: certificate(pcId, privateKey, now),
    pcKey: { algorithm: 'sha256-spki', fingerprint: fingerprint(pair.publicKey) } };
}
/** Corrupt keys are never silently replaced. Renewal retains the pinned SPKI. */
export function validateDirectIdentity(value: DirectIdentity, pcId: string, now = Date.now()): DirectIdentity {
  const key = createPublicKey(createPrivateKey(value.privateKey));
  const cert = new X509Certificate(value.certificate);
  if (value.pcKey.algorithm !== 'sha256-spki' || value.pcKey.fingerprint !== fingerprint(key) ||
    fingerprint(cert.publicKey) !== value.pcKey.fingerprint || !cert.verify(key) ||
    !cert.subject.includes(`CN=CasMate ${pcId}`)) throw new Error('PCの確認鍵を復元できません。直接接続を停止しています。');
  return Date.parse(cert.validTo) - now < 30 * 86400_000 || Date.parse(cert.validFrom) > now
    ? { ...value, certificate: certificate(pcId, value.privateKey, now) } : structuredClone(value);
}
