# 全機能の条件別追加調査

前回の[調査台帳](audit-2026-10-24.md)と未コミット修正を引き継ぐ。前回の機能単位の照合完了は、全条件の実証済みを意味しない。本書では追加調査の現在状態を管理する。正式仕様はSPEC.mdから参照する所有文書を用いる。

その後、利用者から検証用APK生成・接続スマホへの更新許可と、約20秒の実カメラ/マイク私設LAN送信許可を受け、[現在ソースのAndroid実機追加検証](current-android-device-2026-10-24.md)を実施。以下の「導入APKとの一致未証明」は先行工程の制約であり、後続の導入ハッシュ確認で解消した。現行APKのLAN/実OBS画像・操作/短いSRT送信/ロック・背景・音声寿命を確認し、設定・登録13ファイルの原本復元も全ハッシュ一致。別回線・長時間・全品質の実証とは区別する。後続工程の最終検証は同記録へ追記する。

## 状態の定義

- 原文照合: 条件・例外・関連用語・ADRと具体的なコード経路を確認した状態。試験成功を意味しない。
- 自動確認: 対象条件を実際に駆動する試験を特定し、現在差分・実行環境で結果を確認した状態。代替した境界を明示する。
- 実環境確認: 実機・実サービスで条件を実証した状態。過去記録を今回の結果へ繰り上げない。
- 未再照合: 前回の記録はあるが、追加調査の条件別証拠をまだ点検していない状態。

## 25機能の追加調査入口

全行について、正常・境界・異常、保存/移行、起動/終了、切断/復旧、競合、公開/認証、機能間連携を確認する。適用しない条件もコードと所有仕様に基づき理由を残す。「未再照合」を既知不具合なしと解釈しない。

| 機能/所有仕様 | 特に追加確認する条件 | 追加調査状態 |
| --- | --- | --- |
| PC・スマホ間の通信 / smartphone-transport | 用途資格、再購読、ACK、遅延、世代、帯域競合 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| スマホ連携 / smartphone-integration | 排他的公開、登録更新、複数端末、保存中切替 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| 直接接続 / smartphone-direct-connection | TCP/UDP/IPv4/IPv6、候補変更、実ルーター、UAC/SCM、終了 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| OBS操作 / obs-control | 接続切替、音声/Android確認競合、期限後応答、実OBS | 条件別静的照合済み。現行Android→隔離実OBSの確認付きloopback出力開始/終了が成功。実マイク音声の二段階確認との結合は未確認 |
| OBS映像確認 / obs-program-preview | 実JPEG、画像境界、転送中失効、ACK、実OBS/Android | 実JPEG/ACK6条件を追加し関連35件成功。後続の現行Android/実OBS間で画像転送・再生成/背景/許可変更による破棄と非自動再取得を確認。Tailscale/直接接続での実機結合等は未確認 |
| OBSソース登録 / obs-source-registration | コレクション変更、部分失敗、共有ソース、実OBS表示 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| Android外配信 / outdoor-streaming | 実カメラ/音声、長時間、GL故障、再接続、品質切替 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)。後続で現行APKの約20秒LAN SRT送信・受信確認・停止・登録復元が成功。実OBS表示/音声の実聴取・全品質/長時間は未確認 |
| コメント取得 / comment-acquisition | 実サービス応答、文字境界、再接続/停止競合、進捗 | 条件別静的照合済み。[9機能の条件記録](audit-2026-10-24-conditions-comments-local.md)（実行未確認は別管理） |
| コメントフィルター / comment-filter | Unicode、AA閾値、複数表示/音声/AIへの一貫した除外 | 条件別静的照合済み。[9機能の条件記録](audit-2026-10-24-conditions-comments-local.md)（実行未確認は別管理） |
| 掲示板次スレッド / shitaraba-next-thread | 結果不明、認証、切替中の旧応答、実投稿の許可条件 | 条件別静的照合済み。[9機能の条件記録](audit-2026-10-24-conditions-comments-local.md)（実行未確認は別管理） |
| OBSコメント表示 / comment-overlay | 取得断、同期音声、設定変更、実OBS/大量履歴 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| コメント文字演出 / text-effects | 同時発火、処理上限、非表示復帰、旧受入記述 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| 簡易キャラクター / simple-character-display | 実PNG、両レイヤー故障/復旧、音声断、微動同期 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| ローカルアプリ / local-application | 破損/移行/容量不足、終了待ち、公開面、TEMP置換拒否 | 条件別静的照合済み。[9機能の条件記録](audit-2026-10-24-conditions-comments-local.md)（実行未確認は別管理） |
| 管理画面 / management-screen | 全編集先、通知/操作位置、窓/履歴、15領域と旧記述 | 条件別静的照合済み。[9機能の条件記録](audit-2026-10-24-conditions-comments-local.md)（実行未確認は別管理） |
| 初回設定 / initial-setup | 全単独/複合経路、指紋失効、保存競合、再起動 | 条件別静的照合済み。[9機能の条件記録](audit-2026-10-24-conditions-comments-local.md)（実行未確認は別管理） |
| コメント一覧 / comment-list | 10,000件、実スクロール/選択/コピー、方向切替、終了 | 条件別静的照合済み。[9機能の条件記録](audit-2026-10-24-conditions-comments-local.md)（実行未確認は別管理） |
| コメント読み上げ / comment-speech | 実VOICEVOX/出力、話者変更、タイムアウト/停止、既定記述 | 条件別静的照合済み。[9機能の条件記録](audit-2026-10-24-conditions-comments-local.md)（実行未確認は別管理） |
| スマホでコメントを聞く / mobile-speech | 遅い端末、複数購読、変換取消、ロック/復帰 | 条件別静的照合済み。[9機能の条件記録](audit-2026-10-24-conditions-comments-local.md)（実行未確認は別管理） |
| Androidクライアント / android-mobile-client | OS再生成、背景/復帰、資格失効、実端末、保存旧記述 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)。後続で現行APK一致・登録/再登録/不正招待保全・背景/ロック・OS音声操作・プロセス再生成・強制停止後の非自動再開を確認。全実回線/実端末再起動等は未確認 |
| Android手書き合成 / android-handwriting-overlay | GL/静止/動画復帰、寿命、回転、実SRT合成 | 仕様/ADR0028、GLフィルターと実機試験4件を追加照合。現行APKでも実GPU4件成功。手書きの実SRT→OBS表示・長時間等は未確認 |
| 配信者音声認識 / streamer-speech-recognition | 実入力/モデル、共有期間、入力切替、旧結果/終了競合 | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| OBS音声認識表示 / speech-recognition-overlay | 確定結果/期限、再接続、公開射影、実OBS | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| OBSデザイン編集 / obs-style-editor | 両対象/共有部品、CSS/JSON境界、履歴/保存失敗、単独HTML | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |
| AIリスナー / ai-listener | 取消/投稿直前再検証、認証/結果不明、記憶削除、実API | 条件別静的照合済み。[13機能の条件記録](audit-2026-10-24-conditions-mobile-obs-ai.md)（実行未確認は別管理） |

