# 全体調査: スマホ・Android担当（2026-10-24）

本記録は全体調査の分担結果であり、実機未確認を受け入れ完了・不具合不存在とは扱わない。製品コードの修正と最終全体検証は全体担当が行う。既存の作業差分を変更・復元せず、独立した回帰テストだけを追加した。

## 読み取りと調査範囲

AGENTS.md、SPEC.mdの機能索引、docs/development-workflow.mdの読み取り判断表・検証・レビュー、CONTEXT.mdの外配信／スマホ統一登録／直接接続用語を確認した。次の6所有仕様を全文で読み、所有範囲と参照先を整理した。追加でローカルアプリケーション仕様の管理面・REST・WebSocket・セキュリティ境界・設定保存・共通移行・終了・エラー契約を照合した。

| 機能 | 所有仕様・関連用語とADR | 実装・テストとの照合 | 結果・不足 |
| --- | --- | --- | --- |
| PC・スマホ通信 | smartphone-transport.md。接続世代・登録情報更新・用途別資格。ADR 0019、0020、0021、0025 | PCのsmartphone-control-session.ts、mobile-read-session.ts、direct-server.tsとAndroidのManagedSocket、MobileReadConnection、MobileAudioAssembler、SmartphoneControlConnection。制御2/3選択、読取2、購読世代、heartbeat、要求・通知・画像/音声の上限、OBS確認取消、失効と一時停止、遅い登録通知の破棄を照合。smartphone-control-session/mobile-read-session/smartphone-update-contractとAndroid connection/obsテストを確認 | 調査完了。今回の範囲では追加の確定不具合なし。実回線p95、半開き・ロック・長時間待機の端末実測は未検証 |
| スマホ連携 | smartphone-integration.md。接続準備・統一登録・端末共通OBS入力。ADR 0021、0025、0026 | smartphone-controller/enrollment/store、shared/smartphone、管理routesとAndroid RegistrationBundle/RegistrationUpdate/RegistrationStoreTransaction。排他的選択、保存前拒否、初回コメント登録と映像準備の分離、ポート予約、4/5→6移行、credential/revision照合、送信中の自動更新と明示登録の分離、OBS共通入力を照合。controller/store/migration/update-contractとAndroid obsテストを確認 | 調査完了。**M1**: 経路不一致のdirect更新を保存する不具合を再現、全体担当へ修正引継ぎ。複数端末QR・実際のOBS入力引継ぎは未検証 |
| PC・スマホ直接接続 | smartphone-direct-connection.md。受信待受・ルーター開放・接続先候補・外部到達・PC確認情報・受信許可サービス。ADR 0020、0029、関連0021/0026 | direct-runtime/server/admission/identity/assets/gateway/windows/network-worker/firewall-worker、shared/direct-connectionとAndroid PinnedPcClient/DirectAssets/DirectRegistration。TLS/pin、Host/Origin、許可リスト、用途分離、未認証枠、本文上限、候補世代、OFF後の遅い開放・削除残存・5秒終了、端末別障害、保護保存を照合。direct各テストと.NET DirectFirewall/Service/Isolation/Scope/PathHints等を確認 | 調査完了。**M2**: backendが接続後切断をdisconnectedで生成しない不一致をコード経路で確定、全体担当へ修正引継ぎ。実UAC/SCM、ルーター方式別開放、外部IPv4/IPv6は未検証 |
| Android外配信 | outdoor-streaming.md。外配信セッション・配信マイク・送信品質・弱回線対策・緊急動画/静止・復帰試行・数値診断。ADR 0016、0018、0020、0025、0026 | PC OutdoorReceivers、Android OutdoorService/Transmission/NativeSender/SendQueue/AdaptiveControl/ReceiverEvidence/Reporter/Quality。再接続と入力再準備の分離、旧待ち破棄、ACK/PES証拠、正常SRTへの制御障害非波及、手動非表示/ミュート優先、映像局所故障、診断許可フィールドを照合。PC outdoor-receivers/nativeとAndroid OutdoorAdaptive/ClosedLoop/Transmission/Reporter/Queue/Geometry/Clock等を確認 | 調査完了。今回のコード照合で追加確定不具合なし。ネイティブ実接続の追加検証は全体担当へ引継ぎ。実カメラ・音声・GL・OBSの今回実機確認は未検証 |
| Androidクライアント | android-mobile-client.md。Android音声サービス・スマホコメント画面・登録情報更新。ADR 0009、0010、0019、0024、0025 | MainActivity、CommentsWebView、WebViewLoadCoordinator、MobileAudioService、AppPreferences、登録保存/拒否gate、共有接続。保存6と5→6保持移行、失効の別AtomicFile、手動登録取消、仮想originと秘密非開示、背景コメント解除/音声継続、前面サービス・通知、フォーカス、タブ保持、LAN権限を照合。Android ui/audio/data/connection/obs/recognitionの通常テストを確認 | 調査完了。追加確定不具合なし。登録保存形式の詳細に古い「版5」の記述が残るが、同節先頭・互換基準・テスト条件・生成policy・実装は版6で一致（下記文書上の残件）。実端末での通知・音声フォーカス・Bluetooth・省電力は未検証 |
| Android手書き合成 | android-handwriting-overlay.md。手書き文書・外配信セッション。ADR 0028 | OutdoorDrawingRuntime/Document/Filter/Panel/Viewport/InputRegions、OutdoorPreviewView、OutdoorService組込み。session/retry/hold/probeの世代、通常送信版と静止編集版の分離、手動非表示/カメラ復旧、GL失敗時fallback、50操作/50,000点/4,096区間、80ms指待ち・stylus・2指・操作除外を照合。DrawingRuntime/Document/Gesture/Input/Viewport/RecoveryIntegration/CameraReadiness/UIとandroidTestソースを確認 | 調査完了。追加確定不具合なし。JVM/Compose検証と実GL/実カメラは区別し、実GL画素一致、実送信への手書き反映・音声継続は今回未検証 |

