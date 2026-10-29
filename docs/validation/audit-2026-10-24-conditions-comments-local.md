# コメント・ローカル基盤9機能の条件別追加照合

2026-10-24。追加ゴールの研究担当による静的照合。製品コード・テストは編集せず、テストも実行していない。以下の「既存試験」は試験の入力と判定を原文で確認した意味で、今回の実行成功を示さない。現在差分の実行結果は[条件別全体記録](audit-2026-10-24-conditions.md)、前回結果は[前回全体記録](audit-2026-10-24.md)に区別する。1件の候補発見で調査を止めず、担当9機能すべてを再点検した。

## 根拠と読み取り境界

[AGENTS](../../AGENTS.md)、[SPEC](../../SPEC.md)、[運用手順](../development-workflow.md)、[正式用語](../../CONTEXT.md)を入口とした。各表の所有仕様と、その機能が参照する保存・通知・管理認証・公開射影を照合。接続先/共通コメント/初回履歴/新着、現行・次スレッド/一時状態、待ちキュー/同期1件表示、配信セッション/認識セッションの区別を維持する。関連判断は[ADR0001](../adr/0001-login-free-comment-acquisition.md)、[0002](../adr/0002-local-speech-pipeline.md)、[0003](../adr/0003-unauthenticated-read-only-lan.md)、[0004](../adr/0004-limit-shitaraba-write-to-next-thread.md)、[0005](../adr/0005-use-board-title-check-for-shitaraba-next-thread.md)、[0009](../adr/0009-use-tailscale-private-network-for-mobile-speech.md)、[0017](../adr/0017-network-based-multi-device-smartphone-integration.md)、[0019](../adr/0019-consolidate-smartphone-transports.md)、[0027](../adr/0027-adopt-jpnkn-board.md)。過去ADRの同時公開は現行の排他的経路選択へ更新されていることを確認した。

表は「正常/境界/異常」「保存・移行」「起動終了」「切断復旧」「非同期競合」「公開認証」「連携」を個別に点検するための索引。実機未実施をモックによる代替済みとは扱わない。行に挙げるテスト名は各ファイル内の対応ケースを検索する手掛かりでもある。

## 1. コメント取得

所有: [comment-acquisition](../features/comment-acquisition.md)。前回の数値文字参照の行単位隔離を保全。

| 条件 | 具体的コード経路/試験の根拠 | 残る条件 |
| --- | --- | --- |
| 正常・境界・異常 | [SourceConnections.start](../../src/main/sources/source-connections.ts:49)、各sourceのparser/run。[source-inputs](../../tests/source-inputs.test.ts)、[source-parsers](../../tests/source-parsers.test.ts:7)、[jpnkn-source](../../tests/jpnkn-source.test.ts)、[audit-comments](../../tests/audit-comments-2026-10-24.test.ts)で入力、通常本文、初回100、CP932/Range、変換不能行を点検 | Twitch不正エモート範囲、YouTubeエモートURLの許可条件は下記候補。現在の実サービス応答は未実証 |
| 保存・移行 | [SettingsStore.readSavedSettings](../../src/main/core/settings/store.ts:36)、[readStoredSettings](../../src/main/core/settings/stored-format.ts:9)。[settings](../../tests/settings.test.ts:530)の自動接続・取得間隔、互換試験で現行保持と旧退避を分離 | 実ストレージ容量不足/OS置換失敗は故障注入と別 |
| 起動終了 | [SourceConnections.stop](../../src/main/sources/source-connections.ts:96)が世代を先に更新。[source-connections-startup](../../tests/source-connections-startup.test.ts)、[local-server-startup](../../tests/local-server-startup.test.ts:151)に初期確認中終了/停止、[app-state](../../tests/app-state.test.ts:323)に全停止と履歴消去 | OS強制終了後の実再起動は今回未実証 |
| 切断復旧 | [YouTubeSource.run](../../src/main/sources/youtube-source.ts:92)、[TwitchSource.connect](../../src/main/sources/twitch-source.ts:95)、[withSourceRequestDeadline](../../src/main/sources/source-request.ts:4)。[source-lifecycle](../../tests/source-lifecycle.test.ts:221)の履歴再確立、[twitch-source-lifecycle](../../tests/twitch-source-lifecycle.test.ts)、[source-request-lifecycle](../../tests/source-request-lifecycle.test.ts)の本文期限・取消 | 実サービスのレート制限/配信終了/IRC断は未実証 |
| 非同期競合 | SourceConnectionsのadapter一致+stopGenerationsで全callbackを門番化。[useCommentSourceActions](../../src/renderer/use-comment-source-actions.ts:48)の対象枠保存と[dashboard-source-start](../../tests/dashboard-source-start.test.tsx)の先行保存/別枠入力保持 | 上記単体で実サービス到達性は証明しない |
| 公開認証 | 取得はログイン不要。AI投稿用資格と分離。[LocalAccess](../../src/main/server/local-access.ts)、[local-view-projections](../../src/main/server/local-view-projections.ts)が接続先を読取面へ出さない | エモート画像の通常面URL受理は仕様定義不足として別記 |
| 連携 | [AppState.acceptComment](../../src/main/core/app-state.ts:374)がフィルター→store→AI/event→新着のみOBS/音声。[app-state](../../tests/app-state.test.ts:197)、[jpnkn-app-state](../../tests/jpnkn-app-state.test.ts)、次スレッド進捗の専用試験 | 実接続の同時長時間利用は未実証 |

