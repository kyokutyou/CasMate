

export const OBS_CONTROL_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_OBS_PORT = 4455;
export const DEFAULT_OBS_CONTROL_PORT = 3002;

export const defaultObsControlPhrases = {
  startCommand: 'きゃすメイト、配信開始',
  stopCommand: 'きゃすメイト、配信終了',
  startConfirm: '開始を実行',
  stopConfirm: '終了を実行',
} as const;

export type ObsAction = 'start' | 'stop';
export type ObsConnectionState = 'disabled' | 'connecting' | 'connected' | 'unavailable';
export type ObsStreamState = 'unknown' | 'stopped' | 'starting' | 'streaming' | 'reconnecting' | 'stopping';
export type ObsControlSource = 'voice' | 'android';
export type ObsOperationStatus =
  | 'executing'
  | 'succeeded'
  | 'alreadySatisfied'
  | 'failed'
  | 'unknown'
  | 'cancelled';

export interface ObsControlPhrases {
  startCommand: string;
  stopCommand: string;
  startConfirm: string;
  stopConfirm: string;
}

export interface ObsControlPublicationSettings {
  lanEnabled: boolean;
  tailscaleEnabled: boolean;
  port: number;
}

export interface ObsControlSettings {
  enabled: boolean;
  voiceEnabled: boolean;
  androidEnabled: boolean;
  port: number;
  password: string;
  phrases: ObsControlPhrases;
  publication: ObsControlPublicationSettings;
}

export interface ObsControlEndpoint {
  network: 'lan' | 'tailscale';
  address: string;
  port: number;
}

export interface ObsControlRegistration {
  registrationId: string;
  revision: number;
  token: string;
  endpoints: ObsControlEndpoint[];
}

export interface ObsControlLastOperation {
  operationId: string;
  action: ObsAction;
  status: ObsOperationStatus;
  errorCode: string | null;
}

export interface ObsControlConfirmationView {
  action: ObsAction;
  source: ObsControlSource;
  expiresAt: number;
}

export interface ObsControlView {
  epoch: string;
  revision: number;
  enabled: boolean;
  voiceEnabled: boolean;
  androidEnabled: boolean;
  obsPort: number;
  passwordConfigured: boolean;
  phrases: ObsControlPhrases;
  connection: ObsConnectionState;
  stream: ObsStreamState;
  busy: boolean;
  confirmation: ObsControlConfirmationView | null;
  lastOperation: ObsControlLastOperation | null;
  publication: ObsControlPublicationSettings & {
    ready: boolean;
    registered: boolean;
    registrationId: string | null;
    revision: number | null;
    endpoints: Array<Pick<ObsControlEndpoint, 'network' | 'address' | 'port'>>;
    warning: string | null;
  };
  error: string | null;
}

export function normalizeObsPhrase(value: string): string {
  return value.normalize('NFKC').replace(/[\p{White_Space}\p{Punctuation}]/gu, '');
}

export function isObsPhrase(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length >= 1 && Array.from(value).length <= 100 &&
    normalizeObsPhrase(value).length > 0;
}

export function validateObsControlPhrases(value: unknown): ObsControlPhrases {
  if (!value || typeof value !== 'object') throw new Error('OBS_PHRASES_INVALID');
  const phrases = value as Record<string, unknown>;
  const keys = Object.keys(phrases).sort();
  if (keys.join(',') !== 'startCommand,startConfirm,stopCommand,stopConfirm' ||
    !keys.every((key) => isObsPhrase(phrases[key]))) throw new Error('OBS_PHRASES_INVALID');
  const result = {
    startCommand: phrases.startCommand as string,
    stopCommand: phrases.stopCommand as string,
    startConfirm: phrases.startConfirm as string,
    stopConfirm: phrases.stopConfirm as string,
  };
  const normalized = Object.values(result).map(normalizeObsPhrase);
  if (new Set(normalized).size !== normalized.length) throw new Error('OBS_PHRASES_DUPLICATE');
  return result;
}

export function isObsControlPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 65535;
}

export function isObsPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535;
}

export function isRegistrationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

export function isObsToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function isValidObsEndpoint(value: unknown): value is ObsControlEndpoint {
  if (!value || typeof value !== 'object') return false;
  const endpoint = value as ObsControlEndpoint;
  return Object.keys(endpoint).sort().join(',') === 'address,network,port' &&
    (endpoint.network === 'lan' || endpoint.network === 'tailscale') &&
    isAllowedObsEndpointAddress(endpoint.network, endpoint.address) && isObsControlPort(endpoint.port);
}

export function isAllowedObsEndpointAddress(network: ObsControlEndpoint['network'], address: unknown): address is string {
  if (typeof address !== 'string') return false;
  const octets = address.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^(0|[1-9][0-9]*)$/u.test(octet))) return false;
  const values = octets.map(Number);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  if (network === 'tailscale') return values[0] === 100 && values[1]! >= 64 && values[1]! <= 127;
  return values[0] === 10 || (values[0] === 172 && values[1]! >= 16 && values[1]! <= 31) ||
    (values[0] === 192 && values[1] === 168);
}

export function isObsControlRegistration(value: unknown): value is ObsControlRegistration {
  if (!value || typeof value !== 'object') return false;
  const record = value as ObsControlRegistration;
  return Object.keys(record).sort().join(',') === 'endpoints,registrationId,revision,token' &&
    isRegistrationId(record.registrationId) && Number.isSafeInteger(record.revision) && record.revision > 0 &&
    isObsToken(record.token) && Array.isArray(record.endpoints) &&
    record.endpoints.length >= 1 && record.endpoints.length <= 2 &&
    record.endpoints.every(isValidObsEndpoint) &&
    new Set(record.endpoints.map((endpoint) => endpoint.network)).size === record.endpoints.length;
}

export function validateObsControlRegistration(value: unknown): ObsControlRegistration {
  if (!isObsControlRegistration(value)) throw new Error('OBS_REGISTRATION_INVALID');
  return {
    registrationId: value.registrationId,
    revision: value.revision,
    token: value.token,
    endpoints: value.endpoints.map((endpoint) => ({ ...endpoint })),
  };
}