## 確定問題と根拠

### M1: direct設定の経路境界欠落

- 所有仕様: smartphone-integration.md「管理APIと状態」は`network=direct`のときだけ`direct`部分更新を受理する。
- 修正前コード経路: `/api/smartphone/configure`が本文をcontroller.configureへ渡し、`patch.direct !== undefined`分岐ではnetwork一致を調べず、検証・台帳保存・direct revision更新へ進む。例えば`{network:'lan', direct:{mode:'manual'}}`やnetwork欠落で直接接続設定を変更できる。
- 影響: 意図した経路と違う設定要求が直接接続の方式/候補/招待を変更し、直接接続中は公開準備へ影響する。
- 独立再現: tests/audit-mobile-route-contract.test.ts。network欠落/lan/tailscaleの3ケースが修正前にすべて「rejectせずresolve」で失敗。保存未実行・settings維持も期待として記載した。
- 全体担当のbackend修正を独立確認: `patch.direct`分岐の先頭で`patch.network !== 'direct'`を拒否する。変更はclone内の先行編集を含むstore.saveより前で止まり、部分適用されない。新規の公開機能や待受は追加しない。
- 利用側の追加レビューで、DirectSettingsPanelの候補自動保存・方式選択・アダプター選択の3経路はnetworkを省略していたと判明した。SmartphonePanel→Dashboardも補完せず送信するため、backendだけの修正では正規操作を拒否する。3経路へnetwork=directを追加して対応テストを更新する必要を全体担当へ報告した。先行の「正規UIはnetwork=directを送る」という報告はこの確認で訂正した。

### M2: 実接続後の切断状態が生成されない