## 現在の実環境証拠（2026-10-24、通常Windows権限・読取りのみ）

- Android SDKのadbで`devices -l`: 端末一覧は空。
- その後、利用者から接続の連絡があり再確認: SH-M15、Android 12/API 31をADBで認識。`jp.casmate.app`とテストrunnerが導入済み。本体versionCode=1/versionName=0.4.0、lastUpdateTime=2026-10-14 17:36:31。現在ソースとの一致は未証明。端末不在の制約は解消したが、過去のビルドを現在差分の検証済みとはしない。
- OBS: obs64プロセス0、TCP 4455の待受0。VOICEVOX: 該当プロセス0、TCP 50021の待受0。これは現在の稼働確認であり、未インストールを意味しない。導入先や別ポートは未探索。
- 追加探索で`C:\Program Files\obs-studio\bin\64bit\obs64.exe`（32.2.2）と既存OBS WebSocket設定を確認。待受有効・4455・認証必須・パスワード設定済み。パスワードは出力していない。既存設定/シーンを変更せず、隔離した試験設定で実OBSを駆動できるかを次に確認する。VOICEVOXは確認した既知導入先に見つからず、他の導入形態は未探索。
- EthernetアダプターUp、Wi-Fi切断。TailscaleアダプターUpだがCLIのBackendStateはStopped、Self.Online=false。アダプターのUpだけでは実接続確認としない。サービス開始や接続設定変更はしていない。
- 外部認証・投稿・公開配信、実マイク/カメラの取得は実施していない。機器・アカウントの利用可否を追加探索し、副作用が必要な試験は具体化してから必要な確認を行う。

## 次の検証

OBS映像確認は`ObsProgramPreview`の画像寸法デコーダーを既存試験が置き換えていたため、実JPEG経路の3条件を追加した。さらに共有するOBS認証・制御接続・Android受信を照合する。ADR 0012/0019と撮影/転送実装・既存テストを確認し、用途資格と2本の接続を維持する経路を追跡中。撮影側だけで機能全体を確認済みとはしない。

