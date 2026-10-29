import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ManagementShell } from '../../src/renderer/components/ManagementShell';
import { SmartphonePanel } from '../../src/renderer/components/SmartphonePanel';
import { smartphoneDirectView, smartphoneMobileState } from './smartphone-view';
import directInvitation from './direct-invitation-v13.json';
import type { SmartphoneConfiguration, SmartphoneNetwork, SmartphoneView } from '../../src/shared/smartphone';
import type { MobileSpeechState } from '../../src/shared/types';
import '../../src/renderer/styles.css';
import { managementThemes, managementThemeStyle } from '../../src/renderer/management-themes';
import { managementTextSizeStyle } from '../../src/renderer/management-text-sizes';

const route = new URLSearchParams(location.search).get('network');
const network: SmartphoneNetwork = route === 'direct' ? 'direct' : route === 'tailscale' ? 'tailscale' : 'lan';
const initial = structuredClone(smartphoneDirectView);
initial.settings.activeNetwork = network;
initial.networks.lan.videoReady = true;
initial.networks.tailscale = { ...initial.networks.lan, address: '100.90.10.2', commentsUrl: 'http://100.90.10.2:3000/comments' };
initial.devices[0].profiles.tailscale.registered = true;

type HarnessState = { view: SmartphoneView; mobile: MobileSpeechState; saveError: string; notice?: { message: string; tone: 'success' | 'error' } };
let state: HarnessState = { view: initial, mobile: { ...smartphoneMobileState, urls: [
  ...smartphoneMobileState.urls, { kind: 'tailscale', url: initial.networks.tailscale.commentsUrl!, available: true },
] }, saveError: '' };
let pending: { resolve(): void; reject(error: Error): void } | undefined;
declare global {
  interface Window {
    smartphoneHarness: { update(value: Partial<HarnessState>): void; snapshot(): HarnessState; complete(error?: string): void; pending(): boolean;
      themes: Array<{ id: string; style: ReturnType<typeof managementThemeStyle> }>;
      textSizes: Record<'medium' | 'large', ReturnType<typeof managementTextSizeStyle>> };
  }
}

// The fixture has no backend, real credentials, camera, OBS control, or network preparation.
function Harness() {
  const [current, setCurrent] = useState(state);
  const update = (value: Partial<HarnessState>) => {
    flushSync(() => { state = { ...state, ...value }; setCurrent(state); });
  };
  useLayoutEffect(() => {
    window.smartphoneHarness = { update, snapshot: () => structuredClone(state), pending: () => Boolean(pending),
      themes: managementThemes.map(theme => ({ id: theme.id, style: managementThemeStyle(theme.id) })),
      textSizes: { medium: managementTextSizeStyle('medium'), large: managementTextSizeStyle('large') },
      complete(error) { const operation = pending; pending = undefined;
        if (error) operation?.reject(new Error(error)); else operation?.resolve(); } };
  });
  const configure = async (patch: SmartphoneConfiguration) => {
    await new Promise<void>((resolve, reject) => { pending = { resolve, reject }; });
    update({ view: { ...state.view, settings: { ...state.view.settings,
      ...(patch.activeNetwork !== undefined ? { activeNetwork: patch.activeNetwork } : {}),
      ...(patch.network && patch.statusPort ? { statusPorts: { ...state.view.settings.statusPorts, [patch.network]: patch.statusPort } } : {}),
      ...(patch.direct ? { direct: { mode: 'auto', interfaceId: null, manualEndpoints: [], manualSrtEndpoints: [], ...state.view.settings.direct, ...patch.direct } } : {}),
    } } });
  };
  return <ManagementShell connected pcStatus={null} warnings={[]} activities={[]} home={null} windows={null} operationNotice={current.notice}>
    <SmartphonePanel view={current.view} mobile={current.mobile} audioSettings={{ lanEnabled: network === 'lan', tailscaleEnabled: network === 'tailscale', bitrateKbps: 32 }}
      saveError={current.saveError} changeAudio={() => {}} configure={configure} deviceAction={async () => {}}
      invitation={async kind => kind === 'direct' ? { ...directInvitation, type: 'casmate.outdoor', version: 13, network: 'direct',
        pcKey: { ...directInvitation.pcKey, algorithm: 'sha256-spki' }, endpoints: directInvitation.endpoints.map(endpoint => ({ ...endpoint, family: endpoint.family === 'ipv4' ? 'ipv4' : 'ipv6' })) } : { type: 'casmate.outdoor', version: 11,
        network: kind, pcId: '22222222-2222-4222-8222-222222222222', comments: { url: state.view.networks[kind].commentsUrl! }, registrationPort: 3001, token: 'a'.repeat(64) }}
      obsInput={async () => 'udp://127.0.0.1:10001'} onSuccess={message => update({ notice: { message, tone: 'success' } })}
      listLanAdapters={async () => [{ id: 'indoor', name: 'asus USBアダプタ', description: 'ASIX USB to Gigabit Ethernet Family Adapter', preferred: false, addresses: [{ family: 'ipv4', address: '192.168.10.105' }] }]}
      directAction={async () => {}} listAdapters={async () => [{ id: '{de98a742-172b-470f-8aa3-8d2dfc560a21}', name: 'イーサネット',
        description: '描画確認用アダプター', addresses: [{ family: 'ipv4', address: '192.168.1.2' }], preferred: true }]} />
  </ManagementShell>;
}
flushSync(() => createRoot(document.getElementById('root')!).render(<Harness />));