## 2. コメントフィルター

所有: [comment-filter](../features/comment-filter.md)。独自ネットワーク接続/ワーカーを持たず、受信入口とローカル判定テストを共有する。

| 条件 | 具体的コード経路/試験の根拠 | 残る条件 |
| --- | --- | --- |
| 正常・境界・異常 | [evaluateCommentFilter/isAsciiArt](../../src/shared/comment-filter.ts:9)はNFKC→小文字、登録順/投稿者優先、CR正規化、UnicodeコードポイントとL/N/Mで計数。[comment-filter](../../tests/comment-filter.test.ts:23)は本文/投稿者/alt/AA/通常文/URL/顔文字 | 2行、合計7/8字、各2/3字、50%ちょうど/直前、CR/CRLF、結合文字の直接境界ケースが不足。実装は>=条件だが試験成功と同一視しない |
| 保存・移行 | [validateCommentFilterSettings](../../src/main/core/comment-filter.ts:12)とcanonicalizeNgWords。[settings](../../tests/settings.test.ts:441)の空行/前後空白/正規化重複、[comment-filter-editing](../../tests/comment-filter-editing.test.tsx)の保存失敗 | 大量NGの上限は所有仕様に定義なし。推測の制限を追加しない |
| 起動終了 | 設定だけ復元、除外本文/理由/件数は保存しない。CommentStore.clearでseenを破棄。[app-state](../../tests/app-state.test.ts:323) | フィルター固有の終了資源なし |
| 切断復旧 | 除外IDをmarkSeenし、同一配信セッションの再受信でも復活しない。[app-state](../../tests/app-state.test.ts:159) | 新しい配信セッションでは再判定となる。過去セッション永続IDを導入しない |
| 非同期競合 | [useCommentFilterEditing.toggleAsciiArt](../../src/renderer/use-comment-filter-editing.ts:22)は最新保存値へスイッチだけマージ、editVersionで新入力を戻さない。[comment-filter-editing](../../tests/comment-filter-editing.test.tsx)、[auto-saving-settings](../../tests/auto-saving-settings.test.tsx:95) | 実描画の位置は別のlayout試験に委ねる |
| 公開認証 | testerは[CommentFilterPanel](../../src/renderer/components/CommentFilterPanel.tsx)内の純粋関数、入力はAPI/WS/ブラウザー保存へ送らない。[comment-filter-panel](../../tests/comment-filter-panel.test.tsx)にローカル判定と画面保持 | 任意HTMLもReact文字列。外部投稿しない |
| 連携 | AppStateでsequence前に判定し、例外でも当該IDをmarkSeenして破棄。[app-state](../../tests/app-state.test.ts:134)に表示/OBS/PC/スマホ除外、[183行](../../tests/app-state.test.ts:183)に不正コメント後の受信継続 | AI入力も判定後のstore受理結果だけ。内部システム案内は判定対象外 |

