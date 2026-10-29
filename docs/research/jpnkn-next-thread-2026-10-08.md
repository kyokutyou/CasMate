# jpnknの次スレッド自動作成の実現性調査

調査日: 2026-10-08。対象は、きゃすメイトの既存したらば次スレッド作成を、`https://bbs.jpnkn.com/test/read.cgi/clarahas/1789177017/` のようなjpnknスレッドにも提供できるか。

初回調査はユーザーの指示に従い、**スレッド作成、通常投稿、案内投稿、POST、フォーム送信を行わず**、公開HTML・設定・一覧・公式資料へのGETだけで確認した。その後、ユーザーが自分のテスト板を提示し、具体的なタイトル・本文で1件作成することを明示的に許可したため、[末尾の追加確認](#利用者のテスト板での追加確認)を行った。この文書は調査資料で、正式仕様・機能採用・実装完了を意味しない。[コメント取得の先行調査](jpnkn-comment-acquisition-2026-10-08.md)とは確認範囲を区別する。

## 結論

**条件付きで実装可能と判断する。** 対象板には新規スレッド作成用の公開フォームがあり、既存のレス番号監視・タイトル生成・同名タイトル確認・自動切替の制御を、jpnkn専用アダプターと組み合わせる構成が考えられる。初回のclarahas調査では投稿を試していない。その後のkyokutyouテスト板では、許可された1件の作成要求が受理され、タイトル・本文・新規URLをGETで確認できた。きゃすメイトへの製品統合は未実装である。

- 書き込みが許可され、利用認証が不要または同じ送信元IPで認証済みの場合は、アプリ側での自動作成を実装できる見込みがある。
- Turnstileの利用認証を求められた場合は人による認証が必要で、認証が完了するまで無人の自動作成は成立しない。現在の対象板が認証を要求するかはGETでは確定できない。
- 書き込み停止・送信元の規制・文字数やNGワードなどによる拒否は、自動化してもサービス側の判断に従う。

認証と制限の根拠は[公式利用ヘルプ](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/use.md)と[公式管理設定](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/setting.md)。既存制御の根拠は[次スレッド仕様](../features/shitaraba-next-thread.md)と[既存コントローラー](../../src/main/shitaraba/shitaraba-next-thread-controller.ts)。

## 対象板のGETで確認した事実

利用者のログイン情報やCookieを渡さず、[対象板トップ](https://bbs.jpnkn.com/clarahas/)、[現行スレッド](https://bbs.jpnkn.com/test/read.cgi/clarahas/1789177017/)、[subject.txt](https://bbs.jpnkn.com/clarahas/subject.txt)、[SETTING.TXT](https://bbs.jpnkn.com/clarahas/SETTING.TXT)を読み取った。本文はメモリ上で確認し、保存していない。

| 対象 | 確認結果 |
| --- | --- |
| 板トップ | HTTP 200、Shift_JIS。新規作成フォームが存在 |
| 新規作成フォーム | 宣言上の送信方式はPOST、送信先は同一ホストの `/test/bbs.cgi` |
| 作成用項目 | `subject`、`FROM`、`mail`、`MESSAGE`、隠し項目 `bbs=clarahas` |
| 現行スレッド | HTTP 200、Shift_JIS。既存スレッドへのレス投稿フォームが存在 |
| レス投稿用項目 | `FROM`、`mail`、`MESSAGE`、隠し項目 `key=1789177017` と `bbs=clarahas` |
| 公開フォームの認証表示 | パスワード欄・Turnstile/CAPTCHAの記述は検出しなかった。GET応答のSet-Cookieもなかった |
| 公開一覧 | HTTP 200、Shift_JIS。47行すべてが `{スレッドID}.dat<>タイトル (件数)` の形式。現行スレッドも掲載 |
| 公開設定 | HTTP 200、Shift_JIS。`BBS_RES_MAX=1000` |

この確認はフォーム契約と読取経路の確認であり、投稿成功の実測ではない。特に、**認証欄がHTMLに見えないことは、利用認証が不要という証拠にはならない**。公式ヘルプの方式では、書き込み要求に対するエラーで認証URLが発行されるためである。[公式利用ヘルプの認証手順](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/use.md)

subject.txtが読めるため、作成前に同名タイトルが存在するか調べる既存方式を移植するための入口はある。ただし作成直後の一覧反映時間、並行作成、削除・一覧の省略などは未確認で、一意の作成成功を保証するものではない。[既存の同名タイトル確認仕様](../features/shitaraba-next-thread.md#同名タイトルの確認)

## 公式資料から確認した条件

2026-10-08に運営リポジトリの `docs/use.md`、`docs/setting.md`、`docs/feature.md` の公開原文をGETで取得し、以下を確認した。公開資料の記述であり、対象板への投稿検証ではない。

### 利用認証

Turnstileを有効にした板では、最初の書き込みに認証要求が返り、認証URLへ人がアクセスしてトークンを取得する。トークンをメール欄に入れて一度投稿すると、その後は空欄でも利用できると説明されている。別ブラウザでの認証も可能だが、IPアドレス変更時は再認証が必要である。[公式利用ヘルプ](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/use.md)

したがって、認証のある板で「URLを入れるだけで、最初からずっと無人で次スレッドを作る」とは約束できない。人による初回認証を支援する方式は候補になるが、これは既存きゃすメイトのCAPTCHAを自動処理しない境界と合わせて、別途採用・設計する必要がある。[したらば書き込み境界](../features/shitaraba-next-thread.md#したらば書き込み境界)、[ADR 0004](../adr/0004-limit-shitaraba-write-to-next-thread.md)

### 投稿制限とテンプレート

- 本文は1～4096文字、件名は1～128文字、名前・メールは各128文字までとされる。[公式機能表](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/feature.md)
- 書き込み停止、公開Proxy、海外IP、逆引きできないホスト、指定IP・ホスト、NGワードの規制がある。閲覧が成功しても書き込み可能とは限らない。[公式管理設定](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/setting.md)
- 板の最大レス数は1000～4000。今回の対象板の公開設定は1000だったが、他の板へ固定1000を適用しない。[公式管理設定](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/setting.md)、[対象板の公開設定](https://bbs.jpnkn.com/clarahas/SETTING.TXT)
- メール欄の `!tmpl` による板設定テンプレートの挿入がある。現行の1レス目の複製と併用すると重複する可能性があり、どちらを使うかを明示する必要がある。[公式管理設定](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/setting.md)
- HTTPのリンクを含む投稿は公式機能表で許可されている。したらば専用のURL先頭の `h` を除く送信変換を、jpnknへそのまま適用しない。[公式機能表](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/feature.md)、[既存送信変換](../features/shitaraba-next-thread.md#したらば書き込み境界)

公式の二重投稿判定は3秒という記述があるが、通信結果が不明なときの重複スレッド作成を防ぐ保証や冪等キーは確認できない。[公式機能表](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/feature.md)

### 公式自動次スレ機能・書き込みAPIとの区別

運営の[Issue #35](https://github.com/japankun/bbs.jpnkn.com/issues/35)には自動スレ立ての検討、[Issue #58](https://github.com/japankun/bbs.jpnkn.com/issues/58)には書き込みAPIの要望があり、調査時点ではいずれもOpenだった。これらから「専用の公式自動次スレAPIが提供済み」とは判断できない。

今回の実装候補は、サービスに自動作成を依頼する専用APIではなく、きゃすメイト側のレス番号監視と公開新規作成フォームを組み合わせる方式である。投稿成功URLの応答形式やサーバー内部処理は公開資料で確認できず、初回のPOST禁止条件では実測を行っていない。その後の同日追加確認の成功応答は末尾を参照する。

## 既存きゃすメイトから再利用できる制御

| 制御 | 既存の動作と主な根拠 |
| --- | --- |
| レス番号監視 | 初回履歴・新着の最大レス番号が閾値以上なら評価。飛び越しにも対応。[仕様](../features/shitaraba-next-thread.md#レス番号の監視)、[controller](../../src/main/shitaraba/shitaraba-next-thread-controller.ts) 79・214行 |
| 作成内容 | タイトルの最後の数字列を+1。本文は1レス目を明示取得。自動／手動を独立設定。[仕様](../features/shitaraba-next-thread.md#作成予定内容)、[controller](../../src/main/shitaraba/shitaraba-next-thread-controller.ts) 184・500行 |
| 重複防止 | 作成直前の同名タイトルを確認し、0件なら作成、1件なら既存URL採用、複数なら確認待ち。[仕様](../features/shitaraba-next-thread.md#同名タイトルの確認)、[controller](../../src/main/shitaraba/shitaraba-next-thread-controller.ts) 231行 |
| 自動試行 | 現行スレッドの一時状態ごとに1回。結果不明では自動再送しない。[仕様](../features/shitaraba-next-thread.md#レス番号の監視)、[結果不明の解決](../features/shitaraba-next-thread.md#結果不明の解決)、[controller](../../src/main/shitaraba/shitaraba-next-thread-controller.ts) 214～225・276～289行 |
| URL案内 | 成功後に任意で現行スレッドへ1回案内。案内の失敗で作成成功を取り消さない。[仕様](../features/shitaraba-next-thread.md#現行スレッドへのurl案内)、[controller](../../src/main/shitaraba/shitaraba-next-thread-controller.ts) 305行 |
| 接続先切替 | 作成済みかつ切替閾値以上で、その掲示板の取得だけ次URLへ切替。[仕様](../features/shitaraba-next-thread.md#接続先の自動切替)、[controller](../../src/main/shitaraba/shitaraba-next-thread-controller.ts) 342行 |
| 作成・切替の音声案内 | 通常コメントと別のシステム案内として読み上げる。[仕様](../features/shitaraba-next-thread.md#システム案内の読み上げ) |

これらは再利用候補であり、jpnknで動作確認済みという意味ではない。現在の書き込みアダプターは[4操作のインターフェース](../../src/main/shitaraba/shitaraba-write-adapter.ts)（25～30行）へ分離されている一方、実装とコントローラーの入力型はしたらばに固定されている。

## 追加対応が必要な箇所

1. jpnkn用の板・スレッド識別、作成済みURLと同一板の検証、手動復旧URL、画面の表示名を追加する。[controller](../../src/main/shitaraba/shitaraba-next-thread-controller.ts) 34・120・409行、[NextThreadPanel](../../src/renderer/components/NextThreadPanel.tsx) 47行
2. jpnkn用の `fetchThreadContent`、`findThreadsByTitle`、`createNextThread`、`announceNextThread` を実装する。DATとsubject.txtはShift_JISで、一覧の `.dat<>` はしたらばの `.cgi,` と異なる。[既存アダプター](../../src/main/shitaraba/shitaraba-write-adapter.ts) 25～30・78～92行、[先行調査](jpnkn-comment-acquisition-2026-10-08.md)
3. 投稿項目の `FROM`・`MESSAGE`、同一ホストの `/test/bbs.cgi`、Shift_JIS送信、必要な公開項目、成功・認証要求・明確な拒否・結果不明の応答を専用に扱う。したらばのホスト・フォーム項目・パスを流用しない。[既存アダプター](../../src/main/shitaraba/shitaraba-write-adapter.ts) 216・344・486行
4. 取得済みコメント数ではなく、DAT上の最大レス番号で閾値を評価する。削除・空本文・フィルターにより番号がずれないことを検証する。[レス番号監視仕様](../features/shitaraba-next-thread.md#レス番号の監視)、[取得からの進捗通知](../../src/main/core/app-state.ts) 202行
5. 作成成功を確認してからURL案内・切替へ進める。旧スレッドの上限到達後は案内できない可能性があるため、案内を使う場合は上限前に余裕を持って作成する。現在の作成950・切替1000という設定も、通信待ちや認証要求による遅延を保証するものではない。[現行設定](../features/shitaraba-next-thread.md#設定)

タイムアウトや不明な応答で即座に再送せず、GETによる同名確認と利用者の確認待ちへ移る。試行・成功・結果不明の状態は既存と同様に配信セッション中だけ保持し、再起動時は現在の公開一覧を再確認する。作成済み記録の永続化はこの調査で追加提案しない。[ADR 0005](../adr/0005-use-board-title-check-for-shitaraba-next-thread.md)

## 初回調査の未確認範囲・実装前の判断

- 対象板が実際の送信元へTurnstile認証や投稿規制を要求するか。
- フォーム送信が受理されること、必要な参照元・Cookie・公開項目、成功応答と作成スレッドIDの取得方法。
- 通信断・結果不明時の成功判定、一覧への反映時間、並行作成・テンプレート・文字数制限の実挙動。
- 次スレURL案内の成功確認、上限到達・スレッド終了時の投稿応答。
- jpnkn用アダプターを組み込んだアプリの保存・作成・切替・読み上げ・他サービスとの障害分離。

現行仕様は「したらば以外での次スレッド作成」とCAPTCHA等を対象外にしている。採用する場合は[SPEC.md](../../SPEC.md)、[機能仕様の対象と書き込み境界](../features/shitaraba-next-thread.md)、[CONTEXT.md](../../CONTEXT.md)、関連ADRを先に更新する。認証不要の板に限定するか、人による認証・ブラウザ作成後のURL登録を支援するかは、この調査だけでは採用しない。

実投稿検証は、ユーザーが明示的に許可した専用テスト掲示板だけを使うという現行条件に従う。初回のユーザー指示は投稿禁止であり、その段階ではテスト投稿も行っていない。[次スレッド仕様のテスト条件](../features/shitaraba-next-thread.md#テスト条件) 27番

## 利用者のテスト板での追加確認

同日、利用者が[kyokutyou板の「新スレ1」](https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791458242/)を作成し、動作確認を依頼した。以前の投稿禁止指示があるためGET確認と送信データの準備を先に完了し、タイトル「新スレ2」と明示したテスト本文で、スレッドを1件だけ作成してよいか確認した。利用者が「テストスレッド1件の作成を許可する」と回答した後にだけPOSTを実行した。

### 作成前の確認

| 確認 | 結果 |
| --- | --- |
| 現行スレッド・板トップ | HTTP 200、Shift_JIS |
| 現行DAT | HTTP 200、139バイト、2レス、5フィールド、文字化けなし |
| 末尾レスのRange取得 | `bytes=81-` → HTTP 206、58バイト。全文末尾と完全一致 |
| 取得済み末尾からのRange | `bytes=139-` → HTTP 304、本文0バイト |
| 一覧・公開設定 | スレッド1件、`BBS_RES_MAX=1000` |
| 作成フォーム | `/test/bbs.cgi`、`subject/FROM/mail/MESSAGE/bbs`。送信先と `bbs=kyokutyou` を直前に再確認 |
| 同名タイトル | 作成直前のsubject.txtで「新スレ2」は0件 |
| 送信データ | 許可されたタイトル・本文と空の名前・メールを、Shift_JISでURLエンコード。ローカルの復号一致を確認 |

### 許可された1件の作成結果

HTTPクライアントで公開フォームへPOSTを**1回だけ**送信した。自動リダイレクトと自動再送は行わず、Refererは対象板トップ、Content-Typeは `application/x-www-form-urlencoded` とした。送信後はGETだけで確認した。

| 確認 | 結果 |
| --- | --- |
| 作成応答 | HTTP 200、Shift_JIS、ページタイトル「書きこみました」 |
| 認証・拒否の表示 | 今回の応答に利用認証要求・ERROR表示なし |
| HTTP Location | 新規スレッドURLのLocationヘッダーなし。成功の確定は一覧とDATで行った |
| 作成後の一覧 | スレッド2件、「新スレ2」の完全一致候補は1件 |
| 新規ID | `1791459622`。現行スレッドとは別IDで同じ板に属する |
| 表示ページ・DAT | どちらもHTTP 200。DATは108バイト、1レス、文字化けなし |
| タイトル・本文 | 許可された送信内容と一致 |

作成したスレッド: [新スレ2](https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791459622/)

**このテスト板と今回の送信元では、認証操作なしで公開フォームからの新規作成が成功した。** 全板・別IP・今後の設定変更後も認証不要であるとは判断しない。新規作成後の通常投稿、旧スレッドへのURL案内、削除、再作成は行っていない。

確認できたのはサービス側の直接HTTP作成と取得であり、きゃすメイトからの閾値による自動作成・保存・自動切替・読み上げの動作ではない。成功応答のmeta refresh等の解析、認証・拒否・結果不明の全分岐、一覧反映が遅れる場合、同時作成時の挙動も未検証である。

今回のローカル変更は調査文書だけで、製品コード・正式仕様は変更していない。製品のlint・型チェック・全体テスト・buildは実行していない。

## 2026-10-09の製品コードによる追加確認

次スレッド自動作成の失敗報告を受け、投稿のContent-Typeを公開フォームと以前の成功送信に合わせて `application/x-www-form-urlencoded` とし、追加していた `charset=Shift_JIS` を除去した。本文のCP932生バイト、フォーム項目、送信先、自動再送禁止は維持した。元の失敗応答は保持していないため、元の拒否理由そのものの断定とは区別する。

利用者がkyokutyou板への「新スレ5」、本文「きゃすメイトのjpnkn次スレッド自動作成の動作確認用です。」、名前・メール空欄、最大1件の作成を明示許可した後、ビルドした製品の次スレッドコントローラーと書き込みアダプターを使って確認した。

- 同名タイトル0件をGETで確認後、コントローラーへレス番号7を渡した。実コメントの取得による閾値到達とは区別する。
- POSTは1回だけで、HTTP 200の成功応答を受け、状態が `created` になった。公開一覧の同名候補は1件で、DATのタイトル・本文は許可された内容と完全一致した。
- レス番号8の追加評価でもPOSTは増えなかった。案内投稿、接続先切替、読み上げは外部へ実行していない。起動中のアプリの設定・配信状態は変更していない。
- 現在の保存設定による起動時確認も別途GETだけで行い、作成したスレッドを `created` として採用し、追加の作成・案内・成功読み上げを実行しないことを確認した。
- lint、型チェック、全体テスト137ファイル・1338件（`pnpm test --maxWorkers=2`）、`pnpm build`は成功した。初回の全体テストの時間切れ・一時フォルダーロックと、初回ビルドの実行中EXEロックは、成功した再検証と区別する。配布物は生成していない。

作成したスレッド: [新スレ5](https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791475185/)

今回の確認は、この板・送信元での作成と重複防止・起動時採用に限る。実サービスへの案内投稿、実コメントでの閾値到達、自動切替、読み上げ、他の板や送信元については今回の実投稿検証済みとしない。

## 2026-10-09のURL案内と待機調整

利用者が「次スレの案内も正常に行われるか確認してください。スレッドは新規で立ててもいいです。」と依頼した後、同じ専用テスト板で作成と案内を確認した。投稿者名・E-mailは空欄、本文は前回のテスト本文を引き継ぎ、案内文は既定テンプレートを使用した。

| 確認 | 結果 |
| --- | --- |
| 新スレ5から新スレ6の自動作成 | 作成POST 1回、HTTP 200、`created` |
| 作成確定から5秒後の案内 | 実測5,014ms後、案内POST 1回、HTTP 429の明確な拒否。作成済みURLは保持された |
| 拒否後のGET確認 | 新スレ5は1レスのままで、同じ案内文の一致は0件。新スレ6のタイトル・本文は一致 |
| 時間を置いた案内の切り分け | 既存の新スレ6への同じ案内文を製品アダプターで1回送信し、HTTP 200。新スレ5は2レスになり、2レス目の本文と完全なHTTPS URLが一致、重複なし |
| 待機調整後の新スレ6から新スレ7の自動作成・案内 | 作成POST 1回と案内POST 1回、両方HTTP 200。実測30,006ms後に案内し、`created`・警告なし |
| 調整後のGET確認 | 新スレ7の同名候補1件、タイトル・本文一致。新スレ6の2レス目に既定案内文とHTTPS URLが完全一致し、同じ案内は1件 |
| 調整後の追加評価 | レス番号8を渡しても作成・案内のPOSTは増えなかった |

5秒後の拒否と、同じ本文で時間を置いた成功を受け、[URL案内仕様](../features/shitaraba-next-thread.md#現行スレッドへのurl案内)を先に更新してから、jpnknの案内待機を30秒に延長した。したらばの5秒待機、案内の1回送信、自動再送禁止、作成済み状態の保持、読み上げ・到達済み切替を待たせない契約は維持した。管理画面の説明も現行サービスに対応する秒数を表示する。サービスの公表する必須間隔や全板・送信元での受理を保証する秒数は確認できておらず、30秒は今回の連投制限に余裕を持たせる製品側の待機とする。

実投稿先:

- [新スレ5の新スレ6案内](https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791475185/2)
- [新スレ6の新スレ7案内](https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791475841/2)
- [新スレ7](https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791476413/)

作成・案内の一連の確認は、ビルドした製品コントローラーとアダプターの独立インスタンスで行い、レス番号7を入力した。実コメント取得による閾値到達、実音声、実接続先切替はこの実投稿検証の対象ではない。実待機は差し替えておらず、起動中のアプリの設定・配信状態を変更していない。

修正前に30秒待機・サービス別画面説明の回帰テスト3件が失敗することを確認し、修正後の関連テスト122件、lint（350ソースファイル）、型チェック、全体テスト137ファイル・1341件（`pnpm test --maxWorkers=2`）、`pnpm build`は成功した。全体テストはElectronの操作位置・フォーカス・横はみ出しの描画確認と通常Chromeの代表操作を含む。確認用の実投稿スクリプトは削除した。配布物は生成していない。

編集後に、仕様との一致と故障時・利用側への影響を分けて自己レビューした。サービス別待機、旧スレッドへの案内、作成済み状態の保持と再送禁止、管理画面の説明、API呼び出しの待機を確認した。独立した別担当レビューは実施していない。
