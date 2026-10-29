# 追加条件別照合: スマホ・OBS表示・音声認識・AI

2026-10-24。親の[追加調査台帳](audit-2026-10-24-conditions.md)の分担記録。13機能を対象とし、OBS配信操作、OBS映像確認、Android手書き合成は親担当に分離する。これらとの連携境界は対象に含める。前回の[スマホ記録](audit-2026-10-24-mobile.md)と[OBS/AI記録](audit-2026-10-24-obs-ai.md)を入口に、現在のコード・試験の具体的条件へ戻って照合した。

本担当は製品編集・試験実行・実機操作を行っていない。以下の「試験」は現在存在する検証コードの根拠であり、この担当による成功結果ではない。現在差分の成功結果は親台帳へ集約する。導入済みAndroid 12の局所試験、OBS 32.2.2の導入確認を、現行Android全体・実OBS結合・実回線の実証へ拡張しない。

## 調査規則と用語

[AGENTS.md](../../AGENTS.md)、[SPEC](../../SPEC.md)、[運用手順](../development-workflow.md)の読み取り判断表・検証・レビューを確認した。REST/WS/認証の共通所有は[ローカルアプリ](../features/local-application.md)、画面の通知・移動保持は[管理画面](../features/management-screen.md)。正式用語は[CONTEXT](../../CONTEXT.md)のスマホ登録、接続世代、外配信セッション、OBS配信、共有記憶、認識セッション、OBS表示テスト等に従う。OBS配信とスマホ送信、準備済みと到達確認、試験用架空表示と通常結果を分けた。

関連する判断の入口はADR [0019](../adr/0019-consolidate-smartphone-transports.md)、[0020](../adr/0020-adopt-smartphone-direct-connection.md)、[0021](../adr/0021-unify-smartphone-connection-preparation.md)、[0025](../adr/0025-adopt-outdoor-speech-recognition.md)、[0026](../adr/0026-device-shared-obs-input.md)、[0029](../adr/0029-direct-firewall-service.md)、[0018](../adr/0018-native-srt-and-local-receiver.md)、[0016](../adr/0016-redesign-outdoor-adaptation.md)、[0010](../adr/0010-adopt-native-android-client.md)、[0009](../adr/0009-use-tailscale-private-network-for-mobile-speech.md)、[0023](../adr/0023-adopt-obs-source-registration.md)、[0006](../adr/0006-isolate-speech-recognition-in-dotnet-worker.md)、[0008](../adr/0008-use-parakeet-ctc-as-fixed-speech-recognition-model.md)、[0013](../adr/0013-adopt-ai-listener.md)。

各表は正常・境界・異常/復旧・保存/移行・起動終了・非同期競合・公開認証・他機能連携を、同じコード経路を繰り返さない粒度にまとめる。状態の非永続化は保存条件の適用除外であり、機能全体の保存調査を省いた意味ではない。

## PC・スマホ間の通信

