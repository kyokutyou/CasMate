# 全対象調査: OBS・表示・認識・AI担当（2026-10-24）

親調査の担当範囲は以下の10機能。AGENTS.md、SPEC.md、docs/development-workflow.md、CONTEXT.md、各機能の所有仕様を読み、仕様の条件・例外と実装・既存テストを照合した。これは全体の一部分の記録であり、実機未確認を含む。「問題を追加確認できなかった」は「バグなし」の断定ではない。

## 調査状況

| 機能 / 所有仕様 | 用語・ADR | 実装と確認した境界 | 主なテスト / 結果 |
| --- | --- | --- | --- |
| [OBS操作](../features/obs-control.md) | 音声認識セッション・認識結果・OBSへの送信とOBS配信の区別。ADR 0012 | `obs-control-controller.ts`、`obs-control-store.ts`、`obs-websocket-client.ts`、`AppState`の認識結果連携、`use-obs-control-settings.ts`。許可・確認・排他・再試行・送信後の結果不明・保存キュー。以下の不具合を確認 | `obs-control.test.ts`、`obs-websocket-client.test.ts`、`obs-control-settings.test.tsx`、`obs-control-panel.test.tsx`、専用再現2ファイル。既存試験は共有認識と認証停止・30秒の応答遅延境界に不足があった |
| [OBS映像確認](../features/obs-program-preview.md) | OBS配信と本番シーンの静止画、接続世代。ADR 0012 / 0020の用途別認証 | `obs-program-preview.ts`、`ObsControlController.captureProgramAndroid`、`smartphone-control-session.ts`、Android `ObsProgramPreview.kt`・`ObsProgramImage.kt`・`SmartphoneControlConnection.kt`。シーン全体・縮小・JPEG検証・同時1件・5/10秒・ACK断片・資格/購読世代・取消・明示更新 | `obs-program-preview.test.ts`、`obs-control.test.ts`、スマホ制御テスト、Android `ObsProgramPreviewControllerTest` / `ObsProgramImageTest` / `ObsProgramPreviewLayoutTest`。PC代表単体は今回成功。Android実行・実OBS/端末は未実施。新たな確定不具合なし |
| [OBSソース登録](../features/obs-source-registration.md) | 端末共通のOBS入力・OBS各ビュー。ADR 0023 / 0026 | `obs-source-registration-controller.ts`、`obs-source-test-controller.ts`、管理routes、`ObsSourceRegistrationDialog.tsx`、`use-obs-display-test.ts`。実効設定/UUIDによる再利用、入れ子・循環、編集中シーン・世代、書込前再確認、所有項目だけ復旧、共通占有、未完了保持、通常表示とテスト層の分離、公開射影 | `obs-source-registration.test.ts`、`obs-source-test.test.ts`、server・dialog・layout各テスト。PC代表単体は今回成功。HTTP/描画・実OBSの追加確認は親調査へ集約。新たな確定不具合なし |
| [OBSコメント表示](../features/comment-overlay.md) | 初回履歴・新着・共通コメント・同期1件表示 | `comment-overlay-controller.ts`、`CommentOverlayPage.tsx`、`OverlayViews.tsx`、期限関数、`AppState`/読み上げの呼出元。初回除外・ID重複、10/100件上限、モード変更、既存期限維持、同期開始/終了、切断中期限、構造化本文、テーマ分離 | `comment-overlay.test.ts`、`comment-overlay-theme.test.tsx`、`comment-overlay-panel.test.tsx`、`overlay-expiry.test.ts`、接続/読上げ統合。コントローラー代表は今回成功。実OBS透過・複数表示と今回の全幅描画は未実施。新たな確定不具合なし |
| [コメント文字演出](../features/text-effects.md) | コメント文字演出・ルール・OBS文字演出ビュー | `text-effects.ts`、`TextEffectsOverlayPage.tsx`、`TextEffectsPanel.tsx`、`AppState`。NFKC/書記素・URL除外・エモート間の非結合・保存順20個・50ルール・表示上限・期限監視・履歴非復元・テスト再生の他機能分離 | `text-effects.test.ts`、`text-effects-panel.test.tsx`、`overlay-connections.test.tsx`、関連保存/描画テスト。判定/契約代表は今回成功。本文と古いテスト条件の文書矛盾を別記。新たな確定製品不具合なし |
| [簡易キャラクター表示](../features/simple-character-display.md) | 閉口/口開き素材・口形状態・キャラクター表示面・常時微動 | `character-controller.ts`、`character-asset-store.ts`、`png-validation.ts`、`CharacterImage.tsx`、`character-motion.ts`、`SimpleCharacterSettingsPage.tsx`、素材/微動/窓の部分保存。PNG CRC/展開上限・寸法・原子的参照、古い音声ID拒否、位相・一時プレビュー・500ms保存・エラー復帰。閉口画像故障を確認 | `character-controller.test.ts`、`character-motion.test.ts`、`character-settings-updates.test.ts`、`character-asset-store.test.ts`、`simple-character-settings-page.test.tsx`、専用再現。3群成功。asset-storeは正常PNG3件Timeout、残り成功で完了扱いにしない。画面/OBS同期の実機未実施 |
| [配信者音声認識](../features/streamer-speech-recognition.md) | 配信者音声認識・共有セッション・プレビュー履歴。ADR 0006 / 0008（0007は置換済）/ 0025 | `speech-recognition-controller.ts`、JSON Linesクライアント、`smartphone-recognition-input.ts`、`AppState`、.NET `RecognitionRuntime` / `ModelManager`、PC編集画面。共有最大1セッション・入力世代・discard/flush・WAV一時設定・履歴上限・モデル準備・故障分離・設定競合。OBS連携との境界を確認 | `speech-recognition-app-state.test.ts`、`speech-recognition-worker-client.test.ts`、`smartphone-recognition*.test.ts`、worker .NET各試験。前2群は今回成功。OBS許可との統合不足を専用再現で確認。今回.NET試験・モデル取得・実マイク・受信スマホは未実施 |
| [OBS音声認識表示](../features/speech-recognition-overlay.md) | 認識結果・OBS音声認識ビュー・配信に使う/プレビューの区別 | `speech-recognition-overlay-controller.ts`、`SpeechRecognitionOverlayPage.tsx`、`local-view-projections.ts`、専用HTTP/WS。保存ONだけ受理、空結果/無効化で消去、期限変更次回適用、接続断で期限、外観独立、最小公開・通常snapshot/eventから認識情報除外 | `speech-recognition-overlay-controller.test.ts`、`speech-overlay-settings.test.ts`、`speech-recognition-app-state.test.ts`、`overlay-connections.test.tsx`、server・描画。前3群は今回成功。OBS実機と描画追加確認は未実施。新たな確定不具合なし |
| [OBSデザイン編集](../features/obs-style-editor.md) | OBSデザイン編集・OBS各ビュー | `ObsDesignPage.tsx`、`obs-style-editor/*`、`obs-design.ts`、`saved-obs-designs.ts`、`AppState`の部分保存・window/preload。独立HTMLとアプリの境界、対象別履歴20、500ms直列集約・不正入力・閉じる抑止、保存コピー/採番/冪等性、共有表示部品、CSSエスケープ/JSON検証、プリセット10種 | `obs-design*.test*`、`obs-style-editor-*.test*`、`saved-obs-designs.test.ts`、`obs-presets.test.ts`。既存試験と実コードを照合。今回この担当では描画/standaloneビルド・実ブラウザ/実OBSを未実施。新たな確定不具合なし |
| [AIリスナー](../features/ai-listener.md) | AIリスナー・共有記憶・発言ログ・投稿枠。ADR 0013 | `ai-controller.ts`、`ai-connections.ts`、`ai-context.ts`、`ai-reply.ts`、memory writer/buffer/store/budget、`obs-visual.ts`、管理/visual routesと公開射影。配信状態再検証・世代/発話取消・1.5秒猶予・投稿前永続枠・結果不明・サービス分離・自己投稿・記憶削除と集約保存・API用途別分離・画像寿命・禁止公開 | `ai-controller/context/store/posting-budget/memory-buffer/reply.test.ts`、`obs-visual.test.ts`は今回成功。`ai-connections.test.ts`はPKCE1件失敗、他成功、`ai-visual-generation.test.ts`はloopback EACCESで10件失敗、4件成功。HTTP/API境界の最終成功確認は親調査で通常権限実行が必要。外部実投稿/認証・Gemini・画像判読性は未実施。新たな確定製品不具合なし |

