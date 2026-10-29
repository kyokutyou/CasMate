import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicBytes, archiveBytes, compatibilityNotice, replaceRetiredBytes } from '../core/compatibility-storage';
import { compatibilityPolicy } from '../../shared/compatibility-policy.generated';
import { isAllowedObsEndpointAddress, isObsToken, isRegistrationId, isValidObsEndpoint, type ObsControlRegistration } from '../../shared/obs-control';
import { isOutdoorPort, isOutdoorRegistration, type OutdoorRegistration } from '../../shared/outdoor';
import { defaultSmartphoneSettings, smartphoneNetworks, allSmartphoneNetworks, type PrivateSmartphoneNetwork, type SmartphoneSettings, type SmartphoneNetwork } from '../../shared/smartphone';
import type { SecretProtection } from '../core/secret-protection';
import { newDirectCredential, newDirectLedger, rotateDirectInvitation, validateDirectLedger, type DirectLedger } from './direct-ledger';
import { defaultDirectSettings, isDirectCredential, validateDirectSettings } from '../../shared/direct-connection';
import type { DirectCredential } from '../../shared/direct-connection';

export type StoredSmartphoneVideo = Omit<OutdoorRegistration, 'address'> & { address: string | null; localPort?: number };
export interface StoredRegistrationUpdate {
  credential: DirectCredential; speechRecognition: DirectCredential; updateRevision: number;
  projectionHash: string; legacyProjectionHash?: string;
}
export interface SmartphoneDevice {
  id: string;
  name: string;
  obsLocalPort?: number;
  video: Partial<Record<PrivateSmartphoneNetwork, StoredSmartphoneVideo>>;
  updates?: Partial<Record<SmartphoneNetwork, StoredRegistrationUpdate>>;
  obs: ObsControlRegistration;
  client?: { id: string; secretHash: string };
}
export interface SmartphoneRecord {
  version: typeof compatibilityPolicy.contracts.pcSmartphoneStore.current;
  direct?: DirectLedger;
  pcId: string;
  settings: SmartphoneSettings;
  devices: SmartphoneDevice[];
  reservedPorts: number[];
  migrationNotice: string | null;
  invitations?: Record<PrivateSmartphoneNetwork, { token: string; revision: number }>;
}

export function rotateSmartphoneInvitations(record: SmartphoneRecord): void {
  if (record.direct) rotateDirectInvitation(record.direct);
  record.invitations = Object.fromEntries(smartphoneNetworks.map(network => [network, {
    token: randomBytes(32).toString('hex'), revision: (record.invitations?.[network].revision ?? 0) + 1,
  }])) as NonNullable<SmartphoneRecord['invitations']>;
}

export class SmartphoneStorageError extends Error {
  constructor(path: string, cause: unknown) {
    super('スマホ台帳の移行保存に失敗しました。中断・置換の状態を確認できないため編集を停止しています。原本と退避ファイルを保持しています。保存先: ' + path +
      '\n再設定する場合はPCアプリを終了後、このファイルと、存在する場合は ' + path + '.compatibility-reset.json を別の場所へ手動で退避してから再起動し、共通QRで登録し直してください。' +
      '同じフォルダーの .retired-*.backup は原本の退避先です。退避ファイルは削除せず、旧ルーター開放・Windows受信規則も確認してください。', { cause });
  }
}

