# モバイル配信の回線適応事例（2026-09-28調査）

## 調査対象と位置付け

屋外の上り回線が悪化・回復するとき、実在する配信アプリが何を観測し、映像量をどう下げ戻すかを一次資料で確認した。この文書は研究メモであり、[Android外配信の正式仕様](../features/outdoor-streaming.md)や[ADR 0015](../adr/0015-adopt-audio-first-outdoor-adaptation.md)を変更しない。各社の公開資料から分からない項目は未確認とする。

| 製品 | 悪化判定に公開されている値 | 下げ方・戻し方 | 映像以外・限界 |
| --- | --- | --- | --- |
| Larix Broadcaster（Android/iOS） | SRTの送信ドロップ、または送信予定量と実送信量の比率。方式により過去10秒の損失数。 | 方式別の段階低下／大きな初期低下／送信量比に応じた低下。15秒～数分の再上昇試行。 | 可変fpsを併用可能。再接続待ちには別設定がある。OBS表示確認は公開資料では不明。[公式FAQ](https://softvelum.com/larix/faq/) |
| Moblin（iOS） | SRTのRTT、未確認パケット数、送信量。 | 混雑時は減速し、RTTと未確認数が落ち着くと上昇。上昇値は実送信量でも制限。 | 公開実装は映像ビットレートを変更。OBSの表示・音声到達は別途確認が必要。[共通統計型](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrate.swift#L10-L26)、[Belabox方式](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrateSrtBelabox.swift#L105-L175) |
| PRISM Live Studio（Android/iOS） | 「ネットワーク状態」とのみ公表。具体的な信号・閾値は未公開。 | 回線悪化時に解像度を維持して映像データ量を徐々に下げる。最大ビットレートを設定可能。復帰の速度は未公開。 | 画質調整と切断後の再接続は別事象。失敗が長引く場合のエラーもある。[ABP設定](https://guide.prismlive.com/mobile/guides/streaming/configuration/setting-adaptive-bitrate)、[安定化ガイド](https://guide.prismlive.com/mobile/guides/error-solution/performance/10-tips-for-better-stability-and-quality)、[接続エラー](https://guide.prismlive.com/mobile/guides/error-solution/streaming/streaming-is-not-working) |
| LiveU LU-Smart（スマホ） | 「ネットワーク状態」とのみ公表。LRTの詳細な判定式は未公開。 | 常に適応ビットレートを使用。LiveUは回線の低下・回復をトランスポートからエンコーダーへ伝え、下げ戻すと説明。 | Wi-Fiと携帯回線のボンディングを併用できる。単一回線でも動作するが、同じ回復性をきゃすメイトへ転用できる証拠ではない。[LU-Smartガイド](https://www.liveu.tv/lu-smart-qsg)、[LRT説明](https://www.liveu.tv/resources/blog/not-all-bonding-is-the-same) |

## Larix Broadcaster：下げ方と上げ方を別に設定

Softvelumの[公式FAQのQ2](https://softvelum.com/larix/faq/)は、映像ABRに次の三方式を記載する。

- **Logarithmic descend**：段階的に低下し、1分ごとに一段前のビットレートへ戻す試行をする。過去10秒の損失4パケットが低下の起点。
- **Ladder ascend**：最初にビットレートを約2/3下げ、15秒後、1.5分後、5分後に上昇を試す。低下の損失閾値は過去10秒で「ビットレート/300,000」パケットと説明される。
- **Hybrid**：送信予定量に対する実送信量の比率で目標を下げる。最低25%、30秒ごとに500kbpsずつ戻すと説明される。FAQ内の数値例には「1分後」とも記載されるため、正確な試行周期はバージョン・条件別に実測が必要。AndroidではHybridはSRTだけに対応する。

同FAQではSRTの損失を`pktSndDrop`と定義し、SRT遅延設定など内部要因に依存すると明記する。HybridのSRT判定は送信予定量と実送信量の比率に依存する。可変fpsも追加の低下手段として説明される。[Larix Groveの設定資料](https://softvelum.com/larix/grove/)では`enc[vid][adaptiveBitrate]`が0～3の方式選択、`enc[vid][adaptiveFps]`が可変fpsのスイッチである。これらは映像の送信側・トランスポート側の情報であり、OBSが実際に映像を表示したという報告ではない。[同FAQのQ8](https://softvelum.com/larix/faq/)はAndroidのVBRエンコーダーが指定した低ビットレートを超える場合も説明する。

通信断は別扱いで、[同FAQのQ12](https://softvelum.com/larix/faq/)に再接続待ち時間、ネットワーク不在時でも接続を試す設定、iOSの送信不能時停止時間・未送信データ蓄積閾値が記載される。ABRの回復間隔をそのまま再接続間隔として扱うことはできない。

## Moblin：SRTの未確認量も使って短い周期で制御

[MoblinのREADME](https://github.com/eerimoq/moblin#readme)はSRT/SRTLA・RIST・RTMPの自動ビットレートに対応すると明記する。公開ソースの`StreamStats`にはRTT、`packetsInFlight`、`transportBitrate`などがあり、`transportBitrate`が低いとき目標値の上昇に上限を掛ける。理由として、静止した映像ではエンコーダーの実出力が設定値より小さい可能性があるとコードに記されている。ここでいう`transportBitrate`の算出元までは本調査で確定していない。[共通統計型と上限制御](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrate.swift#L10-L26)

[Belabox方式のコード](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrateSrtBelabox.swift#L6-L39)では、映像目標は[1Mbpsから始まり](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrate.swift#L3-L4)、既定の下限は250kbps。RTTが設定SRT遅延の1/3以上、または未確認パケットが大きく増えた場合は下限へ落とす。中程度の悪化は100kbpsまたは「100kbps＋現在値の1/10」ずつ下げる。RTTが低く安定すれば「100kbps＋現在値の1/30」を400ms以上の間隔で足し、上限と`transportBitrate`による制限を掛ける。[判定と更新](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrateSrtBelabox.swift#L105-L175)

[Fight方式のコード](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrateSrtFight.swift#L3-L42)は高速・低速設定を持つ。コメント上はライブ中200msごとの更新を想定し、短期・平滑化した未確認パケット数とRTTを比較する。未確認数やRTTが大きいと目標上限を下げ、落ち着くと上限を増やす。急な未確認数増加時には、上限の更新を待たず実行値を下限へ落とす。[上昇・低下条件](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrateSrtFight.swift#L136-L201)、[一時的な急減](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrateSrtFight.swift#L202-L244)

Moblinの上記コードは`main`ブランチを2026-09-28に閲覧したもので、製品の全設定や将来版を固定するものではない。特に「低RTTだけで良好」とはせず、未確認パケット数と`transportBitrate`も合わせる点が参考になる。ただしソースからOBS側の映像表示・音声継続まで保証するとは読めない。[統計の入力定義](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrate.swift#L10-L26)

## PRISMとLiveU：公開範囲と再接続の扱い

PRISMの[モバイルABP設定ガイド](https://guide.prismlive.com/mobile/guides/streaming/configuration/setting-adaptive-bitrate)はAndroid/iOSとも適応画質が既定で、上限ビットレートを設定できると説明する。[モバイル安定化ガイド](https://guide.prismlive.com/mobile/guides/error-solution/performance/10-tips-for-better-stability-and-quality)は、ABPが解像度を維持し、映像のデータ量を徐々に下げると説明する。具体的な回線指標、上昇間隔、音声優先の条件は記載されていない。[RTMP接続エラーの説明](https://guide.prismlive.com/mobile/guides/error-solution/streaming/streaming-is-not-working)では接続が10分以上回復しなかったケースを別途扱う。よって、ABPが完全断を埋めるとは解釈できない。

LiveUの[LU-Smart手引き](https://www.liveu.tv/lu-smart-qsg)は常時のビットレート適応とライブ配信用帯域上限、Wi-Fiと携帯回線の同時利用を説明する。[LRTの一次説明](https://www.liveu.tv/resources/blog/not-all-bonding-is-the-same)はパケット確認・再送、FEC、回線変化をエンコーダーへ伝える仕組み、回線回復時の画質上昇を挙げる。ただしこれは販売元による概要であり、LU-Smart固有のABR数式、復帰までの秒数、完全断時の挙動は示されない。ボンディングできる構成も、単一SRT経路であるきゃすメイトとは異なる。

## 参考：OBSとWebRTCの公開実装

OBS Studioの[RTMP送信実装](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-outputs/rtmp-stream.c)は、未送信映像パケットの時間幅が200ms以上になると、直近1～2秒の送信実績を基に映像エンコーダーの目標ビットレートを下げる。回復方向は元の映像目標の10%ずつ、4秒間隔で上げる。開発者はこの上昇間隔を30秒から4秒へ[短縮した](https://github.com/obsproject/obs-studio/commit/301730f40c6c250eafbcedcf37dfc89125a0c795)。これは**OBS自身がRTMPを送信する場合**の処理であり、きゃすメイトのSRTをOBSが受信するときにOBSが自動調整する機能ではない。

Googleの[WebRTC輻輳制御実装](https://webrtc.googlesource.com/src/+/bb9b6d1b324c267495139264fdeb000bb7bee582/modules/congestion_controller/goog_cc/goog_cc_network_control.cc)は、パケット到着のフィードバックから確認済み送信レートを推定し、遅延・損失の判定と合わせる。過負荷から回復した場合には上り容量のプローブを要求する。単に低負荷の送信が成功しただけで通常動画の容量があると決めない設計の参考になる。ただしWebRTCの受信フィードバックとSRTの統計は同じAPIではなく、そのまま実装を移植できない。[WebRTCの遅延に基づく推定実装](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/congestion_controller/goog_cc/delay_based_bwe.cc)

[SRT公式統計](https://github.com/Haivision/srt/blob/master/docs/API/statistics.md)には、平滑化RTT、送信後まだ確認されていないパケットとその時間幅、推定帯域、再送・送信破棄がある。きゃすメイトのRootEncoder 2.8.1には[アプリ内の送信待ちバイト量](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/srt/src/main/java/com/pedro/srt/srt/SrtClient.kt#L452-L454)の公開メソッドがあり、[ACK処理](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/srt/src/main/java/com/pedro/srt/srt/SrtClient.kt#L354-L362)も内部にある。ただしACK進行やSRT未確認データ量がそのまま公開されるわけではなく、libsrtと同じ統計を取得できると仮定しない。Androidの[上り帯域API](https://developer.android.com/reference/android/net/NetworkCapabilities#getLinkUpstreamBandwidthKbps())が返すのは第一ホップの推定値であり、OBSまでの実効上り容量とは限らない。

## きゃすメイトへの示唆（採用範囲は正式仕様を参照）

1. 直接比較しやすいのはLarixのSRT HybridとMoblinである。両者は電波アイコンそのものではなく、送信ドロップ、送信予定量と実送信量、RTT、未確認パケットなど配信経路の値を使う。[Larix FAQ](https://softvelum.com/larix/faq/)、[Moblin統計型](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrate.swift#L10-L26)
2. 悪化時の素早い大幅低下と、回復時の小刻みな上昇は複数の実装に見られる。一方、Larixの復帰間隔だけでも15秒～数分の違いがあり、「復帰を速くする値」が普遍的に決まっているわけではない。[Larix FAQ](https://softvelum.com/larix/faq/)、[Moblin Belabox方式](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrateSrtBelabox.swift#L136-L175)
3. 現在画像の静止中は映像送信量が小さくなり、通常動画を流せる上り容量を静止中の数値だけから推定しづらい。Moblinも静止画面後の過大な上昇を防ぐため`transportBitrate`で目標を制限している。動画への低負荷試行と、OBSでの画面更新・音声継続の測定は別に必要となる。[Moblin上限制御](https://github.com/eerimoq/moblin/blob/main/Moblin/Media/AdaptiveBitrate/AdaptiveBitrate.swift#L17-L26)、[外配信受け入れ条件](../features/outdoor-streaming.md#音声優先hevc追加分の受け入れ条件)

Streamlabs Mobileについては、今回確認した公式資料で回線指標や復帰アルゴリズムを裏付けられなかったため比較表へ入れていない。

## RootEncoder 2.8.1で回復判定を実装する際の計測境界（2026-09-29追記）

きゃすメイトが使うRootEncoder 2.8.1では、[SrtClientのACK受信処理](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/srt/src/main/java/com/pedro/srt/srt/SrtClient.kt#L344-L368)が内部の送信済みパケットを解放する。公開されるRTTは一部のACKで更新される値で、直近のACK到着時刻や確認済みバイト数を表さない。[CommandsManagerの送信済みキュー](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/srt/src/main/java/com/pedro/srt/srt/CommandsManager.kt#L104-L153)は非公開で、ACKによる削除のほかSRT遅延を超えたパケットの破棄も行う。このためアプリ側のポーリングだけで「新しいACK」「未確認量の減少」「音声の確認応答」を正しく組み立てられない。

[公開の`getQueueBytesOut()`](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/srt/src/main/java/com/pedro/srt/srt/SrtClient.kt#L448-L454)は、[送信前の主キュー](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/common/src/main/java/com/pedro/common/StreamBlockingQueue.kt#L73-L80)にある圧縮済みフレームのバイト量である。送信中、送信後の未確認、再送や遅延キューは含まない。きゃすメイトの診断にはこの値を追加したが、ゼロをOBS受信や映像帯域の回復証拠にしない。

この値の取得は[キュー全体を走査する](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/common/src/main/java/com/pedro/common/StreamBlockingQueue.kt#L490-L500)。現行の500ms観測ではメインスレッドから読むため、満杯時の取得時間と画面・音声への影響を実機で確認する。診断値だけの取得失敗や不正値は未計測に落とし、自動制御の既存観測を無効化しない。

次の復帰試験方針を実装するなら、RootEncoder側に接続世代ごとの読み取り専用統計スナップショットを追加するのが候補である。必要なのは、ACK進行の連番・到着時刻・確認済みバイト量、未確認のパケット数・バイト量・最古経過時間、再送数と遅延超過破棄数、音声フレームの送信前の最古待ち時間である。[SrtSenderは音声・映像の種別を知って送る](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/srt/src/main/java/com/pedro/srt/srt/SrtSender.kt#L162-L175)ため、音声のACKを必要とするならパケット連番と種別の対応を保持する追加変更も要る。カウンターを別々に読むのではなく、ACK処理と接続世代のリセットを一貫したスナップショットにし、連番の周回、再接続、送信失敗、遅延超過破棄を試験する。映像・音声の内容や接続情報は統計へ含めない。

この計測を得るには、使用中のライブラリに変更を加える方法（管理可能なforkまたは上流への追加）を決める必要がある。非公開フィールドの反射参照やRTT変化・主キュー件数によるACK推定を実装根拠にしない。送信量・試行時間の予算値は、H.264とHEVCの実機出力とキーフレームピーク、OBS側の音声欠落・遅延を同条件で測って決める。現段階で5秒以内の試行開始や音声継続性を達成済みとは判定できない。
