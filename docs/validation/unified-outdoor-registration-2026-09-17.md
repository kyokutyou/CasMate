# 統一外配信登録の検証（2026-09-17）

対象は採用された版4統一QRとPC/Android導線。未コミット差分、基準HEAD `2791d431fbcfd93cc9210b21d9ab5bdaec982880`。以前のB案採用差分も同じ作業ツリーに残っている。

## 自動検証

- 作業前のPC全体テスト: 76ファイル・686件成功。`pnpm test --maxWorkers=1 --testTimeout=15000`。既存の重い画面テストのためタイムアウトを明記して実施。
- 関連PCテスト: 統一登録の契約・API、準備の部分失敗、未保存入力、QR寿命、個別QR/OBS入力コピーの保存待ちを追加。直近の関連3ファイル12件成功。
- `pnpm lint`（229ソース）・`pnpm typecheck`: 成功。
- PC全体テスト: `pnpm test --maxWorkers=1 --testTimeout=15000`、78ファイル・695件成功（330.24秒）。
- `pnpm build`: 成功。NuGet脆弱性情報を取得できないNU1900警告あり。配布用パッケージの生成は行っていない。
- Android: `testDebugUnitTest lintDebug --offline --no-daemon -Pkotlin.compiler.execution.strategy=in-process` 成功。63件すべて成功、コンパイル・lintも成功。共通QR見本、暗号化準備失敗時の旧データ保持、個別セクション更新、破損時の失敗、OBS経路変更時の操作中解除を検証対象に追加。

## 実行環境と修正経緯

Android wrapperは配布URLの証明書検証で失敗したため、既存のGradle 9.5.0 / JDK 17キャッシュでオフライン実行した。リポジトリ内のGRADLE_USER_HOMEとANDROID_USER_HOMEを指定し、Kotlinはin-process。サンドボックス由来の既存デーモンではRobolectric SDK JARがアクセス拒否になり、`noncompatWidthPixels`/`AndroidVersions.CURRENT`で初期化失敗。権限レビュー後の新規 `--no-daemon` プロセスでRobolectricは正常起動した。証明書検証は無効化していない。

初回全体検証では旧ボタン名・詳細設定を常時表示とするテストが失敗し、新導線に合わせて操作・期待表示を更新した。Androidの通信詳細は小さい表示領域でもスクロールして到達できることを確認する。

## 画面確認

`tmp/obs-production-preview` の実製品コンポーネントを使うモック（5202）で確認。OBS・端末・実際の公開設定には接続しない。

- 共通見出しと緑色の説明、PC接続→準備→登録の順序を視覚確認。
- 全接続未準備から明示準備操作で3系統が準備済みになることを確認。
- 統一QRダイアログは5機能と自動開始しない旨を表示。閉鎖後に登録ボタンへフォーカス復帰。
- AndroidのRobolectric出力画像でも共通送信状態・マイク・映像非表示操作を視覚確認。
- 320/560/760pxでdocument幅はviewport幅と一致し、横はみ出しなし。
- 560pxの長文保存エラー前後で準備ボタンの領域内位置364.6px、登録638.2pxが不変。状態枠80px、操作フォーカスも維持。

## 独立レビュー

code-reviewスキルに従い2担当が別々に確認。

- 仕様軸: OBS入力コピー・個別QRが保存前ポートを使用する競合を指摘。flush完了待ちと離脱時取消を実装し、再確認で解消。
- 基準・故障軸: 暗号化保存失敗の未捕捉、OBS経路変更後のworking残留を指摘。成功後のみUI/audio更新、経路変更時の操作状態解除を実装。読み上げ再接続失敗は完了済み登録の失敗と混同せず、個別の警告として返す。担当者の再確認で3件すべて解消。

## 制約

実Android端末・実OBS・Tailscaleによる映像/音声送信と配信先での同時受信は未確認。Android Keystore実機挙動と外出先ネットワークの確認を残す。配布物・インストーラー・APKは生成していない。
