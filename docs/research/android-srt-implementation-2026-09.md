# Android SRT実装の一次情報確認

2026-09-08確認。正式な製品挙動は [外配信仕様](../features/outdoor-streaming.md) が所有する。本書は採用ライブラリの確認記録である。

RootEncoder **2.8.1**（commit `cca548ab7942ab50d34dede272d5da90d46c6b67`）を固定した。[公式版](https://github.com/pedroSG94/RootEncoder/tree/2.8.1) はAndroid向けJava/Kotlin実装で、H.264/AAC、SRT暗号化と再送を提供する。[ライセンス](https://github.com/pedroSG94/RootEncoder/blob/2.8.1/LICENSE.txt) はApache-2.0であり、著作権表示とライセンスを収録して利用する。追加の有料SDKや配信クラウドは必要ない。推移依存の通知は [第三者通知](../../THIRD_PARTY_NOTICES.md) に記録する。

固定版の `SrtStream`、`SrtStreamClient`、`SrtClient`、`StreamBase`、`Camera2Source`、`AudioSource` を実装前および統合時に確認した。

- `SrtStream` はH.264/AACをMPEG-TSに多重化してSRTへ送る。`setPassphrase(..., AES256)` と `setLatency(1000)` を指定する。接続URLには秘密情報を入れない。
- 固定版は空のstream IDを拒否するため、Android内部の送信先を `srt://IPv4:port/casmate` とする。OBSで毎回のID変更は不要。
- 切断APIは非同期である。同じSRT送信器を即座に再利用せず、試行ごとに送信器を作成し、旧コールバックを世代番号で無効にする。
- `Camera2Source` のopen通知はキャプチャセッション完成を保証しない。切替の成功はフレーム取得後に扱い、失敗時の元カメラ復帰を維持する。
- ライブラリのマイク選択APIだけでは実経路を確認できないため、アプリ所有のAudioRecord入力から `routedDevice` と `isClientSilenced` を確認してPCMを渡す。経路未確認または喪失後に別入力のPCMを送らない。

[Android前面サービス種別](https://developer.android.com/develop/background-work/services/fgs/service-types) はcamera/microphoneの権限とサービス種別を要求し、while-in-use権限のためバックグラウンドからの開始を制約する。前面Activityの明示操作で開始してサービスが取得を所有する構成を採る。再起動やプロセス再生成からカメラを自動再開しない。これはOS・メーカーによる強制停止を防ぐ保証ではなく、長時間継続は実機受け入れ試験が必要。

[OBS公式ガイド](https://obsproject.com/kb/srt-protocol-streaming-guide) はメディアソースのローカルファイル解除、Listener、入力形式mpegtsを案内する。[FFmpeg SRTオプション](https://ffmpeg.org/ffmpeg-protocols.html#srt) に従い、OBS入力の遅延はマイクロ秒、鍵長はバイトで指定する。RootEncoder APIのミリ秒・暗号種別と混同しない。

検証環境ではJavaの既定CAストアから依存配布元の証明書を検証できなかったため、Gradle実行時だけ `-Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NONE` を指定した。証明書検証は無効化していない。環境固有の指定を製品設定へ追加しない。

OBS実機、Pixel 10aと非Pixel端末による30分送信、暗号不一致、回線切替、Bluetooth/着信、ロック中継続は、自動単体テストとコンパイルでは代替できない。実施結果は未確認として扱う。