管理画面変更に関係する共通レイアウト・移動保持・通知位置固定・共通トーストと、ローカルアプリの管理認証・REST/WS・最小公開・保存・移行・終了の契約も関連節を確認した。

## 確認した修正対象と根拠

製品コードの修正は親担当が行う。この担当は独立した照合・再現と修正後レビューを担う。

1. **P1: 認識の配信利用とOBS音声操作の許可境界が逆転する。** `obs-control.md`「音声操作」は配信に使うONとプレビュー共有でも操作対象、プレビュー/AIだけでは操作不可。`AppState.onResult`が生の`previewActive`を渡し、`ObsControlController.handleSpeechResult`がその真偽だけで拒否していた。共有ONで操作を受けず、AI専用OFFで確認を作る2件を`audit-obs-voice-sharing.test.ts`で再現。
2. **P1: 同じ共有セッションで配信利用OFFにしても音声確認が残り、再ON後に旧発話を使う。** 設定切替でプレビューが残ると`ensureSession`が何もせず、音声確認取消・取得期間更新に到達しない。OBS連携/音声許可ON時だけの既存`restartCapturePeriod`は認識側ONの境界を扱わない。前述ファイルへ実AppStateの2件を追記し失敗確認。Android確認へ波及させず、保存成功後の音声側境界を処理する必要がある。
3. **P2: 認証失敗・非対応の接続を自動再試行する。** `obs-control.md`「接続・設定・保存」は明示再試行/修正待ち。`connect`のcatchが種類を問わず`scheduleReconnect`を呼ぶ。`audit-obs-contracts.test.ts`で3種のエラーを注入すると1秒で2回目の接続となる。実transportのcloseも認証失敗を一般切断へ変換しており、分類を含めて修正対象。
4. **P2: 配信操作の30秒期限が要求受付応答の後から始まる。** `obs-control.md`「共通の状態と操作」は送信から30秒以内に目標確認。`executeOperation`がStart/Stopの応答後にdeadlineを作る。4秒受付遅延＋31秒後の配信開始を成功扱いする再現が`audit-obs-contracts.test.ts`で失敗。残る読取待ちも送信時起点の絶対期限へ含める必要がある。
5. **P2: 閉口画像の読込失敗時に口開き画像が出続ける。** `simple-character-display.md`「素材」は閉口読込不能なら静止プレースホルダー。`CharacterImage`は閉口onErrorで片方のsourceだけ変更し、開口条件はそのままなので、口パクによりplaceholderと口開き画像が交互になる。`audit-character-fallback.test.tsx`で開口中の閉口error後に期待placeholder、実際open画像となる失敗を確認。