export class SmartphoneStore {
  constructor(private readonly path: string, private readonly protection: SecretProtection) {}
  async load(): Promise<SmartphoneRecord | null> {
    const notice = await this.compatibility(() => compatibilityNotice(this.path));
    let bytes: Buffer;
    try { bytes = await readFile(this.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Only recognize and archive the obsolete file; never import its usable credentials.
      const oldPath = join(dirname(this.path), 'outdoor.protected');
      let old: Buffer; try { old = await readFile(oldPath); } catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return null; throw missing; }
      if (!this.protection.isEncryptionAvailable()) throw new Error('旧スマホ保存を復元できません。', { cause: error });
      const root = JSON.parse(this.protection.decryptString(old));
      if (!root || typeof root.enabled !== 'boolean' || !recognizedRetiredVideo(root.registration)) throw new Error('旧スマホ保存の構造を確認できません。', { cause: error });
      const backup = await archiveBytes(oldPath, old); const fresh = createSmartphoneRecord();
      fresh.migrationNotice = '旧登録を退避しました。共通QRで再登録し、OBS入力と旧ルーター開放・Windows受信規則を確認してください。退避先: ' + backup;
      await this.save(fresh); return fresh;
    }
    if (!this.protection.isEncryptionAvailable()) throw new Error('スマホ台帳を復元できません。');
    const value = JSON.parse(this.protection.decryptString(bytes));
    if (value?.version === 4 || value?.version === 5) {
      const migrated = validateRecord(value, value.version);
      migrated.version = compatibilityPolicy.contracts.pcSmartphoneStore.current;
      for (const device of migrated.devices) {
        for (const video of Object.values(device.video)) delete video.localPort;
        if (value.version === 4) for (const update of Object.values(device.updates ?? {})) {
          update.speechRecognition = newDirectCredential(); update.projectionHash = ''; update.legacyProjectionHash = '';
        }
      }
      for (const allocation of Object.values(migrated.direct!.devices)) if (allocation.outdoor) delete allocation.outdoor.localPort;
      validateSmartphoneRecord(migrated);
      const migrationNotice = 'OBS入力を端末共通に変更しました。スマホ一覧の「映像をOBSに表示」から新しいソースを一度追加してください。旧ネットワーク別ソースはOBSで整理できます。端末・登録資格・接続設定・旧ポート予約は保持しています。';
      await this.compatibility(() => replaceRetiredBytes(this.path, bytes, this.protection.encryptString(JSON.stringify(migrated)), migrationNotice));
      migrated.migrationNotice = await this.compatibility(() => compatibilityNotice(this.path)); return migrated;
    }
    if (compatibilityPolicy.contracts.pcSmartphoneStore.retired.includes(value?.version)) {
      recognizeRetiredRecord(value);
      const fresh = createSmartphoneRecord();
      fresh.migrationNotice = '旧スマホ台帳を退避して公開OFFにしました。共通QRで再登録し、OBS入力と旧ルーター開放・Windows受信規則を確認してください。';
      await this.compatibility(() => replaceRetiredBytes(this.path, bytes, this.protection.encryptString(JSON.stringify(fresh)), fresh.migrationNotice!));
      fresh.migrationNotice = await this.compatibility(() => compatibilityNotice(this.path)); return fresh;
    }
    const record = validateSmartphoneRecord(value);
    if (notice) record.migrationNotice = notice;
    return record;
  }
  async save(record: SmartphoneRecord): Promise<void> {
    if (!this.protection.isEncryptionAvailable()) throw new Error('スマホ台帳を暗号化できません。');
    const encrypted = this.protection.encryptString(JSON.stringify(validateSmartphoneRecord(record)));
    await atomicBytes(this.path, encrypted);
  }
  private async compatibility<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) { throw new SmartphoneStorageError(this.path, error); }
  }
}

export function createSmartphoneRecord(): SmartphoneRecord {
  const record: SmartphoneRecord = { version: compatibilityPolicy.contracts.pcSmartphoneStore.current, pcId: randomUUID(),
    settings: { ...defaultSmartphoneSettings(), direct: defaultDirectSettings() }, direct: newDirectLedger(), devices: [], reservedPorts: [], migrationNotice: null };
  rotateSmartphoneInvitations(record); return record;
}
export function addSmartphoneDevice(record: SmartphoneRecord, name: string): SmartphoneDevice {
  const device: SmartphoneDevice = { id: randomUUID(), name: validateDeviceName(name), video: {},
    obs: { registrationId: randomUUID(), revision: 1, token: randomBytes(32).toString('hex'), endpoints: [] } };
  record.devices.push(device); return device;
}

export function validateDeviceName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 64 || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error('スマホの名前は1～64文字で入力してください。');
  }
  return value.trim();
}

export function allocateSmartphonePort(record: SmartphoneRecord): number {
  const reserved = new Set(record.reservedPorts);
  let port = 10000;
  while (port <= 65535 && reserved.has(port)) port += 1;
  if (port > 65535) {
    port = 1024;
    while (port < 10000 && reserved.has(port)) port += 1;
    if (port === 10000) throw new Error('OBS受信に割り当てられるUDPポートがありません。');
  }
  record.reservedPorts.push(port);
  return port;
}
const allocatePort = allocateSmartphonePort;

