import type { TailscalePublicationStatus } from '../shared/types';

export function tailscaleStatusMessage(status: TailscalePublicationStatus): string {
  return {
    disabled: 'Tailscale公開はオフです。',
    ready: 'Tailscale公開を利用できます。',
    notInstalled: 'Tailscaleがインストールされていません。公式Windows版を導入してください。',
    serviceStopped: 'Tailscaleサービスが停止しています。公式クライアントを起動してください。',
    loginRequired: 'TailscaleへのログインまたはTailscaleネットワークへの接続が必要です。',
    ipUnavailable: 'Tailscale IPv4を確認できません。接続状態とクライアントの更新を確認してください。',
    listenFailed: 'Tailscale IPv4で待ち受けを開始できませんでした。Windowsファイアウォールと受信接続を確認してください。',
  }[status];
}
