# Android外配信の検証記録

## 実行した自動検証

- Windows: `pnpm lint`、`pnpm typecheck`、`pnpm test`（46ファイル・354件）、`pnpm build`。
- Android: `testDebugUnitTest`（10クラス・21件）、`lintDebug`、`compileDebugSources`。
- Windowsのlint・型チェック・全テスト・通常ビルドは成功。Androidの単体テスト・lint・デバッグコンパイルも成功。Android lintには既存実装とライブラリ依存の非致命的警告がある。
- インストーラー、展開版EXE、配布用APK、デバッグAPKの生成は実行していない。

Androidの実行には既存SDK、`%USERPROFILE%/.gradle` とWindowsの信頼済み証明書ストアを使用した。環境上のCA指定は [一次情報確認記録](./android-srt-implementation-2026-09.md) を参照。

## 今回追加した検証

- PC: 専用待受のHost・接続元/待受IP・Bearer検証、経路限定、過大要求、報告内容制限、管理APIの操作保護、読取bootstrapからの除外。
- PC: 旧連番・採用済み旧セッションの無視、鮮度、遅いTailscale検出の監視積み残し防止、暗号化保存の往復と復元不能時のファイル保持。
- PC画面: QRの明示発行、カードを閉じた際の破棄、設定リビジョン変更による破棄、生成中の画面非表示による遅延表示抑止。
- Android: PCと共有するQRデータ、必須フィールド、厳密な数値・固定品質・IP・ポート、非互換版の更新案内、解析エラーへの資格情報非混入。
- Android: 偽SRT相手による明示開始・停止、停止後の旧コールバック/再試行抑止、段階的再接続、接続前/接続後の状態区別、ネットワーク変更での早期試行、準備エラーの理由保持。
- Android: 偽PC応答による報告本文の最小化、ヘッダー認証、任意転送先へのリダイレクト拒否、報告失敗と送信制御の独立性。

## 未確認の実機受け入れ

自動テストはカメラ、Android AudioRecord、実際のSRT暗号通信やOBSデコードの成立を保証しない。以下は今回未実施であり、動作確認済みとして扱わない。

- OBS実機の映像・AAC音声・縦横・AES-256・誤パスフレーズ/未暗号化拒否と再接続。
- Pixel 10aと非Pixel端末での30分送信、ロック、他アプリ、履歴除去、Wi-Fi/携帯回線、Tailscale断復帰、direct/relay。
- 実機でのカメラ切替/復帰、USB/Bluetooth入力、着信、入力喪失後の無音・再選択、発熱/低電池、OS強制終了。
- 実機でのコメント表示・読み上げとの同時利用、およびElectron/通常ブラウザの実画面確認。

これらの合否は [正式な受け入れ条件](../features/outdoor-streaming.md#テスト・受け入れ条件) に従って記録する。

## lint警告の範囲

既存WebView、既存の音声サービス公開宣言、既定HTTP通信設定に関する警告と、RootEncoderのWHIP推移依存に含まれるBouncy CastleのTrustManager実装への警告が残る。外配信の送信器はSRTだけを使用し、WHIPのTLS経路は呼び出さない。Windows信頼済みCAによるGradle取得と、製品内の外配信状態HTTP通信は別の処理である。

## 2026-09-08 QRカメラ解放の回帰修正

利用者の実機では、OBSへの映像開始後にコメントタブへ切り替えると「カメラを開始できません」となった。調査でQR画面を閉じた後もCameraXのPreview/ImageAnalysisがバインドされたままであることと、画面終了後に初期化が完了するとカメラを取得することを、実際のQrScannerとCameraX境界のテストで再現した（修正前2件失敗、修正後2件成功）。

QR画面の破棄時に所有する用途だけをunbindし、解析を終了する。終了後の初期化完了とQR結果通知は無視する。映像送信ライブラリやプレビュー停止処理は今回変更していない。カメラ競合の要因は除去したが、報告された実機でのタブ切替切断の解消は更新APKでの確認が必要。

## 2026-09-08 SRT再接続中の取得継続

採用された仕様に従い、通信失敗では取得リソースを解放せず、RootEncoder 2.8.1のSrtStreamClient.reTryを使用する。再試行間隔は引き続きアプリ側が所有する。再試行ごとに許可回数を1へ設定し、ライブラリへ追加の待ち時間は渡さない。接続開始前の旧通知は無視し、接続成立時に送信待ちを破棄してキーフレームを要求する。

一次ソースの [SrtStreamClient](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/library/src/main/java/com/pedro/library/util/streamclient/SrtStreamClient.kt)、[SrtClient](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/srt/src/main/java/com/pedro/srt/srt/SrtClient.kt)、[BaseSender](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/common/src/main/java/com/pedro/common/base/BaseSender.kt) で、再接続はソケットと送信器を終了・再接続し、取得やエンコーダーを停止しないこと、停止・開始時のキュー破棄とコーデック情報保持を確認した。

回帰テストは段階的再試行、取得リソースの維持、認証失敗からの再試行、旧イベントの無視、明示停止時の解放を検証する。実機ではTailscale切断中のプレビュー・配信マイク状態の維持、復帰後のOBS映像・AAC音声、切断中の明示停止を確認する必要がある。