export function allocateVideo(record: SmartphoneRecord, device: SmartphoneDevice, network: PrivateSmartphoneNetwork): void {
  const reserved = [...record.reservedPorts];
  const previousObsPort = device.obsLocalPort;
  try {
    device.obsLocalPort ??= allocatePort(record);
    device.video[network] ??= newVideo(record, network);
  } catch (error) {
    record.reservedPorts = reserved;
    if (previousObsPort === undefined) delete device.obsLocalPort;
    throw error;
  }
}
function newVideo(record: SmartphoneRecord, network: PrivateSmartphoneNetwork): StoredSmartphoneVideo {
  return { type: 'casmate.outdoor', version: 3, registrationId: randomUUID(), revision: 1, address: null,
    obsPort: allocatePort(record), statusPort: record.settings.statusPorts[network],
    passphrase: randomBytes(16).toString('hex'), token: randomBytes(32).toString('hex') };
}

export function validateSmartphoneRecord(value: unknown): SmartphoneRecord {
  return validateRecord(value, compatibilityPolicy.contracts.pcSmartphoneStore.current);
}

/** Supported imports keep their original shape until the protected migration succeeds. */
function validateRecord(value: unknown, version: number): SmartphoneRecord {
  const legacy = version === 4;
  const legacyObsPorts = version < 6;
  const fail = () => { throw new Error('スマホ台帳の形式が正しくありません。既存の台帳を保持しています。'); };
  if (!value || typeof value !== 'object') return fail();
  const record = value as SmartphoneRecord;
  if (record.version !== version || !isRegistrationId(record.pcId) || !record.settings ||
    ![null, ...allSmartphoneNetworks].includes(record.settings.activeNetwork) ||
    !record.settings.statusPorts || (record.settings.lanInterfaceId != null && (typeof record.settings.lanInterfaceId !== 'string' || !/^[a-zA-Z0-9{}-]{1,80}$/u.test(record.settings.lanInterfaceId))) || !Array.isArray(record.devices) ||
    !Array.isArray(record.reservedPorts) || !record.reservedPorts.every(isOutdoorPort) ||
    new Set(record.reservedPorts).size !== record.reservedPorts.length ||
    !(record.migrationNotice === null || typeof record.migrationNotice === 'string')) return fail();
  for (const network of smartphoneNetworks) {
    if (!isOutdoorPort(record.settings.statusPorts[network])) return fail();
    if (record.invitations) {
      const invitation = record.invitations[network];
      if (!invitation || !isObsToken(invitation.token) || !Number.isSafeInteger(invitation.revision) || invitation.revision < 1) return fail();
    }
  }
  const ids = new Set<string>(); const ports = new Set<number>(); const clients = new Set<string>();
  for (const device of record.devices) {
    if (!device || !isRegistrationId(device.id) || ids.has(device.id) || !device.video || !device.obs) return fail();
    ids.add(device.id); validateDeviceName(device.name);
    if (legacyObsPorts && Object.hasOwn(device, 'obsLocalPort')) return fail();
    if (device.obsLocalPort !== undefined) {
      if (!isOutdoorPort(device.obsLocalPort) || !record.reservedPorts.includes(device.obsLocalPort) || ports.has(device.obsLocalPort)) return fail();
      ports.add(device.obsLocalPort);
    }
    if (device.updates) {
      if (Object.keys(device.updates).some(n => !allSmartphoneNetworks.includes(n as SmartphoneNetwork))) return fail();
      for (const update of Object.values(device.updates)) {
        if (!update || !isRegistrationId(update.credential?.registrationId) || !isObsToken(update.credential?.token) ||
          !Number.isSafeInteger(update.credential.revision) || update.credential.revision < 1 || !Number.isSafeInteger(update.updateRevision) || update.updateRevision < 0 ||
          !(update.projectionHash === '' || /^[a-f0-9]{64}$/u.test(update.projectionHash)) ||
          (legacy ? Object.hasOwn(update, 'speechRecognition') || Object.hasOwn(update, 'legacyProjectionHash') : !isDirectCredential(update.speechRecognition)) ||
          update.legacyProjectionHash !== undefined && !(update.legacyProjectionHash === '' || /^[a-f0-9]{64}$/u.test(update.legacyProjectionHash))) return fail();
      }
    }
    if (device.client) {
      if (!isRegistrationId(device.client.id) || !isObsToken(device.client.secretHash) || clients.has(device.client.id)) return fail();
      clients.add(device.client.id);
    }
    if (!isRegistrationId(device.obs.registrationId) || !isObsToken(device.obs.token) ||
      !Number.isSafeInteger(device.obs.revision) || device.obs.revision < 1 || !Array.isArray(device.obs.endpoints) ||
      !device.obs.endpoints.every(isValidObsEndpoint) || new Set(device.obs.endpoints.map(e => e.network)).size !== device.obs.endpoints.length) return fail();
    for (const network of smartphoneNetworks) {
      const video = device.video[network];
      if (!video) continue;
      if (!video || !isOutdoorRegistration({ ...video, address: '100.64.0.1' }) ||
        (video.address !== null && !isAllowedObsEndpointAddress(network, video.address)) ||
        !record.reservedPorts.includes(video.obsPort) || ports.has(video.obsPort)) return fail();
      ports.add(video.obsPort);
      if (legacyObsPorts) {
        if (video.version !== 3 || !isOutdoorPort(video.localPort) || !record.reservedPorts.includes(video.localPort!) || ports.has(video.localPort!)) return fail();
        ports.add(video.localPort!);
      } else if (Object.hasOwn(video, 'localPort')) return fail();
    }
  }
  {
    if (!record.direct || !isOutdoorPort(record.settings.statusPorts.direct) || !record.settings.direct) return fail();
    validateDirectSettings(record.settings.direct);
    validateDirectLedger(record.direct, record.pcId, record.reservedPorts, record.devices.map(d => d.id), legacyObsPorts);
    for (const allocation of Object.values(record.direct.devices)) if (allocation.outdoor) {
      for (const port of legacyObsPorts ? [allocation.outdoor.internalPort, allocation.outdoor.localPort!] : [allocation.outdoor.internalPort]) {
        if (ports.has(port)) return fail(); ports.add(port);
      }
    }
  }
  if (!legacy) {
    const authorities = record.devices.flatMap(device => [device.obs, ...Object.values(device.video),
      ...Object.values(device.updates ?? {}).map(update => update.credential)]);
    for (const device of Object.values(record.direct!.devices)) authorities.push(device.comments, device.obs, ...(device.outdoor ? [device.outdoor] : []));
    const authorityIds = new Set(authorities.map(credential => credential.registrationId));
    const tokens = new Set(authorities.map(credential => credential.token));
    for (const device of record.devices) for (const update of Object.values(device.updates ?? {})) {
      const speech = update.speechRecognition;
      if (authorityIds.has(speech.registrationId) || tokens.has(speech.token)) return fail();
      authorityIds.add(speech.registrationId); tokens.add(speech.token);
    }
  }
  const result = structuredClone(record);
  const settings = result.settings as unknown as Record<string, unknown>; delete settings.videoEnabled; delete settings.migrationNetwork;
  for (const device of result.devices) delete (device as unknown as Record<string, unknown>).legacyRegistrationIds;
  return result;
}

