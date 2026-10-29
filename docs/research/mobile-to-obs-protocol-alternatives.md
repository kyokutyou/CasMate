# Android から Tailscale 経由で OBS に映像・音声を送る方式の比較（SRT / RTMP 以外）

調査日: 2026-09-07  
対象: 将来のきゃすメイト Android がカメラ・マイクを取得し、同一 tailnet の Windows OBS へ直接送る構成。公開インターネットへの受信ポート公開、クラウド中継、きゃすメイト PC による映像中継は前提にしない。これは実装仕様ではなく、採用判断用の調査ノートである。

## 結論

**この条件で SRT を明確に上回る方式は見つからなかった。** 代替として唯一、同じ「直接 OBS 受信」を満たし、屋外回線の損失回復を持つのは **RIST Main Profile** である。ただし Android の送信実装・相互接続の検証コストが SRT より高く、OBS の受信も Main Profile に制約される。従って、SRT を第一候補のままとし、RIST は比較実験を行う第二候補に留める。

**WebRTC は低遅延の有力技術だが、標準 OBS は Android からの WebRTC/WHIP 入力を直接受ける機能を提供していない。** WHIP は「送信者から WHIP *media server* へ」の ingest 規格であり、OBS の公式 WHIP ガイドも OBS を送信側として説明している。採用には PC 上の WebRTC media server または OBS プラグインが別途必要になる。[OBS: WHIP Streaming Guide](https://obsproject.com/kb/whip-streaming-guide)、[IETF RFC 9725, §3](https://datatracker.ietf.org/doc/html/rfc9725#section-3)

## 前提として確認できたこと

- Tailscale は端末間通信を WireGuard でエンドツーエンド暗号化し、直接 UDP 経路が作れない場合は relay にフォールバックする。映像では `direct` を目標とし、DERP relay 継続時は遅延・帯域を実測する。[Tailscale: Connection types](https://tailscale.com/docs/reference/connection-types)
- Tailscale は転送プロトコルや映像の再送を提供しない。したがって、Tailscale を載せても UDP/RTP/MPEG-TS の損失回復性は増えず、SRT/RIST/WebRTC のような上位方式の性質がそのまま重要になる。
- Android は `MediaCodecList` / `MediaCodecInfo` により利用可能なエンコーダー、対応能力、ハードウェア加速の有無を端末実行時に調べられる。`isHardwareAccelerated()` は API 29 以降で利用でき、端末ごとに H.264/HEVC 等の可否と性能を確認してから選択する。[Android: Media codecs](https://developer.android.com/media/optimize/performance/codec)

## 比較表

| 方式 | OBS が標準機能で直接受信 | Android ネイティブ送信の実現性 | 損失・再接続 | 暗号化 | Tailscale 上の適性 | 判断 |
| --- | --- | --- | --- | --- | --- | --- |
| **RIST Main Profile** | **可**。Media Source で Main Profile のみ受信。 | MediaCodec と RIST 対応ライブラリを組み合わせる必要がある。Android 標準 API に RIST はない。 | ARQ とバッファを持つ。OBS 設定では `bandwidth` が再送上限、`buffer` がバッファ。 | Main Profile は DTLS / PSK を規定。 | 高い。Tailscale 暗号化に加え、UDP 一ポートに閉じられる。 | **第2候補** |
| **WebRTC + WHIP** | **不可**（標準 OBS に Android→OBS 用の WebRTC/WHIP input はない）。 | WebRTC ネイティブ実装・ICE/DTLS/SRTP・WHIP HTTP セッション処理が必要。 | WebRTC の輻輳制御・フィードバックを使えるが、回線復旧時のセッション管理も必要。 | DTLS セッション後の WebRTC media。 | direct なら良いが、Tailscale の価値と ICE/STUN/TURN の仕組みが重複しやすい。 | **中継を許す場合のみ検討** |
| **RTP/RTSP** | 公式に専用の受信手順・対応保証なし。FFmpeg 系入力に依存するため、正式経路としては不可扱い。 | MediaCodec + H.264/AAC packetize、SDP、RTSP server/client 状態管理が必要。 | 基本 RTP は欠損を計測できても、標準 RTP 自体に再送を規定しない。 | SRTP 等を別途設計。 | Tailscale で到達性・暗号化は補えるが、方式自体の回復性は増えない。 | 不採用 |
| **MPEG-TS over UDP** | FFmpeg 系の Media Source による入力は可能だが、OBS の公式受信ガイドは SRT/RIST のみ。 | MediaCodec + MPEG-TS mux + UDP 送信で構成可能。 | UDP は到達保証・再送をしない。切断復旧をアプリ側で設計。 | UDP/MPEG-TS 単体ではなし。 | LAN 向けの単純さだけが利点。屋外モバイル回線には弱い。 | 不採用 |
| **NDI / NDI HX** | **不可**。NDI 自身が公式 OBS プラグインはないと明記。非公式プラグインが必要。 | SDK 統合・配布条件・Android の discovery 対応が必要。HX のエンコードはアプリ側で担う。 | 製品 SDK の挙動に依存。SRT/RIST のような公開仕様の ARQ 設計ではない。 | SDK / 製品構成に依存。 | Tailnet は multicast discovery を通常は運ばないため、IP 指定など別設定が必要。 | 不採用 |

「直接受信」は、OBS の標準インストールだけで受信ソースを作れるかで判定した。OBS プラグイン、PC 常駐のメディアサーバー、クラウドサービスが必要なものは直接受信ではない。

## 1. RIST（検討価値がある直接代替）

### 確認できた事実

- RIST は Video Services Forum の仕様群で、Simple / Main / Advanced Profile がある。Main Profile は Simple Profile に加えてストリーム多重化・トンネル・DTLS と PSK による暗号化を定義する。[VSF TR-06-2 Main Profile](https://static.vsf.tv/download/technical_recommendations/VSF_TR-06-2_2022-08-11.pdf)
- OBS は RIST を Media Source または VLC Source で受信できる。ただし Media Source は **Main Profile の受信のみ**、VLC Source は Simple Profile の受信のみである。OBS 公式ガイドは、Media Source で `rist://@LOCAL_IP:PORT?...` と `Input Format: mpegts` を指定する方法を案内している。[OBS: RIST Protocol Streaming Guide](https://obsproject.com/kb/rist-protocol-streaming-guide)
- 同ガイドでは `bandwidth` は再送が超えない帯域上限、`buffer` はミリ秒単位のバッファであり、`buffer` は ping の 4〜7 倍が適するとの目安を示す。これは SRT と同じく、損失回復のために遅延バッファを使う設計である。[OBS: RIST Protocol Streaming Guide](https://obsproject.com/kb/rist-protocol-streaming-guide)
- Android のフレームワークには RIST 送信 API は存在しない。採用時は、CameraX/Camera2 の入力を `MediaCodec` で H.264 等へエンコードし、MPEG-TS と RIST を送れるライブラリをアプリに組み込む必要がある。ハードウェアコーデック可否は端末実行時に確認できるが、プロトコル実装は別問題である。[Android: MediaCodecInfo](https://developer.android.com/reference/android/media/MediaCodecInfo)

### 評価

SRT と比べ、OBS 側で標準受信でき、ARQ とバッファを利用できることは利点である。一方で「Android 側ライブラリの選定・ライセンス・Main Profile 相互接続・ロック中送信・再接続」の全てを新規に検証する必要がある。Tailscale により公開ポート不要という利点は SRT と同じで、**RIST 固有の決定的な利点は今回の一点送信では小さい**。

## 2. WebRTC / WHIP / WHEP（中継を導入するなら検討）

### 用語を分ける

- **WebRTC** は低遅延のリアルタイム媒体技術群で、実際の接続にはシグナリングが別途必要になる。
- **WHIP** は送信者（encoder / producer）が media server の WHIP endpoint に HTTP POST で SDP offer/answer を交換して、ICE/DTLS の後に**一方向で送る**ための IETF 標準である。[RFC 9725, §3](https://datatracker.ietf.org/doc/html/rfc9725#section-3)
- **WHEP** は media server から視聴者へ出す egress 側の規格であり、Android から OBS へ送る ingest の代替ではない。[WHEP Internet-Draft](https://datatracker.ietf.org/doc/draft-ietf-wish-whep/)

### OBS との関係

OBS 公式の WHIP ガイドは、OBS の Settings > Stream で Server と Bearer Token を設定して **OBS から WHIP provider へ送信する**手順である。Android を WHIP client、OBS を WHIP endpoint にする受信機能は、そのガイドにも OBS の標準ソースにもない。[OBS: WHIP Streaming Guide](https://obsproject.com/kb/whip-streaming-guide)

従って構成は次のいずれかになり、どちらも「Android → Tailscale → OBS 直結」から外れる。

```text
Android -- WHIP/WebRTC --> PC 上の WebRTC media server -- SRT/RTSP/NDI 等 --> OBS
Android -- WebRTC --> OBS 用の追加プラグイン
```

Android での実装自体は、MediaCodec とネイティブ WebRTC 実装を使えば可能性がある。しかし Camera / Audio、コーデック交渉、ICE、DTLS、SRTP、ネットワーク変更時の ICE restart、WHIP の session lifecycle を扱う必要がある。Tailscale の固定アドレスで相手が決まる今回、NAT 越えを主目的とする WebRTC の複雑さは割に合いにくい。

## 3. RTP / RTSP（放送機器互換のための方式で、今回には重い）

RTP はリアルタイム転送・RTCP による品質報告を規定し、受信側は欠損率を算出できる。しかし RFC 3550 は欠損率の報告を規定するもので、SRT/RIST のような ARQ を標準 RTP に与えるものではない。[RFC 3550](https://datatracker.ietf.org/doc/html/rfc3550)

RTSP は媒体そのものではなく、リアルタイム媒体の配送を setup / control するアプリケーション層プロトコルである。RTSP server/client、RTSP セッション、SDP、通常は RTP/RTCP の媒体配送を組み合わせる必要がある。[RFC 7826](https://datatracker.ietf.org/doc/html/rfc7826)、[RFC 4566](https://datatracker.ietf.org/doc/html/rfc4566)

Tailscale は到達性と WireGuard 暗号化を提供できるが、RTP の欠損回復、SRTP、RTSP server の実装を置き換えない。OBS 標準への取り込みも公式の受信経路ではないため、相互運用が必須の機器がある場合以外は採用しない。

## 4. MPEG-TS over UDP（同一 LAN の試験向け）

MPEG-TS はコンテナ、UDP は転送であり、SRT / RIST の代替となる損失回復機構は持たない。UDP はデータグラムの宛先・長さ・チェックサムを規定するだけで、順序保証や再送を規定しない。[RFC 768](https://datatracker.ietf.org/doc/html/rfc768)

OBS のソースコードは FFmpeg MPEG-TS output で `udp` / `tcp` / `http` / `srt` / `rist` を許可しているが、これは OBS が UDP の寄与受信を屋外配信用に保証する公式ガイドではない。[OBS source: `obs-ffmpeg-mpegts.c`](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-ffmpeg/obs-ffmpeg-mpegts.c)

送信側は MediaCodec の出力を MPEG-TS mux して UDP socket に送るだけなので、試作としては単純である。しかし携帯回線の損失・順序入替・瞬断時の視聴継続性を守れないため、本番の外配信には選ばない。暗号化は Tailscale に依存する。

## 5. NDI / NDI HX（LAN 制作用であり、今回の直結条件には不向き）

- NDI の公式文書は、公式 OBS プラグインは存在せず、利用には非公式プラグインを使うと明記する。よって OBS 標準の直接受信ではない。[NDI: OBS](https://docs.ndi.video/all/using-ndi/ndi-tools/plugins/obs)
- NDI HX の H.264/H.265 エンコードはアプリケーション側のハードウェアコーデック等で行い、NDI SDK へ圧縮データを渡す方式である。Android では discovery のため `NsdManager` をアプリ側で稼働させる追加作業も必要になる。[NDI: Decoding with NDI](https://docs.ndi.video/all/developer-guides/decoding-with-ndi)、[NDI: Platform considerations](https://docs.ndi.video/all/developing-with-ndi/sdk/platform-considerations)
- NDI SDK の配布にはライセンス条項への適合、NDI へのリンク・商標表記等の条件があり、Android app に外部 SDK を組み込む製品負担が増える。[NDI: Licensing](https://docs.ndi.video/all/developing-with-ndi/utilities/unreal-engine-sdk/licensing)、[NDI: Software distribution](https://docs.ndi.video/all/developing-with-ndi/sdk/software-distribution)

NDI は同一 LAN の制作環境には便利だが、tailnet 越しでは discovery がそのまま期待できず、OBS 側にプラグインも増える。低遅延を得られても、外配信の可用性・配布負担・保守性で SRT を上回らない。

## 明示的に候補から外したもの

- **VDO.Ninja / 外部 WebRTC relay**: Android アプリと OBS Browser Source で実証済みの有用な運用手段だが、今回の比較対象は「将来のきゃすメイト Android から Tailscale 内で OBS へ直接送る自前の映像経路」である。外部シグナリング/TURN/relay へ依存する選択肢は直接の代替として比較しない。
- **HLS / DASH**: 視聴配信向けの分割配信方式で、寄与映像を低遅延で OBS に入れる用途には適さない。
- **TCP 生ストリーム**: 到達性は高くても、パケット損失時に TCP の順序保証待ちが映像の遅延を膨らませるため、モバイル寄与の第一候補にしない。

## 採用順位と次の判断

1. **SRT + MPEG-TS + Tailscale（継続推奨）** — OBS の公式受信手順があり、暗号化・再送・遅延の調整を備える。Tailscale では公開ポートを不要にできる。
2. **RIST Main Profile + MPEG-TS + Tailscale（比較試験のみ）** — 直接 OBS 受信かつ ARQ を持つ、唯一の実質的な代替。Android 送信ライブラリと相互接続の実証ができた場合に、同じ回線・同じビットレートで SRT と比較する。
3. **WebRTC + WHIP（PC 上の media server を正式に導入する意思がある場合のみ）** — 最低遅延を優先する将来案。現時点の「OBS 直結」要件には不適合。

結論として、SRT を差し替える根拠はまだない。RIST は採用前に、Android 実機で 30 分以上のロック中送信、モバイル回線切替、OBS の listener 再接続、720p30 と 1080p30 の発熱・電池・遅延・フレーム落ちを SRT と同条件で測定してから判断する。