## 3. 掲示板次スレッド

所有: [shitaraba-next-thread](../features/shitaraba-next-thread.md)。実投稿は行っていない。

| 条件 | 具体的コード経路/試験の根拠 | 残る条件 |
| --- | --- | --- |
| 正常・境界・異常 | [controller](../../src/main/shitaraba/shitaraba-next-thread-controller.ts:27)のobserveResponseNumber/performCreation、plannedContent。[shitaraba-next-thread](../../tests/shitaraba-next-thread.test.ts:226)同名0/1/複数、[76行](../../tests/shitaraba-next-thread.test.ts:76)閾値引下げ、[474行](../../tests/shitaraba-next-thread.test.ts:474)inputRequired、write-adapter各試験 | 現在の公開フォーム/CP932受理・実認証要求は未実証 |
| 保存・移行 | 設定はsettings、作成試行/内容/URLはcontroller内。[再起動試験](../../tests/shitaraba-next-thread.test.ts:690)は新controllerで同名照会、[settings](../../tests/settings.test.ts:450)は名前#やテンプレートの検証 | 強制終了した実POST結果は未実証。再送しない方針を維持 |
| 起動終了 | initializeの受動照会、disposeでstopping.abort。[終了後同名照会](../../tests/shitaraba-next-thread.test.ts:188)、[待機後案内](../../tests/shitaraba-next-thread.test.ts:207)は外部送信しない | 実送信済み要求は取り消しを成功取消と解釈しない |
| 切断復旧 | 送信前failed、送信後uncertain、browserRequiredを分離。[392行](../../tests/shitaraba-next-thread.test.ts:392)、[724行](../../tests/shitaraba-next-thread.test.ts:724)、[jpnkn-write-adapter](../../tests/jpnkn-write-adapter.test.ts) | 実断線・作成済みURLの外部事実は本人確認が必要 |
| 非同期競合 | context(key,generation)、operation/switchOperation、attemptedContentを保存fetchから保護。[14行](../../tests/shitaraba-next-thread.test.ts:14)旧案内完了後に新条件を再評価、[575行](../../tests/shitaraba-next-thread.test.ts:575)切替中設定を旧URLへ戻さない | 作成中に別URLへ移っても旧POST自体は既に送信済みであり、旧応答を現行状態へ混入させない |
| 公開認証 | createNow/resolveは管理API。[LocalAccess](../../src/main/server/local-access.ts)、[local-server](../../tests/local-server.test.ts)のHost/Origin/操作token。URL登録は同じboard+異thread+HTTPS。[611行](../../tests/shitaraba-next-thread.test.ts:611) | 実投稿/URL案内は追加の具体的許可がないため行わない |
| 連携 | 自動切替はboardのみ、システム案内は履歴/OBSへ入れない。[511行](../../tests/shitaraba-next-thread.test.ts:511)、[832行](../../tests/shitaraba-next-thread.test.ts:832)、[870行](../../tests/shitaraba-next-thread.test.ts:870) | 実音声・実外部投稿との結合は別途 |

## 4. コメント一覧

所有: [comment-list](../features/comment-list.md)。通常一覧と管理画面内feedのスクロール処理は別実装として扱う。

