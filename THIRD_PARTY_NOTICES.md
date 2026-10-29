# 第三者ソフトウェア

きゃすメイト本体のライセンスはAGPL-3.0-or-laterです。適用範囲・著作権表示・ソースコードの案内は [NOTICE.md](./NOTICE.md)、本文は [LICENSE](./LICENSE) を参照してください。以下の第三者ソフトウェアやモデルには各権利者の条件が適用され、本体の採用によって既存の許諾を置き換えません。

## pngjs（PNG素材の検証）

- バージョン: `5.0.0`（既存QRコード依存と共用）
- 公式ソース: https://github.com/pngjs/pngjs
- ライセンス: MIT
- Copyright (c) 2015 Luke Page & Original Contributors / Copyright (c) 2012 Kuba Niegowski
- ライセンス全文: 同梱する`node_modules/pngjs/LICENSE`

キャラクター素材の画像データ・チェックサムの検証に使用する。

## AndroidX / Jetpack

- 主な構成: Jetpack Compose、Media3、CameraX、DataStore、WebKit
- プロジェクト: https://github.com/androidx/androidx
- ライセンス: Apache License 2.0

Androidクライアントの画面、バックグラウンド音声、QRコード用カメラ、設定保存、WebView連携に使用する。

## RootEncoder（Android外配信）

- バージョン: `2.8.1`（`cca548ab7942ab50d34dede272d5da90d46c6b67`）
- 公式ソース: https://github.com/pedroSG94/RootEncoder/tree/2.8.1
- Copyright (C) pedroSG94
- ライセンス: Apache License 2.0
- ライセンス全文: `android/app/src/main/assets/licenses/RootEncoder-Apache-2.0.txt`

Androidのカメラ、ハードウェアH.264／H.265、AAC-LC、MPEG-TSに使用する。common・srt・encoder・libraryは固定コミットから取得したローカルソースを使用し、通信観測・ビットレートAPI結果・描画フレーム対応の変更を加えている。現行経路ではKotlinのSRT接続を起動せず、MPEG-TSをネイティブlibsrtへ渡す。固定元、ハッシュと変更箇所は `android/vendor/rootencoder/UPSTREAM.md` に記録する。他プロトコルのモジュールは同じ2.8.1のバイナリ依存を維持し、ローカルモジュールとの重複を除外する。Android assetsへライセンス全文を収録する。PCアプリへRootEncoderを組み込まない。

同梱依存にはKtor 3.5.2（https://github.com/ktorio/ktor 、Apache-2.0）とkotlinx.coroutines 1.11.0（https://github.com/Kotlin/kotlinx.coroutines 、Apache-2.0）、Bouncy Castle 1.84（https://github.com/bcgit/bc-java/tree/r1rv84 、MIT）を含む。Bouncy Castleの通知全文は `android/app/src/main/assets/licenses/Bouncy-Castle-MIT.html` に収録する。RootEncoder libraryの推移依存に他プロトコルのモジュールが含まれるが、きゃすメイトの外配信ではSRTだけを使用する。

## libsrt / Mbed TLS

- libsrt 1.5.7、MPL-2.0。対応ソース: https://github.com/Haivision/srt/tree/899348d8318eb9a3c5a5b6ec43c4a1114288773a
- Mbed TLS 3.6.7、Apache-2.0を選択。対応ソース: https://github.com/Mbed-TLS/mbedtls/releases/tag/mbedtls-3.6.7
- 取得アーカイブ・SHA-256: `native/outdoor/dependencies.json`。libsrtの `srtcore/channel.cpp` にIPv6専用ソケットの設定・検証を追加した（2026-10-04）。変更前後のSHA-256と置換内容は `native/outdoor/patches/verified-ipv6-only.json` に記録し、MPL通知を保持する。Mbed TLSの上流ソースは変更しない。対応ソースは上記固定元と同パッチで再現できる。ビルド構成と再現手順: `native/outdoor/README.md`、`native/outdoor/CMakeLists.txt`。
- Windows通知全文: `resources/outdoor-worker/licenses/srt-LICENSE`、`mbedtls-LICENSE`。Android通知全文: `android/app/src/main/assets/licenses/libsrt-MPL-2.0.txt`、`MbedTLS-LICENSE.txt`。

