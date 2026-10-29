# 文書・参考資料の案内

必要な文書を探すための索引。正式仕様の入口は [SPEC.md](../SPEC.md)、文書の役割と読む範囲は [開発の運用手順](development-workflow.md#文書の役割) を参照する。

## 現行仕様と開発の入口

| 読む目的 | 入口 |
| --- | --- |
| 実装対象・機能別仕様 | [SPEC.md](../SPEC.md) |
| 正式用語 | [CONTEXT.md](../CONTEXT.md) |
| 開発ルール・検証手順 | [AGENTS.md](../AGENTS.md)、[開発の運用手順](development-workflow.md) |
| 起動・開発コマンド | [README.md](../README.md)、[Androidの開発手順](../android/README.md)、[ネイティブ送受信の開発手順](../native/outdoor/README.md) |
| 採用済みの設計判断 | [ADR一覧](adr/) |
| GitHub公開前の点検・未決定事項 | [GitHub公開準備](github-publication.md) |
| 今回の対象外・未採用案 | [OUT_OF_SCOPE.md](../OUT_OF_SCOPE.md)、[FUTURE_IDEAS.md](../FUTURE_IDEAS.md) |

## 参考資料と履歴

以下は設定手順、調査・比較、計画、検証の参照先。正式な挙動は各機能仕様、現在の実装・検証状況はSPEC.mdとそこから参照される記録で確認する。日付付きの記録はその時点の結果として読み、現在の検証済み範囲へ広げない。

ローカルの検証ログは `tmp/development-logs/` に退避している。2026-10-14の整理では、プロジェクト直下のログ250件を `2026-10-14/root/`、`tmp/` 直下のログ387件を `2026-10-14/tmp-root/` へ移動した。同日フォルダーの `manifest.json` に元の相対パス、退避先、サイズ、SHA-256を記録している。復元時は退避先のハッシュを照合し、元の場所に同名ファイルがないことを確認して戻す。退避物はGit管理外で、このPCだけに存在する。正式仕様、調査・計画資料、比較見本、検証記録は引き続き以下から参照できる。

### 利用・設定手順

- [OBSカスタムCSSのテンプレートと編集ガイド](guides/obs-custom-css.md)
- [OBS着せ替えツール（ビルド後の単独HTML）](../dist-tools/obs-style-editor.html)、[正式仕様](features/obs-style-editor.md)
- [OBSカスタムCSSの図解ガイド（PDF）](../output/pdf/obs-custom-css-visual-guide.pdf)、[HTML版](guides/obs-custom-css-visual.html)
- [AIリスナー初回設定手順（自分用）](guides/ai-listener-setup.md)
- [AI映像送信デバッグの利用と撤去](guides/ai-visual-debug-removal.md)

### 判断・計画の記録

- [開発運用の改善案](planning/agent-workflow-improvement-2026-09-17.md)
- [開発運用改善案のレビュー](planning/agent-workflow-improvement-review-2026-09-17.md)
- [AIリスナー決定記録](planning/ai-listener-open-decisions.md)
- [開発時の検証範囲を整理する実施計画](planning/development-validation-scope-2026-10-03.md)

### 調査・比較資料

- [jpnknの次スレッド自動作成の実現性調査](research/jpnkn-next-thread-2026-10-08.md)
- [jpnknのスレッドURLを既存の掲示板欄で使うための調査](research/jpnkn-comment-acquisition-2026-10-08.md)
- [AIリスナーの第三者による悪用を抑える提案](research/ai-listener-abuse-prevention-2026-09-19.md)
- [AIリスナーへのスクリーンショット添付案](research/ai-listener-screenshot-proposal-2026-09-18.md)
- [Android SRT実装の一次情報確認](research/android-srt-implementation-2026-09.md)
- [gemini-2.5-flash-lite が利用できない原因の調査](research/gemini-2-5-flash-lite-availability-2026-09.md)
- [無コメント時の話題生成を継続料金なしで行う方式の調査](research/idle-topic-generation-without-recurring-fees-2026-09.md)
- [インターネット越しスマホ音声再生の方式調査](research/internet-mobile-speech-options-2026-08.md)
- [日本語の真のストリーミング音声認識候補](research/japanese-streaming-stt-options-2026-08.md)
- [日本語音声認識（STT）候補調査](research/japanese-stt-options-2026-08.md)
- [モバイル配信の回線適応事例（2026-09-28調査）](research/mobile-adaptive-bitrate-examples.md)
- [HTTP公開中のスマホ画面消灯防止方式調査](research/mobile-screen-wake-lock-over-http-2026-08.md)
- [Android から Tailscale 経由で OBS に映像・音声を送る方式の比較（SRT / RTMP 以外）](research/mobile-to-obs-protocol-alternatives.md)
- [外配信の音声優先・現在画像静止の実現性と設計候補](research/outdoor-audio-first-emergency-design-2026-09-20.md)
- [外配信拡張の一次情報・検証記録](research/outdoor-extension-validation-2026-09.md)
- [Android外配信の検証記録](research/outdoor-streaming-validation-2026-09.md)
- [映像非表示と共通操作領域の実装検証](research/outdoor-video-visibility-validation-2026-09.md)
- [PNGキャラクターモーション方式調査](research/png-character-motion-options-2026-08.md)
- [ReazonSpeech系STTモデル候補調査](research/reazonspeech-model-candidates-2026-08.md)
- [屋外スマホ映像を SRT で OBS に取り込むための調査](research/srt-mobile-obs.md)
- [外配信のTailscale導入を不要にする無料案の調査](research/tailscale-free-alternatives-2026-10-02.md)
- [VDO.Ninja 調査: スマホ外配信を OBS に取り込む場合](research/vdo-ninja-mobile-obs.md)

### 検証記録

- [AIリスナーのOBS必須化・投稿上限の検証（2026-09-19）](validation/ai-listener-posting-guards-2026-09-19.md)
- [AIリスナー設定UIの再構築と検証](validation/ai-listener-ui-2026-09-16.md)
- [AIリスナー映像入力の実装検証（2026-09-18）](validation/ai-listener-visual-2026-09-18.md)
- [AIリスナー映像入力の仕様反映確認](validation/ai-listener-visual-spec-2026-09-18.md)
- [設定・接続・管理画面の責務整理と検証](validation/code-organization-2026-09-27.md)
- [コメント取得A案の実装・検証](validation/comment-acquisition-ui-2026-09-16.md)
- [コメントフィルターA案の実装・検証](validation/comment-filter-ui-2026-09-16.md)
- [コメント一覧 A案の本体実装検証](validation/comment-list-ui-2026-09-17.md)
- [OBSコメント表示 A案の実装検証](validation/comment-overlay-ui-2026-09-17.md)
- [コメント読み上げのホバー時スクロール修正](validation/comment-speech-hover-scroll-2026-09-18.md)
- [コメント読み上げD案の実装・検証](validation/comment-speech-ui-2026-09-16.md)
- [互換性整理の実装・検証記録（2026-10-04）](validation/compatibility-reset-2026-10-04.md)
- [開発運用改善の正式反映と確認](validation/development-workflow-2026-09-17.md)
- [ヘッダー中央の共通トーストの検証](validation/header-toast-2026-09-16.md)
- [管理画面改修の本体検証記録（2026-09-15）](validation/management-screen-2026-09-15.md)
- [スマホでコメントを聞く：C案実装の検証](validation/mobile-speech-ui-2026-09-17.md)
- [ネイティブSRT送受信の検証](validation/native-outdoor-transport-2026-10-03.md)
- [したらば次スレッド作成 A案の本体実装検証](validation/next-thread-ui-2026-09-17.md)
- [OBS操作設定 B案・スマホ接続と自動保存](validation/obs-control-settings-2026-09-17.md)
- [OBS用URL A案の本体反映](validation/obs-urls-ui-2026-09-18.md)
- [OBSソース登録の実機・画面検証（2026-10-05）](validation/obs-source-registration-2026-10-05.md)
- [OBS表示テストの実機・画面検証（2026-10-05）](validation/obs-source-display-test-2026-10-05.md)
- [外配信の再設計版・実機確認（2026-09-30）](validation/outdoor-adaptation-device-2026-09-30.md)
- [外配信の自動制御・診断表示の追加検証](validation/outdoor-adaptation-followup-2026-09-25.md)
- [外配信の自動制御再設計・実装検証（2026-09-30）](validation/outdoor-adaptation-implementation-2026-09-30.md)
- [外配信・提供録画の追加検証（2026-09-30）](validation/outdoor-adaptation-recordings-2026-09-30.md)
- [外配信の自動制御再設計・仕様レビュー記録](validation/outdoor-adaptation-spec-reset-2026-09-30.md)
- [外配信の音声優先・送信品質拡張の仕様更新確認](validation/outdoor-audio-first-spec-2026-09-22.md)
- [外配信・音声優先の試験実装検証](validation/outdoor-audio-first-trial-2026-09-24.md)
- [マイク変更後に残るOBS映像遅延の修正（2026-10-02）](validation/outdoor-microphone-clock-2026-10-02.md)
- [外配信MPEG-TS時計の修正検証（2026-10-04）](validation/outdoor-mpegts-clock-2026-10-04.md)
- [配布版のPC計測ワーカー起動パス修正](validation/pc-status-worker-path-2026-09-17.md)
- [スマホ連携 A案の反映・検証（2026-09-18）](validation/smartphone-a-ui-2026-09-18.md)
- [共通QRとAndroid接続の実機確認（2026-10-03）](validation/smartphone-common-qr-device-2026-10-03.md)
- [PC・スマホ直接接続の実装・検証記録（2026-10-04）](validation/smartphone-direct-connection-2026-10-04.md)
- [スマホ連携の用途選択とAndroid登録画面の統合](validation/smartphone-integration-2026-09-17.md)
- [ネットワーク別スマホ連携・複数端末の検証](validation/smartphone-network-multidevice-2026-10-03.md)
- [PC・Android通信統合の検証](validation/smartphone-transport-2026-10-03.md)
- [スマホ連携の接続準備一本化の実装・検証記録（2026-10-04）](validation/smartphone-unified-preparation-2026-10-04.md)
- [配信者音声認識 A案の本体実装検証](validation/streamer-speech-ui-2026-09-16.md)
- [コメント文字演出 A案 実装検証](validation/text-effects-ui-2026-09-17.md)
- [統一外配信登録の検証（2026-09-17）](validation/unified-outdoor-registration-2026-09-17.md)
- [VOICEVOX試聴のスマホ配信・検証記録](validation/voicevox-preview-mobile-2026-10-02.md)

測定データ:

- [outdoor-mpegts-clock-2026-10-04.measurements.json](validation/outdoor-mpegts-clock-2026-10-04.measurements.json)
- [smartphone-transport-2026-10-03.measurements.json](validation/smartphone-transport-2026-10-03.measurements.json)

### 画面比較見本

採用案と正式な画面仕様は機能別仕様から確認する。見本の変更・再利用時の検査は [開発の運用手順](development-workflow.md#失敗と再実行) を参照する。

- [コメント取得 UI・UX 比較見本](../prototypes/comment-acquisition-ui-throwaway/README.md)
- [コメントフィルター UI・UX 比較見本](../prototypes/comment-filter-ui-throwaway/README.md)
- [コメント一覧の設定 UI 比較見本](../prototypes/comment-list-ui-throwaway/README.md)
- [OBSコメント表示：設定UIの3案](../prototypes/comment-overlay-ui-throwaway/README.md)
- [コメント読み上げ UI 比較見本](../prototypes/comment-speech-ui-throwaway/README.md)
- [管理画面UI比較（破棄可能な試作）](../prototypes/management-ui-throwaway/README.md)
- [スマホでコメントを聞く：設定UIの比較見本](../prototypes/mobile-speech-ui-throwaway/README.md)
- [したらば次スレッド作成：設定UIの3案](../prototypes/next-thread-ui-throwaway/README.md)
- [OBS操作の設定UI：3案比較](../prototypes/obs-control-ui-throwaway/README.md)
- [OBS用URL：2案のUI比較見本](../prototypes/obs-urls-ui-throwaway/README.md)
- [配信者音声認識 UI 比較見本](../prototypes/streamer-speech-ui-throwaway/README.md)
- [コメント文字演出 UI・UX 比較見本](../prototypes/text-effects-ui-throwaway/README.md)

### 通信詳細画面の比較画像

- [4案の比較画像](research/assets/communication-details/communication-details-4-options.png)
- [画面見本（PNG）](research/assets/communication-details/communication-details-mockup.png)
- [画面見本（SVG）](research/assets/communication-details/communication-details-mockup.svg)
