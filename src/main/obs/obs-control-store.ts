import { readFile } from 'node:fs/promises';
import { atomicBytes, compatibilityNotice, replaceRetiredBytes } from '../core/compatibility-storage';
import type { SecretProtection } from '../core/secret-protection';
import {
  defaultObsControlPhrases,
  isObsControlPort,
  isObsPort,
  isObsToken,
  isRegistrationId,
  isValidObsEndpoint,
  validateObsControlPhrases,
  type ObsControlPublicationSettings,
  type ObsControlRegistration,
  type ObsControlSettings,
} from '../../shared/obs-control';

export interface ObsControlRecord {
  version: 1;
  settings: ObsControlSettings;
  registration: null;
}

export type ObsSecretProtection = SecretProtection;

export function defaultObsControlSettings(): ObsControlSettings {
  return {
    enabled: false,
    voiceEnabled: false,
    androidEnabled: false,
    port: 4455,
    password: '',
    phrases: { ...defaultObsControlPhrases },
    publication: {
      lanEnabled: false,
      tailscaleEnabled: false,
      port: 3002,
    },
  };
}

export class ObsControlStorageError extends Error {
  constructor(path: string, cause: unknown) {
    super('OBS操作の保存を読み込めません。原本と退避ファイルを保持しています。保存先: ' + path + '\n再設定する場合はアプリ終了後、このファイルと、存在する場合は ' + path + '.compatibility-reset.json を別の場所へ手動で退避し、再起動してOBS接続を設定し直してください。退避ファイルは削除しないでください。', { cause });
  }
}

export class ObsControlStore {
  resetNotice: string | null = null;
  constructor(private readonly path: string, private readonly protection: ObsSecretProtection) {}

  async load(): Promise<ObsControlRecord | null> {
    try { return await this.readSavedSettings(); }
    catch (error) { throw new ObsControlStorageError(this.path, error); }
  }

  private async readSavedSettings(): Promise<ObsControlRecord | null> {
    this.resetNotice = await compatibilityNotice(this.path);
    let bytes: Buffer;
    try { bytes = await readFile(this.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (!this.protection.isEncryptionAvailable()) throw new Error('OBS_SECRET_UNAVAILABLE');
    try {
      const raw = JSON.parse(this.protection.decryptString(bytes)) as Record<string, unknown>;
      if (raw.registration !== null) {
        validateObsControlRegistration(raw.registration);
        const record = validateObsControlRecord({ ...raw, registration: null });
        await replaceRetiredBytes(this.path, bytes, this.protection.encryptString(JSON.stringify(record)),
          '旧OBS操作登録を退避しました。スマホ連携の共通QRで再登録してください。旧ルーター・ファイアウォール設定が残る場合は手動で確認してください。');
        this.resetNotice = await compatibilityNotice(this.path);
        return record;
      }
      return validateObsControlRecord(raw);
    } catch {
      throw new Error('OBS_SECRET_UNAVAILABLE');
    }
  }

  async save(record: ObsControlRecord): Promise<void> {
    if (!this.protection.isEncryptionAvailable()) throw new Error('OBS_SECRET_UNAVAILABLE');
    const validated = validateObsControlRecord(record);
    const encrypted = this.protection.encryptString(JSON.stringify(validated));
    await atomicBytes(this.path, encrypted);
  }
}

export function validateObsControlRecord(value: unknown): ObsControlRecord {
  if (!value || typeof value !== 'object') throw new Error('OBS_SECRET_UNAVAILABLE');
  const record = value as ObsControlRecord;
  if (Object.keys(record).sort().join(',') !== 'registration,settings,version' ||
    record.version !== 1 || !record.settings || typeof record.settings !== 'object') {
    throw new Error('OBS_SECRET_UNAVAILABLE');
  }
  const settings = record.settings as ObsControlSettings;
  if (Object.keys(settings).sort().join(',') !== 'androidEnabled,enabled,password,phrases,port,publication,voiceEnabled' ||
    typeof settings.enabled !== 'boolean' || typeof settings.voiceEnabled !== 'boolean' ||
    typeof settings.androidEnabled !== 'boolean' || !isObsPort(settings.port) ||
    typeof settings.password !== 'string' || (settings.enabled && settings.password.length === 0) ||
    typeof settings.publication !== 'object' || !settings.publication) {
    throw new Error('OBS_SECRET_UNAVAILABLE');
  }
  const publication = settings.publication as ObsControlPublicationSettings;
  if (Object.keys(publication).sort().join(',') !== 'lanEnabled,port,tailscaleEnabled' ||
    typeof publication.lanEnabled !== 'boolean' || typeof publication.tailscaleEnabled !== 'boolean' ||
    !isObsControlPort(publication.port)) throw new Error('OBS_SECRET_UNAVAILABLE');
  const phrases = validateObsControlPhrases(settings.phrases);
  if (record.registration !== null) throw new Error('OBS_SECRET_UNAVAILABLE');
  return {
    version: 1,
    settings: {
      enabled: settings.enabled,
      voiceEnabled: settings.voiceEnabled,
      androidEnabled: settings.androidEnabled,
      port: settings.port,
      password: settings.password,
      phrases,
      publication: { ...publication },
    },
    registration: null,
  };
}

function validateObsControlRegistration(value: unknown): ObsControlRegistration {
  if (!value || typeof value !== 'object') throw new Error('OBS_SECRET_UNAVAILABLE');
  const registration = value as ObsControlRegistration;
  if (Object.keys(registration).sort().join(',') !== 'endpoints,registrationId,revision,token' ||
    !isRegistrationId(registration.registrationId) ||
    !Number.isSafeInteger(registration.revision) || registration.revision <= 0 ||
    !isObsToken(registration.token) || !Array.isArray(registration.endpoints) ||
    registration.endpoints.length < 1 || registration.endpoints.length > 2 ||
    !registration.endpoints.every(isValidObsEndpoint) ||
    new Set(registration.endpoints.map((endpoint) => endpoint.network)).size !== registration.endpoints.length) {
    throw new Error('OBS_SECRET_UNAVAILABLE');
  }
  return {
    registrationId: registration.registrationId,
    revision: registration.revision,
    token: registration.token,
    endpoints: registration.endpoints.map((endpoint) => ({ ...endpoint })),
  };
}
