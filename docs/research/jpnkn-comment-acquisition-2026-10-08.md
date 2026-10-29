# jpnknのスレッドURLを既存の掲示板欄で使うための調査

調査日: 2026-10-08。対象は、管理画面の既存したらばURL欄へ `https://bbs.jpnkn.com/test/read.cgi/clarahas/1789177017/` を入力し、コメント取得・一覧・OBS表示・読み上げを使うこと。

これは実現可否を判断する調査資料であり、正式仕様・追加採用・実装完了の記録ではない。製品コードと正式仕様は変更していない。

## 結論

**対応可能と判断する。** 指定スレッドの公開DATをログインなしで取得でき、差分取得も実際に動作した。現在のアプリはしたらば専用なのでそのままでは接続できないが、既存欄でURLのホストを判別し、jpnkn専用の取得アダプターへ振り分ける方式で実現できる。

利用者は提示されたスレッドURLをそのまま入力し、通常のオン・オフ操作で使う構成にできる。DATのURLや取得方式を利用者に指定させる必要はない。以下の実測と[既存の接続生成入口](../../src/main/sources/source-connections.ts)（97行）、[共通コメント受理入口](../../src/main/core/app-state.ts)（336行）を根拠にした実装上の判断であり、アプリ内での動作はまだ検証していない。

## 外部サービスについて確認できた事実

