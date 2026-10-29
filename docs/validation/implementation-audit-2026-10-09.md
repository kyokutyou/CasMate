# 実装済み機能の調査（2026-10-09）

ログの保管場所: 本文中のプロジェクト直下の `audit-*.log` は、2026-10-14にローカルの `tmp/development-logs/2026-10-14/root/` へ退避した。ファイル名と内容は維持し、移動対応とSHA-256は同日フォルダーの `manifest.json` に記録している。ログはGit管理外。本文の当時の検証結果は変更していない。

## 対象と方法

[SPEC.md](../../SPEC.md)掲載のWindowsアプリ、Androidクライアント、両者の連携を一巡した。所有仕様・CONTEXT.md・関連ADRを基準に、実装、利用側、既存テストを照合した。発見事項は修正前の回帰テストで再現し、修正後に関連テストと、仕様一致／故障時・影響範囲の独立レビューで確認した。全コード行・全環境・全故障の網羅を保証する調査ではない。

開始時のgit statusは空。調査基準HEADは `2eaeccced14b6b1f9912f9f212f353168d2ff79b`。既存の未コミット変更はなかった。初期調査では対象外・未採用案の実装、実サービスへの投稿、実配信開始・終了、公開設定変更、インストーラー・配布用EXE・APK生成は行っていない。模擬サービスと合成媒体で検証した。追加の実機確認では利用者の明示許可を受け、検証専用デバッグAPKとテストAPKだけを生成・更新した（末尾の追加記録）。

## 構成と既存検証

- PC: Electronメイン、React表示、共有TypeScript契約、ループバック管理サーバー、経路別スマホ公開。音声認識・PC状態は.NET、外配信受信は端末別C++/libsrtワーカー。
- Android: Kotlin/Compose、表示用WebView、読み上げ・外配信の独立サービス、用途別登録保存、ネイティブlibsrt送信。
- 検証: Vitestのアダプター・制御・API・React・Electron描画、Gradle単体/Robolectric・lint、.NET単体、C++ネイティブ検証。
- 既存記録: 直接接続・統一準備・端末共通OBS入力には実機未完了範囲がある。過去のLAN・Android描画確認を今回の実機確認として扱わない。
- 調査前全体テスト: 137ファイル・1,341テスト中、2ファイルの5テストが失敗（OBSスタイルエディター4件の5秒期限、掲示板管理画面1件の描画位置）。同じ2ファイルを `--maxWorkers=2` で実行すると12件成功。並列負荷の影響が疑われるが、この成功だけで原因は確定していない。検査対象・期限・期待値は緩和していない。
- サンドボックス内pnpm起動はrealpath EPERMで失敗したため、承認された通常権限で検証を実行した。

## 機能別の範囲と結果

下表の仕様名は `docs/features/` の所有文書を指す。「追加修正なし」は今回の調査で根拠を伴う追加問題を確定しなかった意味で、問題不存在の断定ではない。

| 機能群（所有仕様） | 主な確認範囲・利用側 | 結果 |
| --- | --- | --- |
| local-application / management-screen | SettingsStoreの原子的保存・失敗時原本保持・移行、起動終了、AppState/SourceConnections、管理認証、WS/REST順序、PC状態、保存UI・共通通知 | 終了の障害分離を修正。設定破損時の仕様矛盾は追加対応で起動停止に統一。保存キュー・版整合・通知位置は追加修正なし |
| comment-acquisition / comment-filter / comment-list | YouTube/Twitch/したらば/ぜろちゃんねる系、3接続枠、再接続世代、DAT差分・CP932・行境界、初回履歴、除外、重複排除、PC/スマホの共有一覧 | 上限到達時の自動スクロール回帰を修正。他の取得・フィルターは追加修正なし |
| shitaraba-next-thread | 作成結果不明、二重作成防止、遅延案内、切替、AppState終了、掲示板障害分離 | 終了後の新規作成・案内開始と待機タイマー残存を修正。通常の旧スレッドへの遅延案内は維持 |
| comment-overlay / text-effects / simple-character-display | 初回履歴除外、同期表示、演出キュー・世代、素材検証・画像サイズ、微動、独立故障 | 追加修正なし。実OBS表示は未検証 |
| comment-speech / mobile-speech | VOICEVOX起動・準備競合、音声キュー、取消、試聴ルーティング、FFmpeg圧縮、モバイル転送・期限 | エンジンの二重起動と終了後起動、FFmpeg取消・パイプエラーを修正 |
| smartphone-integration / smartphone-transport / smartphone-direct-connection | 公開経路の排他、読取/制御認証・秘密除外、PC登録版6と旧版移行、Android版6/5移行、複数端末、再接続、接続数/認証待ち制限、直接接続所有者・候補・期限・Windowsルール、端末共通入力 | 製品の追加修正なし。追加確認で合成LANサーバーと実Androidの接続を検証。実Tailscale/直接接続・ルーター越えは未検証 |
| android-mobile-client | 登録の原子的保存・Keystore、独立設定、ManagedSocket共有購読、読み上げサービス開始/停止/復元、音声フォーカス、WebView、Compose全状態の操作位置 | 前景サービス開始拒否時のクラッシュと購読取り残しを修正。停止状態・再開可否・画面表示を整合 |
| outdoor-streaming | PC端末別受信・取消・親パイプ、Android撮影/符号化/送信・再接続、自動適応・診断、SRT/UDP/認識分岐、音映像・端末障害分離 | コード上の境界と既存回帰を確認、追加修正なし。合成媒体検証と実機確認を区別 |
| obs-control / obs-source-registration | 用途別権限、確認期限・結果不明、OBS再接続・認証・要求応答、入力登録・視覚状態 | 不正JSON/不正構造のOBSフレームによる例外を修正。実OBS操作は未検証 |
| streamer-speech-recognition / speech-recognition-overlay | 入力共有、設定版、モデル/ワーカー寿命、PCM排出・世代・キュー、外配信分岐、表示公開 | 追加修正なし。実マイク・モデルの認識精度/遅延は未検証 |
| ai-listener | 投稿予算の永続化、非同期停止、接続先別障害、資格情報の検証/非公開、記憶・会話削除・画像寿命 | 追加修正なし（AppState終了障害分離は共通修正）。実モデル応答・実投稿は未検証 |
| obs-style-editor | 単独HTML、CSS生成・インポート検証、入力の安全な扱い、保存・描画、取り消し履歴 | 追加修正なし。初回全体テスト失敗は上記に記録 |

## 発見・修正の根拠

いずれも失敗を再現する回帰を先に確認した。優先度は今回の影響に基づく（P1=終了・クラッシュなど広い影響、P2=機能内の不具合）。テスト名は `tests/`、Androidは `android/app/src/test/` 内。

