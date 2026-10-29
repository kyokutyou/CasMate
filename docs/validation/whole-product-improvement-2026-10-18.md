# 全正式対象の調査・改善進捗（2026-10-18）

## 作業契約

- SPEC.mdの25機能と横断経路を対象に、仕様→実装→利用側→テストの順に確認する。広域調査を終えてから採用改善を実装する。
- 全体テストは今回の依頼により省略。変更挙動と影響する利用側の関連テスト、lint/typecheck/buildを実施。配布物は生成しない。
- 開始時のgit statusはクリーン。既存の保存データや実サービスへの投稿・本番配信は操作しない。
- 調査済みはコードとテストの確認を指し、実機未確認や未実行のテストを成功扱いしない。

## 対象一覧

| 所有仕様 | 調査状態 | 実装・テスト・利用側 | 候補・判断 | 実装・検証・未確認 |
| --- | --- | --- | --- | --- |
| [ai-listener.md](../features/ai-listener.md) | 調査済み | AiController・AiMemoryWriter・AiPostingBudget→AppState共有取得/認識・管理UI、ai-memory-buffer/controller/connections試験 | 保存集約・投稿枠・サービス別休止・明示再開あり。追加改善の根拠なし | 関連自動試験成功。実API/外部投稿未操作 |
| [android-handwriting-overlay.md](../features/android-handwriting-overlay.md) | 調査済み | OutdoorDrawingRuntime/Document/Filter→OutdoorService/Panel、OutdoorDrawingRuntimeTest | セッション/保持トークンで旧反映を拒否。追加改善の根拠なし | カメラ故障/固定版復帰の単体試験成功。GL実機・回転・同時利用未確認 |
| [android-mobile-client.md](../features/android-mobile-client.md) | 調査済み | MainActivity・CommentsWebView/LoadCoordinator・MobileAudioService・RegistrationStoreTransaction→ManagedSocket | タブ保持・制限付きWebView・2音声上限・登録原子保存あり。追加改善の根拠なし | Android関連7クラス39件成功。adb端末なし、実機未確認 |
| [comment-acquisition.md](../features/comment-acquisition.md) | 調査済み | SourceConnections・YouTube/Twitch/jpnkn・source-request→AppState/use-comment-source-actions、source-lifecycle/request/startup・Twitch/jpnkn試験 | 接続別世代・本文期限・保存競合防止を確認。追加改善の根拠なし | 故障/再接続の関連試験成功。実サービス未操作 |
| [comment-filter.md](../features/comment-filter.md) | 調査済み | shared/core comment-filter→AppState.acceptComment・設定UI、判定試験 | C03見送り。負荷測定に対してキャッシュ同期の複雑度が大きい | 判定順・除外済みID維持の関連試験成功。性能比較は下記 |
| [comment-list.md](../features/comment-list.md) | 調査済み | CommentListView/CommentItem→独立・管理・スマホ、comment-list-render-work/page・CommentStore試験 | C11見送り。既存memo化を確認、仮想化の必要性は未立証 | 再描画時の本文再処理抑制試験成功。10,000行の実描画時間は未測定 |
| [comment-overlay.md](../features/comment-overlay.md) | 調査済み | CommentOverlayController→CommentOverlayPage/AppState、comment-overlay/overlay-expiry/transparency試験 | C06採用、C02の影響先も検証 | 期限切れ受信/通信断の試験成功。実OBS確認は下記 |
| [comment-speech.md](../features/comment-speech.md) | 調査済み | CommentSpeechController/VoicevoxAdapter→AppState共有合成・OBS/キャラクター、controller/deadlines試験 | C02採用。停止後の旧合成/復旧/再生失敗を排除 | OFF/同期/終了×3段階と再ONの回帰成功。実VOICEVOX音声出力は未確認 |
| [initial-setup.md](../features/initial-setup.md) | 調査済み | InitialSetupStore→AppState指紋通知/InitialSetup/Dashboard、store/ui/layout試験 | C09採用。指紋入力を必要な状態だけに限定 | 10,000履歴の計測・指紋一致・保存競合・Electron実描画成功 |
| [local-application.md](../features/local-application.md) | 調査済み | SettingsStore/compatibility-storage・LocalAccess/projections・LocalServer・electron終了・PcStatus→管理/公開面 | C08/C10見送り、C12採用。保存意味/認証を維持 | 設定/互換/起動/HTTP関連試験成功。終了期限・保存保護を追加確認 |
| [management-screen.md](../features/management-screen.md) | 調査済み | ManagementShell/Workspace/Navigation・useAutoSavingSettings→14編集先/Dashboard、history/studio/auto-saving/notifications試験 | 共通見出し・遅延生成・入力保持・通知固定は既存。配置変更の具体的根拠なし | Electron通知配置と初回設定の描画成功。新たな画面操作は追加していない |
| [mobile-speech.md](../features/mobile-speech.md) | 調査済み | MobileSpeechController共有変換→MobileReadSession/MobileAudioService、controller/deadlines/AndroidAssembler試験 | 共有変換・参照ゼロ破棄・用途世代あり。C02の利用側確認 | PC/Android単体試験成功。実端末再生・複数端末未確認 |
| [obs-control.md](../features/obs-control.md) | 調査済み | ObsWebsocketClient/ObsControlController→音声結果/SmartphoneControlSession/AndroidObsRuntime、controller/websocket試験 | 問合せ期限・確認/実行排他・結果不明非再送あり。追加改善の根拠なし | 関連試験成功。実配信の開始/終了は実施せず |
| [obs-program-preview.md](../features/obs-program-preview.md) | 調査済み | ObsProgramPreview→SmartphoneControlSession→AndroidObsProgramImage、preview/control-session試験 | 占有による二重撮影防止・断片Ack/上限/取消あり。追加改善の根拠なし | 関連試験成功。実Androidへ画像断片を送る経路は未確認 |
| [obs-source-registration.md](../features/obs-source-registration.md) | 調査済み | ObsSourceRegistrationController→管理routes/Dialog/初回設定、controller/server試験 | 許可対象/UUID/対象世代/登録と実表示の分離あり。追加改善の根拠なし | 関連試験成功。製品の登録ダイアログからの実OBS登録は未確認 |
| [obs-style-editor.md](../features/obs-style-editor.md) | 調査済み | model/css/history/App/Preview→独立HTML、model/ui/rendering試験 | JSON原子的適用・エスケープ・20履歴・コピー失敗代替あり。追加改善の根拠なし | ビルド・Electron実描画成功。Edge/Chrome/file実操作未確認 |
| [outdoor-streaming.md](../features/outdoor-streaming.md) | 調査済み | OutdoorReceivers/ReceiverOwnership→認識分岐・AndroidOutdoorSendQueue/VideoFailureTracker/Service・native receiver | 音声優先/4MiB/世代/端末別停止不明保全あり。追加改善の根拠なし | PC受信/Android復帰単体試験・nativeビルド成功。実SRT・弱回線・同時マイク未確認 |
| [shitaraba-next-thread.md](../features/shitaraba-next-thread.md) | 調査済み | NextThreadController→BoardWriteAdapter/jpnkn submit・AppState音声案内/切替、next-thread試験 | 作成結果不明非再送・世代照合あり。追加改善の根拠なし | 終了後POST抑止など関連試験成功。実サービス書込未実施 |
| [simple-character-display.md](../features/simple-character-display.md) | 調査済み | CharacterController/asset store/AppState→各表示面、controller/motion/asset試験 | 項目ID照合・素材寸法/保存の保全あり。C02の影響先 | 口形・旧項目停止の関連試験成功。素材実描画/実OBS同時表示未確認 |
| [smartphone-direct-connection.md](../features/smartphone-direct-connection.md) | 調査済み | DirectRuntime/Server/Admission/Gateway/WindowsWorker→ManagedSocket/PinnedPcClient、runtime/server/gateway試験 | 期限・所有開放の閉鎖・候補別障害分離あり。公開契約変更の根拠なし | 関連試験成功。ルーター/UAC/外部回線未確認 |
| [smartphone-integration.md](../features/smartphone-integration.md) | 調査済み | SmartphoneController/Store/Enrollment→SmartphonePanel・AndroidRegistrationStoreTransaction、store/migration/update試験 | 資格保護・経路排他・部分準備・保存後通知あり。追加改善の根拠なし | PC/Android保存・移行試験成功。実端末/全経路未確認 |
| [smartphone-transport.md](../features/smartphone-transport.md) | 調査済み | MobileReadSession/SmartphoneControlSession→AndroidManagedSocket/Assembler/ObsProgramImage | 2接続貸借・世代・断片上限・遅い端末分離あり。追加改善の根拠なし | 関連試験成功。実回線遅延/30標本測定未実施 |
| [speech-recognition-overlay.md](../features/speech-recognition-overlay.md) | 調査済み | OverlayController→専用projection/SpeechRecognitionOverlayPage、controller/expiry/transparency/connections試験 | C06/C07採用。期限・初期HTTP停止・旧接続を確認 | 時計巻戻りも回帰追加。実OBS確認は下記 |
| [streamer-speech-recognition.md](../features/streamer-speech-recognition.md) | 調査済み | JsonLinesWorker/RecognitionController/ReceiverRecognitionInputs→AppState/OBS/AI/Android、worker-client/app-state試験 | C05採用、C10見送り | 日本語/絵文字の1バイト分割回帰成功。実マイク/モデル認識精度未確認 |
| [text-effects.md](../features/text-effects.md) | 調査済み | matchTextEffects→AppState/TextEffectsOverlayPage、matcher/panel/transparency/connections試験 | C01/C04/C07採用 | タイマー数/判定時間/再接続を確認。実OBS確認は下記 |

