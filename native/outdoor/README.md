# 外配信のネイティブ送受信

AndroidのJNI CallerとWindowsの端末別Listenerは同じ `transport.cpp` と固定版libsrtを使う。AndroidはRootEncoderの撮影・エンコーダー・MPEG-TS packetizerだけを利用し、KotlinのSRT接続実装を起動しない。PCは受信したTSを再エンコードせずループバックUDPへ転送する。`ts-progress.cpp` は連続した完全なPESとPTSを数え、OBSの復号成功を推測しない。

## ビルドと依存

- Windows: Visual Studio C++ build tools（x64・Windows SDK・CMake）、Node.js、pnpm。`pnpm build:outdoor-worker` で生成し、通常の `pnpm build` にも含む。`CMAKE` 環境変数で実行ファイルを指定できる。
- Android: JDK 21、SDK 37、NDK 28.2.13676358、CMake 3.22.1、Node.js。`android/gradlew.bat -p android :app:assembleDebug` でJNIもビルドする。arm64-v8a・armeabi-v7a・x86_64・x86を含む。
- `dependencies.json` は公式取得元と固定版・SHA-256、および適用パッチのSHA-256を所有する。`pnpm native:prepare` はアーカイブとパッチ、適用前後のソースを検証して `tmp/outdoor-native-deps` へ展開する。初回はネットワークが必要。検証済みキャッシュは同じ検査後に再利用し、暗号化あり・ログなし・静的リンクでビルドする。
- 固定ハッシュを検証する `patches/*.json` は `.gitattributes` でLFを維持する。Windowsの `core.autocrlf=true` でcloneしてもバイト列を変更せず、チェックサムの照合を省略・緩和しない。
- libsrtはMPL-2.0、Mbed TLSは選択可能なApache-2.0で使用する。libsrtの `srtcore/channel.cpp` へ2026-10-04にIPv6専用ソケットの設定・検証を追加した。対応ソースは `dependencies.json` の固定URLと `patches/verified-ipv6-only.json` の適用で再現でき、元ファイルのMPL通知を保持する。Windowsのライセンス・依存一覧・パッチは生成先 `resources/outdoor-worker`、Androidは `app/src/main/assets/licenses` に収録する。

## 検証

`pnpm test:native` は暗号化実接続、誤鍵・未暗号化拒否、期限、取消、TS連続性を確認する。

`node native/outdoor/recognition-tap-test.mjs` はビルド済みワーカーと同梱FFmpegの合成音声を使い、認識分岐の媒体一致、SRTを再起動しない切替、認識先不在時のOBS転送継続、再接続境界の分岐解除と古い世代の拒否を確認する。

`pnpm test:native-media` はビルド済みワーカー、同梱FFmpeg、利用可能なプライベートLAN IPv4を必要とする。合成映像と正弦波だけでH.264/AAC・H.265/AACの復号、UDPプロキシによる帯域・損失・遅延・切断、複数受信の独立性、親パイプ終了を確認する。カメラ・マイク・実登録情報を読み取らず、録画しない。これは実機の総遅延やOBS表示の測定を代替しない。

これらの自動検証は、実際の端末・ルーター・OBSでの動作確認を代替しません。

ワーカーはコマンド引数を受け取らない。親が標準入力でLAN／Tailscale用の版1設定、または直接接続用の版2設定を1行渡し、パイプを所有する。直接接続では同じパイプで候補を更新し、正常な受信を維持する。標準出力は制限された版1 JSON状態だけ。資格情報や上流例外を出力しない。ユーザー向けの起動・終了・再試行・認証境界はPCの `OutdoorReceivers` と `SmartphoneController` が所有する。
