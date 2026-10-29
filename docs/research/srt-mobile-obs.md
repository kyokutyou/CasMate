# 屋外スマホ映像を SRT で OBS に取り込むための調査

調査日: 2026-09-07  
対象: 配信者が Android スマホのカメラ・マイクを屋外から自宅の OBS へ送り、きゃすメイトは従来どおりコメント表示・読み上げを担う構成。これは実装仕様ではなく、採用判断用の調査ノートである。

## 結論

SRT は、携帯回線の揺れやパケット損失に対して再送とバッファで耐える、スマホから OBS への**映像寄与（contribution）**に適した方式である。スマホ側は Larix Broadcaster のような SRT 送信アプリ、OBS 側は Media Source で受信できる。

ただし、スマホから自宅 PC の OBS へ直接つなぐには、自宅回線で UDP ポートを外部公開する必要がある。CGNAT、二重 NAT、ポート開放不能な回線では直結できない。**ただし、スマホと OBS PC を同じ Tailscale tailnet に参加させる場合は、OBS PC の Tailscale IPv4 を宛先にして SRT caller から listener へ接続できるため、SRT 用 UDP ポートをインターネットへ公開する必要はない。** 屋外配信を確実に運用するなら、Tailscale、公開 IP を持つ中継サーバー、または別の VPN を用意する構成を検討する。

既に動作確認できた VDO.Ninja Android と比べると、SRT は OBS のブラウザソースを使わず、回線変動への設計上の耐性とビットレートの予測可能性を優先する選択肢である。一方、VDO.Ninja は受信 URL を OBS に入れるだけで NAT 越えを隠蔽しやすく、今回の「スマホだけで外配信」には開始までの手軽さで優位である。

## 確認できた事実

### SRT の性質