## 横断経路

| 対象 | 状態・根拠・判断・検証 |
| --- | --- |
| 共通UI・入力保持・通知 | 調査済み。共通Shell/保存hook/14編集先、通知予約領域を確認。Electron実描画で操作位置の固定を確認。追加配置変更の根拠なし |
| 設定保存・移行・秘密保護 | 調査済み。直列保存・原本退避/復元・専用保護台帳・Android登録transaction。C08見送り。C12で受理済み保存を終了時にも待つ回帰を追加 |
| API・認証・通信・公開範囲 | 調査済み。LocalAccess・公開projection・直接接続許可リスト・用途認証と利用側、上限/期限を確認。C07/C12の取消と旧接続分離を検証。公開拡張なし |
| 起動・終了・ワーカー | 調査済み。electron before-quit→LocalServer.stop/AppState.shutdown、所有ワーカー・旧世代排除。C02/C05/C12採用、C10見送り。終了の受理済み保存と不完全通信を再確認 |
| 同時利用・サービス障害分離 | 調査済み。PC/スマホ共有WAV、AI取得/認識共有、OBS排他、端末別受信/認識tap、手書き固定版。C02利用側回帰・C12同一接続の複数要求を検証。実OBS3表示の同時確認は下記 |

## 改善候補

25機能・横断5経路を一度広く確認後、根拠のある候補を小さな単位で実装・検証・レビューした。12候補のうち8件採用、4件見送り。製品方針の判断待ちはない。

