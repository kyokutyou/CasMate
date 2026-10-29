# AI映像送信デバッグの利用と撤去

通常の映像入力と撮影確認は [正式仕様](../features/ai-listener.md#映像入力)、検証専用機能は [画像送信デバッグ](../features/ai-listener.md#撤去可能な画像送信デバッグ) が所有する。

## 有効化と即時無効化

ソースから起動する開発環境だけで、起動するPowerShellに `$env:CASMATE_AI_VISUAL_DEBUG = '1'` を設定し、ビルド後に `pnpm start` で起動する。「映像」タブを開くと開発用のデバッグ欄が現れる。通常配布版では環境変数があっても有効にならない。

AIを停止して進行中処理の終了を待ち、保存済み人格を選んで「テスト生成」を押す。会話と有効な画像がGeminiへ送られる。外部サービスへのコメント投稿は行わない。表示される画像は実送信要求と同じデータであり、応答成功と送信中を区別する。既存の保存式プロンプトログとは独立している。

無効化は `Remove-Item Env:CASMATE_AI_VISUAL_DEBUG -ErrorAction SilentlyContinue` を実行し、アプリを起動し直す。これは現在のPowerShellの環境変数だけを消す。デバッグ専用APIと画像観測も登録されなくなる。

管理画面を閉じたときは観測を解除する。終了通知が通信断で届かない場合も、最後の状態取得から20秒で観測・保持画像を破棄する。複数管理画面間で共有される一時デバッグ状態であり、履歴を保存する機能ではない。

## 完全撤去する箇所

| 対象 | 作業 |
| --- | --- |
| `src/main/ai/visual-debug.ts` | 専用の調停・観測・保持モジュールを削除 |
| `src/renderer/components/AiVisualDebug.tsx` | 専用UIを削除 |
| `src/main/electron.ts` | `VisualDebug` import、単一フラグと生成、終了時close、`aiVisual.debug`受渡しを削除 |
| `src/main/server/ai-visual-server.ts` | 専用型import、debugオプション、`visual-debug`経路の登録ブロックとdebugEnabled応答を削除 |
| `src/main/server/local-server.ts` | `aiVisual`オプション型からdebug参照を削除 |
| `src/renderer/components/AiVisualPanel.tsx` | 専用import・debug有効状態とエラー集約・専用UIマウントを削除 |
| `src/renderer/components/ai-visual-panel.css` | `.ai-visual-debug`と`.ai-visual-result`を削除。通常画像・状態領域は残す |
| `tests/ai-visual-generation.test.ts` | 専用fixtureとデバッグのテストだけを除去・整理。通常生成、ログ除外、管理API境界のテストは残す |

通常の画像取得・生成、撮影確認、画像設定・移行、共有の生成観測窓口と停止時コンテキスト取得は専用モジュールに依存しない。観測窓口は購読者がなければ画像を保持しない。削除後の型チェックで専用モジュールへの参照漏れを確認する。既存の `debugPromptLog` は別機能であり削除しない。

## 撤去時の確認

1. `rg 'VisualDebug|visual-debug|CASMATE_AI_VISUAL_DEBUG|debugEnabled' src tests` で専用参照を確認し、上表の登録と専用UIを除去する。
2. デバッグなしで通常画像添付とローカル撮影確認が動くこと、デバッグAPIが404になること、画像なし設定も従来どおり使えることを確認する。
3. lint・型チェック・全体テスト・buildと映像タブの画面確認を行う。画像添付の設定や共有記憶の移行・削除は不要。

現時点は撤去可能な構成を用意した段階であり、OBS・Geminiの実機確認前にデバッグ専用部分を削除しない。