| 優先度 | 問題と根拠 | 修正・回帰確認 | 所有仕様 |
| --- | --- | --- | --- |
| P1 | 終了時、1サービスのrejectで後続音声・認識・OBS・イベント購読の解放が飛ぶ | 各停止を隔離し、順序と同期的な初回停止呼出しを維持。`app-state.test.ts`で失敗後の後続停止・購読解除・履歴消去を確認。既存起動回帰も再実行 | local-application |
| P1 | 掲示板案内の5秒/30秒待機後やスレッド探索後に、終了を検査せず外部書込みを開始できる | Controllerを終了時に無効化、待機タイマー取消、非同期境界の終了検査。`board-next-thread-controller.test.ts`等で終了後POSTなし・探索後作成なし・通常切替後の旧スレッド案内維持を確認 | local-application / shitaraba-next-thread |
| P1 | OBSの不正JSON・null・配列・不正要求結果がイベント内例外になる | 握手と接続後の構造検査。不正フレーム後の有効応答も確認。識別成功時に握手リスナー解除。`obs-websocket-client.test.ts`と制御・登録利用側テスト | obs-control |
| P1 | AndroidでOSがstartForegroundを拒否すると例外が外へ出る。接続の同期通知で拒否された場合、取得途中の購読も残る | 拒否を明示状態へ変換、開始希望解除・サービス停止・音声/購読/フォーカス等解放。同期通知後に取得済みleaseを閉じる。`MobileAudioServiceTest.kt`で初回拒否・同期通知中拒否・再試行・開始希望保存を確認 | android-mobile-client / mobile-speech |
| P2 | 同時VOICEVOX prepareが両方spawnする。終了中の検索/プローブ結果が遅れて起動へ進む | 準備Promiseを共有、非同期境界の終了検査、所有プローブを終了。`voicevox-adapter.test.ts`で並行prepareのspawn1回、終了後spawn0回、プローブkill1回を確認 | comment-speech |
| P2 | FFmpeg変換をshutdownが取り消さず、遅い結果が生きる。stdin EPIPEが未処理例外になる | 変換別AbortSignal、終了時abort、遅い結果拒否。stdinエラーで子を終了し固定メッセージの失敗へ。`ffmpeg-transcoder.test.ts`で確認、既存AAC引数・ビットレートを維持 | mobile-speech |
| P2 | コメント保持上限で件数一定のまま新着と最古が入れ替わると、length依存のeffectが動かず追従が止まる | コメント集合更新で追従判定。同件数更新時の追従ON/OFF双方を`comment-list-page.test.tsx`で確認。PC独立一覧とスマホの共有部品・利用側を確認 | comment-list |

失敗再現は作業用 `audit-*-red.log` 等に記録。外部応答は模擬し、実投稿は行っていない。

## 最適化の効果

VOICEVOXの二重起動は同時準備の回帰シナリオで修正前2回から修正後1回へ削減した。不要な別エンジン/プローブ、終了後の変換・待機タイマー・購読を解放する効果もコードと回帰で確認した。CPU利用率、電池、帯域、実時間の改善量は測定しておらず、数値効果として主張しない。大規模変更や先回りの最適化は行っていない。

コメント一覧の性能受け入れ条件に対し、共有CommentListViewと製品CSSへテキスト/リンクの合成コメント10,000件を入力して測定した。Electron 43.4.1、非表示ウィンドウ、ソフトウェア描画、1280px/400px幅、760px高さ。通常ビルドと他の重い検証を終えた後の各1回の参考値で、flushSyncによるDOMコミットと同期レイアウトを測った。初期表示760.0/724.9ms、上限内の1件置換101.6/105.3ms、20回のスクロール設定とレイアウト読取りは各最大約0.1ms。10,000行を保持し、新着追従の末尾との差は約0.4px、停止中の読みかけの行の移動は1px未満だった。

これはPC上の共有表示部品の値で、WebSocket/JSONスナップショット処理、画面描画のFPS、実Android WebView性能は含まない。初回の計測では非表示ウィンドウのrequestAnimationFrameが約1秒に抑制されたため、その値を性能値から除いた。またブラウザのスクロールアンカーが最古行削除時にscrollTopを補正するので、停止中は読みかけの行の画面位置で検証した。計測用スクリプトは作業用 `tmp/audit-performance/`、最終ログは `audit-comment-performance-final.log`。測定だけを根拠に追加の最適化は行っていない。

## 修正後の再レビュー

編集後、仕様一致と故障時・利用側影響を別の読み取り専用担当で独立レビューした。未コミットのため固定HEADとの差分と新規Androidテストを対象にした（コミット差分前提のレビュー手順の作業ツリー適用）。故障レビューがAndroidの同期通知中拒否によるlease取り残しを指摘し、失敗回帰→修正→再レビューで解消した。最後の両観点に未解決の指摘はなかった。

管理UIのレイアウト・トーストは変更していない。Androidは既存の固定状態枠に停止理由を追加し、全状態・拡大文字の操作位置検証を維持した。既存テストの列挙末尾への依存は、ネットワーク権限状態を明示する形へ変更した。

## 最終検証

製品コード・回帰テストの最終状態に対して以下を実施した。全体テストと通常ビルドは同時に実行していない。

| コマンド・対象 | 結果 |
| --- | --- |
| `pnpm lint` | 成功、製品対象350ソース |
| `pnpm typecheck` | 成功、メイン/renderer型検査と互換ポリシー検査 |
| `pnpm test --maxWorkers=2` | 成功、137ファイル・1,358件、256.31秒。対象・期限・期待値を維持 |
| `pnpm build` | 成功、通常/直接接続/単独エディター、TS、.NET両ワーカー、Windows C++ワーカー |
| Gradle `--offline :app:testDebugUnitTest :app:lintDebug :app:compileDebugKotlin :app:compileDebugJavaWithJavac :app:externalNativeBuildDebug` | 成功、59スイート・255件、失敗/スキップ0。JNIはarm64-v8a/armeabi-v7a/x86/x86_64。APK生成なし |
| 音声認識/PC状態の `dotnet test …csproj --no-restore` | 成功、40件/9件、スキップ0 |
| `pnpm test:native` | 成功、暗号化SRT実接続・誤鍵/未暗号化拒否・期限・取消・世代・PES連続性 |
| `pnpm test:native-media` | 成功、合成H.264/AAC119フレーム・H.265/AAC89フレーム復号、損失観測312、同試験の回復672ms、複数端末相当受信の独立性・親終了時停止。カメラ→OBS総遅延は未測定 |
| `node native/outdoor/recognition-tap-test.mjs` | 成功、媒体一致、SRT再起動なしの分岐切替、認識先不在でもOBS向けUDP継続、旧世代拒否・新世代復帰 |
| Electronの10,000件合成コメント測定 | 成功、条件と限界は上記。実端末性能の代替ではない |
| `git diff --check` | 成功 |

全体テストには既存のElectron実描画・タッチ入力とUI/保存/接続利用側回帰が含まれる。Androidでは全状態・拡大文字・WebView再生成等の自動描画回帰を実行した。実機確認とは区別する。詳細出力は作業用 `audit-final-*.log` に残した。

警告は検査設定を弱めず保持した。通常ビルドには500KB超チャンク、依存CMakeの旧最低版、NuGet NU1900がある。NU1900は脆弱性情報取得不能であり、その検査は未完了。Android lintはエラー0・警告17（API定数、TLS/依存JAR、MediaSessionサービス公開、applicationContext保有、画面寸法/KTX等）。WebView描画終了警告は既存のonRenderProcessGone実装と再生成テストを確認した。警告の存在だけを製品障害の根拠にせず、対応コード・契約を照合した。

中間全体テストでは終了後掲示板回帰と既存の初期停止タイミング回帰が失敗。AppStateの終了無効化と停止ヘルパーの同期呼出しを修正し、該当回帰が成功してから最終全体を再実行した。途中の失敗は最終成功として扱わない。

## 要確認事項・未検証範囲

- **正式仕様の矛盾は解消済み**: 当初、`local-application.md`「保存と対応版」の原本保全・起動失敗と「エラー処理」・受け入れ条件11の既定値起動が矛盾していた。追加依頼で利用者が「原本を保持して起動停止」を選択し、所有仕様を現行実装・ADR 0022に一致させた。詳細は下記「設定破損時の仕様矛盾の解消」。
- 初期調査では実Windows終了、Android背景再生と実LANを未検証としていた。追加確認の範囲は末尾の記録に従う。終了時の実故障競合、OS/端末固有の前景制限・音声フォーカス・Keystore実障害、実Tailscale/直接接続・複数実端末・ルーター越えは未検証。
- 実OBSの映像復号・ソース登録・配信操作、カメラ/マイク、熱/電池/回線変動下の長時間外配信、実VOICEVOX・音声認識モデル・サービス認証/投稿は未検証。合成SRT/FFmpeg、模擬応答、Electron/Compose自動描画はこれらを代替しない。
- 初回全体テストの描画/期限失敗は、下記の追加調査でリサイズ反映待ちの不足とUI探索負荷を確認し、テストと実行設定を修正した。あらゆる環境での不安定さの不存在を保証するものではない。
- NuGetの脆弱性情報取得は当初未完了だった。下記「NuGet脆弱性情報取得の復旧」で取得・検査を確認した。過去のNU1900があるビルドを遡って取得成功として扱わない。

