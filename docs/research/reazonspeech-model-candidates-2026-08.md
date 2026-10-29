# ReazonSpeech系STTモデル候補調査

調査日: 2026-08-30
対象: Windows x64 / CPU / .NET 10 / sherpa-onnx で、保存済みの「ぜろ、ぜろ、はち、ろく」WAVを再認識する候補。これは調査メモであり、正式仕様ではない。

## 結論

現在と同じ `reazonspeech-k2-v2` のfp32版を保存WAVでA/Bした結果、int8版とfp32版はいずれも生出力 `八十六`、トークン `八 | 十 | 六` となった。このため、今回の語頭ゼロ欠落はint8量子化だけでは説明できず、このチェックポイント系列の認識結果である。

ReazonSpeech公式の新しいCTCモデル **`japanese-zipformer-base-k2-rs35kh`** も保存WAVで評価したが、パディングなし、前後500ms、末尾500msの全条件で生出力は句点 `。` のみとなり、この音声の採用候補にはならなかった。

sherpa-onnx内で比較した **`sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8`** は、同じ保存WAVを生出力 `0086`、トークン `0 | 0 | 8 | 6` と正しく認識した。ReazonSpeech v2.0の35,000時間超で学習された別アーキテクチャで、今回試した候補のうち唯一、音声認識段階で先頭ゼロを保持した。

**先頭ゼロを保持できると公式資料から断定できるモデルはない。** Parakeetの公開CERは評価前に数字を単語へ変換して算出されているため、`0086` の保持性能を表さない。保存WAVの生認識結果と実機確認を根拠にParakeet CTCを正式採用した。

## 候補比較

| 優先度 | 候補 | 配布サイズの目安 | 現行.NETワーカーとの関係 | 保存WAVの試験 |
| --- | --- | ---: | --- | --- |
| 1 | ReazonSpeech k2 v2 fp32 | encoder 592 MB + decoder 11.8 MB + joiner 10.7 MB | 現行int8版と同じTransducer設定、同じtokens | **設定・構成を変えず試験可能** |
| 2 | ReazonSpeech Japanese Zipformer Base CTC (`japanese-zipformer-base-k2-rs35kh`) | fp32 safetensors 393 MB | Transformers custom code。sherpa-onnx ONNXではない | 試験結果は全条件で `。` のみ。今回の候補から除外 |
| 採用 | NVIDIA Parakeet TDT-CTC 0.6B Japanese int8 | model 625 MB + tokens 28 KB | 同じ `OfflineRecognizer` / CPUで、モデル設定だけTransducerからNeMo CTCへ変更 | **試験結果 `0086`**。実機確認後に正式採用 |
| 対象外 | ReazonSpeech NeMo v2 | 2.48 GB、619M parameters | 公式配布はNeMoのsubword RNN-Tで、sherpa-onnx向け変換済み配布ではない | 現行ワーカーへ直接投入不可 |
| 対象外 | ReazonSpeech ESPnet v2 | 118.85M parameters | ESPnet Conformer-Transducer。sherpa-onnx向け変換済み配布ではない | 現行ワーカーへ直接投入不可 |

## 1. ReazonSpeech k2 v2: int8とfp32のA/B

