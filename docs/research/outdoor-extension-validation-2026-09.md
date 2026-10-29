# 外配信拡張の一次情報・検証記録

対象は基準コミット `7316a0e` からの外配信拡張。正式仕様は [Android外配信](../features/outdoor-streaming.md) と [Android画面](../features/android-mobile-client.md) が所有する。本書は実装上の根拠と試験の記録であり、追加仕様ではない。

## 一次情報

RootEncoder 2.8.1の依存を維持し、公式ソースと実際のGradleキャッシュ内バイナリを照合した。

- [StreamBase](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/library/src/main/java/com/pedro/library/base/StreamBase.kt) の `prepareVideo` はfps・bps・キーフレーム間隔（秒）・回転を受け取る。縦向きではエンコーダー出力寸法を交換する。`prepareAudio` へ音声bpsを渡す。
- [Camera2Source](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/encoder/src/main/java/com/pedro/encoder/input/sources/video/Camera2Source.kt) の準備時検証はカメラとエンコーダーの全組み合わせ検証を代替しない。アプリでカメラの出力サイズ、最短フレーム時間、AE fps範囲、ハードウェアAVC能力とビットレート範囲、AAC能力を確認し、送信サイズを明示する。
- [Camera2ApiManager](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/encoder/src/main/java/com/pedro/encoder/input/video/Camera2ApiManager.kt) のカスタムリクエストは成功可否を返す。ズーム、露出、ライトをこの境界で適用し、失敗を画面へ返す。ライブラリの単純なタップ座標変換は使用しない。
- [CameraRender](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/encoder/src/main/java/com/pedro/encoder/input/gl/render/CameraRender.java) と [GlStreamInterface](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/library/src/main/java/com/pedro/library/view/GlStreamInterface.kt) のプレビュー拡縮・カメラ回転・SurfaceTextureの変換を逆算し、映像外のタップを除外する。
- [Android CaptureRequest](https://developer.android.com/reference/android/hardware/camera2/CaptureRequest#CONTROL_ZOOM_RATIO) ではズーム比使用時のAF領域はズーム後の座標系となる。API 29ではcropRegion、対応するAPI 30以降ではzoomRatioを使用する。AF開始を含むキャプチャを確認してトリガーをIDLEへ戻し、その後は連続AFへ復帰する。
- [SrtStreamClient](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/library/src/main/java/com/pedro/library/util/streamclient/SrtStreamClient.kt) の遅延はms。送信器の累積バイト数からbit/sを算出し、[SrtClient](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/srt/src/main/java/com/pedro/srt/srt/SrtClient.kt) のRTTはμsからmsへ変換する。再接続による計測リセットをまたいだ差分は取らない。
- 同版の `getPacketsLost()` はNAK受信イベント数ではなく、[Nak.getLostCount](https://github.com/pedroSG94/RootEncoder/blob/cca548ab7942ab50d34dede272d5da90d46c6b67/srt/src/main/java/com/pedro/srt/srt/packets/control/Nak.kt) が集計する要求パケット数を加算する。バイナリの呼出しも確認した。配信者の明示回答に従い正式用語を「再送要求パケット数」へ変更した。同じパケットへの再要求も数えるため、固有の損失数ではない。
- [FFmpeg SRTオプション](https://ffmpeg.org/ffmpeg-protocols.html#srt) の `latency` はμs。OBS入力例の200msは `latency=200000` とする。実効受信遅延は受信側の設定と相手の要求値の最大値であり、総映像遅延ではない。

## 自動検証の対象

- PCM16の正負ゲイン、0・100・200%、飽和、入力段階の飽和検知、警告保持、ミュートと入力喪失の独立性。
- 端末内の音量・品質保存、再生成後の復元、QRとの独立性、送信中・再接続中の品質変更禁止。
- 品質境界値とプリセット、QR版1の旧品質検証、版2の品質なし登録、更新対象の案内。
- 送信バイト差分、RTT単位、未取得・切断・再接続時の値破棄、要求パケット数。
- プレビュー余白、回転、鏡像、SurfaceTexture変換。共通ミュート操作、タブ往復と画面再生成、停止後の音量表示。
- PCのQR版2発行、資格情報とrevisionの保持、状態報告版1の維持、OBS遅延URL・一度限りの案内。

Android 10のRobolectricランタイム取得ではJava標準CAによる検証に失敗したため、検証コマンドに限りWindowsの信頼済みCAストアを指定した。証明書検証を無効化していない。

### 実行結果

- Windows: `pnpm lint`、`pnpm typecheck`、`pnpm build` 成功。`pnpm test --maxWorkers=2` は46ファイル・356テスト成功。
- Windows全体テストの最初の実行は、依存ファイルのreadlink/open失敗と5秒タイムアウトで失敗した。テスト内容や制限時間を変えず、並列数だけを2に抑えた再実行で全件成功した。
- Android: `:app:testDebugUnitTest :app:lintDebug :app:compileDebugKotlin --offline` 成功、37テスト・失敗0。追加した警告は修正し、既存のWebView・サービス公開・HTTP設定・推移依存のTrustManagerに関する警告だけが残る。
- 仕様軸と規約軸の別レビューで見つかった停止後の音量表示不整合を修正し、回帰テストを追加した。フォーカスの座標式も固定版のCameraRender・MainRender・ScreenRenderと別途照合した。

## 実機確認の範囲

既存のSRT直接送信、タブ分離、半透明設定、再接続中の取得継続は、今回の開始時点で配信者から実機確認済みとの申告があった。今回追加した音量・ミュートのOBS音声への反映、撮影対象に対するフォーカス、各カメラのズーム・露出・ライト、各品質と1080p・60fps、遅延設定の組み合わせについては、新しい実機確認を実施していない。単体テストやコンパイル成功を実機確認済みとは扱わない。

配布用APK、インストーラー、展開版EXEは生成しない。

## 2026-09-09: 設定画面・Bluetooth・映像の向きの修正

利用者のスクリーンショットと、内蔵マイクは動くがBluetooth入力が無音になる・横映像が潰れるという報告を受けて修正した。

- 設定上部を見出しと明示的な選択肢へ変更し、マイクは機器名・種別の一覧から選択する。音量・カメラ調整・品質の既存操作を維持し、QR登録を末尾の接続先へ移した。
- [AudioManagerの公式契約](https://developer.android.com/reference/android/media/AudioManager#setCommunicationDevice(android.media.AudioDeviceInfo)) に従い、API 31以降は選択入力と対応する通信出力を要求する。入力ポートと出力ポートのIDは同一と仮定しない。[公式移行ガイド](https://developer.android.com/develop/connectivity/bluetooth/ble-audio/audio-manager) に従い、要求受理と経路確立を区別して最大30秒待機する。失敗・キャンセル・終了時に要求と音声モードを解放し、SRT再接続では維持する。
- API 29–30は [startBluetoothScoの契約](https://developer.android.com/reference/android/media/AudioManager#startBluetoothSco()) に従い接続通知を待つ。モノラル8kHzで録音し、連続バッファ間の状態を保持した線形補間でAAC入力の48kHzへ変換する。未検証・喪失入力のサンプルは補間状態にも残さず無音にする。送信音声の形式は変更していない。
- RootEncoderの既定OrientationConfigは端末画面の向きでカメラ回転を上書きしていた。準備後に選択した縦横をプレビュー・送信の両方へ明示し、対応する回転を設定する。選択と端末画面の向きが異なるケースを回帰テストへ追加した。
- 修正前の回帰テストは回転の不一致・通常音声権限の欠落で2件失敗した。修正後はAndroid 45テスト成功、lint・Kotlinコンパイル成功。Bluetooth要求拒否、曖昧な機器の拒否、接続完了待機、キャンセル解放、旧SCOの変換、UI選択を確認した。既存lint警告のみ残る。
- Windowsのlint・型チェック・356テスト・通常ビルドを再実行して成功した。Androidリソース出力の一時的エラーは並列数2での再実行で解消した。
- 仕様軸レビューで指摘された確定入力IDと画面の選択値の不一致を修正した。標準・ライフサイクル軸に追加の確定欠陥はなかった。

修正後のBluetooth実音声、端末回転と前後カメラの組合せ、OBSの縦横比は実機未確認。自動試験の成功をこれらの実機確認に代えない。