## テスト不安定さへの追加対応

利用者の追加依頼により、OBSスタイルエディターUIと掲示板管理画面の描画テストを調査した。上記の製品修正を含む未コミット変更を保全し、製品の挙動・正式仕様は変更していない。追加の変更範囲はUIテスト、掲示板描画テストと2つの共有/実行fixture、`vite.config.mts`。SPEC.md、管理画面の通知位置・共通トースト、OBSスタイルエディター仕様、開発手順の検証・レビュー判断に照合した。

### 再現と原因の証拠

- 通常の全体テストを再実行し、1,358件中OBSスタイルエディター4件が既存の5秒期限を超える失敗を再現した（`audit-flake-default-red.log`）。掲示板の初回描画失敗は毎回発生するものではなかった。
- 同じ「文字サイズ」入力を10回取得する一時的な計測では、画面全体のrole探索はgetComputedStyle 1,120回・1,148.93ms、ラベルから対象を絞って検査する試作は230回・355.11msだった（`audit-flake-query-profile-verbose.log`）。同じ要素を取得したことも検査した。これは探索方法の負荷差の参考値で、最終helperや製品UIの速度改善量としては扱わない。計測用テストは削除した。
- 掲示板fixtureでリサイズ反映を250ms遅延させると、通知前後の比較に異なるviewportの寸法が混ざり、位置・幅のassertが失敗した（`audit-flake-board-red.log`）。resize呼出し完了とrendererへの反映完了は一致しなかった。
- 最終の局所role探索を使い、並列設定変更前の標準全体テストは137ファイル・1,360件が成功した（158.07秒、`audit-flake-load-red.log`。ファイル名と異なり結果は成功）。この実行中の1秒間隔の測定ではNodeプロセス最大29個、合計working set最大3,938MiB、空き物理メモリ最小578MiBだった（`audit-flake-load-metrics.log`）。Node集計には既存プロセスも含む。16論理CPUのホストで、導入済みVitestは通常実行の既定並列数を15と算出していた。ページングの発生や負荷だけを唯一の原因と断定していない。

### 修正と回帰・再レビュー

- UI探索を選択中パネル・ナビゲーション・出力領域に限定した。入力はラベルから絞り、親内の実際の`getByRole`で同一要素・accessible name・先頭roleを検査し、表示/hidden条件も維持した。最初の試作では`toHaveRole`が後続roleを許す差を独立レビューが指摘した。負例を先に失敗させ、局所`getByRole`へ修正して成功した（`audit-flake-role-red/green.log`）。履歴、保存、disabled、エラー、フォーカスの期待値は維持した。
- 掲示板では要求したCSS viewport寸法への反映を既存の3秒上限内で待ち、描画を待ってから通知前の基準を採る。通常Electron・250ms遅延Electron・実ブラウザの3件が成功した（`audit-flake-board-green.log`）。位置・スクロール・overflow・フォーカスの比較を緩めていない。
- 既定の`maxWorkers`を2にし、CPU数による多数のjsdom/ネイティブ描画fixtureの同時実行を抑えた。見本側の設定も継承するため追加検証した。検査対象・除外・setup・既存の5秒期限は変更していない。探索範囲の変更だけの中間全体検証でも期限失敗が残った事実を記録し（`audit-flake-default-green.log`）、並列数を下げた成功だけで原因を確定していない。
- 最終5ファイルを仕様一致／故障時・利用側影響の独立した読み取り専用レビューで確認した。先頭roleの指摘は修正後に解消し、未解決の実害ある指摘はなかった。

### 追加対応の最終検証

- `pnpm lint`: 製品350ソース成功。`pnpm typecheck`: 成功。
- 標準の`pnpm test`（CLIで並列数を指定せず）: 2回連続で137ファイル・1,360件成功、256.70秒／248.92秒（`audit-flake-final-test.log`、`audit-flake-final-repeat.log`）。
- `pnpm lint:prototypes`: 見本64ソース成功。`pnpm test:prototypes`: 7ファイル・69件成功、23.40秒。
- `pnpm build`: 成功、通常/直接接続/単独エディター、TS、.NET両ワーカー、Windows C++ワーカー（`audit-flake-final-build.log`）。全体テストと同時に実行していない。既存のチャンクサイズ・CMake・NuGet NU1900警告は保持した。
- `git diff --check`: 成功。計測専用テストとdebug出力をテストソースから除去した。

実機・実サービス未検証とNuGet脆弱性情報取得不能は前節のとおり。追加対応で実配信・実投稿・公開設定変更・配布物生成は行っていない。

### 反復実行の所要時間を踏まえた並列数の再調整

利用者から「全体テストを何回もするので時間増は困る」と追加指摘を受け、既定並列数2を再検討した。UI探索・リサイズ待機の修正は維持し、同時実行数だけを変更して比較した。`pnpm test --maxWorkers=4`は137ファイル・1,360件が成功し146.52秒（`audit-flake-workers4.log`）。並列数2の2回平均252.81秒より約42%短縮した。同じホストでの参考比較であり、他の環境の時間は保証しない。15並列の負荷測定と比べ、必要以上に2へ制限するより、4で検査条件を維持して反復実行の時間を改善する判断とした。

現行の`vite.config.mts`は`maxWorkers: 4`。上記の並列数2での結果は経緯として保存する。検査対象・期待値・期限・除外は変更せず、製品コードと既存の未コミット変更を保全した。独立した仕様一致／故障時・影響範囲の再レビューでも今回の1行に指摘はなかった。

最終状態の標準`pnpm test`も137ファイル・1,360件成功、150.33秒（`audit-flake-workers4-final.log`）。並列数4で2回連続成功し、平均148.43秒、並列数2の平均より約41%短縮。`pnpm lint`は製品350ソース、`pnpm typecheck`、`pnpm lint:prototypes`は見本64ソースが成功。`pnpm test:prototypes`も7ファイル・69件成功、23.59秒。`pnpm build`は成功し、既存のチャンクサイズ・CMake・NuGet NU1900警告は保持した。全体テストとビルドは同時に実行していない。`git diff --check`も成功。詳細は`audit-flake-workers4-*.log`。実機・実サービス未検証とNuGet脆弱性情報取得不能の範囲は変わらない。

## NuGet脆弱性情報取得の復旧

追加依頼により、2026-10-09 14:36（JST）に公式NuGet接続先と.NET依存復元を確認した。`https://api.nuget.org/v3/index.json`はHTTP 200で応答し、通常restoreも成功した。この時点で過去の接続失敗は再現しておらず、その直接原因は特定していない。

両ワーカーを通常ビルドと同じ`win-x64`・`SelfContained=true`で`dotnet restore … --force --no-http-cache --verbosity normal`し、復元結果を更新した。PC状態ワーカーのログでは脆弱性インデックス・base・2026-10-08更新データのGET/OKを確認。音声認識側は同じ取得済みデータをCACHEで利用した（`audit-nuget-pc-refresh.log`、`audit-nuget-speech-refresh.log`）。`--no-http-cache`指定だけを根拠に全リソースの再ダウンロード成功とは扱わない。単体テスト2プロジェクトのrestoreも警告なしで成功した。

4プロジェクトで`dotnet list … package --vulnerable --include-transitive --format json --no-restore`が成功し、直接・推移依存の既知脆弱性は報告されなかった。両ワーカーの実効設定は`NuGetAudit=true`、`NuGetAuditMode=all`、`NuGetAuditLevel=low`で、NU1900等の警告抑制はない。データベースでの既知問題の検査結果であり、全依存の安全性を保証するものではない。

