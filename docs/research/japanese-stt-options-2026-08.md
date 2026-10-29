# 日本語音声認識（STT）候補調査

調査日: 2026-08-26  
対象: きゃすメイト（Windows 11 / Electron）。音声と認識結果を外部へ送らないローカル処理を優先する。

## 結論

第一候補は **sherpa-onnx の Node.js バインディング + 日本語ストリーミング対応モデル** とする。ただし、採用するモデル（候補: `zipformer-ja-reazonspeech`）の配布・再配布ライセンスを、モデルの配布元で確認してから決定する。

理由は、Windows x64/arm64 と JavaScript を公式にサポートし、Electron に直接つなげやすい Node.js API があり、逐次音声入力・partial result を正式に扱えるためである。日本語は専用 Zipformer モデルと、多言語 SenseVoice モデルが公式に案内されている。

認識品質を最優先し、チャンクごとの再認識でも許容できる場合は **whisper.cpp + multilingual `small`** を有力な比較対象とする。軽さ・最小ダウンロード・明確なモデルライセンスを最優先する場合は **Vosk `small-ja-0.22`** を選ぶ。

ここでの順位は公式資料に基づく統合容易性・機能・容量の比較であり、日本語の認識精度順位を示すものではない。配信の口語、固有名詞、BGM・ゲーム音を含む実録音で A/B 評価して最終決定する。

## 前提と比較観点

- ローカル実行であり、コメント本文・音声・認識結果を外部サービスに送信しない。
- マイク入力中に途中結果を返せること。
- Windows 11 版 Electron に同梱・配布できること。
- 実装本体だけでなく、**モデル重みのライセンスも個別に確認**すること。

## 比較

| 候補 | 日本語 | リアルタイム適性 | Windows / Electron | 代表的な容量・ライセンス | 評価 |
| --- | --- | --- | --- | --- | --- |
| sherpa-onnx | 日本語専用 Zipformer ReazonSpeech と、日本語を含む SenseVoice を公式掲載 | ストリーミング / 非ストリーミング双方をローカル対応。Node の `OnlineRecognizer` は partial result を返す | x64・arm64 Windows と JavaScript を公式対応。`sherpa-onnx-node` は Windows で DLL を自動検出 | ランタイム: Apache-2.0。SenseVoice int8 229 MB / FP32 895 MB。モデルは個別確認 | 第一候補。直接的な Node 連携と逐次認識が強み |
| whisper.cpp | multilingual モデル（`.en` なし）で日本語利用可 | 公式 `whisper-stream` は 0.5 秒ごとに連続文字起こしする「naive example」 | Windows（MSVC / MinGW）、C API、CPU/GPU/Vulkan を公式対応。Electron は native module または子プロセスの設計が必要 | ランタイム: MIT。tiny 75 MiB / base 142 MiB / small 466 MiB / medium 1.5 GiB / large 2.9 GiB | 品質検証の主比較対象。small から実測する |
| Vosk | 日本語 small / large モデルを公式配布 | ストリーミング API、連続・大語彙認識を公式に案内 | Node.js binding あり。Windows の公式配布対象は x86/x64（Python は arm64 非対応） | API: Apache-2.0。`small-ja-0.22` 48 MB、`ja-0.22` 1 GB、両モデル Apache-2.0 | 低負荷・容量最優先の選択肢。精度は実録音で確認 |

### sherpa-onnx

