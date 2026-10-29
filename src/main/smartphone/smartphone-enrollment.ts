import { createHash, timingSafeEqual } from 'node:crypto';
import { isObsToken, isRegistrationId } from '../../shared/obs-control';
import type { SmartphoneEnrollment } from '../../shared/smartphone';
import { compatibilityPolicy } from '../../shared/compatibility-policy.generated';
import { addSmartphoneDevice, validateDeviceName, type SmartphoneDevice, type SmartphoneRecord } from './smartphone-store';

export class EnrollmentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = () => new EnrollmentError(400, 'INVALID_ENROLLMENT', '登録要求の形式が正しくありません。Androidを更新してください。');
const mismatch = () => new EnrollmentError(409, 'REGISTRATION_MISMATCH', '保存済みの登録と一致しません。既存の登録を確認してください。');
function keys(value: unknown, allowed: string[], required = allowed): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k)));
}

export function parseEnrollment(value: unknown, direct = false): SmartphoneEnrollment {
  if (!keys(value, ['clientId', 'clientSecret', 'name', 'previous', 'invitationVersion'], ['clientId', 'clientSecret', 'name']) ||
    !isRegistrationId(value.clientId) || !isObsToken(value.clientSecret)) throw invalid();
  if (value.invitationVersion !== (direct ? compatibilityPolicy.contracts.directInvitation.current : compatibilityPolicy.contracts.privateInvitation.current)) {
    throw new EnrollmentError(400, 'UNSUPPORTED_VERSION', '登録方式が対応していません。PCとAndroidを更新して最新のQRを読み取ってください。');
  }
  try { validateDeviceName(value.name); } catch { throw invalid(); }
  if (value.previous !== undefined) {
    const previous = value.previous;
    if (!keys(previous, ['pcId', 'deviceId', 'proofs'], ['proofs']) ||
      (previous.pcId !== undefined && !isRegistrationId(previous.pcId)) ||
      (previous.deviceId !== undefined && !isRegistrationId(previous.deviceId)) ||
      !Array.isArray(previous.proofs) || previous.proofs.length > (direct ? 8 : 4) || previous.proofs.some(proof =>
        !keys(proof, ['kind', 'registrationId', 'token']) || !(direct ? ['comments', 'outdoor', 'obsControl'] : ['outdoor', 'obsControl']).includes(String(proof.kind)) ||
        typeof proof.registrationId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/u.test(proof.registrationId) || !isObsToken(proof.token))) throw invalid();
  }
  return structuredClone(value) as unknown as SmartphoneEnrollment;
}

// Called only inside the controller's serialized save transaction. Never identifies a phone by its IP/name.
export function enrollDevice(record: SmartphoneRecord, request: SmartphoneEnrollment): SmartphoneDevice {
  if (request.previous?.pcId && request.previous.pcId !== record.pcId) throw mismatch();
  const secretHash = createHash('sha256').update(request.clientSecret).digest('hex');
  const bound = record.devices.find(d => d.client?.id === request.clientId);
  if (bound) {
    if (!safeEqual(bound.client!.secretHash, secretHash) ||
      (request.previous?.deviceId && request.previous.deviceId !== bound.id)) throw mismatch();
    return bound;
  }
  if (request.previous?.deviceId || request.previous?.proofs.length) throw mismatch();
  const device = addSmartphoneDevice(record, request.name);
  device.client = { id: request.clientId, secretHash };
  return device;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