[公式トップ](https://bbs.jpnkn.com/)は5ちゃんねる互換の専用ブラウザ向けAPIと、外部板登録による購読を案内している。運営の[Issue #10のコメント](https://github.com/japankun/bbs.jpnkn.com/issues/10#issuecomment-555381119)にはDATのパスとRange処理、[Issue #36のコメント](https://github.com/japankun/bbs.jpnkn.com/issues/36#issuecomment-765885292)にはShift_JISとLast-Modified追加の記録がある。これらは2019～2021年の公開記録なので、現在の挙動は次の実測を優先する。

### 指定スレッドへの実取得

2026-10-08の20:08～20:11頃（日本時間）に、利用者の資格情報・Cookieを渡さず、対象スレッドだけを少数回読み取った。本文はメモリ上で解析し、ファイルへ保存していない。接続先はユーザー指定の[スレッド表示](https://bbs.jpnkn.com/test/read.cgi/clarahas/1789177017/)と、それに対応する[公開DAT](https://bbs.jpnkn.com/clarahas/dat/1789177017.dat)。

| 確認 | 実測結果 |
| --- | --- |
| スレッド表示 | HTTP 200、`text/html; charset=Shift_JIS` |
| DAT全文 | HTTP 200、`text/plain; charset=Shift_JIS` |
| DAT本文 | 圧縮なしで56,971バイト、624行。全行が `<>` 区切りの5フィールド |
| 文字コード | CP932で復号でき、置換文字は0。本文にはHTML改行がある |
| 差分取得 | `Range: bytes=56401-` がHTTP 206。570バイトが全文末尾と完全一致 |
| 差分位置 | `Content-Range: bytes 56401-56970/56971`。開始位置・本文長・終端が一致 |
| 新着なし | `Range: bytes=56971-` がHTTP 304、本文0バイト |
| 範囲超過 | `Range: bytes=56972-` がHTTP 416、`Content-Range: bytes */56971`、本文0バイト |
| 更新日時条件 | 実際に返された更新日時を `If-Modified-Since` に指定してもHTTP 200で全文が返った |

読み取り用DATで取得できるため、HTMLページの見た目を解析する必要はない。新着なしの304は、一般的な `response.ok` 判定では失敗扱いになるため、専用処理が必要である。現在のしたらば処理は[HTTP成功の判定](../../src/main/sources/shitaraba-source.ts)（93行）に続いて本文を解析する方式である。

### 圧縮と取得位置の注意

自動gzip/deflate展開を有効にした全文取得では、展開後本文が56,971バイトなのに `Content-Range` は `bytes 0-19002/19003` だった。同じ条件で末尾取得を試すと、HTTPクライアントが圧縮展開エラーで停止した。原因を確定していないため、圧縮処理との関係は推測として扱う。

`Accept-Encoding: identity` と自動展開なしへ切り替えた全文取得では、本文長・Content-Length・Content-Rangeが56,971バイトで一致し、末尾・範囲超過も上表の応答を確認できた。[RFC 9110 §14.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.1.2)はRangeの位置を、圧縮がある場合は圧縮後のバイトで定義している。また[§14.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.4)はHTTP 200のContent-Rangeに意味を定義していない。

したがって実装候補は、全文・差分とも圧縮なしへ統一し、文字列長ではなく復号前の実DATバイト数で取得位置を管理する方式である。206では要求位置と応答の位置・長さを確認する。304は新着なしとして接続を維持し、416・Rangeを無視した200・位置不整合では全文取得と重複排除で復旧する。古い公開実装には範囲超過時205もあるため、現在の416だけを恒久契約とみなさない。[運営の公開Range実装](https://github.com/japankun/bbs.jpnkn.com/issues/10#issuecomment-555381119)

### 取得頻度と終了条件

公式資料からHTTP読み取りの最小取得間隔は確認できなかった。現行の既定5秒を候補にし、レート制限時の待機を入れることは実装上の提案であって、運営が5秒を保証したという意味ではない。現行アプリの間隔・再試行契約は[コメント取得仕様](../features/comment-acquisition.md#再接続と障害分離)が所有する。

jpnknは板ごとに最大レス数を1000～4000へ設定でき、終了メッセージも任意に設定できる。したらばの1000件や特定の終了文言をそのまま使わない。[公式設定資料](https://github.com/japankun/bbs.jpnkn.com/blob/master/docs/setting.md)、[運営の上限説明](https://github.com/japankun/bbs.jpnkn.com/issues/53#issuecomment-847791621)

[公式トップ](https://bbs.jpnkn.com/)はクロールを許可しない一方、専用ブラウザによる購読を明示している。この依頼では指定スレッドの購読だけを扱い、掲示板全体の巡回・検索収集へ広げない。

## 現在のアプリについて確認できた事実

| 箇所 | 現状と影響 |
| --- | --- |
| [source-inputs.ts](../../src/main/sources/source-inputs.ts) 104～128行 | `jbbs.shitaraba.net` と `/bbs/read.cgi/{カテゴリ}/{掲示板ID}/{スレッドID}` に限定。jpnknの入力は開始時に拒否する |
| [shitaraba-source.ts](../../src/main/sources/shitaraba-source.ts) 33～45・90～94行 | rawmode、EUC-JP、先頭フィールドのレス番号、5番目の本文を前提にする。jpnkn DATとは異なる |
| [source-connections.ts](../../src/main/sources/source-connections.ts) 45～47・97行 | 接続開始前のしたらば初期化と、したらばアダプター生成が固定されている |
| [settings/schema.ts](../../src/main/core/settings/schema.ts) 109～119行 | スレッドURLを文字列で保存する。既存欄で接続先を保存する構造は利用できる |
| [CommentAcquisitionPanel.tsx](../../src/renderer/components/CommentAcquisitionPanel.tsx) 8～17・73～99行 | 掲示板欄と取得間隔は既にある。ラベル・入力説明・エラー文言はしたらば向け |
| [types.ts](../../src/shared/types.ts) 2行、[messages.ts](../../src/renderer/messages.ts) 33～37行、[speech-text.ts](../../src/main/speech/speech-text.ts) 3～7行 | コメントソースは3値で、表示・読み上げ名もしたらばへ固定。サービスを識別する方法の整理が必要 |
| [app-state.ts](../../src/main/core/app-state.ts) 336行、[comment-store.ts](../../src/main/core/comment-store.ts) 24行 | 共通コメントとして受理できればフィルター・履歴・表示・読み上げの既存経路を利用できる |

調査環境のNode v24.19.0では `fetch` と `new TextDecoder('shift_jis')` が利用できた。ただしElectron内の実取得確認は行っていない。既存アダプターも標準のfetchとTextDecoderを使用している。[shitaraba-source.ts](../../src/main/sources/shitaraba-source.ts) 16・92～94行

## 実装する場合の提案

1. 既存の掲示板入力欄を維持し、したらばかjpnknかをURLから自動判別する。jpnknでは `/test/read.cgi/{掲示板ID}/{スレッドID}/` から公開DATのURLを内部で組み立てる。両サービスを同時に使う別欄の追加は、この依頼には含めない。
2. jpnkn専用アダプターを追加する。DATの5フィールド、Shift_JIS、レス番号とバイト位置、HTML改行・文字参照、初回履歴、新着、差分復旧を扱う。削除行などでレス番号がずれない処理は追加検証する。
3. 初回は全文から最新100レスを履歴として渡し、その後の新着だけをOBS・文字演出・読み上げへ渡す方式を候補にする。サービス・板・スレッド・レス番号を含むIDで重複を防ぐ。現在の共通契約は[初回履歴](../features/comment-acquisition.md#初回履歴と新着判定)と[重複排除](../features/comment-acquisition.md#受理順と重複排除)を参照する。
4. 接続欄・状態・コメント表示・読み上げで、jpnknのコメントをしたらばと誤表示しないよう、サービス識別と文言を更新する。新しい識別値を共通型へ追加するか、掲示板接続枠と実サービスを別に持つかは実装前の設計判断とする。
5. 保存・再接続・停止・他サービスとの障害分離は既存の操作感を維持する。管理画面の変更では[共通レイアウト](../features/management-screen.md#設定編集画面の共通レイアウト)と[通知の共通ルール](../features/management-screen.md#通知で操作位置を動かさない共通ルール)に従う。

これはURL許可だけの変更ではなく、取得形式・共通コメントの識別・サービス固有処理を分離する追加対応である。取得アダプターの分離は[ADR 0001](../adr/0001-login-free-comment-acquisition.md)に合う。

## 次スレッド作成・AI投稿との境界

2026-10-08の追加依頼による次スレッドの調査は、[次スレッド自動作成の実現性調査](jpnkn-next-thread-2026-10-08.md)を参照する。スレッド作成・POSTを行わず、公開フォームと認証条件を確認した。以下はコメント取得から書き込み対応を推測しないための境界である。

コメント取得が可能であることから、次スレッドの自動作成・案内投稿・AIリスナー投稿まで対応可能と判断しない。現行の次スレッド初期化と進捗通知は[SourceConnections](../../src/main/sources/source-connections.ts)（47・59行）と[AppState](../../src/main/core/app-state.ts)（202行）、AI投稿は[ai-connections.ts](../../src/main/ai/ai-connections.ts)（247～253行）から、したらば専用の正規化・書き込み処理へつながっている。

取得用の振り分けを別に追加し、既存のしたらば正規化を無条件にjpnkn対応へ広げない。jpnkn接続時はしたらば用の書き込み処理・次スレッド監視を実行しない条件を設ける。書き込みへの拡張は独立した調査・採用が必要である。[したらば次スレッド仕様](../features/shitaraba-next-thread.md)、[ADR 0004](../adr/0004-limit-shitaraba-write-to-next-thread.md)

## 未確認範囲と次の検証

- 今回確認した差分は、既存DATの末尾範囲が全文と一致すること。調査中の新規投稿を実際に検出した検証ではなく、書き込みは行っていない。
- スレッド削除・レス削除・DATの縮小・終了・過去ログ移動・認証のある板・レート制限・通信断からの復帰は未確認。
- 一覧・OBS・VOICEVOX・スマホへ接続したアプリ内の動作、保存・再起動・他サービスとの同時取得は未確認。
- 長時間の安定性とサービス側の予告のない変更は、この短時間調査では判断できない。

実装を採用する場合は、現行仕様の他ドメイン拒否・コメントソース識別・掲示板接続数・書き込みの境界を先に更新する。[SPEC.md](../../SPEC.md)、[コメント取得仕様](../features/comment-acquisition.md)、[CONTEXT.md](../../CONTEXT.md)、[開発ルール](../../AGENTS.md)

その後、URL入力、Shift_JISと安全な本文変換、初回100レス、新着、レス番号と重複排除、200/206/304/416および再取得、停止・障害分離、保存互換、次スレッド・AI投稿の境界を自動テストする。実サービスの新着受信と表示・読み上げを確認し、lint・型チェック・全体テスト・buildを行う。[検証手順](../development-workflow.md#検証手順)

今回の変更は調査文書の追加のみ。HTTP実取得とローカルのデコーダー生成確認を行い、製品のlint・型チェック・全体テスト・buildは実行していない。
