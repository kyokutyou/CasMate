import { describe, expect, it } from 'vitest';
import { parseEnrollment } from '../src/main/smartphone/smartphone-enrollment';
import { randomUUID } from 'node:crypto';
import { legacyRegistrationProjection } from '../src/main/smartphone/smartphone-controller';
import type { DirectRegistration } from '../src/shared/direct-connection';
import { newDirectCredential } from '../src/main/smartphone/direct-ledger';

describe('接続準備一本化の保存・登録契約', () => {
  it('直接接続の版16を旧版14へ投影し、PC鍵・既存用途資格・候補と更新番号を保つ', () => {
    const current: DirectRegistration = { type: 'casmate.outdoor', version: 16, pcId: randomUUID(), deviceId: randomUUID(), network: 'direct',
      pcKey: { algorithm: 'sha256-spki', fingerprint: 'a'.repeat(64) }, endpoints: [{ id: randomUUID(), family: 'ipv4', address: '8.8.8.8', tcpPort: 3001 }],
      comments: { ...newDirectCredential(), protocolVersion: 2 }, control: { protocolVersion: 3 },
      outdoor: { ...newDirectCredential(), passphrase: 'a'.repeat(32), endpoints: [{ id: randomUUID(), family: 'ipv4', address: '8.8.8.8', outdoorPort: 10000 }] },
      obsControl: newDirectCredential(), registrationUpdate: newDirectCredential(), speechRecognition: newDirectCredential(), updateRevision: 10,
      preparation: { video: 'ready', obsControl: 'ready' } };
    const old = legacyRegistrationProjection(current);
    expect(old).toMatchObject({ version: 14, control: { protocolVersion: 2 }, updateRevision: 10 }); expect(old).not.toHaveProperty('speechRecognition');
    for (const key of ['pcKey', 'endpoints', 'comments', 'outdoor', 'obsControl', 'registrationUpdate', 'preparation'] as const) expect(old[key]).toEqual(current[key]);
    expect(current.speechRecognition).toBeDefined(); expect(current.version).toBe(16);
  });
  it('現行招待版を必須として、不対応版は割当前に拒否する', () => {
    const request = { clientId: randomUUID(), clientSecret: 'a'.repeat(64), name: 'Android' };
    expect(() => parseEnrollment(request)).toThrow();
    expect(parseEnrollment({ ...request, invitationVersion: 11 })).toMatchObject({ invitationVersion: 11 });
    expect(parseEnrollment({ ...request, invitationVersion: 13 }, true)).toMatchObject({ invitationVersion: 13 });
    for (const version of [0, 6, 9, 12, 14, 999]) expect(() => parseEnrollment({ ...request, invitationVersion: version })).toThrow();
    expect(() => parseEnrollment({ ...request, invitationVersion: 13 })).toThrow();
    expect(() => parseEnrollment({ ...request, invitationVersion: 11 }, true)).toThrow();
  });
});