- 所有仕様: smartphone-direct-connection.md「準備状態・到達性・復旧」とsmartphone-integration.md「接続の詳細設定」は未確認・接続確認済み・切断/確認失効を区別する。
- コード経路: DirectRuntime.viewの到達判定はconnectedまたはunconfirmedだけを生成する。connected()から返る解放処理で最後のcountを削除し、実到達経験を失う。UDPもreceiverがreceivingでなくなるとunconfirmedだけになる。
- 再現手順: 同じ候補でTCP connected()を登録してconnectedを確認→返された解放関数を呼ぶ→viewはunconfirmedへ戻る。shared型とDirectSettingsPanelはdisconnectedを扱うが、既存UIテストはその値を仮注入するだけでbackendの遷移を検証していなかった。
- 全体担当の初回修正を独立レビュー: reachedCandidatesを候補キーで管理し、同じ有効候補世代での確認後切断はdisconnected。他の健全なTCP接続が残ればconnected、新しい候補世代はunconfirmed、旧終了は別候補へ影響しない。
- 故障時・影響範囲の追加レビューで、UDP候補集合変更による証拠失効時にreachedCandidatesが解除されず、単候補の受信確認→同じ内部待受へ第2候補追加で既存候補をdisconnectedとする不整合を確認。仕様の曖昧な候補別未確認と一致しない。tests/direct-runtime.test.tsの既存手動候補テストへ、受信確認後の候補追加/削減と正常受信維持の期待を追加し、候補追加後unconfirmedのassertが失敗するredを確認した。全体担当へ製品修正を引き継いだ。

## 実行した検証

- PC関連19ファイル: `pnpm exec vitest run`にsmartphone-controller/control-session/store/store-migration/update-contract、direct-admission/server/connection/controller/runtime/gateway/gateway-upnp/windows/firewall-worker/network-worker/identity、outdoor-receivers/receiver-native、mobile-read-sessionを指定、`--maxWorkers=1`。**19ファイル257テスト成功**。これはM1修正前の既存群であり、新回帰と修正後群の最終確認は全体担当が実施する。
- 初回sandbox実行はVite SSR一時キャッシュのrenameがEPERMとなり19suiteの収集が失敗した。通常権限の同一コマンドで成功した。最初の失敗を製品テストの成功・製品不具合へ読み替えない。
- Android: `android/gradlew.bat testDebugUnitTest lintDebug compileDebugKotlin compileDebugAndroidTestKotlin`。**BUILD SUCCESSFUL**。appのXML集計は**81suite392テスト、失敗0/エラー0/skip0**。lintは**0 errors, 20 warnings**（警告をゼロとは扱わない）。mainとandroidTestのKotlinコンパイル成功、RootEncoderモジュールの通常タスクも成功。配布APK/インストーラーを生成していない。
- Android初回sandbox実行は既存Gradleキャッシュのlock access deniedで開始不能。必要な既存キャッシュを利用する通常権限実行で成功した。
- .NET: `dotnet test src/pc-status-worker/CasMate.PcStatus.Worker.Tests/CasMate.PcStatus.Worker.Tests.csproj --no-restore --verbosity quiet`。**281合格/3skip/284合計、失敗0**。実規則変更/サービスのopt-in環境変数は存在せず、明示opt-inも指定していない。先行Direct限定実行は235合格/1skip/236合計。
- 実機探索: `adb devices -l`は通常権限で成功し一覧空。sandboxではADB daemon開始に失敗した。接続されたAndroidがなく、実機インストール・設定変更・本番配信開始・ルーター開放・実規則変更は行っていない。

## 文書上の残件と検証の制約

- android-mobile-client.md「登録の保存形式」の冒頭は現行6だが後続の箇条書きに現行5の説明が残る。追加採用の日付、先頭、生成policy、保持移行の条件が6で一致するため実装を5へ戻す根拠とはしない。仕様の歴史説明と現行形状の整理候補として全体担当へ報告する。
- outdoor-streaming.md末尾の「実装上の通信フィールドと保存」に旧版2 QRの形状が残る。現行登録契約は同文書の登録節がsmartphone-integration.mdの現行招待/応答を参照する。旧QRを受理させる理由とはしない。
- 実機・外部回線・実UAC/SCM/ルーター方式ごとの未検証を、JVM/偽サーバー/偽ワーカーの成功で代替しない。Windows全体lint・型チェック・最終全体テスト・build、修正後の全関連群、Nativeの追加実接続と全差分レビューは全体担当の記録を参照する。
