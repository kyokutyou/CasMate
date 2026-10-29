---
status: accepted
---

# スマホ音声再生のインターネット経路にTailscaleプライベート接続を採用する

2026-10-04追記: [ADR 0020](./0020-adopt-smartphone-direct-connection.md)で外部経路に直接接続を追加した。利用者管理のTailscale・開発者が共用中継を運営しない判断は維持する。LAN／Tailscale同時公開の記述はADR 0017、直接接続を含む現行の排他的選択はスマホ連携仕様に従う。

v0.3.0では、Windows PCと異なるネットワークのAndroidからスマホコメント画面と読み上げ音声を利用する経路として、配信者自身が管理するTailscaleプライベート接続を採用する。きゃすメイト開発者は共用クラウド中継、ドメイン、TURNサーバー、通信帯域を運営しない。

Tailscaleは端末へ `100.64.0.0/10` のIPv4を割り当て、端末間の直接接続を優先し、直接接続できない場合はDERPリレーへフォールバックする。[TailscaleのIPアドレス](https://tailscale.com/docs/concepts/tailscale-ip-addresses)、[Tailscaleの接続方式](https://tailscale.com/docs/reference/device-connectivity)

## Considered Options

- 開発者がクラウド中継を運営する方式
- WebRTCで直接接続し、シグナリングとTURNを別途用意する方式
- 配信者のルーターでポート転送する方式
- Cloudflare Tunnelで公開URLを作る方式
- Tailscale Funnelで公開URLを作る方式
- 配信者自身のTailscaleプライベート接続を使う方式

開発者運営のクラウド中継は、不特定多数の配信者が利用すると固定費または従量費が発生する。WebRTCはシグナリング経路が別途必要で、直接接続できない環境の成立率を維持するにはTURNリレーが必要となる。[WebRTCの接続確立](https://webrtc.org/getting-started/peer-connections)、[WebRTC TURN](https://webrtc.org/getting-started/turn-server)

ポート転送は開発者費用を発生させないが、ルーターごとに設定が異なり、二重NAT、CGNAT、テザリングでは利用できない場合がある。Cloudflare Quick Tunnelは公式にテスト・開発用で、SLAを持たないため正式機能に採用しない。[Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

Tailscale FunnelはAndroidへTailscaleを導入せず公開HTTPS URLを提供できる一方、公開インターネット経由となり、非設定可能な帯域制限と特定ポート制限を持つ。[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) v0.3.0では、直接接続を優先でき、既存のスマホ向けHTTP契約をそのまま利用できるプライベート接続を採用する。

## Decision

- 配信者は公式Tailscale Windowsクライアントと公式Tailscale Androidアプリを自分で導入し、同じtailnetへ接続する。
- きゃすメイトは公式WindowsクライアントのCLIからローカルTailscale IPv4を取得し、`100.64.0.0/10` 内で現在のネットワークインターフェースにも存在する場合だけ、そのIPv4へスマホ向け読取専用面を公開する。
- Tailscale公開はLAN公開と独立した既定オフの設定とし、両方を同時に利用できる。
- Tailscale公開で提供する入口、データ、Host検証、音声キューはLAN公開と同じとし、管理面を公開しない。
- URLにはTailscale IPv4を使用し、MagicDNS、Tailscale Serve、Tailscale Funnel、追加トークンを使用しない。
- きゃすメイトはTailscaleを同梱、導入、ログイン、接続、設定、更新、契約管理しない。

## Consequences

- 開発者はスマホ音声再生のための共用サーバー、ドメイン、通信帯域を契約しない。
- 配信者数が増えても、開発者側の共用中継容量を増やす必要がない。
- Tailscaleが直接接続できない場合、通信はTailscaleのDERPリレーとサービス稼働へ依存する。
- 配信者はPCとAndroidの両方へTailscaleを導入し、接続状態を維持する必要がある。公式Tailscale AndroidアプリはAndroid 8.0以降を対象とする。[Tailscale Android導入](https://tailscale.com/docs/install/android)
- Tailscale Personalプランは非商用用途向けである。収益化配信などを含む利用形態に適した契約の確認と費用は配信者が負担し、きゃすメイトは契約プランを判定しない。[Tailscale料金](https://tailscale.com/pricing)
- Tailscaleの導入、サービス、ログイン、IPv4取得、待受の失敗はTailscale公開だけを利用不可にし、LAN公開、PC読み上げ、コメント取得、OBSを継続する。
- Androidクライアントとバックグラウンド再生の構成は [ADR 0010](./0010-adopt-native-android-client.md) が所有する。本判断はAndroidクライアントでもTailscale IPv4へのプライベート接続として維持する。
- 公開インターネットURLと他VPN製品は本判断に含めない。

具体的な公開条件、画面、設定、障害処理、テストは [スマホ音声再生仕様](../features/mobile-speech.md) を参照する。
