---
status: accepted
supersedes: 0007-download-fixed-speech-recognition-model-on-first-use
---

# ReazonSpeech学習済みParakeet CTCを固定音声認識モデルにする

配信者音声認識は、ReazonSpeech v2.0で学習された `sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8` とSilero VADを固定採用する。sherpa-onnxのNeMo CTC実装をCPU 4スレッド、greedy searchで使用し、探索方式を利用者設定にしない。

旧 `sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01` は、明瞭な「ぜろ、ぜろ、はち、ろく」の保存WAVをint8・fp32のどちらでも `八十六` と認識し、音響認識結果から先頭ゼロが欠落した。Parakeet CTCは同じWAVを `0086` と認識したため、欠落した桁を後処理で推測せず保持できる。

モデルはParakeet CTC専用のバージョン付きディレクトリへ取得する。モデル管理処理はそのディレクトリだけを置換対象とし、利用者別モデル保存領域に存在する管理対象外ファイルを削除しない。

## Considered Options

- 旧ReazonSpeech Zipformer int8を維持し、文脈から先頭ゼロを推測する方式
- 同じReazonSpeech Zipformerのfp32へ置き換える方式
- ReazonSpeech学習済みParakeet CTC int8へ置き換える方式
- 複数モデルを利用者が選択する方式

## Consequences

- 新モデルはsherpa-onnx公式配布元から初回利用時に取得し、アプリ本体へ同梱しない。
- モデルファイルは約655.5 MB、取得アーカイブは約489.4 MBであり、旧モデルより保存容量、ダウンロード量、認識時間が増える。
- sherpa-onnx 1.13.5のNeMo CTCはgreedy searchだけをサポートするため、探索方式、探索候補数、Blank penaltyを設定として提供しない。旧モデル用の保存値は設定スキーマv10への移行時に除去する。
- モデル選択は提供せず、配信者間で認識条件を固定する。
- 原モデルのCC BY 4.0に従い、モデル名、作成者、原モデル、変換済み配布元、ライセンス、変更内容を第三者ライセンス表示へ記録する。
- マイク取得、Silero VAD、独立.NETワーカー、JSON Lines契約、認識後の数値表現正規化は維持する。

詳細な利用者向け挙動と取得・復旧動作は [配信者音声認識仕様](../features/streamer-speech-recognition.md) を参照する。