所有: [smartphone-transport](../features/smartphone-transport.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/版の境界 | [制御セッション](../../src/main/smartphone/smartphone-control-session.ts)のUpgrade・subscribeは登録資格必須、版2/3を選び、認識topicは版3だけ。[制御試験](../../tests/smartphone-control-session.test.ts)は版、用途、他端末混入拒否を駆動する | 実Androidとの版2降格・登録更新後版3再接続はこの担当未実施 |
| 大量/遅い読取/バイナリ | [読取セッション](../../src/main/server/mobile-read-session.ts)、[読取試験](../../tests/mobile-read-session.test.ts)のsnapshot分割、新着優先、音声36バイトheader、上限/世代。制御captureは画像ACKを待って送出量を制限 | 実回線p95の各30標本、半開き・長時間・複数端末を未測定 |
| 切断/再購読/終了/競合 | 制御`validate`、close時unsubscribe/confirmation取消、generation、登録通知完了時の再確認。Android ManagedSocketと共有接続が貸借し最後の利用者で閉じる。[更新試験](../../tests/smartphone-update-contract.test.ts)は遅い登録通知を検証 | 実PC再起動・OSネットワーク切替とSRT継続を未実証 |
| 保存/公開/連携 | 接続自体は非永続。登録資格と候補は登録所有。読取と制御の2本、制御断でSRTを停止しない構造。直接接続資産は下記DNS期限漏れ | 既存自動試験をTLS実回線や端末背景動作の代替にしない |

## スマホ連携

所有: [smartphone-integration](../features/smartphone-integration.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/境界 | [controller](../../src/main/smartphone/smartphone-controller.ts)のconfigureは保存キュー、排他的activeNetwork、非選択側編集の接続維持。[controller試験](../../tests/smartphone-controller.test.ts)は保存成功後に旧公開を閉じ、新公開を開く順序を検証 | 実Tailscale停止中のためその実到達は未確認 |
| 登録/複数台/応答消失 | [enrollment](../../src/main/smartphone/smartphone-enrollment.ts)のparseEnrollment/enrollDeviceはclientIdと秘密hash、previousのPC/端末証明を確認。再要求で同じ端末を解決し、名前を認証に使わない | 共通QRを複数実端末で連続登録、保存成功/応答消失の実回線は未確認 |
| 保存移行/起動終了/競合 | [store](../../src/main/smartphone/smartphone-store.ts)のload/save、[移行試験](../../tests/smartphone-store-migration.test.ts)。controller試験は起動load/save/listen中終了、次起動へ遅い旧結果の混入、停止中の保存順序を駆動 | 原本退避/実ディスク拒否と実プロセス強制終了の全組合せは未実施 |
| 公開/連携 | [管理routes](../../src/main/server/smartphone-management-routes.ts)と用途別資格。端末共通OBS入力は経路切替でも固定。前回direct部分更新のnetwork必須修正とUI3経路の呼出しを保持 | 前回修正を新規発見と数えない。OBS実入力表示は親実OBS確認へ |

## PC・スマホ直接接続

所有: [smartphone-direct-connection](../features/smartphone-direct-connection.md)、資産取得期限は[通信仕様76行](../features/smartphone-transport.md#直接接続のhttpswssと用途別認証)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 候補/到達/片系統故障 | [runtime](../../src/main/smartphone/direct-runtime.ts)のview、connected、reachedCandidates、udpBaseline。[runtime試験](../../tests/direct-runtime.test.ts)はTCP切断、候補tuple世代、複数UDP候補の曖昧さと集合削減を検証 | 実IPv4/IPv6、TCPとSRT別family、実上流NAT未確認 |
| 公開/認証/入口制限 | [server](../../src/main/smartphone/direct-server.ts)はHost/local address/Origin、用途別資格、no-store、独立資産許可リスト。[server試験](../../tests/direct-server.test.ts)は失効中画像取得のHTTP切断を駆動 | CDN本体取得は既存試験で差替え。DNSを含む5秒と失効による上流取得取消が不足（下記） |
| 保存/鍵/更新 | [identity](../../src/main/smartphone/direct-identity.ts)と[identity試験](../../tests/direct-identity.test.ts)、Android PinnedPcClientはPC鍵確認を他TLSから分離。鍵復元失敗を新鍵生成で回避しない | 実端末の同鍵証明書更新と全候補喪失QR復旧は未確認 |
| 起動終了/開放/故障分離 | runtimeはdesired/jobs/closings/cancellationを対象単位管理。[Windows](../../src/main/smartphone/direct-windows.ts)・[gateway](../../src/main/smartphone/direct-gateway.ts)と各試験は所有対象、拒否/取消、遅い開放の閉鎖を検証 | 実UAC/SCM、組織ポリシー、各ルーター、閉鎖残存は偽API成功で代替しない |

## Android外配信

所有: [outdoor-streaming](../features/outdoor-streaming.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/映像音声境界 | [PC receiver](../../src/main/outdoor/outdoor-receivers.ts)、Android OutdoorTransmission/OutdoorNativeSender/OutdoorService。[receiver試験](../../tests/outdoor-receivers.test.ts)、Android OutdoorContract/Transmission/TsMuxer試験がセッション・端末・音声映像を区別 | 現在導入済みAPKと現行ソース一致未証明。実カメラ/マイク/SRT→OBSを未実証 |
| 回線断/復旧/競合 | Android OutdoorAdaptiveControl/ReceiverEvidence/SendQueueは接続世代を持ち、動画復帰に新しい受信証拠を要求。OutdoorAdaptiveClosedLoop/NativeQueue/FrameEvidence試験 | 自動制御の実映像継続・復帰所要時間・長時間熱/電力は未測定 |
| 保存/手動操作/局所故障 | OutdoorPreferencesCompatibility、VideoFailure、VideoRecoveryAdaptation試験。手動非表示・ミュートを自動制御が解除しない。品質変更と再接続の入力再準備を分ける | 実前後カメラ・回転・USB/BT音声・GL再生成は個別の必要条件として残る |
| 終了/公開/連携 | receiver/reportは許可された数値と状態だけ、認識tapはPC所有ループバックから分岐。制御断と正常SRTを分離。診断書き出しは明示操作 | 実複数端末片故障、停止中のデバイス回収を未実証。手書きGLの局所試験は親記録参照 |

## Androidクライアント

所有: [android-mobile-client](../features/android-mobile-client.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/画面/境界 | MainActivity/CommentsWebView/WebViewLoadCoordinator、Android CommentsWebView/SmartphoneConnectionDialog/RegistrationWelcome試験。タブ保持、入力除外、仮想origin、両配色と狭幅 | Android 12局所試験をAndroid 10〜17、全画面、実送信継続の実証にしない |
| 保存/移行/資格失効 | RegistrationBundle/RegistrationStoreTransactionとRegistrationBundleStore/RegistrationUpdate/DirectRegistration試験。原本退避と失効を独立保存し、旧profile削除で別経路へ自動切替しない | 保存形式節の現行5記述は古い。現行6との矛盾を文書残件へ |
| 再生成/背景/フォーカス/終了 | [MobileAudioService](../../android/app/src/main/java/jp/casmate/app/audio/MobileAudioService.kt): onStartCommand/restoreAfterProcessRecreation/onTaskRemoved/onDestroy、focusChangeListener。喪失で購読・キュー破棄、開始希望保持。MobileAudioService/ButtonReceiver試験 | 実着信・他アプリ・Bluetooth・ロック画面・OS再生成/強制停止・電池最適化未実証 |
| 公開/認証/連携 | PinnedPcClient/DirectAssetsはネイティブ取得と鍵確認、WebViewへ秘密を渡さない。通知は内容を持たない。LocalNetworkAccessのAPI37権限を全入口で確認する設計 | API31実機はAPI37実行時権限の実証にならない。実現行APK導入は親判断 |

## OBSソース登録

所有: [obs-source-registration](../features/obs-source-registration.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/共有/複数候補 | [controller](../../src/main/obs/obs-source-registration-controller.ts)のinventory/register、defaultとinput実効値、UUID選択、treeItems循環検出。[登録試験](../../tests/obs-source-registration.test.ts)は4表示/端末共通入力/別シーン共有・不適合を駆動 | 実OBSの4表示、透明背景、スマホ未受信→受信表示は未確認 |
| 書込直前競合/部分失敗 | mutateは最初の書込直前にdestination/revisionを確認、書込後は確定sceneで継続。resumeは所有ID/initialTransform/desiredTransformと現在値を照合。応答喪失で再送/削除を推測しない | 物理的なOBSコレクション切替と同時操作は親担当へ |
| 保存/終了/再開 | 未完了jobは起動内保持、再起動後の実体を所有と推測しない。stopとsession世代で旧処理を拒否。入力設定保存ではなくOBS側読戻しで完了 | 永続的な登録履歴を新設する理由なし |
| 公開/連携 | [server試験](../../tests/obs-source-registration-server.test.ts)は管理認証、読取公開非混入。[表示テスト](../../src/main/obs/obs-source-test-controller.ts)は通常更新を止めず期限付きレイヤー。スマホメディアをテスト対象にしない | 実OBS占有とAndroid確認の同時可視性未確認 |

## OBSコメント表示

所有: [comment-overlay](../features/comment-overlay.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/件数/期限 | [controller](../../src/main/core/comment-overlay-controller.ts)のaccept/withExpiry/expireは初回除外、stack10、single待ち100、重複ID拒否。[試験](../../tests/comment-overlay.test.ts)で境界を駆動 | 実大量履歴時のOBS描画負荷未測定 |
| 設定/保存/競合 | updateSettingsはmode変更で専用表示をclear、時間変更は既存expiresAtを維持。保存・移行は[settings試験](../../tests/settings.test.ts)へ、既定変更で既存stackを巻き戻さない | 全項目非表示拒否はschema/UI所有、表示controller単体で受理可否を結論しない |
| 同期/停止/復旧 | startSynchronized/finishSynchronized/fallbackSynchronizedは読み上げIDと対応。[ページ](../../src/renderer/pages/CommentOverlayPage.tsx)は受信時/ローカルタイマーで期限照合。[expiry試験](../../tests/overlay-expiry.test.ts) | 音声実出力と複数OBS表示が切断中も同時に消える実環境未確認 |
| 公開/安全な描画 | [共通表示](../../src/renderer/components/OverlayViews.tsx)を使い本文をHTML解釈せず、表示テストは架空データだけを描画 | OBS透過・実エモート故障は未確認。jpnkn表示名は共通source変換との照合対象 |

## コメント文字演出

所有: [text-effects](../features/text-effects.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/Unicode/上限 | [matchTextEffects](../../src/main/core/text-effects.ts)はtext partごとのURL除去/NFKC、longestRunsを共有、保存順20個で打切り。[判定試験](../../tests/text-effects.test.ts)は50ルールとエモート境界を駆動 | 外部実コメントが全part形状を網羅する証拠とはしない |
| 異常/復旧/競合 | [描画ページ](../../src/renderer/pages/TextEffectsOverlayPage.tsx)はeventId重複抑止1000、空きだけ追加、期限監視はactive要素だけ。[接続試験](../../tests/overlay-connections.test.tsx)は遅いHTTP/旧socket/終了取消 | 実OBS非表示→復帰、短時間多数イベント、時計変更は未実証 |
| 保存/公開/連携 | 設定だけ保存し発火履歴をsnapshotへ復元しない。テスト再生は共通コメントを作らない。[panel試験](../../tests/text-effects-panel.test.tsx)は保存失敗・新規取消・構造変更の競合を対象 | 共通設定を閉じる古い受入項目は常時表示採用と矛盾。後述 |

## 簡易キャラクター表示

所有: [simple-character-display](../features/simple-character-display.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/素材境界/原子性 | [asset store](../../src/main/server/character-asset-store.ts)、PNG validation、[素材試験](../../tests/character-asset-store.test.ts)はCRC/展開/寸法と20MiB、8192px。保存時点の閉口寸法を基準に口開き参照を保存 | 正常PNGの読込を小さいmockだけで代替しない。実OBS最大素材負荷未測定 |
| 両レイヤー故障/復旧 | [CharacterImage](../../src/renderer/components/CharacterImage.tsx)はclosedSource placeholder時に開口/微動も止める。前回[audit回帰](../../tests/audit-character-fallback.test.tsx)を保持。openFailedは素材URL変更で解除 | 同じURLファイルを外部復元しただけで再読込する契約はなし。素材再登録とは分ける |
| 音声/世代/同期 | [controller](../../src/main/core/character-controller.ts)はactiveSpeechCommentId、微動共通時刻。start/stop/old mouth通知をID照合。[motion試験](../../tests/character-motion.test.ts) | 実音声停止/複数実OBS・独立窓の1フレーム以内同期未測定 |
| 保存/終了/公開 | 素材/微動/窓設定の部分保存は[更新試験](../../tests/character-settings-updates.test.ts)。口形/開始時刻/一時previewは非永続、失敗時rollback。管理操作はread-only公開から除外 | 設定スキーマ「現行13」記述が共通所有の16と矛盾 |

## 配信者音声認識

所有: [streamer-speech-recognition](../features/streamer-speech-recognition.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/共有/期間 | [controller](../../src/main/speech-recognition/speech-recognition-controller.ts)のisNeeded/ensureSession、renewVoiceCapturePeriod/isCurrentVoiceCapture。共有ON/OFFでmicを再起動せずOBS許可期間だけ更新。[前回回帰](../../tests/audit-obs-voice-sharing.test.ts) | 実マイク/固定モデルによる発話内容・精度未実証 |
| 入力切替/断復帰/競合 | [smartphone入力](../../src/main/speech-recognition/smartphone-recognition-input.ts)のsource/key/openは所有receiverInstance/connectionRevision/sessionId/generation一致だけ。controllerのinputEpoch/lease.enableは遅い開始を破棄。[入力試験](../../tests/smartphone-recognition-input.test.ts) | 実SRT受信・切替と共有認識を継続する全体経路未確認 |
| 設定保存/プレビュー/モデル異常 | applySettingsは適用時再起動、previewHistory50、WAV一時設定。worker JSON Lines検証とmodel managerを所有境界にする。[app-state](../../tests/speech-recognition-app-state.test.ts)、[worker](../../tests/speech-recognition-worker-client.test.ts) | 実モデル初回DL/ネットワーク断/容量不足、実WAV保存失敗未確認 |
| 終了/公開/連携 | shutdownはshuttingDown・inputLease解除、history破棄後worker.shutdown。handleWorkerEventはsessionIdを照合。通常公開へ認識内部情報を載せず、AI/OBSはそれぞれの利用許可を再確認 | 子プロセス強制終了と実デバイス回収は自動制御の代替としない |

## OBS音声認識表示

所有: [speech-recognition-overlay](../features/speech-recognition-overlay.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/空/期限 | [controller](../../src/main/core/speech-recognition-overlay-controller.ts)のaccept/updateEnabled/updateDuration。保存ONのみ、空白でclear、次結果から新期限、既存期限維持。[controller試験](../../tests/speech-recognition-overlay-controller.test.ts) | 実認識→OBS反映と日本語折返しは親実OBS確認へ |
| 切断/再接続/終了/競合 | [ページ](../../src/renderer/pages/SpeechRecognitionOverlayPage.tsx)はローカルexpiry、[接続試験](../../tests/overlay-connections.test.tsx)はWS優先/古いHTTP破棄/旧socket/終了取消 | 実OBS複数ブラウザの同期と長時間非表示復帰未確認 |
| 保存移行/公開/連携 | [projection](../../src/main/server/local-view-projections.ts)と専用APIはid/text/expiresAt/themeだけ。通常snapshotから認識表示・内部情報を排除。専用外観16移行は[設定試験](../../tests/speech-overlay-settings.test.ts) | 13〜15実保存物からの起動/退避/独立保持は自動fixtureと実利用環境を分ける |

## OBSデザイン編集

所有: [obs-style-editor](../features/obs-style-editor.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/両対象/境界 | [ObsDesignPage](../../src/renderer/pages/ObsDesignPage.tsx)、shared obs-design/saved-obs-designs。対象別履歴20、preset10、保存copy100、連番を維持。[page試験](../../tests/obs-design-page.test.tsx)、[保存試験](../../tests/saved-obs-designs.test.ts) | 表示操作の5秒timeout履歴は親の実行記録に従い、失敗を消さない |
| 保存失敗/競合/終了 | 対象ごと500ms自動保存、in-flight中最新集約、部分保存は他対象/時間を保持、未保存/不正入力/失敗でclose抑止。再試行同要求を重複copyにしない | 実OS終了/複数画面同時編集の全組合せ未実証 |
| 独立HTML/安全性 | [独立editor](../../src/renderer/obs-style-editor)のJSON形式1、未知key/範囲/1MiB、font CSS文字列escape。APIなし共通表示部品、見本文を通常コメントへ入れない | file://最終HTMLの実Chrome/Edge、外部要求ゼロと実OBS CSS反映は別々の確認が必要 |
| 保存移行/公開/連携 | 既存appearanceから初回designを導出し開くだけで保存しない。元画面の表示時間/項目と独立、保存copyは管理情報でread-onlyへ非混入 | 実OBS既存custom CSSで上書きされた時の案内/利用者確認は自動描画で代替しない |

## AIリスナー

所有: [ai-listener](../features/ai-listener.md)。

| 条件 | 現在の経路・試験根拠 | 不足/判断 |
| --- | --- | --- |
| 正常/待機/発話境界 | [AiController](../../src/main/ai/ai-controller.ts)のperform/contextAllowed/sendAllowed/verifyObs。最新世代・候補・接続先・1.5秒speech gapを生成前と投稿準備で照合。[controller試験](../../tests/ai-controller.test.ts)に発話中/旧結果/送信済み発話消費を分けたケース | 実モデルの文体/見送り品質・API quota/実OBS stateは未実証 |
| 投稿直前/保存中取消/結果不明 | performはbudget.reserve→sendAllowed→store.log→sendAllowed→sentの順。取消済み未送信本文をdiscardAttempt、送信後の旧結果はログに残し現在記憶へ戻さない。同試験の投稿枠保存中停止、投稿前log停止、送信済み結果を確認 | 実外部書込の許可なしに実投稿しない。fake post成功は実成功の証拠でない |
| メモリ削除/保存故障/終了 | clearMemoryNowはcancel→待機→空save、memoryWriterは実行中+最新1件へ集約。shutdownはworking/clearing/memory完了後budget checkpoint/store.flush。[memory試験](../../tests/ai-memory-buffer.test.ts)、[store試験](../../tests/ai-store.test.ts) | 実ディスク障害/強制kill後復旧の全条件未実証 |
| サービス分離/認証/再接続 | [connections](../../src/main/ai/ai-connections.ts)と[試験](../../tests/ai-connections.test.ts)。OAuthとGeminiキーを暗号化、投稿失敗をsource別errorsへ保持。OBS不明時休止、再確認で通常待機から復帰 | 実アカウント/refresh/失効・Gemini実API・掲示板実投稿は未確認 |
| 公開/映像/自己投稿 | local-view-projectionsはAI管理内容を通常公開から除外。[visual試験](../../tests/ai-visual-generation.test.ts)、[context試験](../../tests/ai-context.test.ts)は画像寿命/入力選別。[controller試験](../../tests/ai-controller.test.ts)は取得batch内の一意自己投稿照合を駆動 | 実OBS画像判読性・プロンプトの意味品質はコード照合だけで保証しない |

## 根拠のある新規修正候補

### 直接接続CDN取得のDNSが5秒期限外、失効/切断が上流処理へ伝わらない

- 所有文言: [smartphone-transport.md 76/79/80行](../features/smartphone-transport.md#direct-secure-transport)は取得5秒・512KiB、OFF/削除/再発行でHTTP資産取得終了、250ms失効監視と応答前再確認を要求。
- 発見時コード（親の修正前）: [direct-assets.ts](../../src/main/smartphone/direct-assets.ts)の`DirectCommentAssets.get`は`await lookup(hostname,{all:true})`後にHTTPS用`AbortSignal.timeout(5000)`を作る。DNSが解決しない間は期限が存在しない。DNS3秒ならHTTPS5秒と合計最大約8秒にもなる。
- [direct-server.ts](../../src/main/smartphone/direct-server.ts)は失効監視で`res.destroy()`するだけで、`assets.get`へsignalを渡さない。応答漏えいはreadable再確認で防ぐが、上流DNS/HTTPS処理の停止とは別。
- [既存server試験](../../tests/direct-server.test.ts)の失効中資産取得は`assets.get`を遅いPromiseへ差し替え、HTTP接続切断を検証する。実getのDNS期限/取消を直接検証していない。
- 再現案: 許可CDN画像をprojectで登録し、DNS lookupを未解決Promiseにしてget開始。5秒時点の完了とHTTPS要求ゼロを観察。DNS完了後にも残り時間だけを使うこと、失効/HTTP切断で上流signalが中断され遅いDNS後にHTTPSを開始しないことを追加する。
- 親担当へ即報告済み。本担当は実行/修正していない。記録末尾の確認時には親がgetのsignal引数、DNS前の共通deadline、遅いDNS後のthrowIfAbortedを実装中であることを確認した。修正確定・テスト結果と全利用側確認は親記録へ委ねる。

## 文書の矛盾と残る条件

既存のAndroid保存「版5」/現行6、外配信末尾QR版2/現行登録、文字演出の初回閉じる受入/常時表示採用を再確認対象とした。追加で[simple-character-display](../features/simple-character-display.md#設定と移行)の「設定スキーマはv13」「現行設定スキーマ13」は、共通保存所有文書の現行16と語の上で矛盾する。素材形状の導入版13という歴史説明とは区別する。いずれも製品を旧版へ戻す根拠とせず、親へ文書整理候補として引き継いだ。

不足の優先順位は、(1) CDN期限/取消の局所再現と修正、(2) 実OBS結合と導入済み端末の現行ソース一致の扱い、(3) 実回線/権限/認証など利用条件が必要な項目の可否確認。(2)(3)を既存のgreen自動試験だけで完了扱いしない。全体テストは親が最後に実行する。根拠不足の候補は推測で修正せず、全13機能の不足条件を上表に残した。