| ID | 問題・根拠 | 判断・理由 | 状態・比較・検証 |
| --- | --- | --- | --- |
| C01 | TextEffectsOverlayPageで終了済みタイマーIDを配列に保持し続ける | 採用。現在要素の最短期限を一つのタイマーで監視 | 実装・独立2軸レビュー済み。同条件20要素の監視20本→1本、20反復で終了後0本、完了済みID保持なし。C06と関連7ファイル46件成功 |
| C02 | 停止後の合成/復旧準備の失敗で再試行・警告・OBS代替表示が復活する | 採用。既存停止契約の修復。OFF→ONの旧処理も排除 | 実装・独立2軸レビュー済み。変更前3回帰失敗→成功。関連7ファイル90件成功後、OFF/同期/終了×合成/復旧/再生と再ONへ拡張（controller18件成功） |
| C03 | NG語と投稿者/本文の正規化を受信ごとに反復 | 見送り。100語/10,000コメントで229〜236ms（約0.023ms/件）。今回の条件ではキャッシュと設定同期の複雑度に見合う効果が小さい | 未変更。語0件は6.76〜12.57ms/10,000件。CPU全体の実測ではない |
| C04 | 連動ルールごとに同じテキストの書記素を再走査する | 採用。コメント内で最長連続数を一度だけ集計 | 実装・独立2軸レビュー済み。50ルールの本文走査50→1回、100件295.22〜346.97ms→40.07〜49.22ms（最終3試行）。結果一致/エモート境界/上限を含む関連55件成功 |
| C05 | 認識ワーカーstdoutの日本語/絵文字を各chunkでString変換する | 採用。UTF-8途中分割を実際に再現、既存日本語結果の保全 | 実装・独立2軸レビュー済み。1バイト分割で文字化け→元文字列保持。関連5ファイル180件成功 |
| C06 | OBS表示hookの旧描画時刻で、遅れて届いた期限切れ結果を描画する | 採用。受信時のlayout effectで期限確認し描画前に同期する | 実装・独立2軸レビュー済み。コメント/認識の2回帰が前失敗→後成功。レビューで時計巻戻り時の再予約漏れを発見・回帰追加/修正。関連46件成功 |
| C07 | 文字演出/認識表示のWS開始が初期HTTPの停止に阻まれる。旧socket通知も現状態を巻き戻す | 採用。並行接続/旧応答無視/終了時HTTP取消 | 実装・独立2軸レビュー済み。無応答中WS未開始→開始、旧HTTP/旧socket巻戻し→保持。新規6回帰/関連45件成功 |
| C08 | atomicBytesの失敗時、一意な自作tmpファイルが残る | 見送り。原本は保全され、実際の蓄積障害は未観測。回復・調査用残骸の扱いを整理せず削除規則を追加する根拠は不足 | 未変更。失敗時の原本保全・保存キュー回復をsettings/compatibility-storage関連試験で確認 |
| C09 | 初回設定指紋の変化確認でコメント履歴までsnapshot複製する | 採用。指紋に必要な型/入力へ限定し、保存/公開形状は維持 | 実装・独立2軸レビュー済み。履歴10,000件/20状態更新で26.45・30.64・25.56ms→1.95・1.66・1.60ms。通常snapshot呼出1→0回・識別値一致。関連251件成功 |
| C10 | 認識ワーカーの改行なしstdout蓄積が無制限 | 見送り。所有する内部ワーカーで実際の過大出力を観測していない。新たな拒否上限は正常応答の最大長を定めてから別途判断 | 未変更。外部入力の通信上限と混同しない。実害や性能改善を断定しない |
| C11 | コメント一覧の10,000行を仮想化する | 見送り（今回）。既存memo化で通常の状態更新の本文再処理を抑制済み。選択/コピー・可変行高さ・読み返し位置の契約を壊すリスクに対し、現時点で操作失敗や実測遅延の根拠なし | 既存render-work試験を確認。描画時間改善を主張しない |
| C12 | OBS実接続の停止時、HTTP要求前のTCP接続でLocalServer.stopが無期限に待つ | 採用。1.5秒期限で未完了通信を閉じ、受理済み要求の保存・応答は完了まで保護 | 生TCPで変更前2.5秒超未完了→期限内終了。レビューで保存打切り・保護後の後続要求残留を発見、各回帰を先に失敗確認して修正。関連8ファイル135件成功・独立2軸再レビュー指摘なし |