追加ゴール開始時点では製品コードの追加変更と最終全体テストの再実行を行っていなかった。その後の変更・局所結果を以下へ追記する。追加ゴールは現在も継続中。

上記の開始時点から調査を進め、22機能は2担当で条件別静的再照合を完了し、根拠を上表の担当記録へ分離した。OBS操作・OBS映像確認・Android手書き合成の3機能も主担当で照合を完了した。全25機能の条件別調査を記録したが、その全条件の実行成功を意味しない。下記2件の追加不具合は修正・関連回帰・追加レビューを完了し、最終検証中。

## 追加の確定問題と現在の検証

### N1 / P2: 直接接続のCDN画像でDNS期限と取消が欠落

所有はsmartphone-transportの直接接続資産取得5秒/512KiBと、失効/OFF時の終了。`direct-assets.get`がDNS終了後にHTTPS用5秒を開始し、HTTPのcloseが上流取得へ伝わらなかった。`tests/direct-assets.test.ts`でDNS停止、取消、DNS4秒後HTTPS開始の3条件すべてが修正前に失敗。sandbox TEMPのEPERMによる0件実行を成功に含めず、通常権限でredを確認した。

DNS前から共通期限を作り、呼出元signalと結合し、DNSの遅延結果からHTTPSを開始しないよう修正。HTTPSにも同じ残り期限を渡す。HTTP資産入口はresponse closeで上流signalを中断する。OSのlookup自体には取消APIがないため、その終了までのOS内部処理が消えるとは主張しない。

`pnpm test direct-assets direct-server --testTimeout=15000`、2ファイル8件成功。実HTTPSサーバーで資格失効によりHTTPと待機中get双方が取り消される条件も追加した。公開範囲検証、許可CDN、HTTPSの接続先固定と既存容量制限は保持。広い利用側の回帰と追加レビューの結果は末尾に記録。

### N2 / P2: 素材と直接接続操作の遅いHTTPが新WS状態を巻き戻す

ローカルアプリ所有の遅延応答・管理WS連番の共通契約。`renderer/api.ts`の`uploadAsset`と`smartphoneDirectAction`だけがsnapshotを無条件適用していた。要求後にWS revision=5の新認識設定を受け、古い版なし/revision=4応答を返す4条件が修正前すべて失敗。

両経路に既存mutateと同じ版比較を適用した。版なしは要求後にWSが進んでいない時だけ、版付きは現在以上だけ採用する。新しい版はlastRevisionへ反映し、その後の古いWS差分を無視する。`pnpm test renderer-api --testTimeout=15000`、12件成功（追加6件）。初回設定/キャラ設定/直接接続UIなど利用側の回帰と追加レビューの結果は末尾に記録。

### 境界の不足条件

コメントフィルターへAAの合計7/8文字、行2/3文字、行/全体の50%ちょうど/未満、CR/CRLF、空白行、結合文字、補助平面文字の13条件を追加。共有判定・受信・画面テストの一致を確認した。`pnpm test comment-filter --testTimeout=15000`は通常3ファイル26件と描画1ファイル1件が成功。追加直後に型注釈をas constへ整理したため、最終関連群で現在テキストの再成功を確認する。

通常表示面のエモート「許可された画像URL」は許可host/protocol/private範囲の具体定義がなく、directの6hostをそのまま適用する根拠もない。YouTube parser→CommentItemで任意URLが画像取得へ進む候補経路を記録し、所有仕様の確認が必要な条件として切り分けた。推測の許可一覧による製品修正はしていない。追加文書残件は簡易キャラクター仕様の「現行スキーマ13」と共通所有仕様の16。

## 隔離した実OBSの追加確認

[公式ソース調査](../research/obs-isolated-validation-2026-10-24.md)に基づき、インストール済みOBS 32.2.2のプログラムをignore済み`tmp/audit/obs-isolated-32.2.2`へコピー。既存設定/資格はコピーせず、FirstRun=true、入力ゼロの試験シーン、専用ポート4456・生成した一時パスワードでportable起動した。通常OBSの設定やWindows受信許可は変更していない。obs-websocketにloopback専用bind設定はなく、試験は127.0.0.1からだけ接続した。コピーは配布物として生成・提供していない。

前工程でビルドした製品のDefaultObsWebsocketTransportとObsProgramPreview（該当モジュールにその後の変更なし）で認証・撮影を駆動。640×360→640×360、360×640→360×640、1920×1080→1280×720の実JPEGを取得し、同梱FFmpegでメモリー内復号して黒画素と寸法を確認した。画像ファイルへ保存していない。誤パスワード拒否、本番AuditProgramとスタジオモードの別プレビューAuditPreviewの区別も成功。