- リポジトリはローカルでの STT を含む機能を掲げ、ストリーミング・非ストリーミングの双方に対応する。Windows x64 / arm64 と JavaScript が対応表に含まれる。 [公式 README](https://github.com/k2-fsa/sherpa-onnx)
- [JavaScript のストリーミング ASR API](https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/api_streaming_asr.html) は、音声を増分投入して partial result を取得する `OnlineRecognizer` を案内している。
- [Node.js のインストール説明](https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html) は Windows では追加設定不要で、DLL が `node_modules` 内にあり自動検出されるとしている。マイク入力例には `node-cpal` が必要である。
- [公式モデル一覧](https://github.com/k2-fsa/sherpa-onnx) は日本語専用 `sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01` と、日本語を含む SenseVoice を掲載している。SenseVoice の [公式変換ページ](https://k2-fsa.github.io/sherpa/onnx/sense-voice/export.html) は int8 229 MB、FP32 895 MB を示す。SenseVoice は非ストリーミングのため、マイク利用時は VAD 区間単位の処理になる。
- ランタイムは [Apache License 2.0](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE)。一方で公式文書はモデルごとのライセンス確認を求めているため、モデル重みの再配布可否をランタイムのライセンスから推測しない。

### whisper.cpp

- [公式 README](https://github.com/ggml-org/whisper.cpp) は依存なしの C/C++ 実装、CPU-only、GPU、Vulkan、C API、Windows（MSVC / MinGW）を案内している。ローカルで動かせる。
- [モデル説明](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md) により、`.en` を名前に含むもの以外は多言語モデルであり、日本語には `base`、`small`、`medium` 等を選ぶ。公式掲載容量は tiny 75 MiB、base 142 MiB、small 466 MiB、medium 1.5 GiB、large 2.9 GiB。量子化も対応する。
- [ストリーミング例](https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/README.md) は 0.5 秒ごとにマイクをサンプリングし連続で認識する。ただし公式自身が「naive example」としているため、厳密な逐次モデル API ではなく、遅延・確定タイミングを実測で評価する。
- ランタイムは [MIT License](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/LICENSE)。Whisper のモデル重みの利用・再配布条件は別途、採用時点の OpenAI の公式条件を確認する。

### Vosk

- [Vosk 公式リポジトリ](https://github.com/alphacep/vosk-api) はオフライン音声認識、Japanese、ストリーミング API、JavaScript / Node.js binding を案内している。小型モデルと低遅延を重視した選択肢である。
- [公式モデル一覧](https://alphacephei.com/vosk/models) の日本語モデルは `vosk-model-small-ja-0.22`（48 MB、Apache-2.0）と `vosk-model-ja-0.22`（1 GB、Apache-2.0）。同ページが CSJ / TED10K の CER も掲載する。
- [公式インストール説明](https://alphacephei.com/vosk/install) は Node.js binding と Windows x86/x64 の対応を案内する。Windows ARM64 を配布対象にする場合は別途検証が必要である。
- API 本体は [Apache License 2.0](https://raw.githubusercontent.com/alphacep/vosk-api/master/COPYING)。上記日本語モデルも公式一覧で Apache-2.0 とされる。

## クラウド API は代替案にとどめる

OpenAI、Google Cloud Speech-to-Text、Azure Speech はいずれも日本語・リアルタイム用途を提供する。ただし音声を各社のサービスへ送るため、本件のローカル優先・外部送信しない前提を満たさない。ユーザーが明示的にクラウド認識を選択した場合だけ、同意、送信範囲、障害時のローカル動作、料金を別途仕様化して検討する。

- OpenAI はマイクなど到着中の音声には [Realtime transcription](https://developers.openai.com/api/docs/guides/speech-to-text) を使うよう案内している。
- Google Cloud Speech-to-Text V2 は [ja-JP](https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages) を `short`、`long`、`chirp_3` などで掲載している。
- Azure Speech は [ja-JP](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=stt) を Speech-to-Text の対応ロケールとして掲載している。

## 採用前の小規模評価

1. 配信マイク、雑談、ゲーム音・BGMあり、固有名詞を含む日本語サンプルを用意する。録音データは評価端末から出さない。
2. sherpa-onnx（日本語 online Zipformer）と whisper.cpp（multilingual small）を同一音源・同一端末で比較する。必要なら Vosk small-ja を軽量基準として加える。
3. 文字誤り、途中結果の安定性、発話終了から確定までの時間、CPU / RAM、初回モデル読み込み、配布サイズを記録する。
4. 採用モデルの重み・依存 DLL のライセンスと再配布条件を確認し、第三者表示へ反映する。
5. 結果をもとに初めて機能仕様書を作成・更新する。この調査ノート自体は正式仕様ではない。
