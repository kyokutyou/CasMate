# 日本語の真のストリーミング音声認識候補

調査日: 2026-08-27  
対象: Windows/Electron でローカル実行し、発話中にも途中結果を更新する日本語 STT。これは調査メモであり、正式仕様ではない。

## 結論

現時点で、**ローカル・日本語・真のストリーミング**を同時に満たして評価すべき第一候補は **Vosk** である。`vosk-model-small-ja-0.22` をまず試し、精度が不足する場合に 1 GB の `vosk-model-ja-0.22` を同じ音源で評価する。Whisper small は発話後の最終品質比較用として残す。

## 「真のストリーミング」の定義

- **真のストリーミング**: 音声フレームを追加し続け、発話中に変化し得る partial / interim 結果を返す。
- **疑似ストリーミング**: VAD が発話終了を検出してから、発話区間をオフラインモデルに渡して確定文を返す。途中結果はない。

## ローカル候補

| 候補 | 真のストリーミング | 日本語 | Windows/Electron | 判断 |
| --- | --- | --- | --- | --- |
| **Vosk** | 可。入力チャンクごとに partial result、無音で final result | 可 | Node.js バインディングと Win x64 DLL が公式ソースにある | **第一評価候補**。小型モデルから実測する |
| **Julius** | 可。マイク/ネットワーク入力、連続デコード、短い無音で区切る | 可（日本語 dictation kit） | Windows向けキットあり。ただしElectronは子プロセス/サーバー連携を自前で包む | コマンド文法が限定できる場合の候補。自由発話の品質は必ず実測 |
| **sherpa-onnx + ReazonSpeech** | **不可**（VADによる疑似ストリーミングのみ） | 可 | Node API はある | 発話後の高速確定用としては評価可。発話中の日本語 partial 表示の候補ではない |

### Vosk

- 公式は Vosk をオフラインで動く streaming API とし、Node.js バインディングを提供する。[公式 README](https://github.com/alphacep/vosk-api/blob/master/README.md)
- Node の公式サンプルは、`acceptWaveform()` が未確定なら `partialResult()`、無音による区切りなら `result()` を返す。partial result は後続音声で変化し得る。[公式 Node サンプル](https://github.com/alphacep/vosk-api/blob/master/nodejs/demo/test_simple.js)、[Node API 実装](https://github.com/alphacep/vosk-api/blob/master/nodejs/index.js)
- 日本語モデルは小型 `small-ja-0.22`（48 MB）と大型 `ja-0.22`（1 GB）が公式掲載され、いずれも Apache-2.0 とされる。[公式モデル一覧](https://alphacephei.com/vosk/models)
- Electron 配布では Node FFI とネイティブ DLL のABI・パッケージングを実機検証する。

### Julius

- 公式 README はリアルタイムデコード、マイク/ネットワーク入力、逐次デコード、制御APIを掲げる。日本語向けには60k語の言語モデルを含む dictation kit がある。[Julius README](https://github.com/julius-speech/julius)、[日本語 dictation kit](https://github.com/julius-speech/dictation-kit)
- ただし最新リリースは 2020 年で、キットは約2 GB。現代的なElectron統合の手間と自由発話精度を受容できる場合に限り検証する。

### sherpa-onnx と ReazonSpeech

- `OnlineRecognizer` API 自体は増分入力と partial result をサポートする。[公式 JavaScript API](https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/api_streaming_asr.html)
- しかし公式の online transducer モデル一覧に日本語はない。[公式 online model 一覧](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/index.html)
- 日本語 ReazonSpeech は offline transducer として掲載され、公式例も `simulated-streaming-asr` と明記する。[公式 ReazonSpeech 手順](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/zipformer-transducer-models.html)
- Moonshine を含む sherpa-onnx の **offline** モデルも、VAD区間ごとに使う限り同じく疑似ストリーミングであり、`OnlineRecognizer` の日本語モデルではない。

## 外部送信を許容する場合のみの候補

- **OpenAI Realtime transcription**: incremental delta と completed event を返す真のストリーミング。ただし音声を外部サービスへ送る。[公式ガイド](https://developers.openai.com/api/docs/guides/realtime-transcription)
- **Google Cloud Speech-to-Text**: streaming recognition を提供し、日本語（`ja-JP`）を対応言語として掲載。ただし音声をGoogle Cloudへ送る。[公式ストリーミングガイド](https://cloud.google.com/speech-to-text/docs/streaming-recognize)、[対応言語](https://cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages)
- **Azure Speech**: intermediate result を伴う real-time transcription を提供。ただし音声をAzureへ送る。[公式概要](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-to-text)

## ラボで次に行うこと

1. Vosk small-ja で、200〜500 ms ごとに partial result をUI表示する。
2. Whisper small と同じ発話・環境で CER、初回partialまでの時間、確定までの時間、CPU/RAMを記録する。
3. 精度が足りなければ Vosk large-ja を同条件で再測定する。
4. 配布前にモデル重み・DLL・Node依存の各ライセンスと再配布条件を個別に確認する。