## 検証履歴

- 2026-10-18: 対象索引・開発手順・正式用語・実装ファイル一覧を確認。
- C02/C05: 変更前既存2ファイル17件成功（.tmp-whole-product-baseline.log）。C05回帰は最初の試験データのキーを正式形状に修正したうえで文字化けを再現（.tmp-whole-product-utf8-red.log）。C02回帰3件の失敗を確認（.tmp-whole-product-speech-red.log）。
- C01/C06/C07/C04/C09: 変更前のタイマー数、期限切れ表示、HTTP待ち/旧接続、走査回数、不要snapshotの回帰失敗を確認してから実装。各関連試験と独立レビューを完了。C02の追加試験では復旧回数の期待値を段階別に修正した。試験側の誤りを製品の失敗と数えない。
- C12: 実OBS確認で停止が戻らず、生TCPの要求前接続で再現。初案へのレビューで「設定/初回設定保存を1.5秒で打ち切る」を発見し、1.7秒の保存を保護する2回帰が失敗することを先に確認。その修正へのレビューで「同じ接続の後続未完了要求が期限後に残る」を発見し、保存保護後の再判定回帰の失敗を先に確認して修正。全て同条件で成功し、2軸再レビューに未解決指摘なし。

| 最終確認 | 結果・対象 | 作業ローカルのログ |
| --- | --- | --- |
| 広域関連試験 | 選定35ファイル630件成功。取得の再接続/本文期限、設定/互換保存、スマホ保存/移行/直接接続/制御、OBS、AI投稿枠/記憶、外配信受信、PC状態/起動、着せ替えUI | `.tmp-whole-product-audit-related.log` |
| 変更と利用側 | 選定21ファイル368件成功。下記コマンドの対象 | `.tmp-whole-product-changes-final.log` |
| 終了・保存・HTTP | 選定8ファイル135件成功。local-server-startup/local-server/initial-setup-store/settings/obs-source-test-server/obs-source-registration-server/electron-startup/mobile-lan-server | `.tmp-whole-product-shutdown-final.log` |
| 公開投影 | local-view-projections 2件成功。初回設定の管理専用状態と公開投影の分離 | `.tmp-whole-product-projections-final.log` |
| Electron描画 | 選定4ファイル4件成功。obs-custom-css/initial-setup-layout/management-notifications-layout/obs-style-editor-rendering。通常ブラウザ用UIの通知位置・初回設定・CSS利用側を実レンダラーで確認 | `.tmp-whole-product-rendering.log` |
| Android | app単体試験7クラス39件成功、XMLで失敗0/skip0を確認。ManagedSocket/MobileAudioAssembler/MobileAudioService/CommentsWebView/RegistrationUpdate/OutdoorDrawingRuntime/OutdoorVideoRecoveryAdaptation | `.tmp-whole-product-android-related-retry.log` |
| lint | `pnpm lint` 成功（製品424ソース）。規則変更なし | `.tmp-whole-product-final-lint.log` |
| 型チェック | `pnpm typecheck` 成功（main/rendererと互換ポリシー） | `.tmp-whole-product-final-typecheck.log` |
| ビルド | `pnpm build` 成功。renderer/direct/独立着せ替えHTML/main/.NET認識・PC状態/native外配信を含む。依存mbedtlsの既存CMake非推奨警告あり、エラーなし | `.tmp-whole-product-final-build.log` |
| 差分・レビュー | `git diff --check` 成功。編集後に仕様一致/故障影響の独立2軸レビュー、重大な未解決指摘なし。各担当のテスト再実行はしておらず実行結果は本担当が確認 | 本記録とレビュー結果 |

