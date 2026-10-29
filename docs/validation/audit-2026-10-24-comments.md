# 2026-10-24 コメント関連6機能の調査

本記録は全製品調査の担当範囲を示す。正式仕様の代替ではない。製品コードの修正と最終検証は全体担当が所有し、最終結果は [全体記録](audit-2026-10-24.md) を参照する。

## 調査方法と範囲

AGENTS.md、SPEC.md、CONTEXT.md、運用手順の読み取り判断表・検証手順・レビュー判断、以下6件の所有仕様を原文で確認した。関連する管理画面共通レイアウト・通知・保存・終了・WebSocket・公開境界、スマホ通信の読取専用プロトコル版2も確認した。正常系だけでなく、上限・停止世代・失敗・設定保存・履歴再同期・PCとスマホの音声共有・掲示板切替をコードと既存テストへ照合した。確認できた3問題に新規失敗テストを作成し、root担当へ修正を引き渡した。

| 対象 | 所有仕様 | 用語・ADR | 確認した主な実装 | 確認した主なテスト | 状況 |
| --- | --- | --- | --- | --- | --- |
| コメント取得 | [comment-acquisition](../features/comment-acquisition.md) | 接続枠・接続先・共通コメント・初回履歴・新着・レス番号、ADR 0001・0013 | `sources/source-connections.ts`、`source-inputs.ts`、YouTube/Twitch/したらば/jpnkn各source、`source-request.ts`、AppState、CommentStore、`use-comment-source-actions.ts` | source-inputs/parsers/lifecycle/request-lifecycle/connections-startup、twitch-source-lifecycle、jpnkn-source/app-state、app-state、dashboard-source-start | 調査済み。数値文字参照の不具合を再現、root修正後差分レビュー済み |
| コメントフィルター | [comment-filter](../features/comment-filter.md) | コメントフィルター・NGワード・アスキーアート判定。独立ADRなし、共通コメントと公開境界のADRを参照 | `shared/comment-filter.ts`、`core/comment-filter.ts`、AppState.acceptComment、`use-comment-filter-editing.ts` | comment-filter、comment-filter-editing/panel、app-state、settings | 調査済み。この調査では新たな修正対象を確定しなかった |
| 掲示板次スレッド作成 | [shitaraba-next-thread](../features/shitaraba-next-thread.md) | 現行/次スレッド・次スレッド一時状態・レス番号、ADR 0004・0005・0013 | 次スレッドcontroller、したらば/jpnkn書込adapter、AppStateの進捗通知/切替/システム読み上げ | shitaraba-next-thread、shitaraba-write-adapter、jpnkn-write-adapter/app-state、server/API関連 | 調査済み。取得の不正1行で進捗も停止する連携影響を確認。独立の新規不具合は確定しなかった |
| コメント一覧 | [comment-list](../features/comment-list.md) | コメント一覧・共通コメント・初回履歴。窓/公開の共通契約を参照 | CommentListView/Page、MobileCommentsPage、CommentItem、useApplicationState、MobileCommentFeed、CommentStore、mobile公開射影 | comment-list-page/render-work/panel/window-actions、comment-item、mobile-comments-page、comment-store | 調査済み。この調査では新たな修正対象を確定しなかった |
| コメント読み上げ | [comment-speech](../features/comment-speech.md) | コメント読み上げ・待ちキュー・同期1件表示、ADR 0002 | speech-text、CommentSpeechController、VoicevoxAdapter、ElectronAudioPlayer、AppState共有WAV、CommentSpeechPanel | speech-text、comment-speech-controller/panel、speech-operation-deadlines、app-state | 調査済み。本文連結と話者一覧更新の2件を再現、root修正後差分レビュー済み |
| スマホでコメントを聞く | [mobile-speech](../features/mobile-speech.md) | スマホでコメントを聞く・LAN/Tailscale公開・Android音声サービス、ADR 0002・0003・0009・0017・0019。直接接続は所有仕様へ参照 | MobileSpeechController、FfmpegTranscoder、MobileReadSession、MobilePublicationServerManager、公開射影、MobileBrowserConnection、BrowserAudioPlayer | mobile-speech-controller、mobile-comments-page、speech-operation-deadlines、app-state、server/transport関連 | 調査済み。本文連結不具合はスマホにも影響。独立キュー・期限・世代・試聴購読境界に新規確定不具合なし |

表の実装は `src/main/`、`src/renderer/`、`src/shared/`、テストは `tests/` を探索したもの。列挙は全参照元の固定リストではない。

## 確認できた問題と根拠