function recognizedRetiredVideo(v: unknown, network: PrivateSmartphoneNetwork = 'tailscale', allowNull = false): boolean {
  if (!v || typeof v !== 'object') return false;
  const video = v as Record<string, unknown>;
  return video.type === 'casmate.outdoor' && [1, 2, 3].includes(video.version as number) && typeof video.registrationId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(video.registrationId) &&
    Number.isSafeInteger(video.revision) && (video.revision as number) > 0 && (allowNull && video.address === null || isAllowedObsEndpointAddress(network, video.address)) &&
    isOutdoorPort(video.obsPort) && isOutdoorPort(video.statusPort) && typeof video.passphrase === 'string' && /^[a-zA-Z0-9]{32}$/.test(video.passphrase) && isObsToken(video.token) &&
    (video.version !== 1 || recognizedFixedQuality(video.quality));
}
function recognizedFixedQuality(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fixed = { videoCodec: 'h264', fps: 30, videoBitrate: 2500000, landscapeWidth: 1280, landscapeHeight: 720, portraitWidth: 720, portraitHeight: 1280,
    audioCodec: 'aac-lc', sampleRate: 48000, channels: 1, audioBitrate: 64000, latencyMs: 1000, encryption: 'aes-256' };
  return Object.keys(value).length === Object.keys(fixed).length && Object.entries(fixed).every(([key, expected]) => (value as Record<string, unknown>)[key] === expected);
}
function recognizeRetiredRecord(value: unknown): void {
  const fail = () => { throw new Error('旧スマホ台帳の構造を確認できません。原本を保持しています。'); };
  if (!value || typeof value !== 'object') return fail();
  const r = value as Record<string, unknown>; const settings = r.settings as Record<string, unknown> | undefined;
  if (!compatibilityPolicy.contracts.pcSmartphoneStore.retired.includes(r.version as never) || !isRegistrationId(r.pcId) || !settings ||
    ![null, ...(r.version === 3 ? allSmartphoneNetworks : smartphoneNetworks)].includes(settings.activeNetwork as never) || !settings.videoEnabled || !settings.statusPorts ||
    !Array.isArray(r.devices) || !Array.isArray(r.reservedPorts) || !r.reservedPorts.every(isOutdoorPort) || new Set(r.reservedPorts).size !== r.reservedPorts.length ||
    !(r.migrationNotice === null || typeof r.migrationNotice === 'string')) return fail();
  if (settings.migrationNetwork !== undefined && !allSmartphoneNetworks.includes(settings.migrationNetwork as never)) return fail();
  for (const network of smartphoneNetworks) {
    if (typeof (settings.videoEnabled as Record<string, unknown>)[network] !== 'boolean' || !isOutdoorPort((settings.statusPorts as Record<string, unknown>)[network])) return fail();
    if (r.invitations !== undefined) {
      if (!r.invitations || typeof r.invitations !== 'object') return fail();
      const invitation = (r.invitations as Record<string, { token?: unknown; revision?: number }>)[network];
      if (!invitation || !isObsToken(invitation.token) || !Number.isSafeInteger(invitation.revision) || invitation.revision! < 1) return fail();
    }
  }
  const ids = new Set<string>(); const ports = new Set<number>(); const clients = new Set<string>();
  for (const d of r.devices) {
    if (!d || !isRegistrationId(d.id) || ids.has(d.id) || !d.video || !d.obs || !isRegistrationId(d.obs.registrationId) || !isObsToken(d.obs.token) || !Number.isSafeInteger(d.obs.revision) || d.obs.revision < 1 || !Array.isArray(d.obs.endpoints) || !d.obs.endpoints.every(isValidObsEndpoint) || new Set(d.obs.endpoints.map((e: { network: string }) => e.network)).size !== d.obs.endpoints.length) return fail();
    ids.add(d.id); validateDeviceName(d.name);
    if (d.updates !== undefined) return fail();
    if (d.client) {
      if (!isRegistrationId(d.client.id) || !isObsToken(d.client.secretHash) || clients.has(d.client.id)) return fail();
      clients.add(d.client.id);
    }
    if (d.legacyRegistrationIds && (typeof d.legacyRegistrationIds !== 'object' || Object.entries(d.legacyRegistrationIds).some(([key, id]) => !['outdoor', 'obsControl'].includes(key) || typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/u.test(id)))) return fail();
    for (const n of smartphoneNetworks) {
      const video = d.video[n];
      if (!recognizedRetiredVideo(video, n, true) || !r.reservedPorts.includes(video.obsPort) || ports.has(video.obsPort)) return fail();
      ports.add(video.obsPort);
      if (r.version !== 1 || video.version === 3) {
        if (video.version !== 3 || !isOutdoorPort(video.localPort) || !r.reservedPorts.includes(video.localPort) || ports.has(video.localPort)) return fail();
        ports.add(video.localPort);
      }
    }
  }
  if (r.version === 3) {
    if (!r.direct || !settings.direct || typeof (settings.videoEnabled as Record<string, unknown>).direct !== 'boolean' || !isOutdoorPort((settings.statusPorts as Record<string, unknown>).direct)) return fail();
    validateDirectSettings(settings.direct); const direct = r.direct as DirectLedger;
    validateDirectLedger(direct, r.pcId as string, r.reservedPorts as number[], [...ids]);
    for (const allocation of Object.values(direct.devices)) if (allocation.outdoor) for (const port of [allocation.outdoor.internalPort, allocation.outdoor.localPort!]) {
      if (ports.has(port)) return fail(); ports.add(port);
    }
  }
}
