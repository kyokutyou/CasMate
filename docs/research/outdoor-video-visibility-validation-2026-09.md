# 映像非表示と共通操作領域の実装検証

2026-09-10。基準は `6874361ce5a9c698b6a5405a51a8cf9dad94cf35`。正式仕様は [Android外配信](../features/outdoor-streaming.md#映像の非表示) と [Android画面](../features/android-mobile-client.md#android画面) が所有する。

## 一次情報と実装

- 固定版RootEncoder 2.8.1の [StreamBase.changeVideoSource](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/library/src/main/java/com/pedro/library/base/StreamBase.kt) を確認した。ソース変更は映像入力だけを停止・交換し、音声入力・音声エンコーダー・SRT接続を再準備しない。失敗時の旧ソース再開処理があるため、非表示への切替では先にカメラを停止し、失敗後にも再停止して黒出力を維持する。
- [BitmapSource](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/encoder/src/main/java/com/pedro/encoder/input/sources/video/BitmapSource.kt) のSurface/Canvas描画を確認した。標準クラスは描画例外を外へ通知しないため、アプリの代替映像ソースで初回同期描画、後続の間隔描画、失敗通知、SurfaceとBitmapの解放を所有する。停止と描画は排他化し、Androidのキャッシュ復帰時に描画が大量実行されない固定遅延タイマーを使用する。
- [GlStreamInterface](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/library/src/main/java/com/pedro/library/view/GlStreamInterface.kt) の `muteVideo` はエンコーダー出力に作用し、プレビューを黒にしない。そのため非表示時の端末表示はTextureViewから黒背景・固定画像へ置き換える。固定画像の入力サイズは実出力の縦横と一致させ、カメラ回転を流用しない。
- 固定画像はAndroidの選択画面から取り込み、デコード時に最大辺1920へ縮小して端末専用領域へPNG保存する。送信フレームには縦横比を維持して中央配置し、余白を黒で埋める。画像保存の確定と配信開始を同じロックで直列化し、配信中の画像置換を防止する。

## 検証

- 共通領域の高さ、メーターと操作ボタンと本文の順、両タブでの映像・マイク操作、タブ往復、終了確認の確定・キャンセル、共有設定の維持を確認した。
- 画像の縦横比と黒余白、黒フレームの不透明性、画像の保存・再読込・失敗時の保持、配信中変更禁止、代替映像の向き設定を確認した。
- 画面計測はRobolectricのネイティブ描画を使用する。通常文字サイズ・幅320dpで共通操作領域は約126dp。144dp以内の回帰条件を設け、ボタンは48dp以上のタッチ領域を維持する。描画確認画像は `android/app/build/reports/layout/outdoor-common-controls.png` に出力される。
- RobolectricではImageDecoderのAndroid固有ファイル記述子経由のデコードが未対応だったため、画像デコード・保存テストでは同じデコーダーへByteBufferソースを渡す。選択画面からのURI読込は実機確認対象として残す。
- 仕様軸レビューで代替映像失敗時のプレビュー残留、標準軸レビューで画像保存と開始の競合を指摘され、修正後に再レビューした。追加の確定欠陥はなかった。
- 最終検証はAndroid 52テスト、`:app:lintDebug`、`:app:compileDebugKotlin` が成功。既存lint警告のみ残る。Windowsは `pnpm lint`、`pnpm typecheck`、`pnpm test --maxWorkers=2`（356テスト）、`pnpm build` が成功した。

## 実機確認対象

OBSでの黒画面・固定画像・カメラ復帰、切替中の配信マイク音声、再接続中の非表示維持、前後カメラと縦横の組合せ、画像選択画面のURI読込は実機未確認。自動検証や描画確認を実機確認済みとは扱わない。配布用APK・Windows配布物は生成しない。