AndroidのSRT CallerとWindowsの端末別受信ワーカーに静的リンクする。Mbed TLSの同梱通知は上流の二重ライセンス全文を保持するが、本製品ではApache-2.0を選択する。利用者による追加ランタイムの導入は不要。



## OkHttp

- バージョン: `5.5.0`
- プロジェクト: https://github.com/square/okhttp
- ライセンス: Apache License 2.0

AndroidクライアントからPCへのHTTP、WebSocket、M4A取得に使用する。

## ZXing

- バージョン: `3.5.4`
- プロジェクト: https://github.com/zxing/zxing
- ライセンス: Apache License 2.0

Androidクライアント内でQRコードを解析する。画像と解析結果は外部サービスへ送信しない。

## FFmpeg

- バージョン: `n9.0.1-6-g9d4ca21220`
- 配布物: BtbN FFmpeg Builds `win64-lgpl-shared-9.0`
- 固定配布元: https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-22-12-58/ffmpeg-n9.0.1-6-g9d4ca21220-win64-lgpl-shared-9.0.zip
- ビルド構成と再現手順: https://github.com/BtbN/FFmpeg-Builds
- FFmpegソース: https://github.com/FFmpeg/FFmpeg/tree/9d4ca21220
- ライセンス全文: `resources/ffmpeg/LICENSE.txt`

きゃすメイトは上記のLGPL共有ライブラリ構成を変更せずに同梱し、音声変換にはFFmpegのネイティブAACエンコーダーだけを指定する。GPL、nonfree、`libfdk_aac` を含むビルドは同梱しない。利用者は同梱DLLを同じ版の互換ビルドへ置き換えられる。

## VOICEVOX

VOICEVOX本体およびVOICEVOX Engineは、きゃすメイトへ同梱しない。利用者が別途導入したVOICEVOXと各話者の利用規約・クレジットが適用される。

## sherpa-onnx

- バージョン: `1.13.5`
- プロジェクト: https://github.com/k2-fsa/sherpa-onnx
- ライセンス全文: `resources/speech-recognition-worker/licenses/Apache-2.0.txt`

Windows x64向け.NETパッケージと、そのネイティブ依存ライブラリを配信者音声認識ワーカーへ同梱する。

## ONNX Runtime

- バージョン: `1.27.1`
- プロジェクト: https://github.com/microsoft/onnxruntime
- ライセンス全文: `resources/speech-recognition-worker/licenses/ONNX-Runtime-MIT.txt`

## NAudio

- バージョン: `2.3.0`
- プロジェクト: https://github.com/naudio/NAudio
- ライセンス全文: `resources/speech-recognition-worker/licenses/NAudio-MIT.txt`

## NVIDIA Parakeet CTC Japanese

- モデル: `sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8`
- 作成者: NVIDIA NeMo team
- 固定取得元: https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8.tar.bz2
- 原モデル: https://huggingface.co/nvidia/parakeet-tdt_ctc-0.6b-ja
- 学習データ: ReazonSpeech v2.0
- ライセンス: Creative Commons Attribution 4.0 International（CC BY 4.0）
- ライセンス全文: `resources/speech-recognition-worker/licenses/CC-BY-4.0.txt`

固定取得元のモデルは、原モデルのCTC branchをsherpa-onnx向けONNXへ変換し、int8量子化した配布物である。きゃすメイトはこの変換済みモデルを変更せずに取得して使用する。NVIDIAによるきゃすメイトの後援または承認を示すものではない。

モデル本体はアプリへ同梱せず、利用者が配信者音声認識を初めて必要とした時に固定取得元からダウンロードする。

## Silero VAD

- 固定取得元: https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
- プロジェクト: https://github.com/snakers4/silero-vad
- ライセンス全文: `resources/speech-recognition-worker/licenses/Silero-VAD-MIT.txt`

## .NET Runtime

自己完結型ワーカーに同梱する.NET Runtimeのライセンスと第三者通知は、`resources/speech-recognition-worker/licenses/Dotnet-MIT.txt` および `resources/speech-recognition-worker/licenses/Dotnet-ThirdPartyNotices.txt` に収録する。

PC状態計測ワーカーにも.NET Runtimeを同梱し、対応する通知を `resources/pc-status-worker/licenses/Dotnet-MIT.txt` および `resources/pc-status-worker/licenses/Dotnet-ThirdPartyNotices.txt` に収録する。計測にはWindows標準APIを使い、追加のサードパーティー計測ライブラリは同梱しない。
