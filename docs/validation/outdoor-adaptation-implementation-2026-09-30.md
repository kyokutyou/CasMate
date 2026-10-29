# 外配信の自動制御再設計・実装検証（2026-09-30）

## 対象と到達点

- 正式仕様は[外配信](../features/outdoor-streaming.md#弱回線対策と自動制御)、画面配置は[Android画面](../features/android-mobile-client.md#android画面)。この記録は仕様を重複して所有しない。
- 比較基準コミットは `9655aa03b4e4a9e77d8582177d032968e4942caf`。仕様作成時の変更を保持した作業ツリーへ製品実装を追加した。コミット・配布用パッケージの生成は行っていない。後続の実機確認依頼に基づくDebug APK生成・導入は[実機確認記録](./outdoor-adaptation-device-2026-09-30.md)に記載する。
- 再設計版の製品コードと今回の必須確認を完了した。後続の実機確認で送信制御と数値保存を検証し、観測時刻の誤判定を修正した。再試行では利用者がOBS映像の復帰・音声継続を目視・聴取して確認した。確認した1台・1構成と未確認範囲は[実機確認記録](./outdoor-adaptation-device-2026-09-30.md)を参照する。
- 任意に提供されたH.265の[追加録画検証](./outdoor-adaptation-recordings-2026-09-30.md)では、自動調整・動画復帰と、長い静止・試行区間を確認した。音声継続は画面録画とのマイク競合により不成立であり、この条件を追加の合格構成にはしていない。

## 主な実装入口

| 責務 | 実装・確認先 |
| --- | --- |
| 制御と適用状態 | [OutdoorAdaptiveControl.kt](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorAdaptiveControl.kt)、[状態型](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorAdaptation.kt) |
| 実際の映像適用・局所故障 | [OutdoorService.kt](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorService.kt)、[保持フィルター](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorHoldFilter.kt)、[復旧完了](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorVideoFailureTracker.kt) |
| 接続世代・待ち・ACK・期限切れ・実送出 | [TransportObservation.kt](../../android/vendor/rootencoder/common/src/main/java/com/pedro/common/TransportObservation.kt)、[SrtSender.kt](../../android/vendor/rootencoder/srt/src/main/java/com/pedro/srt/srt/SrtSender.kt)、[CommandsManager.kt](../../android/vendor/rootencoder/srt/src/main/java/com/pedro/srt/srt/CommandsManager.kt) |
| ライブ映像と試行世代の対応 | [OutdoorFrameEvidence.kt](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorFrameEvidence.kt)、[OutdoorSrtStream.kt](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorSrtStream.kt) |
| 対応下限と変更結果 | [OutdoorCapabilities.kt](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorCapabilities.kt)、[VideoEncoder.java](../../android/vendor/rootencoder/encoder/src/main/java/com/pedro/encoder/video/VideoEncoder.java) |
| 履歴と明示保存 | [OutdoorDiagnosticHistory.kt](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorDiagnosticHistory.kt)、[OutdoorDiagnosticExport.kt](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorDiagnosticExport.kt) |
| 依存固定元・第三者通知 | [UPSTREAM.md](../../android/vendor/rootencoder/UPSTREAM.md)、[第三者通知](../../THIRD_PARTY_NOTICES.md)、[同梱変更通知](../../android/app/src/main/assets/licenses/RootEncoder-modifications.txt) |

旧制御器の試験は新仕様の試験へ置換した。新しい[制御テスト](../../android/app/src/test/java/jp/casmate/app/outdoor/OutdoorAdaptiveControlTest.kt)と[閉ループ試験](../../android/app/src/test/java/jp/casmate/app/outdoor/OutdoorAdaptiveClosedLoopTest.kt)では、未稼働・API失敗、保持失敗、遅延コールバック、閾値・期限・待ち段階、古いACK、欠測・世代変更、基準RTT、実量の追従不足を扱う。閉ループのエンコーダーモデルは受付目標を実量として代入せず、反応遅延・変更無視・オーバーシュート・キーフレーム集中を持ち、独立した回線容量と音声生成からキュー・未ACK・期限切れを返す。

## 自動検証

実行環境は Windows、JDK 21、Android SDK 37、既存のGradleキャッシュ。Gradleは `GRADLE_USER_HOME="$env:USERPROFILE/.gradle"`、`--offline --console=plain` を使用した。キャッシュのロック取得に通常の実行権限が必要だったため、許可された実行環境で確認した。

レビュー指摘と履歴保存の最終修正を反映した状態でAndroidの全129件とlint・コンパイル・依存関係検証を再実行し、成功を確認した。全体テストとビルドは同時に走らせず、順に実行した。

| 確認 | 結果 |
| --- | --- |
| `:app:testDebugUnitTest` | 成功、122件。失敗・スキップ0件 |
| `:rootencoder-common:testDebugUnitTest`、`:rootencoder-encoder:testDebugUnitTest` | 成功、common 5件・encoder 2件。失敗・スキップ0件。キュー消費と送出の分離、ACK・期限切れ・連番周回、API結果を確認 |
| `:app:lintDebug` | 成功。エラー0件。警告は下記に記録 |
| `:app:compileDebugKotlin`、`:app:compileReleaseKotlin` | 成功。Releaseには観測注入処理を含めない |
| `:app:checkDebugDuplicateClasses` | 成功。ローカル4モジュールと外部バイナリの重複なし |
| 各 `:rootencoder-{common,srt,encoder,library}:assembleDebug` | 成功。既存の他プロトコルを含むlibrary利用側をコンパイル |
| `pnpm lint` | 成功、261ソース。Gitが出す既存の文字化けディレクトリ警告は残る |
| `pnpm typecheck` | 成功 |
| `pnpm test` | 成功、86ファイル・758件。下記に初回失敗と再実行条件を記録 |
| `pnpm build` | 成功。Vite・TypeScript・Windows用の両workerをビルド。NuGetの警告は下記に記録 |

- 初回のWindows全体テストは756件成功、Electronを起動する描画テスト2件が制限環境で失敗した。GPUプロセスの起動失敗と `ERR_FAILED` が原因として記録された。同じ2件を通常のWindows実行環境で実行すると成功し、この条件で全体を再実行して758件すべて成功した。期待値・タイムアウト・並列数を緩める修正はしていない。
- Windowsのビルド時に `NU1900` が出た。NuGetのサービスインデックスへ接続できず、パッケージの脆弱性データを取得できなかった。ビルドは成功したが、脆弱性データの取得・検査が成功したとは扱わない。
- Android lintの警告10件は、既存のSharedPreferences commit、WebViewのrenderer終了処理、画面寸法取得、既存Bouncy Castle依存内のTrustManager、メディアサービス公開、既存HTTP用ネットワーク設定。今回の新しい制御・診断コードに対する警告はない。上流ソースには既存APIの非推奨警告がある。
- 保持・解除の遅い完了、API失敗、過去の試行・静止フレームを復帰成功へ変換しないことを自動検証した。保持はraw GL出力を用い、圧縮済みメディアを履歴へ保存しない。
- UIテストでは自動更新・長いエラーによる操作位置の維持、欠測表示、診断表示、狭い画面・文字拡大、手動非表示の優先を確認。生成された状態表示画像も目視した。エミュレーション上の描画であり、端末上のGL検証ではない。
- 履歴の時間・件数上限、不変コピー、次回送信での破棄、保存失敗・キャンセル・二重操作、保存待ちの間の追加観測、JSONの許可フィールド・相対時刻・欠測を確認した。
- 仕様・ADR・検証記録・依存元の文書内リンク167件を確認し、ファイルと見出しの欠落はなかった。`git diff --check`も成功。生成物が未追跡のソース差分へ混入していないことを確認した。

## 独立レビュー

`code-review`スキルに従い、読み取り専用のサブエージェント2名が仕様軸とStandards軸を分けて確認した。

- 仕様軸のP1: 静止中のcodec自動復旧が保持解除と動画再評価を行い、復帰条件を迂回していた。codecだけの復旧は保持入力・適応状態・待ちを維持するよう修正し、サービスが呼ぶ復旧完了処理へ回帰テストを追加。再レビューで解消を確認した。
- Standards軸のP2: キューを消費しただけで送出成功と数えていた。キュー処理終了と実ソケット送出完了を分離し、全パケット書込み成功時だけ送出を数えるよう修正。パケット0件・途中失敗・二重計上の回帰テストを追加。再レビューで解消を確認した。
- 両軸とも重大な未解決指摘なし。レビュー担当は全体テストや実機確認を代行していない。

## 録画なしの短い実機確認（実装完了時点の計画）

実装完了時点の`adb devices`では端末が接続されていなかった。その後、利用者が接続した端末で実施した結果は[実機確認記録](./outdoor-adaptation-device-2026-09-30.md)に分離する。以下は当初の手順であり、録画・編集・提出を利用者へ依頼しない。

1. 開発用ビルドで普段のスマホとOBSを使用し、自動モードと弱回線対策を有効にして通常の操作で送信を開始する。
2. 外配信の「通信詳細」→「セッション」→「開発用：低下・静止・復帰を確認」を押す。8秒間、混雑観測だけを注入する。状態を直接変更せず、実際のカメラ、エンコーダー、GL、音声、SRTを通す。ACK・ライブフレームの証拠は実測のまま使う。
3. スマホの低下・静止・動画復帰表示と、OBSの映像の静止・動き、実際の音声継続を目視・聴取する。手動非表示・ミュート・停止の優先を確認する。
4. 「数値診断を書き出す」からAndroidの保存先を選ぶ。試験入力と実観測の両方が記録されたJSONと、構成・結果の短いメモを残せる。キャンセル・保存失敗で履歴は失われない。

この試行は実回線の帯域低下・回復性能の実証ではない。実施結果と残る未確認点は上記の実機確認記録に従う。長時間・複数端末・全品質、音声欠落やOBS復帰時間の保証へ結果を広げない。

## 診断UI整理の追記（2026-10-01）

自動制御の既存未コミット変更を引き継ぎ、通常画面・プレビュー要約・分類別診断パネルを整理した。配置・操作は[Android画面仕様](../features/android-mobile-client.md#配信中の画面と設定)、数値の意味は[外配信の通信詳細](../features/outdoor-streaming.md#通信状態の詳細)が所有する。通信API、履歴JSON、制御ロジックの変更・移行は行っていない。

- 実装入口は[診断パネルと要約](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorDiagnosticPanel.kt)、[通常状態](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorVideoStatus.kt)、[書き出し](../../android/app/src/main/java/jp/casmate/app/outdoor/OutdoorDiagnosticExport.kt)。保存先選択の受け取りをタブ共通の親へ移し、パネル閉鎖・タブ変更・画面再生成中も結果を処理する。
- [診断パネルのComposeテスト](../../android/app/src/test/java/jp/casmate/app/outdoor/OutdoorDiagnosticPanelTest.kt)と既存の画面テストで、4分類、分類別スクロール保持、閉じる・戻る・背景タップ・スワイプ、停止後保存、キャンセル・成功・失敗・二重操作防止を確認する。書き出し中の観測追加が選択時点の保存内容を変えないことも確認する。
- 320dp幅、縦横のプレビュー、文字倍率2、長文、数値更新を対象にする。警告・長い診断値には描画時の文字欠け検出、異常の追加・解消には再試行位置の比較を追加した。描画画像は `android/app/build/reports/layout/outdoor-*-cleanup.png`、`outdoor-preview-diagnostics-portrait.png`、`outdoor-diagnostic-large-*.png` に出力する。Robolectric上の合成状態による描画であり、実カメラや端末上の描画検証ではない。
- 今回の `adb devices` は接続端末なし。新UIを実機で開閉・操作する短い確認は未実施。以前の端末検証を新UIの確認済み結果へ流用しない。端末接続後は通常表示、診断表示、4分類、閉鎖後の保存結果、送信・音声継続を短く確認する。録画・配布用パッケージは生成していない。
- 仕様軸とStandards／故障・影響範囲の独立レビューを実施。異常の追加で再試行ボタンが横へ動く点、文字拡大時の警告と診断値の欠け、復帰ヒント消失時のスクロール補正を指摘され、固定の個別操作枠・実測した文字領域・要約本文の高さ保持で修正した。関連回帰テストの成功後、両レビューで未解決指摘なしを確認した。レビュー担当はテストや実機確認を代行していない。
- 読み取り範囲は外配信・Android画面・通知の共通規則・開発手順・関連ADRと利用側。全体検証は状態保持・保存結果の受信元変更と、レビュー後のUI修正を理由に再実行した。上記3点は追加レビューが見つけた手戻りであり、自動テスト成功だけで読み取り・描画確認を省略しない。

最終差分での結果は以下のとおり。負荷の高い全体テストとビルドは順に実行した。

| 確認 | 結果 |
| --- | --- |
| Android単体テスト | `:app:testDebugUnitTest` 134件、`:rootencoder-common:testDebugUnitTest` 5件、`:rootencoder-encoder:testDebugUnitTest` 2件。全141件成功、失敗・スキップ0件 |
| Android lint・コンパイル | `:app:lintDebug`、`:app:compileDebugKotlin`、`:app:compileReleaseKotlin` 成功。lintはエラー0、既存警告10件 |
| `pnpm lint`・`pnpm typecheck` | 成功。lintは261ソース。既存のGit文字化けディレクトリ警告は残る |
| `pnpm test` | 通常のWindows環境で全86ファイル・758件成功 |
| `pnpm build` | 成功。Vite・TypeScript・両workerをビルド。PC状態workerで既存の `NU1900`（NuGet脆弱性データ取得不可）があり、脆弱性検査の成功とは扱わない |
| 描画・文書・差分 | 合成状態の通常画面、縦横の診断要約、診断パネル、文字2倍の長文を目視。更新文書のローカルリンク123件の参照先あり。`git diff --check` 成功 |

初回のPC全体テストは制限環境で754件成功・4件失敗だった。Electron描画2件はGPU起動失敗と `ERR_FAILED`、管理画面2件は5秒タイムアウトを記録した。通常のWindows環境で対象3ファイル67件、その後全体758件が成功した。期待値・タイムアウト・並列数は変更していない。要約の配置調整では狭い画面の復帰案内の可視性テストが一度失敗し、案内の上部配置と本文高さ保持を反映した後、Android全体を再検証した。

確認ログは `android/build/ui-cleanup-android-verified.log`、`ui-cleanup-pc-test-final.log`、`ui-cleanup-pc-build.log`、`ui-cleanup-lint.log`、`ui-cleanup-typecheck.log` に残した。