最終の変更・利用側試験は次の選定コマンドで実行した（全体テストではない）。

```powershell
pnpm exec vitest run tests/comment-speech-controller.test.ts tests/speech-operation-deadlines.test.ts tests/mobile-speech-controller.test.ts tests/mobile-read-session.test.ts tests/speech-preview-routing.test.ts tests/character-controller.test.ts tests/comment-overlay.test.ts tests/speech-recognition-worker-client.test.ts tests/speech-recognition-app-state.test.ts tests/speech-recognition-overlay-controller.test.ts tests/overlay-expiry.test.ts tests/overlay-transparency.test.tsx tests/overlay-connections.test.tsx tests/text-effects.test.ts tests/text-effects-panel.test.tsx tests/initial-setup-store.test.ts tests/initial-setup-ui.test.tsx tests/app-state.test.ts tests/ai-controller.test.ts tests/comment-filter.test.ts tests/shitaraba-next-thread.test.ts
```

AndroidはSDK/Java 21を利用し、`android/gradlew.bat :app:testDebugUnitTest`へ上記7クラスを`--tests`で指定した。当初の非修飾`testDebugUnitTest`は依存rootencoderモジュールにもフィルターが適用され対象なしで失敗。対象をappタスクに限定して再実行し成功した（appのXML39件も確認）。ログのBUILD FAILEDを成功と読み替えない。APK・インストーラー・展開版配布EXEは生成していない。

全体テスト（`pnpm test`など）は今回の明示指示により省略した。件数は異なる選定実行間で重複するため合算しない。