| 条件 | 具体的コード経路/試験の根拠 | 残る条件 |
| --- | --- | --- |
| 正常・境界・異常 | [CommentListView](../../src/renderer/components/CommentListView.tsx:6)と[CommentItem](../../src/renderer/components/CommentItem.tsx:5)、[CommentStore](../../src/main/core/comment-store.ts:12)。[comment-list-page](../../tests/comment-list-page.test.tsx:28)方向/追従、[comment-store](../../tests/comment-store.test.ts:5)上限とseen保持 | [management-studio fixture](../../tests/fixtures/management-studio-checks.mjs:312)の10,000件・8秒budgetは管理内feedであり、独立/ブラウザCommentListViewの10,000件性能を証明しない |
| 保存・移行 | 表示項目と外観はcommentList、OBS設定と独立。[settings](../../tests/settings.test.ts:564)全非表示拒否、[comment-list-panel](../../tests/comment-list-panel.test.tsx)プレビュー | 一覧本文・追従状態は永続化しない |
| 起動終了 | 独立窓の位置/表示をElectron保存、AppState.disposeでstore.clear。[independent-window-controller](../../tests/independent-window-controller.test.ts)、[comment-list-window-actions](../../tests/comment-list-window-actions.test.ts)、[electron-startup](../../tests/electron-startup.test.ts) | 現実の複数ディスプレイ着脱/最大化・再起動はモックと別 |
| 切断復旧 | [useApplicationState](../../src/renderer/api.ts:157)のsnapshot正/イベント受理、connectedを別表示。[websocket](../../tests/websocket.test.ts)、[mobile-comments-page](../../tests/mobile-comments-page.test.tsx) | 実ネットワーク断の読返し位置と再同期の実描画は未実証 |
| 非同期競合 | memo行のprops維持、変更のない本文再処理削減。[comment-list-render-work](../../tests/comment-list-render-work.test.tsx)。管理feedは[ManagementCommentFeed](../../src/renderer/components/ManagementWorkspace.tsx:104)でanchor/sequence保持 | CommentListViewでnewestTop追従停止中の先頭挿入・上限削除とブラウザscroll anchoringの組合せは直接実描画が不足 |
| 公開認証 | linkedTextはhttp(s)/省略hだけ、target blank+noopener。独立窓は[comment-list-window-actions](../../src/shared/comment-list-window-actions.ts:29)のprotocol検証。公開射影は管理情報を含めない | 実OS既定ブラウザ起動、選択→クリップボード内容の全経路は未実証 |
| 連携 | 共通履歴で初回/新着両方、OBS表示時間/音声キューを一覧へ逆流させない。[app-state](../../tests/app-state.test.ts:197)、[local-view-projections](../../tests/local-view-projections.test.ts) | 画像失敗はimg altへフォールバック。URL許可範囲は下記要確認 |

## 5. コメント読み上げ

所有: [comment-speech](../features/comment-speech.md)。前回の本文連結と話者更新修正を保全。

| 条件 | 具体的コード経路/試験の根拠 | 残る条件 |
| --- | --- | --- |
| 正常・境界・異常 | [buildSpeechText](../../src/main/speech/speech-text.ts:10)連結/URL/emoji/コードポイント長、[CommentSpeechController.enqueue/process](../../src/main/speech/comment-speech-controller.ts:113)待ち10・最古破棄・復旧1回。[speech-text](../../tests/speech-text.test.ts:18)、[comment-speech-controller](../../tests/comment-speech-controller.test.ts)、[audit-comments](../../tests/audit-comments-2026-10-24.test.ts) | 実VOICEVOXの現話者一覧/合成応答は未実証 |
| 保存・移行 | 保存は話者組と数値のみ。実行パスはSettingsStore専用。[settings](../../tests/settings.test.ts:493)パス並行保存、[514行](../../tests/settings.test.ts:514)値範囲 | テスト条件2の「本文だけ既定」は最新の投稿者ONと矛盾。推測で製品を変更しない |
| 起動終了 | [VoicevoxAdapter.prepareEngine/shutdown](../../src/main/speech/voicevox-adapter.ts:60)、所有プロセスのみkill。[voicevox-adapter](../../tests/voicevox-adapter.test.ts)、[electron-audio-player](../../tests/electron-audio-player.test.ts)初期化停止/終了/再利用 | Windows既存/自動起動CPU/既定出力/所有停止の実VOICEVOX確認は不足 |
| 切断復旧 | [request](../../src/main/speech/voicevox-adapter.ts:202)が本文までdeadline、[speech-operation-deadlines](../../tests/speech-operation-deadlines.test.ts)実loopback本文停止と取消。controllerは1復旧後後続へ | real engineクラッシュと音声出力デバイス抜差しは未実証 |
| 非同期競合 | clearでgeneration++、process各await後に比較。listVoicesはensureReady(true)で進行準備共有。[audit-comments](../../tests/audit-comments-2026-10-24.test.ts)失敗→更新/終了後の遅い準備、既存controller試験の旧合成/再生完了 | 実エンジンの更新中利用は自動試験と別 |
| 公開認証 | 管理APIで一覧/試聴/パス選択。パスはsnapshot外、WAVメモリ。[local-server](../../tests/local-server.test.ts)、[local-view-projections](../../tests/local-view-projections.test.ts) | VOICEVOX応答の生本文を利用者警告へ出さない |
| 連携 | 同期は準備後表示→音声→2秒、失敗前/後でfallbackを分離。AppStateのWAV共有、previewは専用playerと購読時点受信者。[app-state](../../tests/app-state.test.ts:505)、[560行](../../tests/app-state.test.ts:560)、[speech-preview-routing](../../tests/speech-preview-routing.test.ts) | PC/Androidで同じ固定試聴が実際に聞こえることは未実証 |