- SRT（Secure Reliable Transport）は UDP ベースのオープンソース転送技術で、インターネットのような予測しにくいネットワーク向けに、パケット損失の回復、ジッタ制御、帯域変動への適応、AES 暗号化を提供する。[Haivision: Introduction to SRT](https://doc.haivision.com/SRT/1.5.3/Haivision/introduction-to-srt)、[SRT Alliance: What is SRT?](https://srtalliance.org/)
- パケット損失の再送には時間が必要であるため、SRT の `latency` は損失・ジッタを吸収するバッファ時間でもある。バースト損失が SRT latency より長ければ、再送で回復できず映像の乱れが起こり得る。[Haivision: Packet Loss Rate](https://doc.haivision.com/SRT/1.5.3/Haivision/packet-loss-rate)
- この protocol latency は、カメラキャプチャ、エンコード、デコード、表示の処理時間を含まない。したがって `latency=1000000`（1 秒）を設定しても、実際のカメラから OBS までの遅延は 1 秒を超える。[Haivision: Source & Destination](https://doc.haivision.com/SRT/1.5.3/Haivision/source-destination)
- SRT は一方向の映像転送でも、制御と再送要求のため双方向 UDP 通信を継続する。Haivision は接続断後の自動復元を可能にする keep-alive/control 情報の交換を説明している。[Haivision: Source & Destination](https://doc.haivision.com/SRT/1.5.3/Haivision/source-destination)

### 接続モード

`caller` / `listener` は「映像を送る側／受ける側」と同義ではない。どちらの端点も caller または listener になれる。[Haivision: Source & Destination](https://doc.haivision.com/SRT/1.5.3/Haivision/source-destination)

| モード | 接続動作 | 今回の典型的な役割 |
| --- | --- | --- |
| `caller` | 相手の IP/ホストと UDP ポートへ接続を開始する。 | 外にあるスマホ。 |
| `listener` | 指定 UDP ポートで接続を待ち受ける。 | 自宅 OBS、または公開中継サーバー。 |
| `rendezvous` | 両端が同時に発信・待受を行う。 | 両端に外部から到達可能な UDP 経路を用意できる場合の選択肢。 |

定義と rendezvous のファイアウォール越えの位置付けは、[Haivision Gateway User's Guide](https://doc.haivision.com/__attachments/7667814/HMG%203.2%20User%27s%20Guide.pdf?inst-v=fc09627f-2f38-453c-bdc6-69c141bbb0ca) を参照。rendezvous はすべての NAT を自動的に越える保証ではない。SRT が双方向 UDP を必要とすることからも、片側または両側の NAT/ファイアウォール規則が通信を許可する必要がある。

### OBS での受信

OBS 公式ガイドによると、受信には **Media Source** または VLC Source を使う。Media Source の場合は「Local File」を外し、Input に SRT URL、Input Format に `mpegts` を入れる。送信アプリが caller なら、OBS 側は listener にする。[OBS: SRT Protocol Streaming Guide](https://obsproject.com/kb/srt-protocol-streaming-guide)

自宅 LAN 内での検証例（スマホと OBS が同じ Wi-Fi のとき）:

```text
# OBS / Media Source
Input: srt://0.0.0.0:10000?mode=listener&latency=1000000
Input Format: mpegts

# Larix Broadcaster / 接続先
srt://192.168.1.50:10000
mode: Caller
latency: 1000 ms
```

OBS は URL の query で SRT オプションを受け付け、`latency` の単位はマイクロ秒である。OBS は初期値 120 ms を示し、少なくとも RTT の 2.5 倍を推奨している。[OBS: SRT Protocol Streaming Guide](https://obsproject.com/kb/srt-protocol-streaming-guide)

受信の再接続で問題が出る場合、OBS 公式ガイドには `timeout=5000000`（マイクロ秒）の例がある。例: `srt://0.0.0.0:10000?mode=listener&latency=1000000&timeout=5000000`。[OBS: SRT Protocol Streaming Guide](https://obsproject.com/kb/srt-protocol-streaming-guide)

> 上記の IP・ポート・遅延値は説明用であり、利用者の環境に合わせて変える。特に `0.0.0.0` の表記を Media Source が受け付けない OBS バージョンでは、自宅 PC の LAN IP を使う。

### Android 送信アプリ（Larix Broadcaster の例）

- Larix Broadcaster はモバイルからの SRT の Caller（Push）、Listener、Rendezvous をサポートする。[Softvelum: SRT support](https://softvelum.com/srt/)
- Android 版は映像を H.264/AVC、対応端末では H.265/HEVC、音声を AAC でエンコードする、と公式が案内している。OBS 互換性を優先する初期設定は H.264/AVC + AAC が安全である。[Softvelum: Larix for Android](https://softvelum.com/larix/android/)
- Larix の接続設定には SRT mode、latency、最大帯域、passphrase、`pbkeylen`（16/24/32）、stream ID を設定できる。[Softvelum: Larix Grove](https://softvelum.com/larix/grove/)
- Larix は目標ビットレートでエンコードし、SRT は設定された latency の範囲でエラー回復を試みる。公式は、不安定な回線では Adaptive bitrate を有効にできるとしている。[Softvelum: FAQ](https://wp.softvelum.com/larix/faq/)

### 暗号化

- SRT は AES-128 / AES-256 を使える。暗号化を有効にする場合、送信・受信双方で同一の passphrase が必要で、Haivision の仕様では 10〜79 文字の UTF-8 printable character である。[Haivision: Encrypting SRT Streams](https://doc.haivision.com/SRT/1.5.3/Haivision/encrypting-srt-streams)
- passphrase は暗号鍵交換のためのものであり、認証そのものではない。受信側に passphrase を設定しただけで未暗号化ストリームを拒否するものではない、と Haivision は明記している。[Haivision: Encrypting SRT Streams](https://doc.haivision.com/SRT/1.5.3/Haivision/encrypting-srt-streams)

## 接続構成と NAT

### A. 同一 LAN のテスト

`スマホ（Caller） → Wi-Fi/LAN → OBS Media Source（Listener）`

ポート開放不要。まずこの構成で、映像・音声・解像度・遅延・OBS の音声ミキサーへの入力を確認できる。

### B. スマホから自宅 OBS へ直接送信

`屋外スマホ（Caller） → インターネット → 自宅ルーター UDP 転送 → OBS（Listener）`

**推奨手順（設計判断）**: 自宅ルーターの固定 LAN IP を OBS PC に割り当て、専用 UDP ポート（例: 10000）のみをその PC に転送する。スマホには自宅のグローバル IP または DDNS 名を設定し、OBS は listener とする。公開ポートを増やさず、配信ごとに SRT passphrase を更新する。

この構成が成立する前提は、自宅回線にグローバル IPv4 または外部到達可能な IPv6 があり、ルーターで UDP の受信を OBS PC まで転送できること。CGNAT、二重 NAT、事業者側の受信制限がある回線では成立しない。この部分は SRT の「caller が listener に接続する」定義と双方向 UDP の要件から導くネットワーク上の判断であり、個別 ISP の可否を保証するものではない。

### C. 公開中継サーバーを置く

`屋外スマホ（Caller） → 公開 IP の SRT 受信サーバー（Listener） → OBS`

**推奨（自宅でポート開放できない場合）**: 固定の公開 IP を持つ VPS または専用の SRT 対応中継サービスを listener として置く。スマホは外向き UDP でそこへ caller 接続する。OBS への後段は、(1) OBS が中継先に caller 接続して pull する、または (2) 中継側から OBS へ送るために VPN を張る、という二段に分ける。

中継が「スマホからの一つの URL で済む」一方、サーバーの運用、費用、アクセス制御、監視が増える。中継方式の製品・設定は別途選定が必要であり、SRT 単体は中継サーバーを提供しない。

### D. VPN で自宅ネットワークへ参加させる

`屋外スマホ（VPN） → VPN → 自宅 LAN の OBS（Listener）`

**推奨（公開ポートを避けたい場合）**: スマホと自宅側を同一の VPN に参加させ、VPN のアドレスへ caller 接続する。インターネットから OBS の UDP listener を直接公開しない。VPN の導入・常時接続・モバイル OS の省電力動作は別途検証する。

### E. Tailscale tailnet 経由で受信する

`屋外スマホ（Tailscale + SRT Caller） → Tailscale tailnet → OBS PC（Tailscale + SRT Listener）`

#### 確認できた事実

- Tailscale は tailnet 内の各デバイスに安定した専用 IP を割り当て、物理的な場所や接続回線が変わっても、その IP を使ってデバイス間のサービスへ接続できる。Tailscale 自体はサービスを提供するものではないため、OBS の SRT listener のような受信サービスは PC 側で別途起動している必要がある。[Tailscale: Connect to devices](https://tailscale.com/docs/how-to/connect-to-devices)、[Tailscale: IP addresses](https://tailscale.com/docs/concepts/ip-and-dns-addresses)
- SRT caller は指定した IP/ホストと UDP ポートへ接続を開始し、OBS は SRT URL を Media Source の Input に設定して listener として受信できる。[Haivision: Source & Destination](https://doc.haivision.com/SRT/1.5.3/Haivision/source-destination)、[OBS: SRT Protocol Streaming Guide](https://obsproject.com/kb/srt-protocol-streaming-guide)
- したがって、両端が同一 tailnet にあり、tailnet ポリシーと端末の受信設定が許可していれば、Larix などの SRT caller の宛先を **OBS PC の Tailscale IPv4**（通常 `100.x.y.z`）とする構成が成立する。これは、上記の Tailscale のデバイス間サービス接続と SRT の caller/listener 定義を組み合わせた判断である。自宅ルーターの SRT 用ポート転送は不要で、Tailscale IPv4 は公開インターネットには露出しない。[Tailscale: What are these 100.x.y.z addresses?](https://tailscale.com/docs/concepts/tailscale-ip-addresses)
- Tailscale は最初に NAT 越えを試み、成功すれば端末同士を UDP で直接接続する。失敗時は tailnet 内の Peer Relay、さらに DERP relay へフォールバックする。すべての経路は WireGuard によるエンドツーエンド暗号化だが、直接接続が一般に最も低遅延・高スループットである。[Tailscale: Connection types](https://tailscale.com/docs/reference/connection-types)
- DERP relay は直接経路の代替として接続性を提供するが、追加遅延があり、共有リレーの公平性のためスループット制限もある。映像ビットレートを継続して流す SRT では、DERP のまま本番運用するより、直接接続または必要に応じた Peer Relay を目標にするべきである。[Tailscale: Poor performance between tailnet devices](https://tailscale.com/docs/reference/troubleshooting/poor-performance-tailnet)、[Tailscale: Peer Relays](https://tailscale.com/docs/features/peer-relay)
- Tailscale の access control は deny-by-default で設定でき、Grants の `ip` はプロトコルとポート単位で許可できる。OBS PC では Tailscale の「Allow incoming connections」が有効であることも必要である。[Tailscale: Grants](https://tailscale.com/docs/features/access-control/grants)、[Tailscale: Manage client preferences](https://tailscale.com/docs/features/client/manage-preferences)
- Android の Tailscale はアプリ単位の split tunneling に対応する。Larix を除外すると Tailscale 宛通信が VPN を通らなくなるため、この構成では Larix を除外しない。利用には Tailscale Android v1.70 以降が必要である。[Tailscale: Android app-based split tunneling](https://tailscale.com/docs/features/client/android-app-split-tunneling)

#### 設定例（Tailscale を既に導入している場合）

```text
# OBS PC / Media Source
# PC の Tailscale IPv4 が 100.101.102.103 の例
Input: srt://100.101.102.103:10000?mode=listener&latency=1000000&timeout=5000000
Input Format: mpegts

# Larix Broadcaster / 接続先
srt://100.101.102.103:10000
mode: Caller
latency: 1000 ms
```

`100.101.102.103` は説明用の値である。実際には Tailscale の Machines 画面に表示される OBS PC の IPv4 を使う。OBS の SRT listener が特定の Tailscale IPv4 への bind を受け付けないバージョンでは、OBS 公式例どおり `0.0.0.0` で待受し、Windows Defender Firewall で **Tailscale インターフェース／スマホの Tailscale IP からの UDP 10000 のみ**を受信許可する。[OBS: SRT Protocol Streaming Guide](https://obsproject.com/kb/srt-protocol-streaming-guide)

#### 運用上の推奨（設計判断）

1. OBS PC を `tag:obs`、スマホを `tag:mobile-camera` のように識別し、tailnet の Grant はスマホから OBS PC の SRT 専用 UDP ポートだけを許可する。例: `src: ["tag:mobile-camera"]`、`dst: ["tag:obs"]`、`ip: ["udp:10000"]`。同じ tailnet の他端末を無条件に許可しない。
2. PC 側の Tailscale で「Allow incoming connections」を有効にし、Windows Defender Firewall の受信規則も上記ポート・Tailscale 側に限定する。SRT URL を `0.0.0.0` で待ち受ける場合、Windows 側の絞り込みは特に重要である。
3. SRT の AES passphrase も設定する。Tailscale の WireGuard 暗号化と重ねて防御でき、誤った tailnet ポリシーや端末管理時の影響を小さくできる。ただし SRT passphrase はアクセス制御の代替ではない。
4. 本番前に、映像を実際に送ってから OBS PC で `tailscale status` を確認する。`direct` が理想で、`relay`（DERP）が継続する場合は、回線・UDP 制限・実効ビットレートを現地で試験する。Tailscale は `tailscale status` と `tailscale ping` で経路種別を確認する方法を案内している。[Tailscale: Connection types](https://tailscale.com/docs/reference/connection-types)

## 運用の注意点と初期値の提案

以下は公式に固定値として定められたものではなく、屋外配信を安全に始めるための**推奨値**である。

| 項目 | 初期値 | ねらい |
| --- | --- | --- |
| 映像 codec | H.264/AVC | OBS との互換性を優先。 |
| 音声 codec | AAC | Larix の SRT 出力で使える標準的な組合せ。 |
| 解像度 / fps | 720p / 30 fps | 携帯回線と発熱への初期負荷を抑える。 |
| 映像ビットレート | 2〜3 Mbps から実測 | Larix の目安では 720p は 2 Mbps。利用回線の実効上り帯域に余裕を持たせる。 |
| SRT latency | 1,000 ms から開始 | 再送の余地を確保し、必要なら 500〜2,000 ms の範囲で現地試験する。 |
| 暗号化 | AES-256 + ランダムな passphrase | 公開インターネット経由の映像・音声を保護する。 |
| Adaptive bitrate | 有効にして比較試験 | 回線低下時の継続を優先する場合。画質変動とのトレードオフを確認する。 |

SRT は無制限に回復できるわけではない。回線がビットレートを継続的に下回る、または損失の連続時間が latency を超える場合は、映像の破綻・遅延増大・切断が起こり得る。再接続が自動で起きても、OBS の Media Source が映像・音声を再捕捉するか、実機で「地下・駅・回線切替・画面ロック・Bluetooth マイク」を含めて試験する。

また、スマホのマイク音声と、きゃすメイトの読み上げ音声を物理的に近いスピーカーで鳴らすと、配信マイクに読み上げが回り込む。イヤホン利用、読み上げ専用端末、または音声経路の分離を運用で決める必要がある。

## VDO.Ninja Android との比較

| 観点 | SRT + Larix + OBS Media Source | VDO.Ninja Android + OBS Browser Source |
| --- | --- | --- |
| OBS への取り込み | MPEG-TS の Media Source。ブラウザソース不要。 | WebRTC の browser source。公式は view link を入れる方式を案内。 |
| 屋外回線の損失 | latency バッファ内で再送し回復する設計。代償は遅延。 | WebRTC のリアルタイム設計。実際の品質・経路は接続状況に依存。 |
| 自宅へ直結 | UDP 受信ポートの公開または VPN が必要。 | P2P/WebRTC が基本で、シグナリングと NAT 越えの仕組みを利用できる。 |
| 開始の手軽さ | URL、モード、port、暗号化、ネットワーク構成の理解が必要。 | Android アプリで送信開始、OBS に view link を設定。 |
| 画面ロック | 送信アプリごとの実機検証が必要。 | 今回、VDO.Ninja Android でロック中の映像・音声送信を確認済み。公式 release notes でも Android 14+ の background camera support を案内。 |
| 向く用途 | 安定した固定受信点と運用を作り、回線揺れへの耐性を優先する外配信。 | 1 台スマホで素早く開始し、ネットワーク設定の負担を減らす外配信。 |

VDO.Ninja の公式は、WebRTC/P2P を利用し view link を OBS の browser source に置く構成を案内している。[VDO.Ninja basics](https://docs.vdo.ninja/getting-started/vdo.ninja-basics)、[How does it work](https://docs.vdo.ninja/readme/how-does-it-work)。Android アプリの background camera support は [公式リリースノート](https://github.com/steveseguin/vdo.ninja/releases) に記載がある。

## 採用判断

**現時点の推奨**: VDO.Ninja Android の実機試験が良好なら、まずはそれを標準手順として採用し、きゃすメイトに追加実装は行わない。SRT は「自宅側に公開受信点または VPN を準備できる」「回線変動時に多少の遅延を許容して映像継続性を優先したい」配信者向けの上級オプションとして扱う。

SRT を正式な利用手順または製品連携として採用する前に、次を実測する。

1. 同一 LAN と携帯回線の両方で 30 分以上、映像・AAC 音声・OBS 再接続を確認する。
2. 720p30 / 2 Mbps、3 Mbps と latency 500 / 1,000 / 2,000 ms を比較し、遅延・映像破綻・発熱・電池消費を記録する。
3. 自宅回線で UDP ポート公開の可否を確認する。不可なら VPN または中継サーバー案へ進む。
4. 暗号化した場合としない場合で、OBS と送信アプリの相互接続・再接続を確認する。