## 要確認の仕様記述

`text-effects.md`管理画面の2026-10-18採用項目は共通設定を「折り畳みなしで常時表示」としているが、同文書テスト条件21/22/27に「初回は閉じた」「開閉」が残る。実装の常時表示を製品不具合とせず、新しい明示採用条件を判断根拠にした。古い受入記述の整理が必要。仕様の意味をこの担当だけで変更しない。

## 実行した検証と制限

- 専用再現: `pnpm exec vitest run tests/audit-obs-voice-sharing.test.ts --maxWorkers=1`（当初2件失敗、親の許可境界修正後は2成功/追加2失敗）、`audit-obs-contracts.test.ts`（当初4件失敗）、`audit-character-fallback.test.tsx`（当初1件失敗）。これらは修正前の不具合裏付けであり、最終成功確認は親の修正後結果へ従う。
- 代表関連群: `pnpm exec vitest run tests/comment-overlay.test.ts tests/text-effects.test.ts tests/character-controller.test.ts tests/character-asset-store.test.ts tests/character-motion.test.ts tests/character-settings-updates.test.ts tests/speech-recognition-app-state.test.ts tests/speech-recognition-worker-client.test.ts tests/speech-recognition-overlay-controller.test.ts tests/speech-overlay-settings.test.ts tests/obs-program-preview.test.ts tests/obs-visual.test.ts tests/obs-source-registration.test.ts tests/obs-source-test.test.ts tests/ai-controller.test.ts tests/ai-context.test.ts tests/ai-connections.test.ts tests/ai-store.test.ts tests/ai-posting-budget.test.ts tests/ai-memory-buffer.test.ts tests/ai-reply.test.ts tests/ai-visual-generation.test.ts --maxWorkers=1`。
- 代表群結果: 22ファイル中19成功・3失敗、406件中392成功・14失敗、未処理拒否3件。AI HTTP統合のloopback EACCESとPKCE1件、正常PNG3件5秒Timeoutは成功扱いしない。後者の原因はこの担当では未確定。親担当がsandbox外の通常権限で再検証する。
- 標準のsandbox TEMPでは初回Vitestキャッシュrename EPERMにより0件実行。以後はworkspace `.tmp/audit-obs` をTEMP/TMPへ指定して実行した。コードの修正や検査除外による回避はしていない。
- この担当ではlint・型チェック・最終全体テスト・buildを実施しない（親担当に集約）。配布物は生成していない。
- 今回の実OBS、Windows実マイク/.NETモデル、Android実機/Gradle、Tailscale/直接接続、Gemini/各投稿サービスの実認証・実投稿は未実施。自動試験・コード照合をその代替として完了扱いしない。