## 6. スマホでコメントを聞く

所有: [mobile-speech](../features/mobile-speech.md)。直接接続の証明書/資格・Androidサービス実機条件は別担当の通信/Android照合へ参照する。

| 条件 | 具体的コード経路/試験の根拠 | 残る条件 |
| --- | --- | --- |
| 正常・境界・異常 | [MobileSpeechController](../../src/main/speech/mobile-speech-controller.ts:58)接続別current/queue/prefetch、15秒、共有prepared+参照解放。[controller試験](../../tests/mobile-speech-controller.test.ts:33)15秒/開始済み保持、[136行](../../tests/mobile-speech-controller.test.ts:136)10件/音声ID失効 | 15秒ちょうどを<=で破棄する。複数実端末長時間は未実証 |
| 保存・移行 | bitrateだけ一般設定、公開選択はスマホ台帳由来。[AppState.effectiveMobileSettings](../../src/main/core/app-state.ts)、[app-state](../../tests/app-state.test.ts:542)旧公開flagのみで開始しない | URL/IP/購読/音声の永続化なし |
| 起動終了 | [MobileSpeechController.shutdown](../../src/main/speech/mobile-speech-controller.ts:215)stop全接続→transcoder終了、[FfmpegTranscoder](../../src/main/speech/ffmpeg-transcoder.ts)所有プロセスkill | 実Android OS再生成/再起動時の希望保持は別担当・未実証部分あり |
| 切断復旧 | [MobileReadSession](../../src/main/server/mobile-read-session.ts:10)heartbeat/closeで接続の購読を破棄。[mobile-comments-page](../../tests/mobile-comments-page.test.tsx)開始希望とautoplay拒否、[speech-operation-deadlines](../../tests/speech-operation-deadlines.test.ts)変換期限後の後続回復 | 4G/5G、Tailscale direct/DERP、実lock/background復帰は未実証 |
| 非同期競合 | 配信中にstop後同id再開もSubscription実体比較で旧deliver破棄。createPreviewReceiverは開始時の実体固定。[122行](../../tests/mobile-speech-controller.test.ts:122)試聴対象固定、[100行](../../tests/mobile-speech-controller.test.ts:100)遅い1台の分離 | 変換完了済み音声を新購読へ遡及しない |
| 公開認証 | LAN/Tailscaleは別許可リスト、Host実待受のみ、directは認証付き射影。[mobile-read-session](../../src/main/server/mobile-read-session.ts:100)に版/世代/型チェック、[local-server](../../tests/local-server.test.ts)と通信試験 | 実TailscaleはStoppedという全体担当の環境証拠。CLI/仮想入力成功は接続成功ではない |
| 連携 | [prepareAudio](../../src/main/speech/mobile-speech-controller.ts:308)はPC同WAV参照、AAC変換は独立。[74行](../../tests/mobile-speech-controller.test.ts:74)複数台共有変換、[156行](../../tests/mobile-speech-controller.test.ts:156)FFmpeg障害分離 | 現行端末binary/ソース一致と実音声出力は別確認 |

## 7. ローカルアプリケーション

所有: [local-application](../features/local-application.md)。個別機能の処理完了を管理起動準備と同一視しない。

