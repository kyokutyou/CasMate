# マイク変更後に残るOBS映像遅延の修正（2026-10-02）

## 対象と原因

利用者から「OBSに映像・音声を送信」後に配信マイクを変更すると、OBS映像に約0.5秒の遅延が残るとの報告を受けた。Androidプレビューの一時停止ではなく、OBS側だけで切替後も続くことを確認した。

`SelectedMicrophone`のPCMフレームだけが`System.nanoTime()`を使用し、RootEncoderの映像・エンコーダー開始時刻は`TimeUtils.getCurrentTimeMicro()`（`SystemClock.elapsedRealtimeNanos()`）を使用していた。Androidでは前者は深いスリープ時間を含まず、後者は含むため、同じ時刻基準として減算できない。[Androidの時計仕様](https://developer.android.com/reference/android/os/SystemClock)。

`AudioEncoder.calculatePts()`はPCM時刻からエンコーダー開始時刻を引き、負値を0に丸める。端末の累積スリープ時間によってPCMのPTSが0になり続けると、AAC側のサンプル数による時刻進行にマイク切替の中断時間が入らず、再開後も送信音声の時刻が遅れる。AACの重複・逆行入力時刻の扱いは[AOSPのAAC実装](https://android.googlesource.com/platform/frameworks/av/+/master/media/codec2/components/aac/C2SoftAacEnc.cpp)でも確認した。

製品修正はPCMフレームにRootEncoderと同じ時計を使用することに限定した。入力経路確認のタイムアウトは同一時計同士の差分であり、対象外。正式な同期条件を[外配信仕様](../features/outdoor-streaming.md#android操作)へ補足した。

## 切り分けと回帰試験

最初に実AACエンコーダーへ20msの合成無音を送り、500ms中断して再開する、約2.7秒の失敗する端末テストを構成した。カメラ・マイク収録・ネットワーク送信・メディア保存は使用していない。

| 仮説 | 確認方法と結果 |
| --- | --- |
| 音声と映像の時計基準の不一致 | 合成PCMの時計だけを`nanoTime`から`TimeUtils`へ変更すると、500ms中断後の残留遅延試験が成功した |
| AAC自体が入力中断に追従できない | 同じAAC・同じ中断で時計だけを揃えると成功したため、今回の再現の主因から除外 |
| SRT・OBSの受信バッファによる遅延 | SRT・OBSを使用しない試験でも送信前のAAC時刻遅れを再現。OBS表示の最終確認とは区別する |

| 試験 | 修正前 | 修正後 |
| --- | --- | --- |
| 最小の合成PCM入力、500ms中断 | AAC出力時刻の遅れ93→637ms（約544ms増）、失敗 | 時計だけの置換で成功 |
| 製品の`SelectedMicrophone`を停止・新規作成、500ms中断 | 413→1236ms（約822ms増）、失敗 | 90→89ms、成功 |
| Robolectricで製品PCMとエンコーダーの時刻を照合 | 時計不一致で失敗 | 開始時刻と500ms間隔の3回の再選択で成功 |

数値は各段階末尾15個のAAC出力について、現在の共通時計からPTSを引いた値の中央値。OBSの総表示遅延ではない。製品経路の端末テストは開始前に入力喪失ミュートへ固定するため、実際のAudioRecordを開かず無音を生成する。Pixel 10a / Android 17の接続端末を使用し、修正版の開発ビルドを設定保持で更新した。配布用APKは生成していない。

永続テスト:

- `SelectedMicrophoneClockTest`: 実PCM生成経路の共通時計・繰り返し再選択・無音維持を検証。
- `OutdoorAudioClockDeviceTest`: 実AAC、製品の無音PCM経路、500msの入力交換を使用。新しいAAC出力の継続、切替後の時刻遅れ増分100ms未満、共通時計との差150ms以内を確認。

## 全体検証

Windows / JDK 21 / Android SDK 37で検証した。Androidは既存キャッシュを使い、`GRADLE_USER_HOME="$env:USERPROFILE/.gradle"`、`--offline --console=plain`を指定した。通常の制限環境ではGradleのキャッシュロックを取得できず、許可された実行権限へ変更した。全体テストとビルドは順番に実行した。

| コマンド・確認 | 結果 |
| --- | --- |
| `gradlew.bat testDebugUnitTest :app:lintDebug :app:compileDebugKotlin --offline --console=plain` | 成功。35スイート・142件、失敗・エラー・スキップ0件。lintはエラー0件・既存警告10件 |
| `:app:assembleDebug :app:assembleDebugAndroidTest` | 成功。端末検証用の開発ビルド |
| `am instrument -w -e class jp.casmate.app.outdoor.OutdoorAudioClockDeviceTest jp.casmate.app.test/androidx.test.runner.AndroidJUnitRunner` | 製品修正前に失敗、修正後に1件成功 |
| `pnpm lint` | 成功、261ソース |
| `pnpm typecheck` | 成功 |
| `pnpm test` | 成功。86ファイル・758件、通常の実行権限で97.51秒 |
| `pnpm build` | 成功。Vite・TypeScript・両Windows workerをビルド。配布物は生成していない |

初回のPC全体テストは制限環境でElectron描画の2件（`comment-speech-scroll`、`ai-listener-layout`）が失敗し、他の試験の完了結果が出なかったため中止した。成功扱いせず、通常の実行権限へ変更して全体を再実行した。テストの期待値・タイムアウト・並列数は変更していない。

通常権限の実行も途中出力が少なく、詳細レポーターへの切替を試みた時点で、元の全体実行が758件成功で完了していたことを確認した。不要になった詳細実行は直ちに中止し、その結果を検証成功に数えていない。

Android lintの既存警告10件は継続している。PCビルドの`pc-status-worker`ではNuGetのサービスインデックスへ到達できない`NU1900`が残り、ビルドは成功したが脆弱性データ取得の成功とは扱わない。

## 追加レビュー

担当者が編集終了後に2観点を分けて自己レビューした。独立レビューではない。

- 仕様との一致: PCM・映像・エンコーダーの時計と単位を照合し、送信開始の基準時刻を再選択でリセットしないことを確認。通常入力・入力喪失時の無音・8kHz SCOの48kHz変換後は同じフレーム生成箇所を通る。
- 故障時・影響範囲: 音量・手動ミュート・入力喪失・ルーティング・再接続の制御を変更していないことを確認。SRT／映像の再起動、ライブラリ全体の時計変更、診断情報の外部送信を追加していない。実マイク機器の切替とOBS表示は合成無音試験では検証していない。

利用者へ通常手順でのOBS表示確認を依頼した。回答未取得の間はOBS実表示での解消を確認済みとしない。
