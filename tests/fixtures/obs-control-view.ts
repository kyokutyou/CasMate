import { defaultObsControlPhrases, type ObsControlView } from '../../src/shared/obs-control';

export const obsControlView: ObsControlView = {
  epoch: 'test-epoch', revision: 1, enabled: true, voiceEnabled: true, androidEnabled: true,
  obsPort: 4455, passwordConfigured: true, phrases: { ...defaultObsControlPhrases },
  connection: 'connected', stream: 'stopped', busy: false, confirmation: null, lastOperation: null, error: null,
  publication: { lanEnabled: true, tailscaleEnabled: false, port: 3002, ready: true, registered: true,
    registrationId: '550e8400-e29b-41d4-a716-446655440000', revision: 1,
    endpoints: [{ network: 'lan', address: '192.168.1.25', port: 3002 }], warning: null },
};
