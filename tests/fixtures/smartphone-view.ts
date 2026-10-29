import { defaultSmartphoneSettings, type SmartphoneView } from '../../src/shared/smartphone';
import type { MobileSpeechState } from '../../src/shared/types';

export const smartphoneView: SmartphoneView = {
  available: true, settings: { ...defaultSmartphoneSettings(), activeNetwork: 'lan' }, warning: null,
  networks: {
    lan: { address: '192.168.1.2', commentsUrl: 'http://192.168.1.2:3000/comments', registrationReady: true, invitationRevision: 1, videoReady: false, obsReady: false, warning: null },
    tailscale: { address: null, commentsUrl: null, registrationReady: false, invitationRevision: 1, videoReady: false, obsReady: false, warning: null },
  },
  devices: [{ id: '11111111-1111-4111-8111-111111111111', name: 'スマホA', obsLocalPort: 10001, obsRevision: 1, profiles: {
    lan: { registered: true, obsPort: 10000, receiver: { state: 'listening', receivedBytes: 0 }, revision: 1, report: null, stale: true },
    tailscale: { registered: false, obsPort: 10002, receiver: { state: 'stopped', receivedBytes: 0 }, revision: 1, report: null, stale: true },
  } }],
};
export const smartphoneMobileState: MobileSpeechState = { urls: [{ kind: 'lan', url: 'http://192.168.1.2:3000/comments', available: true }],
  tailscaleStatus: 'disabled', activeClient: true, clientCount: 3, currentCommentId: null, queueLength: 2, droppedCount: 1, audioAvailable: true, warning: null };

export const smartphoneDirectView: SmartphoneView = {
  ...smartphoneView, settings: { ...defaultSmartphoneSettings(), activeNetwork: 'direct' },
  networks: { ...smartphoneView.networks, direct: { address: '8.8.8.8', commentsUrl: null, registrationReady: true, invitationRevision: 1, videoReady: true, obsReady: true, warning: null } },
  devices: smartphoneView.devices.map(device => ({ ...device, profiles: { ...device.profiles, direct: { ...device.profiles.lan, obsPort: 11000 } } })),
  direct: { revision: 1, interfaceId: null, entries: [
    { id: 'tcp', protocol: 'tcp', family: 'ipv4', localAddress: '192.168.1.2', localPort: 3001, address: '8.8.8.8', publicPort: 3001,
      method: 'pcp', listener: true, firewall: true, prepared: true, expiresAt: null, reachability: 'unconfirmed', warning: null },
    { id: 'udp', deviceId: smartphoneView.devices[0].id, protocol: 'udp', family: 'ipv6', localAddress: '2001:4860:1::2', localPort: 11000, address: '2001:4860:1::2', publicPort: 11000,
      method: 'pcp', listener: true, firewall: true, prepared: true, expiresAt: null, reachability: 'unconfirmed', warning: null },
  ], residual: [], pendingDeviceIds: [], failure: null },
};
