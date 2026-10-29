import type { SmartphoneDeviceView, SmartphoneNetwork } from '../../shared/smartphone';

const receiverLabels = { stopped: '受信OFF', starting: '受信を準備中', listening: '受信待ち', receiving: '受信中', reconnecting: '再接続待ち', error: '受信エラー・PCのポートとファイアウォールを確認' };

export function smartphoneReceiverState(device: SmartphoneDeviceView, network: SmartphoneNetwork, active: SmartphoneNetwork | null): string {
  const profiles = Object.values(device.profiles);
  if (profiles.some(profile => profile.receiver?.stopStatus === 'unknown')) return '旧受信の停止を確認できません・PCアプリを再起動して確認';
  if (profiles.some(profile => profile.receiver?.stopStatus === 'stopping')) return '旧受信の停止を確認中';
  const profile = device.profiles[network];
  if (!profile?.registered) return 'この経路は未登録';
  if (network !== active) return '受信OFF';
  if (profile.preparation?.video === 'error') return '要確認';
  if (profile.preparation?.video === 'preparing') return '準備中';
  return receiverLabels[profile.receiver?.state ?? 'starting'];
}