| 条件 | 具体的コード経路/試験の根拠 | 残る条件 |
| --- | --- | --- |
| 正常・境界・異常 | [createHttpApplication](../../src/main/server/local-server.ts:59)管理REST、設定section検証、LocalAccess。[local-server](../../tests/local-server.test.ts)、[settings](../../tests/settings.test.ts:576)port1024/65535と表示値 | 実ポート競合のOS UI復旧、全周辺ソフト共存は未実証 |
| 保存・移行 | [atomicBytes/replaceRetiredBytes/compatibilityNotice](../../src/main/core/compatibility-storage.ts:8)はtemp→fsync→rename、退避hash/再読込/復元/不一致停止。[compatibility-storage](../../tests/compatibility-storage.test.ts:10)、[compatibility-replacement](../../tests/compatibility-replacement.test.ts:41)、settings | 作業ツリーTEMP rename拒否のOS背景は未解明。ローカル注入試験が成功しても実拒否の原因解消とはしない |
| 起動終了 | [AppState.shutdown](../../src/main/core/app-state.ts:726)stoppingとsource世代を先に更新、サービス失敗をallSettled/stopServiceで分離。[electron-startup](../../tests/electron-startup.test.ts:220)、[local-server-startup](../../tests/local-server-startup.test.ts:27)受理済み保存保持/1.5秒未完了通信閉鎖/次世代保護 | 実Windowsクラッシュ/強制電源断は未実証 |
| 切断復旧 | バックエンドとrenderer切断、ポート変更は再起動後、固定URL維持。[electron-startup](../../tests/electron-startup.test.ts:350)、[websocket](../../tests/websocket.test.ts) | 本番配布版の復旧/インストーラー更新は今回配布物を生成しないため対象環境未実証 |
| 非同期競合 | AppState.settingsUpdateQueueとSettingsStore.saveQueue。[app-state](../../tests/app-state.test.ts:18)窓/一般設定両順序、[361行](../../tests/app-state.test.ts:361)section直列、[395行](../../tests/app-state.test.ts:395)失敗で制御不変 | 前回の窓状態部分保存修正を維持 |
| 公開認証 | [LocalAccess](../../src/main/server/local-access.ts)、[readOnlySnapshot/Event](../../src/main/server/local-view-projections.ts)許可項目だけ、管理token/Host/Origin。local-server/retired-management-routes/local-view-projectionsの応答照合 | 実別マシンからの拒否試験はlocalhost駆動と別 |
| 連携 | 起動は外部準備を待たず、終了はスマホ閉鎖を保存前に始める。共通設定更新は検証→永続化→利用側適用。[local-server-startup](../../tests/local-server-startup.test.ts:125)、[app-state](../../tests/app-state.test.ts:36)ワーカー故障でも残りを解放 | 実SCM/UAC/ルーターは直接接続担当の未確認条件と参照し合う |

## 8. 管理画面

所有: [management-screen](../features/management-screen.md)。機能名数より、現行editor定義と全利用先が基準。

