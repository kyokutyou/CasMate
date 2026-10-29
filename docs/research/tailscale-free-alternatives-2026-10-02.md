# 外配信のTailscale導入を不要にする無料案の調査

調査日: 2026-10-02。**検討資料であり、正式仕様・採用決定ではない。** 公開された一次資料と現在の作業ツリーを確認した。アカウント作成、サービス契約、配信実験、製品コード・正式仕様の変更は行っていない。

ここでの「無料」は、配信者ときゃすメイト開発者の追加のサービス利用料金が0円であることを指す。既存のインターネット回線・携帯通信料、機材、電気代、開発・保守の工数は含めない。無料枠、非商用条件、サービス提供者に依存する無償提供を区別する。

## 判断

**推奨する調査後の次工程は、SRTを残したアプリ内P2P接続の小さな試作。** 直接接続を優先し、必要時だけ無料枠のTURN中継を使う構成なら、別のVPNアプリを要求しない導入を設計できる。Cloudflareはその部品の有力候補だが、無料枠超過時の確実な無課金停止は採用前の未確認事項である。これは設計上の評価であり、きゃすメイトでの実証済み構成ではない。

既存製品をすぐ試すならVDO.Ninjaが手軽。ただし映像の暫定経路であり、現在のコメント・読み上げ・OBS操作まで自動的に置き換わるわけではない。NetBirdの接続機能を内蔵する案もあるが、Android組み込み版の中継依存とアカウント準備が残る。

今回確認した候補に、**追加アプリ不要・あらゆる回線で接続・利用量無制限・両者の料金が永久に0円**を同時に保証できるものはなかった。無料枠内に収める、接続できない回線を許容する、無償サービスの制約を受け入れる、のいずれかが必要になる。根拠は各候補の公式条件を以下に記載する。

## きゃすメイトで置き換える対象

