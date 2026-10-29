# インターネット越しスマホ音声再生の方式調査

調査日: 2026-08-30  
対象: Windows 11上のきゃすメイトから、別ネットワークのAndroid端末へコメント一覧とM4A読み上げ音声を届ける方式。これは採用判断用の調査メモであり、正式仕様ではない。

## 結論

第一候補は、**各配信者が自分のWindows PCとAndroidへTailscaleを導入し、きゃすメイトのスマホ向け読取専用面をTailscaleネットワークへ公開する方式**である。

この方式では、きゃすメイト開発者がクラウドサーバー、ドメイン、TURN、帯域を契約しない。PCとAndroidは直接接続を優先し、直接接続できないネットワークではTailscaleのDERPリレーへ自動的にフォールバックする。[Tailscaleの接続方式](https://tailscale.com/docs/reference/device-connectivity)、[DERP公式説明](https://tailscale.com/docs/reference/derp-servers)

現行実装は既にコメント一覧、WebSocket通知、M4A取得、1台分の独立キューを持つため、クラウドへ音声処理を移す必要はない。主な変更は、Tailscaleが使う `100.64.0.0/10` のアダプターをインターネット接続用の公開候補として認識し、そのURLとQRコードを表示することである。Tailscaleは端末へこのCGNAT範囲のIPアドレスを割り当てる。[Tailscale予約IPアドレス](https://tailscale.com/docs/reference/reserved-ip-addresses)

ただし、Tailscaleの無料Personalプランは2026年8月時点で「非商用利用向け」である。収益化配信などが商用利用に当たる配信者は、本人が適切な有料プランを契約する必要がある可能性がある。開発者負担はゼロのままだが、全配信者の無料利用は保証できない。[Tailscale料金ページ](https://tailscale.com/pricing)、[Tailscale利用規約](https://tailscale.com/terms)

## 前提から分かること

現行のスマホ音声は、VOICEVOXのWAVをPCでAAC-LC・M4A・モノラルへ変換し、既定32 kbpsで1件ずつ送る。M4AはPCメモリだけに保持し、WebSocketで準備完了を通知してAndroidブラウザがHTTP取得する。[現行スマホ音声仕様](../features/mobile-speech.md)

したがって必要なのは、次の既存経路をインターネット越しに到達可能にすることだけである。

- `GET /comments`
- `GET /mobile/bootstrap`
- `WS /mobile/ws`
- `GET /mobile/audio/{audioId}.m4a`

音声が合計60分再生された場合、32 kbpsの音声本体は概算で約14.4 MBである。映像配信に比べて小さく、Tailscaleの直接接続またはリレーを利用する用途と相性がよい。ただしWebSocket、HTTP、M4Aコンテナの付加分は別途発生する。

## 推奨構成: Tailscaleのプライベート接続

### 利用者の流れ

1. 配信者が自分のGoogle等のアカウントでTailscaleを開始する。
2. Windows PCへTailscaleを導入してログインする。
3. Androidへ公式Tailscaleアプリを導入し、同じTailscaleネットワークへ追加する。公式AndroidクライアントはAndroid 8.0以降に対応する。[Tailscale Android導入手順](https://tailscale.com/docs/install/android)
4. きゃすメイトで「インターネット接続」をオンにする。
5. きゃすメイトがTailscaleアダプターの `100.x.y.z` を検出し、`http://100.x.y.z:{port}/comments` とQRコードを表示する。
6. AndroidでTailscaleをオンにし、ChromeからそのURLを開いて従来どおり「音声を開始」を押す。

Tailscale IPは物理ネットワークが変わっても端末に対して安定しているため、毎回URLを作り直す必要がない。[TailscaleのIP割当](https://tailscale.com/docs/concepts/ip-and-dns-addresses)

### きゃすメイト側の変更範囲

- 現在のRFC 1918だけの判定とは別に、Tailscaleの `100.64.0.0/10` を明示的な「インターネット接続」候補として扱う。
- LAN公開とTailscale公開を別設定にする。TailscaleがないPCではインターネット接続を利用不可として案内する。
- アダプター名だけに依存せず、アドレス範囲と利用可能状態を確認する。
- 既存のスマホ向け許可経路だけを公開し、管理RESTやOBS面は公開しない。セキュリティを優先しない条件でも、既存境界を崩さない方が変更量と事故範囲を小さくできる。
- URL、QRコード、待受失敗をLAN用と区別して表示する。
- WindowsファイアウォールでTailscaleアダプターから設定ポートへ到達できることを実機確認する。
- Wi-Fi PCとモバイルデータAndroid、テザリング配下PCと別回線Android、直接接続、DERP経由、切断・再接続をテストする。

### 長所

- 開発者がサーバー、ドメイン、帯域料金を負担しない。
- 配信者ごとにネットワークが分離され、不特定多数の配信者が増えても開発者側の共用サーバー容量に依存しない。
- ポート転送や固定グローバルIPを要求しない。
- NAT越えに失敗してもDERPリレーへフォールバックするため、直接P2Pだけの実装より成立率が高い。[Tailscale接続タイプ](https://tailscale.com/docs/reference/connection-types)
- Android専用アプリを新規開発しなくても、現行ブラウザ画面を再利用できる。

### 短所

- PCとAndroidの双方へTailscaleの導入とログインが必要である。
- Androidで別のVPNを常用している配信者は切替が必要になる場合がある。
- Tailscaleという外部サービスの無料枠、規約、稼働に依存する。
- Personalプランは非商用用途向けであり、商用配信者の無料利用を前提にできない。[Tailscale料金ページ](https://tailscale.com/pricing)
- HTTP URLのままでもTailscale経路自体は暗号化されるが、ブラウザ上はHTTPSとして扱われない。今回の機能は通常の音声再生なので直ちに問題になりにくいが、将来Secure Context必須APIを使う場合は制約になる。

## 派生案: Tailscale Serve

Tailscale Serveは、PCの `127.0.0.1` にあるHTTPサーバーをTailscaleネットワーク内だけへHTTPSでリバースプロキシできる。自動発行された証明書と安定した `*.ts.net` 名を使える。[Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)、[Serveの例](https://tailscale.com/docs/reference/examples/serve)

この方式なら、きゃすメイトがTailscale IPへ直接バインドせず、スマホ専用のループバック待受をServeへ渡せる。HTTPSと読みやすい安定URLを得られる一方、初回にMagicDNSとHTTPSの有効化が必要で、CLI連携とTailscale設定の管理が増える。[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

最初の実証では直接Tailscale IP方式を採り、HTTPやファイアウォールが実運用上の問題になった場合にServeへ移すのが妥当である。Serveを使う場合、管理面全体ではなくスマホ専用のループバック待受だけをプロキシ対象にする。

## 公開URL案: Tailscale Funnel

Tailscale Funnelは、AndroidへTailscaleを入れず、PC上のローカルサービスを誰でもアクセスできるHTTPS URLとして公開できる。[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)、[Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel)

利用者体験は良いが、次の理由で第一候補にはしない。

- Funnelは公開インターネット経由で、通信は常にTailscale側の中継と非公開の帯域制限に依存する。
- MagicDNS、HTTPS、ポリシー属性の有効化が必要である。
- 利用できる公開ポートは443、8443、10000に限られる。
- Tailscaleプランの商用・非商用条件を配信者ごとに確認する必要がある。
- URLを知る第三者もアクセスできる。今回はセキュリティを要件外にできるが、コメント内容と音声が公開される事実はUIに明記する必要がある。

Funnelを採るなら、Tailscale Serveと同様に管理面を含まないスマホ専用ループバック待受を用意し、その待受だけを公開する。

## 他候補の比較

| 方式 | 開発者の継続費 | 配信者の準備 | NAT/CGNATへの強さ | 判定 |
| --- | ---: | --- | --- | --- |
| Tailscaleプライベート接続 | 0円 | PC・Androidへ導入、ログイン | 強い。直接不可時はDERP | **第一候補** |
| Tailscale Funnel | 0円 | PCへ導入、初回設定 | 強い。公開中継 | 利便性重視の第二候補 |
| ZeroTier | 0円 | PC・Androidへ導入、ネットワーク参加承認 | 強い | 代替候補 |
| Cloudflare Quick Tunnel | 0円 | PC側トンネル起動 | 強い | 本番不可 |
| ルーターのポート転送 | 0円 | ルーター設定、URL管理 | 弱い | 上級者向け補助 |
| 独自WebRTC | サーバー次第 | 専用クライアント等 | TURNなしでは弱い | 条件不適合 |
| 開発者運営のクラウド中継 | 増加時に有料 | 少ない | 強い | 条件不適合 |

### ZeroTier

ZeroTierも世界中で使える仮想LANを作る方式で、技術的には同じ公開面を再利用できる。2026年8月時点のPersonalは無料、1ネットワーク、10台だが、Personal-use licenseである。[ZeroTier料金](https://www.zerotier.com/pricing.md)、[ZeroTier開始手順](https://docs.zerotier.com/start/)

2台だけの本用途には台数上限は十分である。ただしTailscaleと同様、商用配信者の無料利用を保証できない。最初から複数VPN製品を正式対応すると検出、案内、実機試験が増えるため、Tailscaleで成立確認した後の代替アダプターとして扱う。

### Cloudflare Tunnel

Quick Tunnelはアカウントやドメインなしでランダムな `trycloudflare.com` URLを発行し、WebSocketもCloudflare Tunnelで利用できる。[Quick Tunnel公式説明](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)、[Tunnel FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/)

しかし公式資料がQuick Tunnelをテスト・開発専用とし、SLAなし、同時200リクエスト上限としているため、配布アプリの正式機能にはできない。Named Tunnelは本番利用できるが、各配信者のCloudflareアカウントと通常は管理下ドメインが必要になり、「すぐ同じように使う」要件から外れる。

### ポート転送とIPv6直接公開

配信者のルーターからPCへポート転送すれば第三者サービス費は不要である。しかしルーターごとに手順が異なり、固定URL、Windowsファイアウォール、二重NAT、ISPのCGNAT、テザリング環境で成立しない場合がある。標準方式にはせず、自己解決できる利用者向けの非保証手順に留める。

IPv6直接公開も中継費を避けられるが、PC側とAndroid側の双方にIPv6到達性が必要で、アドレス表示、Windowsファイアウォール、URL表記、ネットワーク変更対応を追加する。全利用者向けの単独解にはならない。

### 独自WebRTC

WebRTC DataChannel等でP2P転送する場合も、接続候補を交換するシグナリング経路が別途必要である。さらに公式WebRTC資料は、直接ソケット接続できない環境で多くのアプリがTURNリレーを必要とすると説明している。[WebRTC Peer Connections](https://webrtc.org/getting-started/peer-connections)、[WebRTC TURN server](https://webrtc.org/getting-started/turn-server)

TURNを開発者が運営すれば金銭負担が生じ、無料TURNだけに依存すれば不特定多数利用時の容量と継続性を保証できない。Tailscale等が既に解決しているNAT越えとリレーを再実装する利点はない。

## Android専用アプリは必要か

**インターネット越しに現在と同じ、画面を開いている間だけ再生する要件なら不要**である。Tailscale AndroidアプリとChromeで現行画面を使える。

Android専用アプリを作る価値が出るのは、画面ロック中・他アプリ表示中・Bluetoothボタンでの継続再生を正式要件にする場合である。Android公式は、バックグラウンド音声を `MediaSessionService` とmedia playback種別のフォアグラウンドサービスへ置く構成を案内している。[Android Media3バックグラウンド再生](https://developer.android.com/media/media3/session/background-playback)

専用アプリを作る場合もVPN機能を内製せず、Tailscaleアプリと併用し、既存のbootstrap・WebSocket・M4A契約をネイティブクライアントから利用する。APKを直接配布すればストア費用は避けられるが、利用者に提供元不明アプリの許可と手動更新を求める。Google Playで一般配布する場合は、別途ストア登録と継続的なポリシー対応が必要になる。

## 「無料」の現実的な境界

次の三条件を同時に永続保証することはできない。

1. 開発者が一切払わない。
2. 商用を含む不特定多数の配信者も一切払わない。
3. あらゆるNAT環境で高い接続成功率と中継品質を保証する。

直接P2Pだけなら1と2を満たせるが3を満たせない。TURN、DERP、公開トンネル、クラウド中継のどれかを使えば3へ近づくが、その運営費は事業者、開発者、または配信者の誰かが負担する。したがって本プロジェクトでは、**開発者は共用インフラを持たず、各配信者が自分の外部接続アカウントとプランを選ぶ**ことを金銭面の境界とするのが現実的である。

## 推奨する段階的な進め方

### 第1段階: 小さな実証

- 正式仕様を変える前に、Tailscale導入済みPCの `100.64.0.0/10` アドレスへ既存スマホサーバーを一時的に待ち受けさせる。
- AndroidをWi-Fiから切り、4G/5G経由でコメント一覧、WebSocket再接続、連続M4A再生を確認する。
- Tailscaleの接続がdirectかDERPかを確認し、両方で試す。
- Windowsファイアウォール、PCスリープ、Tailscale切断・再接続を確認する。

### 第2段階: 正式採用

- `OUT_OF_SCOPE.md` からインターネット越し公開だけを正式採用へ移す。
- `docs/features/mobile-speech.md` がインターネット接続の挙動、設定、URL、再接続、障害分離、テストを所有する。
- `docs/features/local-application.md` は起動・終了と外部アダプター待受の関係だけを更新する。
- ADR 0003を無理に拡張せず、外部VPNアダプター公開と第三者接続サービス依存を扱う新ADRを作る。
- `SPEC.md` の概要と機能説明を更新する。同じ正式仕様を複数文書へ重複させない。

### 第3段階: 必要な場合だけAndroidアプリ

- ブラウザ前面再生で運用できる間は作らない。
- 画面ロック中の継続再生が正式要求になった時点で、Kotlin + Media3の小さな受信・再生アプリを別成果物として設計する。
- サーバー契約は変えず、既存のM4Aキュー契約を再利用する。

## 採用判断

- **まずTailscaleプライベート接続で実機PoCを行う。** 現行アーキテクチャをほぼそのまま使え、開発者の固定費と従量費が発生しない。
- Android専用アプリはまだ作らない。現在のブラウザ要件には不要である。
- AndroidへTailscaleを入れたくないという要求が強い場合のみ、Tailscale Funnelを第二候補としてPoCする。
- 「収益化配信者も外部サービス費ゼロ」を正式条件にする場合、Tailscale PersonalやZeroTier Personalへ依存する案は採用せず、接続成功率を保証しない直接公開方式か、費用条件そのものを再検討する。
