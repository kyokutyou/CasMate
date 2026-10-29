# 共通QRとAndroid接続の実機確認（2026-10-03）

対象は[スマホ連携仕様](../features/smartphone-integration.md)の共通QR版6と、接続済みPixel 10a（Android 17 / API 37）のLAN接続不具合。変更前の基点は `5f4f91f32aec5556711dced4bea51ed44bed8e1a`。資格情報・コメント本文・カメラ映像を本記録へ保存しない。

## 原因と対応

- 保存済みコメントURLは正しく、同じ端末のブラウザでは到達できたが、AndroidアプリのOkHttp接続は2秒でタイムアウトした。targetSdk 37で必要な `ACCESS_LOCAL_NETWORK` が未宣言・未許可だった。宣言追加・許可後に同じネイティブ接続テストが成功。アプリにもLAN利用時の許可要求、拒否時の案内、Android設定から戻った際の再確認を追加した。[Androidのローカルネットワーク権限](https://developer.android.com/privacy-and-security/local-network-permission)も参照。
- OBSの既存SRTソースは対象端末のUDPポートと一致していたが、パスフレーズがPCの現在の登録と一致しなかった。配信・録画が停止中であることを確認し、そのソースの入力だけを現在の「OBS入力」に更新した。OBS配信・録画は開始していない。
- PC画面をネットワークごとに1つの共通QRへ変更。Androidはインストールごとの保護済み識別情報で登録し、同じ端末の再試行を重複追加しない。旧登録の移行には保存済み資格を提示する。

## 実機の結果

| 検証 | 結果 |
| --- | --- |
| 保存URL・ネイティブHTTP到達 | 成功。登録とUIの接続先が一致し、コメントページが200を返す |
| Android内のコメント画面 | WebViewのコメント接続済み表示を確認。WebSocketのsnapshotを受信 |
| ネイティブ読み上げ | PCの試聴を受け、Media3の実再生 `isPlaying` を観測。再生エラーなし、待機へ復帰 |
| 共通QRの登録要求 | PCが発行した版6の内容をAndroidの登録処理へ渡し、同じ招待で2回登録成功。旧端末IDと受信ポートを維持、PCの端末数は1台のまま |
| 移行後のSRT | Androidの送信状態・PCへの状態報告・実映像IDへのSRT ACKを確認し、5秒後に明示停止。診断時には約5.27 MBの送信と実映像ID 472へのACKも確認 |
| PCの操作 | 通常ブラウザで共通QR表示、Esc閉鎖とフォーカス復帰、LAN/Tailscaleの設定表示往復を確認。表示切替でLAN接続は変化しない |
| Electronの配置 | 320・560・760pxの描画テスト成功。最狭幅と通常幅の画像を確認 |

実機テストは `SmartphoneConnectionDeviceTest` の2件と `SmartphoneRuntimeDeviceTest` の2件が成功。共通QRの内容を使う登録処理は確認したが、カメラでPC画面のQRを撮影する操作自体は今回の実機テストには含めていない。検証後は読み上げ・SRT送信を停止し、LAN設定と修正版の登録を保持した。

## 自動検証と再実行

- `pnpm lint`（223ファイル）、`pnpm typecheck`、`pnpm test -- --maxWorkers=2 --testTimeout=15000`（81ファイル・717件）、`pnpm build` は成功。
- Androidは `gradlew.bat --gradle-user-home "$env:USERPROFILE/.gradle" :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug` が成功。単体テスト151件、失敗・スキップ0。デバッグアプリを実機へ更新し、配布用APK・インストーラーは生成していない。
- 最初のPC全体テストはAndroidビルドとの同時実行中に既存の設定保存テスト1件が5秒を超過。対象単体は成功し、負荷の高い処理との同時実行を避けて上記条件で全体を再検証した。
- 最初のPCビルドは検証用PCアプリがワーカーDLLを使用中のため失敗。検証用プロセスを終了して再実行した。最終ビルドにはNuGet脆弱性情報の取得不可（NU1900）の警告が残る。
- 初回の読み上げテストはUI状態の瞬間値を待ってタイムアウトしたため、Media3の実再生遷移を保持する検証へ変更。SRTテストは背景色の状態を映像送信判定に使用していたため、実映像IDのACKへ変更した。製品内に一時的な診断ログは残していない。

## 独立レビューと未確認範囲

仕様観点では、招待情報の初回保存失敗時に既存ネットワークを保持すること、旧OBS専用登録にもLAN権限の案内を出すこと、QRのコメント用ポート範囲を指摘され、修正・再確認済み。故障時・影響範囲の観点では、認証境界、失効、保存順序、再試行、取消を確認し、重大な未解決指摘なし。

実機はPixel 10aの1台とLANのみ。複数Androidの同時利用、非Pixel・Android 10、Tailscaleのdirect/DERP、長時間・画面ロック・着信時は今回未確認。複数登録・別秘密・別経路・失効・保存失敗・再起動は自動テストの範囲で確認した。
