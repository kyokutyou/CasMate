# Android画面切り替えと横フリックの検証（2026-10-07）

対象仕様は [配信中の画面と設定](../features/android-mobile-client.md#配信中の画面と設定)。仕様の所有文書へ、コメント文書の保持・非選択時の購読解除・非操作領域の横フリックを先に反映した。

## 原因と修正

- カメラへ移るとコメントWebViewが破棄され、戻るたびにHTML・JavaScriptから読み直していた。コメントだけを同じ接続identity・Activity内で保持し、画面外では入力・フォーカス・アクセシビリティ・コメント購読を無効にする。カメラは引き続き非選択時にプレビューと前面OBS購読を解放する。
- コメントの独立スクロール面で横タッチが `pointercancel` になっていた。Android埋め込みの一覧と状態欄へ `touch-action: pan-y` を指定し、縦スクロールを維持する。ヘッダーの余白もネイティブ横フリック検出の範囲へ含める。
- 修正前の失敗ログは `tmp/android-smooth-navigation/retained-comments-red.log`、`header-flick-red.log`、`renderer-touch-red.log`。作業開始時点の比較用ファイルは同ディレクトリの `before/`。他の採用済みUI変更を今回の差分に混ぜてレビューしない。

## 自動検証

- `pnpm lint`、`pnpm typecheck` 成功。
- `pnpm test --maxWorkers=2 --testTimeout=15000`：114ファイル、1,010件成功。全体テストとビルドは順次実行した。
- `pnpm build` 成功。検証用PCアプリを送信・OBS配信停止確認後に更新して再起動した。
- 実Chromiumのタッチ入力で、本文・投稿者名・サービス名・行の余白・状態欄・一覧の隙間・空欄を検証。縦スクロール、短い動作、ボタン・リンク、取消、複数指、320px・文字2倍・ダーク配色と通常ブラウザの非変更を確認。詳細は `tmp/android-comments-layout/touch-coverage.json`。
- Androidの関連テストでは保持・事前準備・ロード回数・接続変更／再読込／描画終了、ヘッダー余白、状態バッジ・診断要約のスクロール面を検証。実際のブリッジと購読管理を使い、ready後の購読、非選択・背景での解除、再選択時の返信先の再利用、破棄済み応答の拒否も確認した。RobolectricのWebView寸法補完はテスト内に限定し、実寸は実機で別途確認する。

## 実機検証と完了状態

- Android最終全体検証：`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest --offline` 成功。225件成功・失敗0件。lintはエラー0件、既存警告23件。検証コードの後続変更はAndroid lint・デバッグテストAPKビルドを再実行した。ログは `tmp/android-smooth-navigation/native-full-final.log` と `native-device-evidence-build.log`。
- USB接続のAndroid 12実機（1080×2280、密度3）へ保存登録を残してデバッグ版を更新した。最初のコメント選択前に実WebViewが1080×1992で測定・読み込み済みであること、同じインスタンス・文書マーカーを保持して切り替えること、縦スクロールと戻った時のスクロール位置、ヘッダーと本文の寸法が動かないことを確認した。
- `NavigationSurfaceDeviceTest#retainedCommentsAndTouchSurfacesNavigateWithoutStartingServices`：1件成功、12.959秒。本文・投稿者名・サービス名・画像・行余白・接続状態・空欄、停止中カメラ5箇所、ヘッダー余白両方向の計14箇所を実タッチで確認した。WebViewの各領域では表示範囲・ヒット対象・pointerupまでの完了・pointercancelがないことを検証した。送信・読み上げは開始しない。ログは `device-retained-final.log`、測定値は `device-retained-result.json`。
- タブ操作開始から保持文書の確認までは152ms。この値には自動操作・UI待機・JavaScriptによる確認時間を含む。画面の最初の描画フレームを撮影計測した値ではなく、ユーザー報告の約0.8秒との厳密な性能比較には使わない。毎回のWebView・HTML・JavaScript再生成がなくなったことを直接確認した。
- `NavigationSurfaceDeviceTest#liveCameraTextureMarginsAndDiagnosticSummaryFlickWithoutStoppingTheSend`：1件成功、11.108秒。事前のユーザー承認の範囲で実カメラ・マイクを登録済みLANのPCへ一時送信し、実プレビュー・状態表示・余白6箇所、OBS表示未確認バッジ、診断要約の計8箇所を確認した。診断の縦スクロール、カメラを離れた時のプレビュー解放、切り替え中の送信継続も確認した。OBS配信と読み上げは開始しない。finallyで送信を停止し、終了後のサービス停止・OBS配信停止も確認した。ログは `device-live.log`、結果は `device-live-result.json`。
- 最初の端末試験で行余白の左端からの横タッチが取り消された。実測のOS戻るジェスチャー予約領域は左90px（30dp）で、18dpからの入力がこの領域に入っていた。予約領域を避け、行余白・空欄を中央で検証して成功した。Android埋め込みCSSの `pan-y` は端末上でも適用されており、OSの戻る操作を上書きする製品変更は行わない。一覧左端の狭い隙間は実Chromiumで別途検証し、Androidでは仕様どおりOS安全領域を除外する。失敗ログは `device-retained.log`・`device-retained-probe.log`、修正後は `device-retained-final.log`。
- 仕様軸と開発ルール軸を別のレビューで確認した。購読ライフサイクルの検証不足、端末試験の要素位置、偽ソケットの後始末を補強し、未解決指摘なし。新たな通知欄・説明欄・テレメトリーは追加していない。

実装・テスト・ビルド・端末への反映を完了した。検証用PCアプリとAndroid本体は更新済み。一時送信と読み上げは停止状態に戻した。