## 比較条件・環境

- 性能測定: 同じNode/Vitest環境、1回ウォームアップ後3試行。本文は「配信の通常コメントです。」25回（300文字）、NG語100件または連動50ルール（不一致）、初回設定は履歴10,000件と同じOBS状態20回更新。壁時計の区間時間で、アプリ全体CPU/メモリ/実配信レイテンシの測定ではない。最終測定はC04/C09両方を含む。
- 測定値は候補表に保存。元JSONは作業ローカルの `tmp/whole-product-performance/whole-product-performance-{before,after-effects,final}.json` に保存し、測定用一時試験は実行後に削除した。正式な回帰は走査回数/出力/不要snapshot呼出で判定し、時間閾値で不安定な合否を作らない。未変更のNG100語は最終測定261.71〜273.08msで環境変動もあり、改善したとは主張しない。
- C12の生TCP接続（要求を送らない）を最終ビルドで3回測定し、停止完了は1502.99/1513.14/1503.38ms。1.5秒タイマーとスケジューリングの実測であり、全機能の終了時間上限ではない。受理済み操作の保存は別に完了まで待つ。
- 実機状況: Android SDKのadbでdevicesを実行したが端末一覧は空。ロック/背景音声、カメラ・回転・手書き・SRT、LAN/Tailscale/直接接続のAndroid実測は未実施。既存の過去記録を今回の確認としない。

## 実OBSの確認

- OBS 32.2.2、作業開始時は未起動。インストール済みファイルを `tmp/whole-product-obs` へ複製し、専用のポータブル設定・シーンと認証付きlocalhost WSで起動。本番プロファイルは変更せず、配信/録画は開始していない。専用環境の既定音声入力も除去して確認した。
- 最終buildのAppState/LocalServerへ合成コメント「同時表示の確認ww」と合成認識結果「日本語の認識結果の表示確認」を入力。マイク認識自体の実測ではない。3つのOBSブラウザソースを同時表示し、各PNGが空表示と異なること、日本語本文が描画されることを確認した。
- LocalServer停止後3.4秒でコメント/文字演出/認識の各PNGが初期の透明PNGとハッシュ一致。OBS取得画像を目視確認。通信断後も期限で消える利用側を確認した。製品の登録ダイアログやAndroidプレビューの操作確認と混同しない。
- 最初の確認は停止待ちで中断しC12として修正。再確認の一度目はOBSのCreateInputが失敗、詳細statusを出す診断を追加した再実行で成功した。その失敗原因は特定できず、一時的失敗が解消したこと以上を主張しない。成功記録は `tmp/whole-product-obs/result.json`、画像は同ディレクトリ、ログは `.tmp-whole-product-obs-final.log`。検証用ソースを削除し、専用OBSプロセスのみを終了した。

## 最終到達点と未確認範囲

- 25正式対象と横断5経路の仕様・実装・テスト・利用側を調査済み。未調査対象なし。候補12件は全件判断済み、採用8件の仕様/実装/回帰・利用側確認・レビューを完了した。重大な未解決指摘、製品方針の判断待ちはない。
- 再確認した故障経路は、停止直後の旧合成/復旧/再生、同期切替と再ON、UTF-8境界、期限切れ受信と時計巻戻り、無応答HTTP/旧WS、設定変化と公開投影、TCPの要求前/不完全ヘッダー/不完全本文/保存中/後続要求/サーバー再起動。関連する回帰の対応漏れは確認されなかった。
- 画面配置・クリック数は変更していない。操作上の効果は、接続時のHTTP待ち除去、停止後の意図しない復旧/表示の抑止、終了の無期限待ち解消。性能効果は上記同条件の区間時間・タイマー/走査/snapshot回数で評価し、アプリ全体CPU・メモリの改善率は未測定。
- Android実機、ルーター/UAC/外部IPv4・IPv6/Tailscale、弱回線SRT・カメラ/手書き/マイク同時利用、実VOICEVOX再生/認識モデル、実サービス取得/投稿・有料APIは未確認。端末接続、対象ネットワークと権限、サービス設定が揃った環境で別途実測が必要。変更していない実機機能の合格や実サービス性能は今回の成果に含めない。
