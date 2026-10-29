# Android ヘッダーなしの比較見本（throwaway）

問い：ヘッダーをなくし、カメラとコメントの表示面積を広げながら、切替・設定・接続確認へ迷わずアクセスできるか。

- A「下部にひとまとめ」：2つの画面タブ、主操作、メニューを1行に置く。
- B「切替ボタンとフリック」：主操作を広くし、もう一方の画面へ移るボタンとメニューを添える。
- C「全画面と操作シート」：固定フッターも外し、切替と操作の浮動ボタンから操作シートを開く。

いずれも左右フリック、ライト／ダーク、通信断、開始前、送信停止とOBS配信の確認を試せる。状態は架空でローカルだけに保持する。カメラ・QR・接続・OBS・音声を実際には動かさない。説明欄を通常操作後に追加しない。完全な見本状態は画面外の「見本の状態」に表示する。

正式仕様の変更・製品実装はこの比較には含まない。現在採用済みの仕様は[Androidクライアント仕様](../../docs/features/android-mobile-client.md#android画面)と[ADR 0024](../../docs/adr/0024-adopt-android-camera-comments-ui.md)を参照する。

```powershell
node node_modules/vite/bin/vite.js --config prototypes/android-headerless-throwaway/vite.config.mts
```

http://127.0.0.1:5211/ 。`?variant=A`、`?variant=B`、`?variant=C`で初期案を指定できる。
同コマンドの `vite.js` 後に `build` を加えると、`tmp/android-headerless-ui-prototype-build/`へ単独ビルドする。

`verify-layout.mjs`で320／400／736px、通常／2倍文字、両画面・両配色の外形と通信断時の安定性、設定・確認・切替をElectron描画で確認する。