試験前後のGetInputListは空、配信/録画はfalse。既存のカメラ/マイクを使っていない。終了時に所有PIDとコピーの実行ファイル絶対パスが一致することを確認し、試験OBSだけを終了、HasExited=true。実OBSからAndroidまでの転送、実OBS出力の開始/終了、実カメラ/マイクとの結合は未実証。

### PCの実JPEGと転送の条件

同梱FFmpegのlavfi colorから32×18の黒JPEG（226 bytes）を生成し、`tests/fixtures/obs-program-black.jpg`として保存。個人画像や実OBS画像は使わない。`obs-program-preview.test.ts`に実image-size解析による黒/小画像受理、要求寸法との不一致拒否、壊れた開始終了マーカーのみのJPEG拒否→次の明示取得で復旧の3件を追加した。

`pnpm test obs-program-preview smartphone-control-session --testTimeout=15000`、2ファイル32件成功。後者には実TCP下り4KiB/sでもheartbeat継続、版/用途違い拒否、取消/購読世代/切断/失効時の旧結果破棄、転送待ち中の許可OFFが含まれる。全ネットワーク/実OBS/実Androidとの結合をこの成功で代替しない。追加したのは不足条件のテストであり、新たな製品不具合の確定・修正はまだない。追加テスト差分の最終lint/型/全体/buildは調査工程の最後に行う。

その後、不正imageId/offset/generationのACKで次の断片へ進まず、heartbeat維持と正規ACKでの再開・取消を確認する3条件を追加。上記2ファイルを全件再実行して35件成功。

### 接続端末の局所確認

端末IDを固定して既存の`ObsProgramPreviewDeviceTest`を`am instrument`で実行、`nativeJpegAssemblyAndBothThemesKeepButtonsStableAtDoubleText`が5.44秒で1件成功（skipなし）。ソース上は合成JPEGの組立/ネイティブ復号と両配色・文字2倍の操作位置を確認し、保存済み登録や実配信サービスを変更しないテスト。ただし導入済みテストバイナリーと現在ソースとの一致は未証明のため、実行成功だけで現在のAndroid製品実装全体を検証済みとはしない。実OBS撮影・ネットワーク転送との結合は未確認。

テスト生成のdark/light・文字2倍の画像だけを`tmp/audit/device-preview`へ取得して目視確認。合成画像全体、閉じる/更新、シーン名が表示され、取得時刻の続きは固定状態領域のスクロール対象となる。通常利用画面・個人データのスクリーンショットは取得していない。既存ローカルdebug APKとandroidTest APKはいずれも10月14日生成であり、現行ソース一致の証拠にはならない。新しいAPKは生成・インストールしていない。

`OutdoorDrawingGlDeviceTest`を`verifyDrawingGl=true`で実行し、6.939秒で4件成功（skipなし）。合成Surface/Bitmapだけで縦横出力・4方向と前後を模した入力・プレビュー拡縮、出力とプレビューの画素一致、静止下書きの非公開/再保持/成功後公開、GL再生成、アップロード故障と明示再試行、非公開下書きから公開版へ戻る際の失敗分離を実GPUで確認した。実カメラの前後切替・実動画送信・端末回転の全経路の実証ではない。導入済みAPKの版の制約はOBS画像の試験と同じ。

`OutdoorAudioClockDeviceTest`は3.116秒で1件成功（skipなし）。実MediaCodec AACへ合成無音を渡し、入力交換の停止間隔後も時計遅延が増大しないことを確認した。マイク・カメラ・通信・録音を使わない条件であり、実音声入力の切替や長時間音声フォーカスの実証ではない。

## 追加レビューと検証工程

固定基点`03a3c0300873de8c650680cff9507f0a12d8f32c`に対する現在の未コミット差分・追加ファイルを、code-reviewスキルで独立したSpec軸とStandards/故障影響軸へ分離して再レビュー。両担当ともN1/N2と前工程の共有処理・音声・OBS・保存・公開境界を照合し、追加の確定指摘なし。読取りレビューであり実行結果の代替としない。

広い関連群のファイル全体を`pnpm test direct- smartphone-control-session smartphone-controller smartphone-navigation simple-character character-asset renderer-api obs-registration-api initial-setup-ui initial-setup-store comment-filter comment-list-page dashboard-source-start obs-design-page obs-style-editor-rendering obs-custom-css overlay-transparency electron-startup local-server --testTimeout=15000`で実行し、36ファイル644件（通常33ファイル641件、描画3ファイル3件）が全件成功。N1/N2の利用側回帰と追加レビューは完了。最終lint・型・全体テスト・buildへ進む。