| 条件 | 具体的コード経路/試験の根拠 | 残る条件 |
| --- | --- | --- |
| 正常・境界・異常 | [ManagementShell](../../src/renderer/components/ManagementShell.tsx)、[ManagementEditorHeading](../../src/renderer/components/ManagementEditorHeading.tsx)、[management-navigation](../../src/renderer/management-navigation.ts)。[management-settings-categories](../../tests/management-settings-categories.test.tsx)、[management-editor-heading](../../tests/management-editor-heading.test.tsx)、studio描画で入口/最狭幅/文字サイズ | 受入1の14と現行表15の文書不整合。旧件数で入口を削らない |
| 保存・移行 | [useAutoSavingSettings](../../src/renderer/use-auto-saving-settings.ts:38)はdirty/version/persistedと500ms、共通section直列。[auto-saving-settings](../../tests/auto-saving-settings.test.tsx:95)同section置換/他section保持/失敗入力 | OS保存失敗はローカル保存条件へ参照 |
| 起動終了 | Dashboardの共有hook所有でeditor往復してもdraftを維持。management-window-close/openはElectron寿命を分離。[management-window-close](../../tests/management-window-close.test.ts)、[management-window-open](../../tests/management-window-open.test.ts) | 実窓の最小寸法/OS倍率は自動jsdomと別 |
| 切断復旧 | api.tsのconnectedとsnapshot、警告は消さず要確認へ。[management-warnings](../../tests/management-warnings.test.tsx:72)、[99行](../../tests/management-warnings.test.tsx:99)全解消もモーダル維持 | 実backend crash後の全UI往復は未実証 |
| 非同期競合 | [useManagementHistory](../../src/renderer/use-management-history.ts:17)generationで古いrestoreを隔離。[management-history](../../tests/management-history.test.tsx:33)、[history-rendering](../../tests/management-history-rendering.test.ts)。toastは置換ごと4秒を再設定 | 通知のDOM存在だけを位置保証としない。実描画の座標判定を別試験に保持 |
| 公開認証 | 管理HTMLだけtoken、URL/コピー明示操作、管理専用PC数値/進行/窓情報は公開投影外。local-server/local-view-projections | 実既定ブラウザ/Explorer起動は別確認 |
| 連携 | [ManagementWorkspace](../../src/renderer/components/ManagementWorkspace.tsx:169)は保存ONと実稼働/障害を分離。[management-studio](../../tests/management-studio.test.tsx)、[management-notifications-layout](../../tests/management-notifications-layout.test.ts)通知矩形・本文高さ・focus | 全機能の通知が常時重複せず警告へ到達することは各機能テストとも照合する。追加root変更に応じ再実行 |

## 9. 初回設定

所有: [initial-setup](../features/initial-setup.md)。選択/本人確認と実サービス成功を別に扱う。

| 条件 | 具体的コード経路/試験の根拠 | 残る条件 |
| --- | --- | --- |
| 正常・境界・異常 | [initialSetupSteps/setupConfigured](../../src/shared/initial-setup.ts:53)は8選択と依存手順を一意順にする。[initial-setup-store](../../tests/initial-setup-store.test.ts:31)、[initial-setup-ui](../../tests/initial-setup-ui.test.tsx)、entry/creative/device/flow描画 | 全選択256組×smartphone用途8組の網羅を主張しない。複合経路は各代表の証拠 |
| 保存・移行 | [InitialSetupStore.load/update/parseRecord](../../src/main/core/initial-setup-store.ts:12)、専用版1とrevision。[store](../../tests/initial-setup-store.test.ts:20)firstRun、[65行](../../tests/initial-setup-store.test.ts:65)破損原本/保存失敗、取消失敗 | 未知版/破損で自動初期化しない。実disk不足は未実証 |
| 起動終了 | firstRunは一般設定不在だけ、recordを優先。専用保存はatomicBytes。入口操作は機能起動を含めない。[initial-setup-entry](../../tests/initial-setup-entry.test.tsx)、[store](../../tests/initial-setup-store.test.ts:38)中断後復元 | 実OS再起動を全経路で通してはいない |
| 切断復旧 | 操作失敗後に同revisionで再試行、record warning中はreloadだけ。[initial-setup-store](../../tests/initial-setup-store.test.ts:65)、recovery fixture | 実backend切断中の進行応答喪失は成功の推測不可。最新snapshotで照合 |
| 非同期競合 | update.queue内で期待revision照合、confirmは最新snapshotのfingerprintとconfiguredを照合。[38行](../../tests/initial-setup-store.test.ts:38)同版並行拒否、[145行](../../tests/initial-setup-store.test.ts:145)port/資格/OBS対象で失効 | 実サービスが止まることと設定指紋失効は別。確認は前回の本人記録 |
| 公開認証 | [管理API試験](../../tests/initial-setup-store.test.ts:106)Host/Origin/token/余分keyと公開snapshot/event除外。記録はhashだけで本文/秘密を保存しない | 実AI投稿/OBS配信開始は初回設定の操作対象外であり試さない |
| 連携 | [InitialSetupConfirmation](../../src/renderer/components/InitialSetup.tsx:132)はchecked取消と未準備禁止を分離、既存各feature操作を再利用。[192行](../../tests/initial-setup-store.test.ts:192)VOICEVOX/OBS変更で失効、[initial-setup-creative-review](../../tests/initial-setup-creative-review.test.tsx) | 実音声が聞こえた/実OBS表示/実スマホ利用は本人の確認であり、fixtureの見本表示で代替しない |

