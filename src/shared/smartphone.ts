import type { ObsControlRegistration } from './obs-control';
import type { OutdoorRegistration, OutdoorReport, OutdoorReceiverView } from './outdoor';
import type { DirectSettings, DirectView, DirectRegistration, DirectInvitation, DirectCredential } from './direct-connection';
import { compatibilityPolicy } from './compatibility-policy.generated';

export const smartphoneNetworks = ['lan', 'tailscale'] as const;
export type PrivateSmartphoneNetwork = typeof smartphoneNetworks[number];
export const allSmartphoneNetworks = [...smartphoneNetworks, 'direct'] as const;
export type SmartphoneNetwork = typeof allSmartphoneNetworks[number];
export type SmartphoneControlVersion = 2 | 3;
export type NetworkValues<T> = Record<PrivateSmartphoneNetwork, T> & { direct?: T };
export const smartphoneNetworkNames: Record<SmartphoneNetwork, string> = {
  lan: '家庭内LANのネットワーク', tailscale: '外配信Tailscaleネットワーク', direct: 'PC・スマホ直接接続',
};
export interface SmartphoneSettings {
  activeNetwork: SmartphoneNetwork | null;
  lanInterfaceId?: string | null;
  statusPorts: NetworkValues<number>;
  direct?: DirectSettings;
}
export interface SmartphoneConfiguration {
  activeNetwork?: SmartphoneNetwork | null;
  lanInterfaceId?: string | null;
  network?: SmartphoneNetwork;
  statusPort?: number;
  direct?: Partial<DirectSettings>;
}
export interface PrivateSmartphoneRegistration extends RegistrationUpdateFields {
  type: 'casmate.outdoor';
  version: typeof compatibilityPolicy.contracts.privateRegistration.current;
  pcId: string;
  deviceId: string;
  network: PrivateSmartphoneNetwork;
  comments: { url: string };
  control: { protocolVersion: typeof compatibilityPolicy.contracts.controlProtocol.current; url: string };
  outdoor?: Omit<OutdoorRegistration, 'statusPort'>;
  obsControl?: Omit<ObsControlRegistration, 'endpoints'>;
}
export interface SmartphonePreparation {
  video: 'preparing' | 'ready' | 'error';
  obsControl: 'disabled' | 'preparing' | 'ready' | 'error';
}
export interface RegistrationUpdateFields {
  registrationUpdate: DirectCredential;
  speechRecognition: DirectCredential;
  updateRevision: number;
  preparation: SmartphonePreparation;
}
export type UpdatedPrivateRegistration = PrivateSmartphoneRegistration;
export type UpdatedDirectRegistration = DirectRegistration;
export type CurrentSmartphoneRegistration = UpdatedPrivateRegistration | UpdatedDirectRegistration;
export type LegacyPrivateSmartphoneRegistration = Omit<PrivateSmartphoneRegistration, 'version' | 'control' | 'speechRecognition'> & {
  version: 12; control: { protocolVersion: 2; url: string }; speechRecognition?: never;
};
export type LegacyDirectSmartphoneRegistration = Omit<DirectRegistration, 'version' | 'control' | 'speechRecognition'> & {
  version: 14; control: { protocolVersion: 2 }; speechRecognition?: never;
};
export type UpdatedSmartphoneRegistration = CurrentSmartphoneRegistration | LegacyPrivateSmartphoneRegistration | LegacyDirectSmartphoneRegistration;
export type SmartphoneRegistration = UpdatedSmartphoneRegistration;
export interface PrivateSmartphoneInvitation {
  type: 'casmate.outdoor';
  version: typeof compatibilityPolicy.contracts.privateInvitation.current;
  pcId: string;
  network: PrivateSmartphoneNetwork;
  comments: { url: string };
  registrationPort: number;
  token: string;
}
export type SmartphoneInvitation = PrivateSmartphoneInvitation | DirectInvitation;
export interface SmartphoneEnrollment {
  invitationVersion: typeof compatibilityPolicy.contracts.privateInvitation.current | typeof compatibilityPolicy.contracts.directInvitation.current;
  clientId: string;
  clientSecret: string;
  name: string;
  previous?: { pcId?: string; deviceId?: string; proofs: { kind: 'comments' | 'outdoor' | 'obsControl'; registrationId: string; token: string }[] };
}
export interface SmartphoneNetworkView {
  address: string | null;
  commentsUrl: string | null;
  registrationReady: boolean;
  invitationRevision: number;
  videoReady: boolean;
  obsReady: boolean;
  warning: string | null;
}
export interface SmartphoneDeviceView {
  id: string;
  name: string;
  obsLocalPort?: number;
  obsRevision: number;
  profiles: NetworkValues<{
    registered: boolean;
    obsPort: number;
    receiver?: OutdoorReceiverView;
    revision: number;
    report: OutdoorReport | null;
    stale: boolean;
    preparation?: SmartphonePreparation;
  }>;
}
export interface SmartphoneView {
  available: boolean;
  settings: SmartphoneSettings;
  networks: NetworkValues<SmartphoneNetworkView>;
  direct?: DirectView;
  devices: SmartphoneDeviceView[];
  warning: string | null;
}

export function defaultSmartphoneSettings(): SmartphoneSettings {
  return { activeNetwork: null, statusPorts: { lan: 3001, tailscale: 3001, direct: 3001 } };
}

/** Current PC transport receipt; registration and Android reports are not receipt evidence. */
export function smartphoneDeviceDataReceiving(device: SmartphoneDeviceView, network: SmartphoneNetwork, active: SmartphoneNetwork | null): boolean {
  const profile = device.profiles[network];
  return Boolean(network === active && profile?.registered && profile.preparation?.video !== 'error' && profile.preparation?.video !== 'preparing' &&
    profile.receiver?.state === 'receiving' && profile.receiver.receivedBytes > 0 &&
    !Object.values(device.profiles).some(item => item.receiver?.stopStatus === 'unknown' || item.receiver?.stopStatus === 'stopping'));
}