最終検証はWindows通常権限・標準TEMPで、上記関連群→`pnpm lint`（521ソースファイル）→`pnpm typecheck`→`pnpm test --testTimeout=15000`の順にすべて成功。全体は194ファイル2,420件（通常169ファイル2,377件、描画25ファイル43件）、1032.14秒。全体実行中に別のテスト・lint・型・buildを並行実行していない。15秒は前工程で測定した描画の5秒超過に対するコマンド指定を継続し、製品期限やテストの検査条件・標準4/2並列は変更していない。追加差分に対する最後の全体テストはこの1回で成功した。

その成功後に`pnpm build`を実行しexit 0。Viteの大きいchunk、CMakeの古い互換ポリシー/PkgConfig未検出等の警告・探索表示は残るが、Web各面・TypeScript・.NET両ワーカー・ネイティブ外配信ワーカーを完了した。インストーラー・展開版・APKは生成していない。`git diff --check`も成功。

### 実VOICEVOXとAAC変換

保存設定にある実行ファイルがVOICEVOXの`vv-engine/run.exe`であることを確認し、既存エンジンを流用せず、未使用の127.0.0.1専用ポートに製品VoicevoxAdapterで起動。話者43件の取得、固定文「動作確認です。」のWAV合成、製品FfmpegTranscoderによるAAC-LC/mono変換と復号確認が成功した（起動1914ms、合成・変換2294ms、WAV61484 bytes、M4A13194 bytes）。音声はメモリー内だけで処理し、保存・再生していない。

finallyで両製品アダプターを終了し、所有プロセス一覧が空・エンジンポート閉鎖を確認した。既存ユーザー設定は変更していない。実スピーカー再生、スマホへの音声配信、実マイク認識の結合はこの試験では未確認。冒頭の「稼働なし・既知導入先なし」は探索開始時点の記録であり、現在の導入可否の結論ではない。

## 残る実行条件と必要な前提

| 条件 | 現在の証拠・不足する前提 |
| --- | --- |
| 現行Android版のPC結合 | 後続の利用者許可に基づき検証APKを生成・更新し、生成物/導入物のハッシュ一致とLAN実機結合を確認。詳細は[現行実機記録](current-android-device-2026-10-24.md)。古い固定先・旧登録形式の試験スクリプトは使わず、現在の製品APIから一時登録を生成した |
| OBS実出力と音声/Androidの確認 | 後続でloopback RTMPへの合成出力と現行Androidの二段階確認を結合して成功。公開配信は行っていない。実マイクからの二段階確認、Tailscale/直接接続の実機確認は未実施 |
| LAN/Tailscale/直接接続・ルーター・UAC/SCM | Ethernetは利用可能だが、TailscaleはStopped/Offline。実ルーターの管理先・操作対象や実外部回線は指定されていない。受信規則/サービス・ルーターの変更は未実施。ループバックのサーバー試験と実回線の到達性を区別する |
| 実カメラ/マイク・長時間利用 | 後続の送信先を限定した明示許可により約20秒のLAN実送信を確認。録画なし。合成音声の背景/ロック/音声フォーカスは現行APKで確認。実映像送信の回転/レンズ切替・長時間・手書きの受信最終表示は未実証 |
| 外部コメント・AI認証・実投稿 | 対象アカウント/試験スレッド/書込み先の指定や外部投稿・有償API試験の許可がない。モックとコード経路は照合したが、現時点の実API応答・認証更新・結果不明の実書込みは未実証 |
| Windows実操作と故障条件 | 描画試験の寸法/操作位置と保存失敗注入は実行対象。独立コメント一覧10,000件での実選択・コピー、実ディスク容量不足、OS強制終了、既定出力の実聴取、全倍率/IME/複数窓の組合せは未実証 |

これらは「不具合なし」の判定ではない。必要な機器・対象・許可が揃った時に、ここで示した具体的条件から再開する。仕様矛盾・未定義条件は上記と担当記録の要確認として保持し、今回の製品修正で勝手に意味を選ばない。

## 今回の到達点

全25機能について条件別の仕様・用語・ADR・実装・テストの照合を完了し、前工程の11件を保全したまま、追加の確定不具合2件を修正した。追加境界テスト、利用側回帰、独立2観点レビュー、最終lint/型/全体/buildを完了。実OBS・実VOICEVOX・接続Androidの実行可能な条件も追加確認した。未対応の確定修正項目はない。上表の未実証条件と仕様の要確認事項は残り、全条件の実証済み・不具合不存在とは結論しない。