## 根拠のある候補と不足条件

0. **P2: 個別HTTP操作の遅いsnapshotが新しい共有状態を巻き戻す。** [useApplicationState.uploadAsset](../../src/renderer/api.ts:290)は一般mutateのrevision検証を通らず、応答snapshotを無条件setSnapshotする。サーバーの[素材登録応答](../../src/main/server/local-server.ts:372)はrevisionを含めない。要求A→新しいWS snapshot B(revision5)→遅延HTTP Aという順序で、コメント/認識設定/接続状態を含むB全体を古いAへ戻す具体経路を確認。[renderer-api](../../tests/renderer-api.test.tsx:65)の版なし旧応答の回帰はmutate/sourceActionだけで、uploadを含まない。同じ抜け道が[smartphoneDirectAction](../../src/renderer/api.ts:408)にもある。対してobsSourceAdd/obsTestActionは既にrevisionを比較する。根拠と再現試験案をrootへ報告し、rootの製品修正・回帰検証へ引き渡した（この担当では未実行）。影響は素材アップロード元の通常設定/初回設定と、直接接続操作元、同じhookが表示する他機能全体。
1. **YouTubeエモート画像の通常面の許可条件が未定義。** [parseYouTubeActions](../../src/main/sources/youtube-source.ts:48)は外部応答のurlが非空文字列ならそのままemoteへ入れ、[CommentItem](../../src/renderer/components/CommentItem.tsx:36)がimg.srcへ渡す。[取得仕様](../features/comment-acquisition.md#共通コメント契約)には「許可された画像URL」とあるが、protocol・host・userinfo・privateの具体的な許可集合は定義されていない。[direct-assets.project](../../src/main/smartphone/direct-assets.ts:17)だけにはhttps/6host等の制限がある。通常面へその6hostを移すことは仕様判断を含むため、今回の確定修正とはしない。非https/資格情報/ローカル宛ての扱いと、非対応公式hostの代替テキストへの変換を所有文書で明確にしてからsource-parser/render利用側を検証する候補。rootへ報告済み。
2. **Twitchの不正emote範囲は未検証。** [parseTwitchMessage](../../src/main/sources/twitch-source.ts:12)は整数なら負数・逆転・重なり・本文超過の範囲を受け、cursorを無条件更新する。例 `emotes=25:0-4/26:2-3` と本文 `Kappa hello` では元本文へ重複した範囲が追加される具体経路。正常なサービス応答を不正とみなす根拠はなく、実発生を主張しない。不正コメント破棄という現行契約に沿うparser再現試験を追加する候補であり、任意の範囲修復規則は推測しない。
3. **AA閾値の直前/ちょうどとUnicode条件の試験不足。** 上表のコードは所有仕様の>=と一致するが代表例だけでは境界は未実証。製品を変更せず試験補強で確認できる。rootへ報告済み。
4. **10,000件性能の対象差。** 管理feedの既存描画測定は見つかったが、独立/通常ブラウザのCommentListViewについて同じ件数・読返し・選択/コピーまで測る証拠は特定できなかった。共通CommentItemの再利用だけで性能条件全体を実証済みとしない。
5. **古い所有文書記述。** comment-speechテスト条件2の既定、management受入1の領域数は最新具体節と矛盾。comment-list末尾の「既存テストが存在しない」も現在の試験ファイルとは一致しない（製品動作矛盾ではない）。正式仕様の整理と製品修正を分ける。

## 現時点の実証範囲と次の作業

この担当は静的調査のみ。前回修正が現在のコードに存在することを確認したが、前回の緑を追加差分の成功へ転記していない。rootが追加する修正・試験を含む関連群→lint/型→最後の全体→buildの結果を待つ。実VOICEVOX、Windows既定出力、外部サービス現在応答/投稿、独立一覧のOS操作、複数スマホ音声/長時間、Tailscale direct/DERP、実ストレージ異常は今回の担当では未実証。接続済みAndroidの合成JPEG/GPUテストは別条件の証拠であり、この9機能の実サービス結合成功へ繰り上げない。