標準の`pnpm build`が成功し、NU1900〜NU1905は0件（`audit-nuget-final-build.log`）。チャンクサイズ・CMakeの既存警告は継続。ソース・ビルド設定・NuGet接続先・依存版・利用者のグローバル設定は変更せず、復元結果と取得済みデータを更新した。変更コードがないため、TypeScript/Androidの全体テストは再実行していない。既存の未コミット変更は保全した。

コマンドの確認には[dotnet restore公式資料](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-restore)、取得エラーの扱いには[NU1900公式資料](https://learn.microsoft.com/en-us/nuget/reference/errors-and-warnings/nu1900)を参照した。今後のネットワーク障害を防止・隠蔽する設定は加えていない。

## 設定破損時の仕様矛盾の解消

利用者が一般設定の破損時に「原本を保持して起動停止」を明示選択した。[所有仕様](../features/local-application.md)の「エラー処理」と受け入れ条件11を、同文書の設定保存・保存と対応版契約および採用済み[ADR 0022](../adr/0022-reset-compatibility-baseline.md)に一致させた。保存設定が存在しない初回起動は既定値を使用することも明記した。既知の対応終了保存の検証付き退避・初期化と、独立した保護保存の障害分離は既存契約を維持した。正式な挙動は所有仕様を参照し、この記録で別の仕様を追加しない。

SettingsStoreは破損JSONを拒否し、保存先・手動退避・再起動/再設定の案内を返す。Electronは一般設定のload完了後にバックエンド等を作るため、失敗時は起動エラーを表示して終了する。製品コード・テストコードは変更していない。

関連4ファイル（settings、compatibility-storage、compatibility-replacement、electron-startup）の76件が成功（`audit-settings-policy-tests.log`）。直前の通常ビルドで生成したSettingsStoreを一時ディレクトリで直接確認し、初回の完全な既定値、破損JSONの2回の読込拒否、原本バイト列不変、復旧案内、退避・初期化ファイルの自動生成なしを確認した（`audit-settings-policy-probe.log`）。利用者の実設定には触れていない。正式仕様の文書統一のみで実装不変のため、全体テスト・lint・型チェック・ビルドは再実行していない。文書の参照先と差分を確認し、既存の未コミット変更を保全した。

仕様一致と故障時・利用側影響の独立レビューを実施し、両観点に未解決の指摘はなかった。`git diff --check`も成功した。

## 追加のWindows・Android実機確認

利用者の「続けてください」と検証専用デバッグAPKの生成・登録保持更新の明示許可を受けて実施した。SH_M15、Android 12、USB接続済み1台と家庭内LAN、Windows上の通常ビルドを使用した。実設定の公開フラグは変更せず、合成コメント・合成M4A・模擬OBS状態だけを扱う別ポートのLANサーバーを使った。最新アプリの更新前後で登録・enrollment保護ファイルのバイト一致を確認した。実機base.apkと最新app-debug.apkのSHA256一致も確認した。リリースAPK、インストーラー、配布用EXEは生成していない。

### 失敗の証拠と試験コードの修正

`SmartphoneTransportDeviceTest`にHOME表示中の確認を独立テストとして追加した。既存の画面消灯・Keyguardロック確認と期限・反復数・期待値は維持した。原登録をfinallyで戻し、秘密値を出力せず再読込結果の一致を検査する。製品コードの追加修正はない。

- 最初の実機試験は、`measure-smartphone-transport.mjs`が対応終了した登録版8を返すため、登録の更新要求で失敗した（`audit-device-fixture-red.log`）。helperを現行の登録版15／制御版3と用途別資格・登録更新interfaceへ合わせ、版2向けの登録12投影も維持した。
- 次の試験はコメント接続待ちで失敗した（`audit-device-transport.log`）。資格情報・本文を含まない一時診断で、保存先とWebViewの対象・寸法は正しく、HTTP要求がなく制御だけ接続されていると確認した。待受調査では13000が存在しなかった。現在のAppStateは`smartphone.settings.activeNetwork`から公開フラグを射影するため、古いhelperの`mobileSpeech.lanEnabled`だけでは公開されなかった。合成SmartphoneViewのLAN選択を追加し、待受起動失敗を即時エラーにした。一時診断はテストソースから除去した。
- 独立レビューが、HOME試験の標本名に`locked`が残る誤認を指摘した。phase／step／ackを同じ`playbackKind`へ統一し、背景の結果は`background`で保存するよう修正した。最終差分の仕様軸と規約・故障時／利用側軸に未解決指摘はない。

### 実機の確認結果と測定条件

修正後の中間試験は1件成功（109.913秒）。診断除去・記録名修正後は新しいhelperプロセスと最終テストAPKで1件成功（109.711秒、`audit-device-final-instrumentation.log`）。ADBの終了コードだけで成功とせず、JUnitの`OK (1 test)`も検査した。

- コメント新着のDOM反映、模擬OBS状態の更新、Media3の合成音声再生開始、待受停止／600ms後再開による切断・再接続を各30回確認した。コメント履歴は1,000件。音声待機30秒の後に同じ購読で再生できた。
- HOME表示中に3回再生し、通知の停止actionでSTOPPEDと開始希望falseを確認した。原登録の論理一致とenrollment保護ファイルのバイト不変、音声・映像サービスの停止を確認した。試験終了後はアプリを開き直した。登録の再暗号化はランダムIVを使うため、試験後の原登録保全は暗号文ハッシュの一致ではなく論理一致で判定した。
- Windowsアプリも実Electronで起動し、管理画面のDOM読込とウィンドウを閉じた正常終了（exit 0）を確認した。既定設定を置いた一時appData、外部要求拒否、絶対パスの一時cwdを用い、外部要求0と実settings.jsonのハッシュ不変を検査した。終了後の子プロセスと3000待受の残存はなかった（`audit-device-windows-startup.log`）。最初の手動GUI起動では終了待ち／標準出力取得を誤り、検証未完了だったため、所有プロセスだけ終了し、Hidden＋Wait＋ログ取得で確認し直した。作業用driverは削除した。

最終実機標本の参考値は以下。PC側の単調時計で操作／音声準備からAndroidの観測後ACKまで測り、端末時計差を使わない。合成音声は440Hz・0.25秒・AAC-LC/M4Aモノラル32kbps。音声合成時間、耳での聴取品質、実OBS描画遅延は含まない。全体テスト・ビルドと測定を同時実行していない。

| 観測 | 標本 | p95 | 最大 |
| --- | --- | --- | --- |
| コメントDOM反映 | 30 | 65.1ms | 111.1ms |
| 模擬OBS状態反映 | 30 | 31.0ms | 31.1ms |
| 音声準備から再生開始 | 30 | 214.5ms | 581.9ms |
| 切断開始から再接続反映（600ms停止を含む） | 30 | 1,776.7ms | 1,781.6ms |
| HOME表示中の再生開始 | 3 | 260.1ms | 260.1ms |

30秒の待機中と約4.5秒の背景phaseで追加HTTP要求・追加socketは0。詳細は作業用`tmp/transport-measurements/current.json`。現方式単独の参考値であり、旧方式との同条件比較や製品速度の最適化効果とは扱わない。

今回も画面ロック（端末にsecure PINがあり自動解除不可）、10分超の待機、履歴からの除去／端末再起動、OSの前景開始拒否、着信・Bluetooth・音声フォーカス、Keystore実障害、複数実端末、Tailscale・直接接続・ルーター越えは未検証。Windows正常終了確認を実故障中の終了競合検証へ拡大しない。実OBS操作／映像復号、カメラ・マイク送信、実VOICEVOXと実サービス取得／投稿も実施していない。

### 追加確認の最終検査

- `pnpm lint`：製品350ソース成功。`pnpm typecheck`：成功。
- 標準`pnpm test`：137ファイル・1,360件成功、147.36秒。既定4並列を維持し、期限・対象・期待値は変更していない（`audit-device-final-test.log`）。
- `pnpm build`：成功。通常／直接接続／単独エディター、TS、.NET両ワーカー、Windows C++ワーカーを確認。全体テストの後に実行し、NU1900〜NU1905は0件。チャンクサイズ・CMakeの既存警告は維持（`audit-device-final-build.log`）。
- Gradle `--offline :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest`：最終状態で成功。59スイート・255件、失敗／スキップ0、lintはエラー0・警告17。必要な最新デバッグアプリAPKは先に`:app:assembleDebug`で生成・更新済み。
- 最終実機試験：指定した安全なbackground試験1件成功。全instrumentationの無選別実行はしていない。別の実OBS／カメラ試験を自動実行しない。
- `git diff --check`：成功。試験サーバー待受と実Windows検証のプロセスは終了し、Androidの元登録と停止状態を確認した。既存の未コミット変更を保全した。

今回の追加は試験ツールの現行契約への修正と検証範囲の追加で、製品の最適化は行っていない。上記の参考遅延と、既存の全体テスト所要時間の改善を混同しない。

## 長時間背景待機の追加確認（2026-10-10）

利用者がスマホを再接続し、検証続行を指示した。前回と同じSH_M15／Android 12／家庭内LANで、既存登録と停止状態を確認してから実施した。デバッグテストAPKの保持更新許可は継続し、更新前後の登録・enrollment保護ファイルはバイト不変だった。製品コード・合成helper・正式仕様は変更していない。

`SmartphoneTransportDeviceTest`に明示的な`backgroundIdleMs`引数（2,500〜1,200,000ms、既定2,500ms）と、実経過時間・開始希望true・WAITINGの検査を追加した。既存のロック条件・短時間待機・反復数・期待値は維持した。通知停止後の読取サーバー再起動でも停止状態を保持する検査も追加した。

`backgroundIdleMs=660000`の実機試験は1件成功、772.527秒（`audit-longwait-device.log`）。HOME表示中に11分待機した後、希望trueとWAITINGを確認し、新着合成音声3件を再生、通知停止・原登録の論理一致復元まで成功した。背景phaseは665.24秒（再生・停止後確認を含む）。USB給電中で、途中の確認では画面はAwake、前面サービスは維持されていた。画面ロック・画面消灯・Dozeの検証として扱わない。

独立した仕様軸／規約・故障時軸のレビューで、停止後の再起動が予約だけで返るため、固定3秒待ちでは起動前に成功し得る指摘があった。読取サーバーの`/mobile/bootstrap`成功と版2を10秒以内で観測してから、3秒間の再生回数不変・STOPPED・希望falseを検査するよう補強した。補強後の両軸レビューに未解決指摘はない。11分試験はこの補強前APKの長時間待機・その後新着の証拠とし、補強後の最終APKによる短時間回帰確認と区別する。

追加したKotlin実機テスト以外の検査対象は前回から不変。長時間待機中に`pnpm lint`（350ソース）、型チェック、全体137ファイル・1,360件（164.13秒）、通常`pnpm build`が成功した。既定4並列・期限・対象・期待値を変更せず、全体テストとビルドは順に実行した。全体テストは今回1回。NU1900〜NU1905は0件。補強後のGradle単体59スイート・255件、lint（エラー0／警告17）、テストAPK生成も成功した。Kotlinのみの補強はPC lint・型チェック・テストが読む入力を変更しないため、同じPC検査を繰り返していない。測定・試験ログは`audit-longwait-*.log`、長時間標本は作業用`tmp/transport-measurements/audit-longwait.json`。

### 通知停止試験の不安定さの調査

補強後の短時間実機試験は113.561秒で失敗した（`audit-longwait-final-short.log`）。通知停止後の`startDesired.first { !it }`が5秒でタイムアウトした。成功するまで同条件で再実行せず、開始・通知停止だけを5回行う小さな公開操作の試験を追加した。この試験でも開始希望trueまたはfalseの継続監視が約7秒で失敗し、失敗直後の新しい`first()`では保存済みの値を読めた。IO上の監視とUIを進める待ち方だけに変えても失敗した。

一時診断は保存の開始・終了時刻、開始希望の真偽、端末起動番号の一致だけを記録した。保存自体は10〜160msで完了した一方、その直前に開始したcold collectorには古い値だけが届いた。したがって保存の遅さやComposeの待機だけを原因と判断せず、今回の検証目的である保存済み希望の確認を、各読取1秒・全体5秒以内の新しい`first()`によるポーリングへ変更した。保存値・期限・停止状態の期待値は弱めていない。変更後の開始・通知停止5回は3.746秒で成功した（`audit-stop-snapshot-device.log`）。継続Flowの更新通知の内部原因は確定しておらず、製品の保存実装や依存版は変更していない。製品で開始希望を読む利用側はスナップショット取得である。一時診断は全て除去した。試験側の不安定さの解消と、製品の保存不具合の修正を混同しない。
独立レビューの規約・故障時軸で、focused試験の登録復元失敗時に通信client解放が飛ぶ指摘があり、復元と論理一致検査とは独立したfinallyへ解放を移した。仕様軸ではCompose `waitUntil`のpredicateが期限後にtrueを返すと最大約1秒の超過を受理できると指摘され、最終helperは全体`withTimeout(5000)`内で各`first()`を1秒に制限し、不一致時20ms待つsuspendループにした。5秒期限は旧試験と同じ。両軸の再レビューで指摘解消を確認した。

一時診断除去後の中間実機試験は2件成功、116.375秒（`audit-longwait-clean-device.log`）。これは上記レビュー補強前の結果として区別する。最終APKではレビュー補強後のfocused試験と全背景通信試験を新しい合成helperプロセスで確認する。

### 最終実機確認と残る範囲

最終テストAPKによる2件は成功、115.934秒（`audit-longwait-final-device.log`）。開始・通知停止を5回、コメントDOM・模擬OBS状態・合成音声・切断再接続を各30回、HOME中の新着再生3回、通知停止後の読取サーバー実復帰と3秒間の再生回数不変・STOPPED・希望falseを確認した。両試験とも原登録の論理一致復元を検査した。標本は作業用`tmp/transport-measurements/audit-longwait-final.json`。速度最適化は行っておらず、参考遅延を性能改善の効果と扱わない。

試験runner終了時にアプリプロセスが既に存在しなかったため、最初の停止プロセス再生成手順はそこで未成立として中断した。通常起動後に音声・映像サービスがないことを確認し、HOME→対象アプリだけの`am kill`→PID消失→通常起動→新PIDを確認した。強制停止やデータ消去は使っていない。再生成後も音声・映像サービスはなく、登録とenrollmentの保護ファイルは再生成前後でバイト不変。enrollmentは今回のAPK更新・失敗した診断試験・最終試験を通じて開始時とバイト一致した（`audit-longwait-recreate-result.log`）。これは明示停止後の再生成の証拠であり、開始希望trueのサービス再生成・端末再起動の証拠ではない。

最終Kotlin差分でGradle `--offline :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest`が成功。単体59スイート・255件、失敗／スキップ0、lintエラー0／既存警告17（`audit-longwait-final-android.log`）。一時製品診断除去後のアプリデバッグAPKも生成・保持更新済み。PC側は前述のlint・型チェック・全体1,360件・通常build成功から入力を変更しておらず、全体テストは今回1回だけ。仕様軸と規約・故障時軸の最終再レビューはそれぞれ指摘解消・追加指摘なし。`git diff --check`成功、合成待受13000〜13002は終了、既存未コミット変更を保全した。

画面ロック／消灯／Doze、開始希望trueでのプロセス再生成・履歴からの除去・端末再起動、着信・音声フォーカス・Bluetooth、OS前景開始拒否の実障害、実OBS／カメラ・マイク送受信、複数実端末、Tailscale・直接接続・ルーター越え、実VOICEVOX・外部サービスは今回も未検証。cold Flowの更新通知内部の原因は未確定で、今回の試験修正をその内部不具合の解消とは報告しない。実配信操作・外部投稿・実公開設定変更、配布用成果物生成は行っていない。
## Androidライフサイクル・音声フォーカスの追加確認（2026-10-10）

利用者の続行指示を受け、同じSH_M15／Android 12・家庭内LAN・USB給電・画面Awakeで実施した。Android音声サービス仕様の開始希望、履歴からの除去、音声フォーカス、通知停止と、通信仕様の新着だけの再生を照合した。実配信、実OBS操作、撮影・マイク送信、公開設定変更、外部投稿は行っていない。製品コード・依存・正式仕様は今回変更していない。

### 履歴からの除去とOS音声フォーカス

`AudioLifecycleDeviceTest`を追加した。合成登録と音声を用い、実Androidの`finishAndRemoveTask()`でActivityのDESTROYEDを確認した後、新着のMedia3再生を確認する。3秒の合成音声再生中に、別のAudioManagerクライアントから排他的な一時フォーカスを要求し、PC側音声購読0・再生停止・開始希望trueを検査した。喪失区間に合成announcementを投入し、待ちキュー0、復帰後の古い音声非再生、新着だけの再生を確認する。通知停止後は希望false、STOPPED、購読0を確認し、finallyで原登録の論理一致を検査する。履歴削除はプログラムから実OSのタスク削除を呼ぶ方式で、端末メーカーの履歴画面で手動スワイプした証拠とは区別する。

helperには3秒の440Hz/AAC-LC音声、購読数・キュー件数だけの`/audio-state`、喪失中合成announcementを追加した。標準0.25秒音声は維持する。診断APIに資格・本文・接続先・音声IDを含めない。フォーカス競合は同一プロセス内の別クライアントによる実OS調停の証拠であり、実他アプリ・着信・Bluetoothの証拠ではない。聴取品質・音量は測っていない。

最初の新規試験は1件成功、6.302秒。終了失敗時にも通信clientを解放するfinally補強後の最終APKでは、新規試験と既存の通知停止5回の回帰試験が2件成功、8.615秒（`audit-lifecycle-final-device.log`）。原登録は論理一致で復元し、enrollment保護ファイルは今回開始時とバイト一致した。

### 開始希望中のプロセス再生成

試験runnerの終了が実プロセスの生存へ影響するため、準備試験は明示`lifecycleRecoveryStage=prepare`と、noBackupFilesDir内の外部復元用コピーを必須とし、合成登録の保存だけを行う。runner終了後に通常デバッグアプリを開き、外部driverから合成音声を明示開始して音声購読1と音声サービスだけの稼働を確認する。HOME表示へ移し、検証済みの単一対象PIDだけを終了し、新PIDと音声購読1の自動復帰を待つ。Activityを起動し直して復帰を促すことはしない。復帰後に新着3秒音声を投入し、対象パッケージのネイティブMediaSessionのPLAYINGを確認する。

最初の手順はPowerShellの配列に対する`-notmatch`を真偽として扱ったため、終了注入前の安全確認で中断した。端末の`SIGKILL`要求はunknown pidエラーとなり未成立だった。`SIGTERM`は対象を終了できたが、最初の観測はPID不在という期待した状態をnullとして扱い中断した。いずれも成功扱いせず、外部finallyで原登録とenrollmentの保全・音声停止を確認した。終了方法とPID不在の扱いを修正後に自動復帰を確認した。`SIGKILL`失敗の内部原因は未確定で、OSの異常終了すべての証拠と扱わない。

最終driver（作業用`tmp/audit-lifecycle-recovery.ps1`）は`SIGTERM`後、5.89秒で新PIDと音声購読の自動復帰を確認し、新着のネイティブPLAYINGと原登録・enrollmentの復元を確認した（`audit-lifecycle-recovery-result.log`）。これは開始希望中・待機中のプロセス終了／再生成の証拠であり、再生途中の終了、端末再起動、OS設定からの強制停止の証拠ではない。復元コピーは暗号文のまま保持し、検証済みコピーと原登録のhash一致、enrollment不変を検査した後だけ所有コピーを削除した。試験プロセス内のfinallyだけに復旧を依存しない。

独立の故障時軸レビューで、準備を拒否した場合の無条件STOPが以前の開始希望を変更し得る点と、不一致バックアップを原登録へ書き戻し得る点が見つかった。`audioStarted`と`backupVerified`を分け、合成音声を開始した場合だけSTOP、初期hash一致を確認したコピーだけ復元するよう補強した。未検証コピーは保持し、原登録へ書き込まない。最終再レビューで指摘解消を確認した。仕様軸にも未解決指摘はない。

### 全体検査で見つかった配色保持試験の不安定さ

標準の全体テスト1回目は137ファイル・1,360件中1件失敗、149.67秒（`audit-lifecycle-final-test.log`）。配色保持試験のscrollTopが23から0になった。単独実行では成功したため同条件の全体再実行はせず、初回DOM commitをMutationObserverで観測する一時再現へ縮小した。2.34秒で同じ0への変化を再現した（`audit-lifecycle-scroll-red.log`）。初回commit後にasync `act`で初期化effectを完了させる1行だけを加えると、同条件2.37秒で成功した。

最終差分は元のfixtureに戻し、初回本文表示の後、スクロール位置23・フォーカスを設定する前にasync `act`を追加した。初回の自動スクロールと配色変更を分離する。配色、DOM同一性、位置23、フォーカス、表示世代と通信非発生の全検査を維持し、期限・対象・既定4並列を変更していない。配色変更時に位置をリセットする製品の回帰は引き続き失敗する。関連2ファイル17件成功（`audit-lifecycle-scroll-related.log`）。一時observer・診断タグはソースから除去し、仕様軸と規約・故障時軸の独立レビューは追加指摘なし。この変更は試験の準備不足の修正で、製品の配色動作は変更していない。
### 追加確認の最終検査と未検証範囲

- 最終状態で`pnpm lint`、`pnpm typecheck`、標準`pnpm test`（137ファイル・1,360件、149.06秒）、`pnpm build`が成功した（`audit-lifecycle-complete-*.log`）。全体テストは今回2回。1回目の実失敗を短い再現で修正したため最終差分を再検査し、変更なしの反復は行っていない。検査対象・期待値・期限・既定4並列を維持した。ビルドは全体テスト後に実行した。
- 最終Android検査はGradle `--offline :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest`成功。単体59スイート・255件、失敗・エラー・スキップ0、lintエラー0・既存警告17。最終テストAPKの実機2件成功と、外部driverのプロセス自動復帰成功は上記のログに記録した。
- 仕様照合、関連回帰試験、仕様軸／故障時軸の再レビューを実施した。原登録を復元し、音声・映像サービス停止と所有復元コピーの除去、enrollment保護ファイルの不変を確認した。合成待受13000〜13002を終了し、通常画面へ戻した。既存の未コミット変更を保全した。

今回は製品の最適化を行っていない。5.89秒の自動復帰は当該条件の参考観測で、性能改善やp95の証拠ではない。

実他アプリ・着信・Bluetoothとの音声フォーカス競合、手動の履歴スワイプ、再生途中のプロセス終了、SIGKILL・OS強制停止・端末再起動、画面ロック・消灯・Dozeは未検証。実OBS映像・カメラ・マイク、複数実端末、Tailscale・直接接続・ルーター越え、実VOICEVOX・外部サービスも未検証。cold Flowの更新通知内部の原因は未確定で、保存スナップショットを確認する試験の修正と区別する。実配信操作・外部投稿・実公開設定変更、配布用成果物生成は行っていない。

## 別アプリ音声フォーカス・画面消灯・Doze復帰の追加確認（2026-10-11）

利用者の続行指示と手元でのPIN解除を受け、SH_M15／Android 12・家庭内LAN・USB給電中の実機で確認した。SPECを入口にAndroid音声サービス、音声フォーカス、通知・ロック画面、バッテリー最適化、通信の接続と復旧、CONTEXT、ADR 0019、運用手順を照合した。製品コード・常設テスト・依存・検証設定は直前の最終検査から不変。作業用の一時ハーネスと本記録だけを追加した。

### 確認結果

- Chromeは初回設定画面だったため、ログイン・利用規約への同意・設定変更をせず中断した。YouTube Musicのローカル音声プレビューもメディアアクセス権限を求めたため付与せず中断した。これらを別アプリ再生成功として扱わない。
- 時計アプリのタイマー一覧に既存タイマーがないことを確認し、固有名の20秒タイマーを作成した。きゃすメイトの3秒合成音声がネイティブMediaSessionでPLAYINGとなった後、時計のタイマー音が音声フォーカスを取得した。実OSのfocus stackで`com.android.deskclock`・別UID・GAIN_TRANSIENT・USAGE_ALARMを確認し、きゃすメイトの音声購読0とPLAYING解除を確認した（`audit-crossapp-clock-focus.log`）。
- フォーカス喪失中の合成announcement投入後、待ちキュー0を確認した。時計音の停止後は音声購読1へ復帰し、旧音声のPLAYINGがないこと、新着合成音声のPLAYINGを確認した。時計の一時フォーカスの実証であり、恒久フォーカスを取得する音楽アプリ・着信・Bluetoothすべてを検証済みとしない。
- HOMEへ移動して消灯し、`mWakefulness=Asleep`を確認した後、新着3秒合成音声のネイティブPLAYINGを確認した。PINロック画面でも、停止後の通知は「きゃすメイト音声」「停止中」であり、コメント本文・接続先を表示していなかった。
- 初期`mForceIdle=false`を確認し、Androidの検証コマンドでdeep idleへ移行した。入口で`mForceIdle=true`・`mScreenOn=false`・`mCharging=true`・`mState=IDLE`を確認（`audit-doze-state.log`）。30秒後のPC側音声購読は1、キュー0だった。合成announcementを投入し、さらに20秒後にunforceして復帰を確認した。復帰後に旧音声のPLAYINGはなく、新着3秒合成音声のPLAYINGを確認した（`audit-crossapp-doze-result.log`）。Doze中の当該announcementの再生有無を観測していないため、Doze中の音声再生成功や通信切断・再接続の証拠とは扱わない。

### 再レビュー・復元・検証の扱い

一時ハーネスを担当者が仕様一致と故障時・影響範囲の2観点で自己レビューした。独立した別担当レビューは今回追加していない。外部finallyで、検証済みの暗号化バックアップだけを復元し、原登録の暗号文hash一致・enrollment不変、音声・映像サービスの停止、所有バックアップの除去を確認した（`audit-crossapp-doze-backup.log`、`audit-crossapp-doze-restored.log`）。Dozeを解除し、利用者のPIN解除後に時計のタイマー一覧が初期の空入力へ戻ったことを確認した。既存アラームには触れていない。端末へ置いた所有合成音声をPC側hashと照合して削除し、きゃすメイトの通常画面へ戻した。所有試験待受13000〜13003を終了した。

今回の製品修正・最適化はない。直前の最終lint・型チェック・全体1,360テスト・通常build、Android単体255テスト・lintの検査入力は変更していないため、全体テストを繰り返していない。上記の実機ハーネスは成功し、失敗した再生入口は成功扱いしていない。既存の未コミット変更は保全した。

USB給電中の強制deep idleは、非給電・長時間放置で自然にDozeへ入る場合やメーカー固有の省電力停止を再現した証拠ではない。Doze中の新着再生、実音楽アプリ・着信・Bluetooth、再生途中のプロセス終了、端末再起動・OS強制停止、複数実端末、Tailscale・直接接続・実外部サービス・実OBS映像／カメラ／マイクは引き続き未検証。配信開始終了、外部投稿、実公開設定変更、配布用成果物生成は行っていない。

## 2026-10-11: Bluetooth修正とDoze中の新着再生の追加検証

利用者の追加依頼で、自然なDoze、Doze中の新着再生、実着信、Bluetoothを対象にした。実着信を発生させる別端末は用意できず、Bluetoothイヤホンだけを用意できるとの回答を得た。実着信は未検証とし、既存の時計フォーカス試験と同一視しない。SPEC、Android音声サービス・音声フォーカス・通知・バッテリー最適化、通信仕様、CONTEXT、ADRと開発手順を照合した。既存未コミット変更を保全し、許可済みの検証用デバッグAPKだけを更新した。

### 発見・修正・回帰検証

- 実イヤホンの物理一時停止で購読0・ネイティブ再生解除・キュー0になったが、物理再開後も購読0で新着が再生されなかった（`audit-bt-buttons-result.log`）。停止でサービス・MediaSessionを解放する実装に対し、OSが再開キーを配送するmanifest receiverがなかった。PLAY_PAUSEも常に開始として扱っていた。独立レビューでも同じ不整合を確認した。
- `MobileAudioButtonReceiver`を追加し、明示的なPLAY・PLAY_PAUSE・HEADSETHOOKのDOWNだけで通常の開始入口へ戻す。再開先は保護された登録から読み、broadcastの接続先extraを転送しない。UP・repeat・停止・不正イベントを無視する。サービス側のtoggleは購読中なら停止、停止中なら再開とした。明示停止の希望false・サービス終了・旧音声破棄を維持した。OS拒否時は状態と保存希望を解除し、broadcast完了をfinallyで保証する。
- 故障時レビューで、古いexplicitStopの保存完了後の無条件stopSelfが、後から開始した新購読まで終了させる競合を指摘された。実際の保存完了を別executor上の後続editで待ち、main looperを進める上限付き回帰テストで未修正の失敗を確認した（`audit-bt-stop-race-bounded-red.log`）。停止時のstartIdを捕捉し、保存後も開始希望がfalseの場合だけstopSelfResultを呼ぶ修正を、明示停止とforeground拒否へ適用した。関連テストは成功（`audit-bt-related-green.log`）。初期のスナップショット待機は古いtrueを読んだだけで不十分、同一スレッドの保存barrierは進行不能で中断しており、これらを有効な再現成功として数えない。
- 初期の`cmd media_session dispatch`利用試験は、OSの対象へのキー配送を確認できず、一時停止の観測で失敗した。再開不具合の自動再現として扱わない。最終常設試験は対象packageのplatform controllerへ一時停止を配送し、サービス終了後はpackage限定manifest broadcastで再開する。実機2試験成功（`audit-bt-final-device.log`、6.086秒）。これは登録receiver→serviceの統合確認であり、物理BluetoothキーのOS配送自体の証拠とは区別する。
- 修正後の物理イヤホン試験は、一時停止・購読解除・キュー破棄、再開・新着音声のネイティブPLAYING・停止区間の旧音声非再生を確認した（`audit-bt-final-physical.log`）。イヤホンからの音は利用者が確認した。再開直後の短い音は再送を求められ、再送時に「聞こえた」と確認した。暗号化原登録とenrollmentのhash一致、音声・映像サービス停止、所有バックアップ除去を確認した。

### テスト負荷の追加修正

最初の最終Windows全体検査は1,359成功・1失敗。OBS着せ替えの詳細編集試験が5秒期限に対して7.987秒かかった（`audit-bt-final-test.log`、全体216.19秒）。単独の旧試験は4.012秒。操作別の一時計測では全画面の色・見本設定のラベル探索が各約730ms、初期描画は約86msだった（`audit-style-phase-profile.log`）。対象の編集tabpanel・公開summaryから取得する見本detailsへ探索を絞り、role・完全一致accessible name・可視性・hidden除外・値・取り消しの検査を維持した。switch候補はON/OFF付きラベルを厳密に検索した後、元のroleとaccessible nameで同一要素を再検査する。中間の候補検索不一致は失敗として修正し、一時計測出力は全て除去した。

変更後の関連11テスト成功、詳細試験1.841秒（`audit-style-scope-green.log`）。単発比較のため全環境での倍率は保証しない。5秒期限、対象、期待値を弱めず、全体テスト時間を伸ばす設定変更はしていない。仕様軸と故障時・影響範囲軸の独立再レビューで追加指摘なし。Android全258ユニットテスト・lint・デバッグ用コンパイル成功（`audit-bt-final-android-checks.log`、`audit-bt-final-compile.log`）。Windows最終再検査と自然Dozeの結果は後段へ記録する。

### Doze検証の条件と途中結果

[AndroidのDoze説明](https://developer.android.com/training/monitoring-device-state/doze-standby)に従い、強制Dozeと、非給電・消灯・静置で自然に入るDozeを区別する。自然観測のため既存USBデバッグの接続を、同じ端末と確認したLAN内の一時ADB接続へ移した。Wi-Fi・Bluetooth・バッテリー除外・idleの時間設定は変更しない。音声はLAN内の合成fixtureだけで、実配信・投稿・公開設定変更・実カメラ／マイクは行わない。

最初の強制Doze入口は消灯の反映前でmScreenOn=trueだったため中断・復元し、成功として扱わない。消灯を上限付きで確認するハーネスへ修正後、2026-10-11 00:43:57 JSTにmForceIdle=true・mScreenOn=false・mCharging=true・mState=IDLEを確認し、新着3秒音を送った。native PLAYINGを観測した直後も同じdeep IDLEを確認した（`audit-idle-new-states.log`、`audit-idle-new-result.log`）。15秒の期限後にunforceし、古い音声非再生・新着再生を確認した。USB給電中の強制検証であり、自然Doze成功の代用にしない。

利用者がUSBを外して静置した後、00:45:36 JSTにmForceIdle=false・mScreenOn=false・mCharging=false・deep INACTIVEを確認した。以降は約60秒ごとの読み取りのみで最大65分観測する。deep IDLEへ自然移行した場合だけ、その中での新着音声と復帰後の期限切れ非再生を確認する。

最終Windows検査はlint（350ソース）、型チェック、全137ファイル・1,360テスト、pnpm buildが全て成功した（`audit-bt-complete-*.log`）。全体テスト148.91秒。テストの修正前と同時のAndroid検査負荷が異なるため、216.19秒との差を全て今回の探索削減効果とは断定しない。成功後は製品・テスト・検査設定を変更していない。

自然Dozeの端末既定設定はinactive_to=30分、idle_after_inactive_to=30分、sensing_to=4分、locating_to=30秒だった（`audit-natural-idle-config.log`）。これらは読み取りだけで、短縮やバッテリー最適化除外は行わない。開始約2分後からlight IDLEは確認できたが、深いDozeの確認とは区別する。

観測中ハーネスの独立再レビューで、自然deep未到達時にも期限切れ試験の成功名を出す分岐が見つかった。未到達時は通常消灯からの復帰・新着再生だけの証拠とし、自然Dozeでの期限切れ検証は未実施と扱う。今後版の一時ハーネスはラベルを分岐した。実行中の自然観測を中断せず、終了後の実際のstateと投入履歴で結果を分類する。

また強制Doze投入前は先行3秒tone後の4秒待機はあったが、native非再生・キュー空を明示検査していないと指摘された。新着再生の証拠を補強するため、自然観測終了後、先行音声を一切送らず、IDLE内でnative非再生・fixtureキュー空を検査してから新着を投入する追加driverを用意した。既存のforced結果はこの補強前の暫定確認と区別する。

追加の単独計測は変更前と同じテスト選択で実行した（`audit-style-detail-final-isolated.log`）。全体テストは繰り返していない。製品・テストソースは最終成功時から不変。

### 自然Dozeの最終結果

00:45:36 JSTの開始記録から63分33秒後、01:49:09 JSTにdeep IDLEを自然に確認した。入口はmForceIdle=false・mScreenOn=false・mCharging=false・mState=IDLE。途中でlight IDLE、deep IDLE_PENDING、静止検出、LOCATINGへ進む状態も読み取った（`audit-idle-new-states.log`、`audit-natural-idle-timing*.log`）。時計短縮・バッテリー偽装・最適化除外は使用していない。

このIDLEを確認してから新着3秒合成音声を投入し、対象packageのnative MediaSession PLAYINGを確認した。直後の01:49:10 JSTもmForceIdle=false・消灯・非給電・deep IDLEだった。長時間静置の間は音声を投入しておらず、先行再生の残存を新着と数える条件ではない。16秒待ってから画面を復帰し、旧音声のPLAYINGがなく、新しい合成音声のPLAYINGを確認した（`audit-idle-new-result.log`、exit 0）。今回のdeep到達分岐は実行されており、未到達分岐の過剰な旧成功ラベルを結果には使っていない。

この試験ではDoze中の音声が実際に再生された。復帰時の旧音声非再生は確認したが、未再生のキューを意図的に15秒滞留させて破棄させる実Doze試験は行っていない。旧driverの「expired audio not replayed」というログ名だけで、未再生期限切れの全経路を確認したとは扱わない。音の可聴性はBluetooth試験で利用者が確認した範囲、Doze中はネイティブ再生状態の実測である。

外部finallyは音声・映像サービス停止、暗号化原登録・enrollmentのhash一致、所有バックアップ除去を確認した。自然観測の登録は復元済み。独立レビューの補強要求に対応した強制Doze新着試験と、LANデバッグ接続の復元を続ける。

同じ単独条件の最終画面テスト計測は2.182秒で、変更前4.012秒から約46%短縮した（`audit-style-detail-final-isolated.log`）。単発比較であり、全環境の短縮率を保証しない。

### 補強検証・最終レビュー

先行音声を送らない追加driverで強制Dozeへ入り、消灯・非給電・deep IDLE、native非再生・fixtureキュー0のbaselineを必須確認した。新着だけを投入した後、native PLAYING、直後もdeep IDLEを確認（01:51:11〜12 JST、`audit-forced-fresh-states.log`、`audit-forced-fresh-result.log`、exit 0）。復帰後の旧音声非再生・新着再生、原登録・enrollmentのhash一致・サービス停止・所有バックアップ除去も成功した。先行tone残存の指摘はこの補強結果で解消する。PowerShellの関数呼出しを括ってキューの論理式を正しく評価し、構文解析・純粋な真偽条件と独立再レビューで確認した。

最終製品・常設テストはWindows全検査成功時から不変。追加は一時ハーネスの補強と本記録だけで、全体テストやビルドを再度繰り返していない。実着信は別端末を用意できず未検証。今回の確認はこのAndroid 12端末・LAN内合成fixture・用意したBluetoothイヤホンの範囲であり、他OS／他端末／他イヤホン、実サービス・Tailscale・直接接続の全経路の確認へ一般化しない。配布用成果物、実配信開始終了、外部投稿、公開設定変更は行っていない。

仕様一致と故障時・影響範囲の最終独立レビューでも追加指摘なし。所有合成fixtureを終了し、端末の所有バックアップ除去・音声／映像サービス停止・mForceIdle=falseを読み取りで再確認した。USB方式・通常画面の復元を利用者のUSB再接続・手元ロック解除後に確認する。

### USB接続・通常画面の復元完了

利用者のUSB再接続・手元ロック解除後、一時LAN ADBをUSB方式へ戻した。元のUSB端末でget-state=device、service.adb.tcp.port=0を確認し、LAN endpointを切断した。mForceIdle=false、画面ON、給電あり、deep/lightともACTIVE。音声・映像サービスのServiceRecordなし。通常のMainActivityを開き、カメラ停止中・送信停止中・マイク停止中の表示を確認した。原登録・enrollmentは直前の原本復元時hashと再一致し、所有バックアップも残っていない（audit-final-usb-restoration.log）。Bluetoothの利用者設定は維持した。これで検証後の復元確認を完了した。