現在の `sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01` は、ReazonSpeech公式の `reazonspeech-k2-v2` をsherpa-onnx向けに配布したものである。公式モデルカードは、159.34M parametersの文字ベースRNN-T、Zipformer、約30秒までの日本語音声、Apache-2.0を明記している。[ReazonSpeech公式モデルカード](https://huggingface.co/reazon-research/reazonspeech-k2-v2)

同じ公式リポジトリにはint8とfp32の両方がある。fp32はencoder 592 MB、decoder 11.8 MB、joiner 10.7 MB、int8はencoder 155 MB、decoder 2.96 MB、joiner 2.7 MBで、tokensは共通である。[ReazonSpeech公式ファイル一覧](https://huggingface.co/reazon-research/reazonspeech-k2-v2/tree/main)

sherpa-onnx公式手順も同じアーカイブ内のfp32/int8双方を `encoder` / `decoder` / `joiner` / `tokens` で認識する例を掲載し、Windowsでは `sherpa-onnx-offline.exe` を使えるとしている。[sherpa-onnx公式ReazonSpeech手順](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/zipformer-transducer-models.html#sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01-japanese)

保存WAVをfp32で再認識する試験はアーキテクチャ変更なしで実施した。条件は現行設定と同じmodified beam search、max active paths 8、blank penalty 0.5、CPU 4 threadsである。

| モデル | 生出力 | トークン | 読込時間 | 認識時間 |
| --- | --- | --- | ---: | ---: |
| k2 v2 int8 | `八十六` | `八`・`十`・`六` | 5,471 ms | 112 ms |
| k2 v2 fp32 | `八十六` | `八`・`十`・`六` | 5,771 ms | 164 ms |

入力は保存済みの2.418秒WAVで、話者による聴取では「ぜろ、ぜろ、はち、ろく」が明瞭に含まれている。同じ生出力・トークンになったため、fp32への置換は先頭ゼロ欠落の解決策にならない。

## 2. Japanese Zipformer Base CTC (`japanese-zipformer-base-k2-rs35kh`)

Reazon Human Interaction Labは、ReazonSpeech v2.0でfine-tuneした新しいZipformer Base CTCを公式配布している。モデルカードは約98.2M parameters、fp32、Apache-2.0、JSUT-BASIC5000 CER 9.71%、Common Voice 11.00%、TEDxJP-10K 13.07%を掲載する。長時間音声はモデル単独では失敗扱いで、Silero VAD併用時のJSUT-BOOK CERは20.80%とされる。[ReazonSpeech公式モデルカード](https://huggingface.co/reazon-research/japanese-zipformer-base-k2-rs35kh)

配布物は393 MBの `model.safetensors` と、`modeling_zipformer.py`、`zipformer.py`、tokenizer等であり、公式利用例はTransformersの `AutoModelForCTC` に `trust_remote_code=True` を指定する。ONNXファイルやsherpa-onnx向けexportは配布されていない。[ReazonSpeech公式ファイル一覧](https://huggingface.co/reazon-research/japanese-zipformer-base-k2-rs35kh/tree/main)、[公式config](https://huggingface.co/reazon-research/japanese-zipformer-base-k2-rs35kh/blob/main/config.json)

保存WAVの一回限りの比較は、隔離したPython環境で公式Transformersコードを使えばアプリ実装を変更せず実施できる。公式例は16 kHzへ読み込み、前後へ0.5秒paddingしてgreedy CTC decodeする。今回の語頭欠落との関係では、このpadding条件も含めて試す価値がある。ただし、現在の.NETワーカーはsherpa-onnxの `OfflineRecognizer` にONNX/ORTモデルを渡す設計であり、safetensorsとPython custom codeはロードできない。正式採用には次のいずれかが必要で、いずれも小変更ではない。

保存済み2.418秒WAVをTransformers 4.57.1、PyTorch CPU、fp32で試験した。パディングなし、前後500ms、末尾500msの3条件はいずれも生出力が句点 `。` のみだった。認識時間は233～289msだった。この単一WAVの結果からモデル全体の品質は判断できないが、少なくとも今回の先頭ゼロ問題を解決する候補にはならない。

- Reazon公式またはsherpa-onnx公式による互換ONNX exportを待つ。
- 独自exportを作成し、sherpa-onnxの対応モデル形式と出力一致を検証する。
- Python/Transformersワーカーを別途導入する。

同モデルにはBPE版もあるが、公開平均CERは非BPE 11.26%、BPE 11.46%で、先頭ゼロ評価はない。まず非BPE版だけを数字列WAVへ試し、必要な場合のみBPE版を追加する。[ReazonSpeech公式BPEモデルカード](https://huggingface.co/reazon-research/japanese-zipformer-base-k2-rs35kh-bpe)

## 3. Parakeet TDT-CTC 0.6B Japanese

NVIDIA公式モデルはReazonSpeech v2.0の35,000時間超で学習された約0.6B parametersのHybrid FastConformer TDT-CTCで、ライセンスはCC BY 4.0である。公開CERはJSUT 6.4%、Common Voice 8.0 test 7.1%、TEDxJP-10k 9.0%などだが、CER計算では数字を `num2words` で単語へ変換している。このため、先頭ゼロやアラビア数字表記の品質は公開値から判断できない。[NVIDIA公式モデルカード](https://huggingface.co/nvidia/parakeet-tdt_ctc-0.6b-ja)

sherpa-onnx公式配布はCTC branchだけをint8 ONNXへ変換したもので、model 625 MB、tokens 28 KBである。公式Windows手順は、単一チャネル16-bit WAVを `sherpa-onnx-offline.exe` の `--nemo-ctc-model` で認識でき、サンプルでは13秒音声を1.375秒、RTF 0.106、2 threadsで処理している。ただし測定CPUが記載されていないため、この値を利用者PCの性能予測には使えない。[sherpa-onnx公式日本語Parakeet手順](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-ctc/nemo/japanese.html)

変換スクリプトは、NVIDIAモデルのCTC branchだけをONNXへ出力し、sherpa-onnx用メタデータを付けることを明記している。[sherpa-onnx公式変換スクリプト](https://github.com/k2-fsa/sherpa-onnx/blob/master/scripts/nemo/parakeet-tdt_ctc-0.6b-ja/export-onnx-ctc.py)

従来のワーカーは既に `OfflineRecognizer`、16 kHz PCM、Silero VAD、CPU providerを使用していたため、比較用の一回限りの認識では `ModelConfig.NeMoCtc.Model` とtokensを指定するだけで同じ保存WAVを投入できた。マイク取得、VAD、ワーカープロセス、TypeScriptとの契約を変えずに正式採用し、固定モデルの名称・必要ファイル・ハッシュ・容量・ライセンス・探索設定の扱いを仕様とADRへ反映した。

保存済み2.418秒WAVをsherpa-onnx 1.13.5、CPU 4 threads、greedy searchで試験した結果は次のとおりだった。

| 生出力 | トークン | 読込時間 | 認識時間 |
| --- | --- | ---: | ---: |
| `0086` | `0`・`0`・`8`・`6` | 3,641 ms | 345 ms |

旧k2 v2 int8の同じWAVに対する認識時間112msより遅く、モデルファイルも約655.5MBへ増える。一方、欠落したゼロを後処理で推測せず音響認識結果へ残せた。sherpa-onnx 1.13.5のNeMo CTC実装はgreedy searchだけをサポートし、旧既定のmodified beam searchを指定すると初期化エラーになる。このため正式採用では探索方式をgreedy searchへ固定し、探索方式、探索候補数、blank penaltyを設定から除去した。

評価に使用した固定ファイル情報は次のとおりである。

- アーカイブ: 489,389,564 bytes / SHA-256 `4b0a800ef29f4f4c8667339bf6f60d5bfdc2852ddc9dc5741aea65b6f8d1306b`
- `model.int8.onnx`: 655,542,604 bytes / SHA-256 `3addd00ef5bd1742078389e540b77394e4a508bdf2f4c9ad1b4a76d93e76598e`
- `tokens.txt`: 28,557 bytes / SHA-256 `732f64c53909f2620c713f4106b487d92e6f54a6915b3cd3d1dbd32f9f4f392a`

## 4. 公式ReazonSpeechの他アーキテクチャ

ReazonSpeech公式コレクションにはk2 v2、NeMo v2、ESPnet v2などがある。[ReazonSpeech公式ASRコレクション](https://huggingface.co/collections/reazon-research/reazonspeech-asr)

- `reazonspeech-nemo-v2` は619M parametersのsubword RNN-Tで、公式ファイルは2.48 GBの `.nemo` checkpointである。Apache-2.0だが、sherpa-onnx用ONNXではない。[公式NeMo v2モデルカード](https://huggingface.co/reazon-research/reazonspeech-nemo-v2)、[公式ファイル一覧](https://huggingface.co/reazon-research/reazonspeech-nemo-v2/tree/main)
- `reazonspeech-espnet-v2` は118.85M parametersのConformer-Transducerで、ESPnet/ReazonSpeech Python APIを前提とする。Apache-2.0だが、sherpa-onnx用変換済みモデルは公式コレクションにない。[公式ESPnet v2モデルカード](https://huggingface.co/reazon-research/reazonspeech-espnet-v2)

これらを評価するには別Pythonランタイムを追加するか、対応するONNX exportとsherpa-onnx互換性を新たに検証する必要がある。今回の「現在の.NETワーカーで保存WAVを比較する」目的には過大である。

## icefallレシピから分かる範囲

icefallのReazonSpeechレシピが現在掲載するモデル系統はZipformerで、「latest recipe」とされている。公開結果はnon-streaming largeのgreedy CER 4.2、modified beam CER 4.13などで、streaming評価は未完了と明記されている。[icefall公式ReazonSpeechレシピ](https://github.com/k2-fsa/icefall/tree/master/egs/reazonspeech/ASR)、[公式RESULTS](https://github.com/k2-fsa/icefall/blob/master/egs/reazonspeech/ASR/RESULTS.md)

公式RESULTSには学習・デコード条件はあるが、現在配布中の `reazonspeech-k2-v2` と別にダウンロード可能な複数epoch/平均checkpointは案内されていない。したがって「別epochを順に試す」は、公開済み成果物だけでは実施できない。

## 保存WAVでの評価手順

1. 現行int8の**正規化前**出力を基準として保存する（既知: `八十六`）。
2. 同じWAVをk2 v2 fp32へ入力し、生テキストと認識時間を記録する。
3. 同じWAVをJapanese Zipformer Base CTCへ、公式条件どおり16 kHz + 前後0.5秒paddingで入力する。
4. 同じWAVをParakeet int8 CTCへ入力し、生テキストと認識時間を記録する。
5. `ぜろぜろはちろく` だけでなく、`ぜろきゅうぜろ`、文中の電話番号、小数 `さんてんいちよん` を同じ話者・マイクで確認する。
6. 後処理は比較時に適用しない。生出力にゼロの音響情報が残るかを先に判定する。
7. leading zero保持、通常文のCER、認識時間、モデル読込時間、ピークRAM、配布容量を比較してから正式採用を決める。

## 推奨判断

- **k2 v2 fp32の試験は完了し、fp32でも欠落した。** fp32への置換は行わない。
- **公式Japanese Zipformer Base CTCの試験は完了し、今回の保存WAVでは句点だけだった。** この問題の候補から除外する。
- **Parakeet int8 CTCは `0086` を保持し、小数と通常の日本語発話も実機確認できたため正式採用した。** 固定モデルを置き換え、greedy searchへの固定、約655.5MBの保存容量、CC BY 4.0の表示を正式仕様へ反映した。
- 3候補ともゼロを落とす場合、同じ訓練コーパス由来のモデル差し替えだけでは解決しない可能性が高い。数字列専用の認識モード、候補再ランキング、または数字列の再発話UIを別仕様として検討する。
- NeMo v2/ESPnet v2は、上記3候補が不十分で、別ランタイムまたは独自exportを受け入れる判断をした場合だけ再検討する。
