# Android ヘッダー・フッターの比較見本（throwaway）

「ヘッダーとフッターが大きすぎる」というフィードバックを確認するための独立した見本。
一段ヘッダー、操作とタブをまとめる、切替を上部へ、現在の見本の4配置を同じ大きさで比較する。
カメラ／コメントの画面切替、ライト／ダーク、配信中／通信断／開始前は架空のローカル状態。
接続、QR読取、OBS、カメラ、読み上げを実際には実行しない。説明欄は通常操作後に追加しない。
2026-10-07に利用者が「切替を上部へ」を採用した。現行動作は[正式仕様](../../docs/features/android-mobile-client.md#配信中の画面と設定)と[ADR 0024](../../docs/adr/0024-adopt-android-camera-comments-ui.md)を参照する。この見本は参考資料として保持し、架空の状態を製品の通信・診断契約へ流用しない。

起動（リポジトリルート）：

```powershell
node node_modules/vite/bin/vite.js --config prototypes/android-compact-chrome-throwaway/vite.config.mts
```

http://127.0.0.1:5210/ 。先行する下部操作の比較資料は5209。
単独ビルドは上記コマンドの `vite.js` 後に `build` を追加する。
ビルド出力は `tmp/android-compact-chrome-ui-prototype-build/`。

`verify-layout.mjs` は隔離したElectron userDataと作業ディレクトリからビルド済みHTMLを読み、
320／400／736px、両画面、両配色、通常／2倍文字で検証する。
端末実機の検証や機能実装完了を示す見本ではない。