1. **不正数値文字参照の1行で、したらばの取得バッチ全体を失う。** `shitaraba-source.ts` の `decodeEntities` は `&#x110000;` に対し `String.fromCodePoint(1114112)` を呼び RangeError。`parseShitarabaRaw` が全体失敗し `run` が同じ取得位置で再試行するため、正常な前後コメントと次スレッド判定のレス番号進捗を失う。取得仕様「エラー処理」の不正コメントだけを破棄する契約と、次スレッド仕様「レス番号の監視」に不一致。root修正はbody/authorの変換失敗を行単位で破棄し、先に取得したレス番号の進捗を維持する。callback例外はこのcatchで隠さない。影響は掲示板取得と次スレッド連携。
2. **分割した本文へ人工的な空白を入れ、URLの省略が途中で終わる。** `speech-text.ts` が ContentPart を `join(' ')` していた。`参照https://exam` と `ple.com/path` を同じ本文として受信すると、実際の読み上げ文字列は `参照URL ple.com/path`。読み上げ仕様「読み上げ文字列」の連結・URL全体置換に不一致。root修正は `join('')`。PCとスマホが同じ関数を使うため双方へ適用される。
3. **準備済みVOICEVOXの話者一覧が更新できない。** CommentSpeechController.listVoices はensureReady後にキャッシュだけ返していた。2回目のエンジン一覧を別話者へ変更しても旧一覧が返る。話者追加/削除やエンジン再起動後の「話者一覧を更新」が反映されず、古い話者の有効判定も残る。読み上げ仕様「話者と音声設定」「管理画面」の現在の一覧取得に不一致。root修正は明示一覧取得でprepare/listVoicesを更新し、進行中の準備は共有する。

再現テストは [audit-comments-2026-10-24.test.ts](../../tests/audit-comments-2026-10-24.test.ts)。修正前は3件とも期待した失敗を確認した。rootから修正後3件成功の連絡を受け、修正差分を仕様一致と故障分離・利用側の2観点で独立に再確認した。最終の関連テストと全体検証は全体記録へ集約する。

## 連携・境界の確認

- フィルターはAppStateでCommentStore.accept前に適用される。除外IDはmarkSeen、sequence非付与、後からNG解除しても再受信で復活しない。フィルターテストは共有純粋関数を使い、本文・結果の外部送信を要しない。AA判定の2行/8文字/50%条件はコードと照合した。
- SourceConnectionsは接続インスタンスと停止世代で旧コメント・進捗・状態通知を遮断する。掲示板切替は実サービスを保存URLから判定し、次スレッド設定だけでは取得を再作成しない。jpnknの物理行進捗・未完CP932バイト・Range重なり・全文復旧は専用テストと照合した。
- 次スレッドは同名0/1/複数、送信前失敗/結果不明/browserRequired、明示登録、閾値引下げ、手動停止と切替、旧案内終了後の新スレッド条件再評価を確認した。案内と作成成功音声はコメント履歴/OBSへ混入しない。
- 一覧は共通履歴・受理sequence・安全なReactテキスト/URLリンク・memo行を共用する。状態同期と差分、停止中追従、方向反転、表示設定の分離を既存テストへ照合した。実描画での自動スクロール/選択/コピーや10,000件性能は今回実機確認していない。
- PC読み上げは10待ち/初回履歴除外/停止世代/復旧1回/同期後2秒、音声プレイヤーは初期化・終了検出の期限、VOICEVOX/FFmpegは本文までの期限と終了取消を確認した。
- スマホ購読はAppState.speech.availableを前置するため、MobileSpeechController単体のvoice非null判定だけから「無効な声を購読可能」とは判定しなかった。接続別キュー・15秒破棄・先読み1・共有変換参照解放・開始前コメント除外・試聴開始時点の購読者固定・停止再開の旧世代除外を確認した。公開データは接続先を含む内部IDを不透明化し、表示設定と必要イベントへ射影する。

## 検証・不足・未確認

- 初回の再現テスト実行はVitestのsandbox Temp内キャッシュrename EPERMで0件実行。TEMP/TMPを作業ツリー内へ変更した再実行で3件の実失敗を確認した。作業用の非ignoreディレクトリは削除し、その後はignore済み `tmp/audit/comments` を使用した。
- 既存24ファイルの局所実行は `speech-operation-deadlines.test.ts` の「実HTTPの本文受信中でも終了操作で通信を切断する」が1059msで失敗し、後始末で停滞したため中断した。assertion詳細は出力されておらず、原因はこの結果だけから確定していない。全件成功として扱わない。
- 実HTTP群を除いた22ファイル、さらに6ファイルへ絞った実行も完了前に停止し、全体担当へ検証を引き継いだ。テスト成功の根拠はrootの最終検証を使用する。
- 既存テストには異常行の数値文字参照、ContentPart境界を跨ぐURL、ready後の話者再取得の不足があり、今回の回帰テストで補った。話者更新の失敗・停止・世代競合は修正後の関連回帰確認対象。
- 読み上げ仕様のテスト条件2に「本文だけが既定」と旧記述が残る一方、同書の2026-10-18採用済み既定は投稿者名オン。この軽微な文書不整合は全体担当へ報告した。現実装/現テストは明示された最新の既定と一致する。
- YouTube/Twitch/掲示板の現在の実応答、Windows 11のVOICEVOX起動/既定出力/所有プロセス停止、実掲示板投稿、スマホのLAN/Tailscale/4G/5G・direct/DERP・Android音声再生・画面ロック/長時間待機は今回未検証。一般掲示板への試験投稿は実施していない。

以上は調査した範囲と証拠を示し、「他に不具合がない」ことを保証しない。