現行の外配信はWindows 11とAndroid 10以降を対象とし、次の通信を分離している。[外配信の構成](../features/outdoor-streaming.md#構成と対応範囲)、[Android対応環境](../features/android-mobile-client.md#対応環境)

| 通信 | 現行の役割・仕様 |
| --- | --- |
| 映像・配信マイク | AndroidのSRT CallerからOBS ListenerへMPEG-TSを直接送信。H.264/H.265とAAC-LCを使用。[送信品質](../features/outdoor-streaming.md#送信品質とエンコード設定) |
| コメント・読み上げ | HTTP/WebSocketによるコメント通知とM4A取得。Tailscale内の読取専用公開。[公開範囲](../features/mobile-speech.md#スマホ向け公開範囲) |
| 外配信状態報告 | 専用の認証付きHTTP受付。映像表示成功の確認とは別。[状態報告](../features/outdoor-streaming.md#状態報告と公開境界) |
| OBS配信開始・終了 | 独立した認証・確認付き操作。OBSパスワードはPC内に保持。[Android操作](../features/obs-control.md#android操作と認証) |

現行のQR・接続先検証はTailscale IPv4を前提としている。任意の公開アドレスへ変えるだけでは動かない。また、コメント公開は私設ネットワーク内を前提とした認証なしの入口なので、そのままインターネットへ出す設計にはしない。[統一登録QR](../features/outdoor-streaming.md#統一登録qr版4)、[ADR 0009](../adr/0009-use-tailscale-private-network-for-mobile-speech.md)、[Android登録実装](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorRegistration.kt#L19)、[PC登録検証](../../src/shared/outdoor.ts#L25)

## 比較

「別アプリ不要」は、きゃすメイトへの必要な組み込み開発を終えた場合の評価。VDO.Ninjaのブラウザ運用以外は、現行きゃすメイトの設定だけで実現するものではない。

| 案 | 配信者側 | 開発者側の無料条件 | SRTの扱い | 評価 |
| --- | --- | --- | --- | --- |
| アプリ内ICE接続 + Cloudflare TURN | 別VPN・サービスアカウント不要のUIを設計可能 | 中継はSFUと合計1,000GB/月まで無料。接続仲介も無料枠内で運営 | アプリ内UDP転送層を新設して維持する案 | 第一試作候補。開発量は大きいが今の映像機能を残しやすい |
| WebRTC + 同じ接続仲介/TURN | 同上 | 同上 | 映像伝送を変更 | 次候補。映像送受信・OBS取り込み・品質制御の再検証が広い |
| NetBird接続機能の内蔵 | 自分の無料アカウントと登録準備が必要 | 配信者のアカウントを使えば共用サーバー契約不要 | ローカルUDP転送で維持を検討 | Android組み込み版は中継依存。無料リレーの動画適性が未検証 |
| VDO.Ninjaブラウザ運用 | 原則アカウント・追加アプリ不要 | 現行の無料ホストサービスを利用 | WebRTC映像へ変更 | すぐ映像を試せる。きゃすメイト全機能の代替には未達 |
| Oracle Always Free上に中継を自営 | アプリへ接続処理を内蔵すれば追加VPN不要 | 無料VM・月10TB送信枠の範囲 | 中継方式次第で維持可能 | 開発者の運用負担、空き容量不足・回収リスクがある |
| Irohの内蔵 + 公開リレー | 別VPN・利用者アカウント不要の構成を検討可能 | 公開リレー無料。ただし可変の速度制限・稼働保証なし | UDP転送への適合を要検証 | 試作用。長時間映像の安定した無料基盤とは判断しない |
| 公開IPv4/IPv6への直接接続 | 回線条件とルーター/ファイアウォール準備が必要 | 中継サービス費用なし | 維持可能 | 対応回線向けの上級者用。導入の簡単さでは不利 |

工数・適性・順位は本調査の評価であり、ベンダーの性能保証ではない。無料条件の根拠と制約は次の各節に分ける。

## 1. アプリ内P2P + 無料枠TURN

### 確認できたこと

- WebRTCの接続ではICEによる候補探索を行い、接続情報交換には別の仲介経路が必要。直接接続できない環境ではTURNが中継する。[WebRTC公式の接続説明](https://webrtc.org/getting-started/peer-connections)、[TURN](https://webrtc.org/getting-started/turn-server)
- CloudflareのSTUNは無料・無制限と案内されるが、STUN自身は映像を中継しない。[TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)
- Cloudflare Realtime TURNとSFUは合計で最初の1,000GB/月が無料、超過分は$0.05/GB。開発者の1アカウントで全員に提供する設計なら全員分を合計する。配信者ごとに1,000GBが付与される設計ではない。[料金](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)、[アカウント配下のTURN運用](https://developers.cloudflare.com/realtime/turn/replacing-existing/)
- 製品ページにはカード不要で開始できるとある。ただし「TURNが無料枠で必ず停止し請求されない」という製品固有の保証は今回確認できなかった。予算通知は利用を停止・制限しないと公式に明記される。[製品案内](https://www.cloudflare.com/products/turn-sfu/)、[予算通知](https://developers.cloudflare.com/billing/manage/budget-alerts/)
- TURNはWebRTC専用ではなく、ネイティブアプリから直接使う方法も公式に説明されている。ただしTURNの割当・権限・認証・パケット転送の処理が必要で、SRTの送信先欄にTURNのURLを書くだけでは使えない。[CloudflareのTURN説明](https://developers.cloudflare.com/realtime/turn/what-is-turn/)、[RFC 8656 §3](https://www.rfc-editor.org/rfc/rfc8656.html#section-3)
- Workers Freeはアカウント単位で10万リクエスト/日、CPU 10ms。無料のSQLite型Durable Objectsにも10万リクエスト/日、13,000GB-s/日等の上限がある。接続情報の交換用に検討し、映像本体を流さない。[Workers上限](https://developers.cloudflare.com/workers/platform/limits/)、[Durable Objects料金](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- TURNの長期API資格情報はサーバーで保持し、端末へ短期の認証情報を発行する方式が案内される。無料枠を不特定の利用に消費されないよう、登録済み端末への発行と失効を設計する必要がある。[認証情報の生成](https://developers.cloudflare.com/realtime/turn/generate-credentials/)

### SRTを維持する設計候補

AndroidとPCの双方に接続部品を入れ、SRTのUDPパケットを直接またはTURN経由で運び、PCではローカルのOBSへ渡す。映像の再エンコードは不要にする構想である。コメント・読み上げ・状態・OBS操作も、認証・暗号化した独立の通信として接続部品へ接続する。

現在のRootEncoderのSRTソケットはUDPを使っているため、パケット単位の転送層を検討できる。ただしこれは構成の提案であり、既製の互換性を確認したものではない。[現在のSRTソケット](../../android/vendor/rootencoder/srt/src/main/java/com/pedro/srt/utils/SrtSocket.kt#L26)

具体的な部品候補にはlibjuiceがある。Android/Windowsと双方向UDP、STUN/TURNに対応するMPL-2.0のライブラリで、完成済みのSRT接続製品ではない。作者の説明では、接続後もICE agentを保持し、データを`juice_send()`経由で送る必要がある。STUNでIPだけ調べて既存SRTソケットへ渡す構成とは異なる。[libjuice公式](https://github.com/paullouisageneau/libjuice)、[作者による統合方法の説明](https://github.com/paullouisageneau/libjuice/discussions/192)

試作では、パケットサイズ、暗号化、再送・RTT観測、Wi-Fi/携帯回線切替、再接続、画面ロック中の継続、コメントと操作の独立性を確認する。PCの接続部品が中継を所有する場合、PCアプリ終了後も映像が独立継続する現行の性質は維持できるとは限らない。この変更は[ADR 0011](../adr/0011-use-srt-direct-to-obs.md)の再判断対象となる。

WebRTC映像へ全面変更する案なら、映像・音声とDataChannelを使う構成が別途可能。ただし既存SRTの品質制御、H.265/AAC、OBSメディアソース受信をそのまま流用できるとは扱わない。[WebRTC DataChannel](https://webrtc.org/getting-started/data-channels)、[現行送信品質](../features/outdoor-streaming.md#送信品質とエンコード設定)

### 無料枠の大きさ

単純なメディア量は `Mbps × 0.45 = GB/時`（10進単位）。現行標準の映像2.5Mbps + 音声64kbpsなら約1.154GB/時、画質優先の映像6Mbps + 音声128kbpsなら約2.758GB/時となる。[現行プリセット](../features/outdoor-streaming.md#品質プリセット)

1,000GBは単純計算で標準約866時間、画質優先約362時間分。**1人当たりではなく、実際に中継された全員分の合計**である。この値は中継課金が片方向メディア1本分となる仮定で、再送、プロトコル付加分、逆方向通信、中継構成による差を除く。利用可能時間の保証ではなく、実際の課金メーターで確認する必要がある。

直接接続の映像はTURNを消費しないため利用規模は直接接続率にも左右される。「全員が直接つながる」「中継は一定の割合だけ」と仮定して無料を保証しない。無料運用を採用する前に、中継上限到達時の受付停止と、提供者側で超過請求を確実に防げるかを確認する。

### 小さい無料枠の代替

Metered Open Relayは月20GB無料。標準ビットレートの単純計算では約17時間分のため、小規模試作向けと評価する。サービス停止等について保証されるものではない。通常のMetered TURN価格表にある月500MBの試用枠とは別サービスである。[Open Relay](https://www.metered.ca/tools/openrelay/)、[規約](https://www.metered.ca/tools/openrelay/terms-and-conditions/)、[通常TURN価格](https://www.metered.ca/pricing)

## 2. NetBirdの接続機能を内蔵

### 確認できたこと

- 公式Go APIの`client/embed`があり、userspaceでの組み込みと`ListenUDP`を提供する。別クライアントの導入・管理者権限を不要にできる設計である。[公式API説明](https://github.com/netbirdio/netbird/blob/main/client/embed/doc.go)
- クライアント部分はBSD-3-Clauseで、管理・シグナル・リレー等のサーバー部分は別のライセンス。ソフトの組み込み条件とCloudサービスの利用条件を混同しない。[公式LICENSE](https://github.com/netbirdio/netbird/blob/main/LICENSE)
- Androidの組み込み対応はv0.67.2で追加された。一方、対応PRと現行Android実装ではネットワークインターフェース列挙を省略し、P2P探索を行わず中継へフォールバックする構成となっている。一般のNetBirdアプリが直接接続できることと、Android組み込み版の能力は同一ではない。[v0.67.2](https://forum.netbird.io/t/netbird-v0-67-2-released/664)、[Android対応PR #5623](https://github.com/netbirdio/netbird/pull/5623)、[現行Android実装](https://github.com/netbirdio/netbird/blob/main/client/internal/connect_android_default.go)
- Cloud無料プランは5ユーザー・100マシン。配信者自身のアカウントで2端末を登録する形と、開発者の1アカウントへ全利用者を集約する形は別物である。[料金](https://netbird.io/pricing)
- 登録にはsetup keyなどの準備が必要となる。組み込みAPIがあることだけで、アカウント作成や初回登録がQRだけになるとは判断しない。[setup keyによる登録](https://docs.netbird.io/manage/peers/register-machines-using-setup-keys)
- 無料の通常mesh relayについて、映像向けの保証帯域・月間GB上限を今回確認できなかった。**制限が見つからないことは無制限の保証ではない。** 規約中のReverse Proxy向けの枠は別機能の条件として扱う。第三者向けサービス提供や過負荷の条件もあり、開発者アカウントで全員へ中継を再提供する案を安易に無料運用としない。[規約](https://netbird.io/terms)

### 評価

ユーザーごとの無料アカウントを前提に、Windows・Androidへ接続機能を内蔵し、SRTとHTTP系の限定された経路をつなぐ試作候補。別VPNアプリのインストールはなくせる可能性があるが、アカウントと登録準備は残る。Androidが中継依存のため、標準・画質優先の長時間送信と回線切替を試し、無料リレーで継続的な映像利用が認められる範囲を確認してから順位を上げる。

## 3. VDO.Ninja

- 既存の無料サービスを使えば、スマホのブラウザで映像を送信し、PCのOBSブラウザソースへview URLを設定できる。原則アカウント・追加VPN・開発者の自前サーバーは不要。[基本操作](https://docs.vdo.ninja/getting-started/vdo.ninja-basics)、[サービス規約](https://docs.vdo.ninja/help/privacy-and-security-details/vdo.ninja-terms-of-service)
- 無料TURNは現時点の提供であり、混雑時の品質低下等が説明される。長時間の中継や永久無料を保証する根拠にはしない。[TURNの説明](https://docs.vdo.ninja/advanced-settings/turn-and-stun-parameters/turn)
- Androidブラウザの画面消灯やバックグラウンド動作には制約がある。別のネイティブアプリも提供されるが、追加インストールが必要で、きゃすメイトのAndroidサービスと同一ではない。[Androidの注意点](https://docs.vdo.ninja/platform-specific-issues/android)、[ネイティブアプリ](https://docs.vdo.ninja/steves-helper-apps/native-mobile-app)
- Web本体はAGPL-3.0-only。別の`@vdoninja/sdk`はブラウザ/Node向けで、コアはMPL-2.0。公開signalingへの直接接続を自由に使えるという意味ではなく、SDK側にも利用条件がある。[Web本体ライセンス](https://github.com/steveseguin/vdo.ninja/blob/develop/LICENCE.md)、[SDK](https://github.com/steveseguin/ninjasdk)

**評価:** 追加インストールなしの映像体験をすぐ比較する暫定案として最有力。きゃすメイトの既存コメント・読み上げ・OBS操作は別途接続する必要がある。SDKで独自データ通信を作る場合も新規実装であり、現在のHTTP APIが自動で通るわけではない。画面ロック中の送信を維持する製品統合は、ブラウザ版を開くだけの試験より大きな作業になる。

## 4. 無料クラウド上の自前中継

Oracle Always Freeには無料VMと月10TBの外向き通信枠がある。調査時点のAlways Free A1記載は2 OCPU・12GB相当で、古い記事の4 OCPU・24GBを前提にしない。空き容量不足でVMを作れないこと、低稼働のVMが回収され得ることも公式に記載されている。[Always Freeリソース](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

開発者の登録に本人確認用のカードが必要。無料サービスにはSLAがなく、有料化後は無料枠超過が課金対象となる。[公式FAQ](https://www.oracle.com/cloud/free/faq/)

**評価:** この上でTURNまたは認証・暗号化付きの中継を自営し、端末側の接続部品を内蔵すれば、配信者にクラウド登録を要求しない構成を検討できる。ただしこれは構成案であり、Oracleがきゃすメイト向けSRT中継を提供するという意味ではない。無料枠の監視、OS更新、不正利用対策、障害復旧を開発者が所有する。サービス料は0円にできても、運営不要にはならない。

## 5. Irohと直接公開

IrohはKotlin等の公式バインディングとAndroid/Windows対応を案内し、端末間のQUIC接続をアプリに組み込める。公開リレーは無料だが、Communityの速度・転送枠は可変であり、混雑に応じて制限される。5MB/sという記載は有料Proの条件で、無料枠の保証ではない。[言語・OS対応](https://www.iroh.computer/blog/iroh-language-support)、[2026-09-08の料金・制限説明](https://www.iroh.computer/blog/shared-relays)、[稼働保証の有無](https://www.iroh.computer/services/hosting)

**評価:** 接続の内蔵には合うが、無料公開リレーを長時間映像の保証された土台にはしない。公式のバインディング紹介はQUICストリームを中心としており、SRTのUDPパケット転送をそのまま実用化できるとまでは判断していない。

公開IPv4へのポート転送、到達可能なIPv6、SRT Rendezvousを用いる直接接続は中継料金をなくす候補。ただし携帯回線・家庭回線のNATやファイアウォール条件に依存し、SRTへ方式名を指定するだけで全回線から通るわけではない。[SRTの接続モード](https://doc.haivision.com/SRT/1.5.3/Haivision/srt-connection-modes)、[NATの条件](https://doc.haivision.com/SRT/1.5.4/Haivision/other-considerations)

**評価:** 配信者の回線環境と設定を選ぶ上級者向けオプション。インストールの代わりにルーター設定を要求するため、今回の導入障壁の解消としては第一候補にしない。コメント・OBS操作の公開には別途TLS・認証を設計する必要があり、現行私設ネットワーク向けHTTPの単純公開では完了しない。[現行公開契約](../features/mobile-speech.md#スマホ向け公開範囲)、[OBS操作の公開境界](../features/obs-control.md#android操作と認証)

## 無料でも、そのままの置換に向かないもの

| 候補 | 確認結果と扱い |
| --- | --- |
| Cloudflare Tunnel | 通常の公開hostnameのTunnelはSRT/UDP公開サービスではない。汎用TCPは接続側の追加クライアントが必要。公開Tunnelでの動画にはFree/Pro/Business向けの制約がある。Realtime TURNとは別製品。[対応方式](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/)、[動画に関する公式FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/#large-file-and-streaming-traffic-through-tunnel) |
| Cloudflare Quick Tunnel | アカウント・ドメイン不要だがPCのcloudflaredは必要。開発・試験用、稼働保証なし、同時処理200件、SSE非対応。正式外配信の土台として推奨しない。[公式](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) |
| ngrok Free | 月1GBの外向き通信等の上限があり、UDP非対応。現在のSRT送信をそのまま代替できない。[無料枠](https://ngrok.com/docs/pricing-limits/free-plan-limits)、[UDP非対応の説明](https://ngrok.com/compare/tailscale) |
| playit.gg | 汎用UDPは現在無料で、PCだけにagentを入れる構成。SRTだけの試験候補にはなるが、汎用TCP/HTTPSはPremiumなのでコメント・操作まで無料で一本化できない。組み込み・代理提供には別のサービス条件がある。[公式](https://playit.gg/)、[規約](https://playit.gg/terms/) |
| Tailscaleの内蔵 | tsnetにはUDP APIがあり別デーモンなしの接続を検討できるが、アカウントと契約条件は残る。Personalは非商用向けで、全配信者の無料利用を保証する代替にはならない。[tsnet](https://pkg.go.dev/tailscale.com/tsnet#Server.ListenPacket)、[料金](https://tailscale.com/pricing) |
| ZeroTier/libzt | アプリ組み込みSDKはあるが、現在のCentral Personalは10端末・1ネットワーク・1管理者・APIなし。SDKと依存coreでライセンスの変遷があり、採用版を固定した配布条件の確認が必要。「商用は必ず有料」「無条件に無料」のどちらとも断定しない。[SDK](https://docs.zerotier.com/sockets/)、[料金](https://www.zerotier.com/pricing/)、[SDKライセンス](https://github.com/zerotier/libzt/blob/main/LICENSE.txt)、[coreライセンス](https://github.com/zerotier/ZeroTierOne/blob/dev/LICENSE.txt) |
| 別VPNアプリへの単純変更 | 名前だけ変えても、両端への追加アプリ導入という今回の障壁は残る。内蔵可能性、配布条件、クラウドの利用条件を分けて判断する |

## 採用を判断するために残る確認

1. **無料の境界:** 想定する人数・月間配信時間、中継の実測比率、上限時に接続を止めてもよいか。Cloudflareなら提供者側の無課金停止、NetBirdなら無料リレーの継続映像利用の条件を確認する。
2. **SRT維持の実現性:** AndroidとPCの小さなUDP接続試作で、直接接続と強制中継の両方を確認する。標準・画質優先、画面ロック、携帯回線切替、瞬断復帰、コメント読み上げ併用を測る。
3. **登録の手間:** 独自接続ならきゃすメイトのQRだけで済む流れを設計する。NetBirdなら配信者のアカウントとsetup key準備が、元のTailscale導入より簡単になるか比較する。
4. **責任と障害範囲:** 映像の中継をPCアプリが所有するか、接続仲介を開発者が運営するか、停止時にどの機能が継続するかを決める。管理面全体を公開せず、コメント・読み上げ・状態・OBS操作の限定した契約を保つ。[セキュリティ境界](../features/local-application.md#セキュリティ境界)

採用時には[SPEC](../../SPEC.md)、[外配信仕様](../features/outdoor-streaming.md)、[スマホ音声仕様](../features/mobile-speech.md)、[Android仕様](../features/android-mobile-client.md)、[OBS操作仕様](../features/obs-control.md)、関連ADR、[対象外事項](../../OUT_OF_SCOPE.md)を先に更新する。過去の[映像プロトコル比較](./mobile-to-obs-protocol-alternatives.md)は「Tailscaleを利用済み」が前提だった。今回は導入障壁を取り除くため、当時比較対象外だった接続仲介・TURN・VDO.Ninjaも比較した。

## 検証範囲

本調査は公式ドキュメント・公式ソース・作業ツリーの読み取りと、調査メモの追加に限定した。疎通、映像品質、電池消費、料金上限の実サービス動作は未検証。製品の挙動を変更していないため、製品のlint・型チェック・全体テスト・ビルドは実行していない。
