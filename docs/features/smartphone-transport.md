# PC・スマホ間の通信仕様

2026-10-14、制御版3へ[OBS映像確認の追加通信契約](./obs-program-preview.md#追加通信契約)を追加採用した。任意のhello対応機能情報、認証付き撮影要求、画像バイナリ断片を既存の制御接続で扱う。読取接続・登録・保存版と通常の要求／JSON上限は維持する。

## 所有範囲

2026-10-03採用。2026-10-04に直接接続を追加採用し、追加部分は**実装済み・実機検証未完了**。コメント・音声・OBS操作・外配信状態の接続、購読、世代、再接続、フレーミングと通信入口の用途別認証を所有する。登録は[スマホ連携](./smartphone-integration.md)、公開・開放・PC鍵・通信保護は[直接接続](./smartphone-direct-connection.md)、表示と音声生成は[スマホ音声](./mobile-speech.md)、操作の意味と確認は[OBS操作](./obs-control.md)、SRTと受信証拠は[外配信](./outdoor-streaming.md)、端末のライフサイクルは[Android](./android-mobile-client.md)を参照する。

## 音声認識を追加する制御版3

2026-10-08、[ADR 0025](../adr/0025-adopt-outdoor-speech-recognition.md)を採用する。操作の意味は[配信者音声認識仕様](./streamer-speech-recognition.md#外配信入力とスマホ操作2026-10-08追加採用)が所有する。

- 制御Upgradeと登録POSTで`X-CasMate-Control-Version: 3`を明示した場合に版3を選択する。無指定は版2を維持し、未知版を拒否する。版2のOBS・映像・登録更新は引き続き利用でき、版2へ認識の操作・状態・資格を混入させない。読取プロトコル版2と招待版11／13は変更しない。
- 版3では更新資格に加え、認識用途の`X-CasMate-Speech: Bearer <token>`を個別に検証する。提示された用途資格はすべて同じ端末・経路でなければならない。認識資格だけではOBS・映像・読取・登録更新を許可しない。直接接続のTLS・PC確認鍵・Host・Origin検証を省略しない。
- `control.hello.protocolVersion`は選択版を返す。版3の`control.subscribe`は既存項目に`speechRecognition: boolean`を加える。認識未購読時は同状態を送らない。状態・結果には同じconnectionIdとgenerationを付け、別接続・古い購読世代を反映しない。
- `speechRecognition.state`は`revision / enabled / inputSource / microphoneId / smartphoneDeviceId / inputs / status / message`だけを返す。非選択側IDはnullとする。inputsは`id / name / inputSource / microphoneId / smartphoneDeviceId / available`の一覧で、PCの既定マイクを含む。同じ設定revisionでも稼働状態の更新は受理し、同じ接続世代の古い設定revisionは捨てる。
- コマンドは`speechRecognition.setEnabled {enabled}`、`speechRecognition.selectInput {revision,inputSource,microphoneId? ,smartphoneDeviceId?}`、`speechRecognition.retry {}`。`control.result`の成功payloadは現在の最小状態。競合は409と`SPEECH_SETTINGS_CONFLICT`、現在の状態イベントも再通知する。切断・応答消失時の変更を自動再送しない。
- 新Androidは版3を要求し、旧PCの版2 helloも受理して既存機能を利用する。認識資格が未取得なら登録更新だけを購読し、新登録を保護保存した後に認識資格を付けて再接続する。機能が未対応・資格未取得という理由で4403の永久失効へ変換せず「PC更新待ち」を示す。既存有効資格の明示的失効処理は維持する。
- 認識用の3本目の接続や認識専用HTTP公開面を増やさない。既存の最小状態購読だけで操作する。

## 接続と復旧

### 制御版2の登録情報購読

- `/smartphone/ws`のUpgrade時、有効な`X-CasMate-Registration: Bearer <token>`を必須とする。対応制御版の選択は上記の追加契約に従う。欠落・空・重複・不正・失効ヘッダーは拒否する。登録形式はスマホ連携仕様が所有する。
- 版2の`control.subscribe`は既存のobs/outdoor/generationに`registration: boolean`を追加する。更新資格は登録購読だけに使い、OBS操作・映像報告には用途別資格が別途必要。複数資格は同じ端末・経路に一致しなければならない。旧版への降格を行わない。
- 登録購読直後と情報変更時に、既存のconnectionId/generationで`registration.state`を送り、payloadは新版の登録全体とする。変更がない場合は再送しない。JSON通知は32768バイト以下、登録本体は16384バイト以下。受信要求の8192バイト上限は維持する。
- 現在の更新資格を定期検証し、失効を既存接続へ反映する。OFF・一時的準備不可は失効とは別で、通常の再接続対象とする。保存待ち・通知処理は世代確認し、他端末・OBS操作を待たせない。
- 版2のUpgradeで現在の更新資格は有効だが接続準備が不可なら503、更新資格自体が無効なら403と`X-CasMate-Registration-State: revoked`を返す。Host等の入口検証だけによる403は失効確定ではない。既存接続も一時停止は1012、更新資格の失効は4403とする。Androidは版2の明示失効だけを保存し、通常403・PC鍵確認失敗を永久失効へ変換しない。
- Androidは保存されたcontrol.protocolVersionでhelloを検証し、画面・音声・映像の利用中に既存の制御接続を共用して登録を購読する。最後の利用者が離れれば閉じ、常時3本目の接続・HTTPポーリングを追加しない。
- 直接接続の更新は同じPC鍵で検証した登録済みTCP経路から取得する。新候補も形式・用途・PC/端末/経路を検証して保存する。鍵は自動更新しない。更新経路を全部失った場合はQR再登録が必要で、正常なSRTだけが残っても新情報取得を保証しない。

登録の自動更新は制御版2／3で提供する。共通する接続・復旧条件は以下に従う。

- 映像・配信マイクのネイティブSRTを維持する。コメントとM4Aは読取専用の `/mobile/ws`、OBS操作と映像状態は登録ポート（既定3001）の認証付き `/smartphone/ws` に分ける。LAN／Tailscaleでは画面・静的ファイル・bootstrap・登録に既存HTTP／WSを使用し、直接接続では専用TCPのHTTPS／WSSを使用する。2本の購読と用途の分離は全経路で維持する。旧音声取得・OBS操作・映像状態・受信確認のHTTP APIとOBS専用3002待受を廃止する。
- Androidのネイティブ接続管理が各接続を一つだけ所有する。表示・音声サービス・外配信・OBS操作は必要な購読を貸借する。最後の利用者が離れた接続は閉じる。音声だけの背景動作にはコメント履歴を送らない。
- ハートビートは2秒、応答喪失の判定は4秒以内。再試行は0.5、1、2秒、以後最大2秒。ネットワーク利用可能通知で前倒しできる。認証・版不一致は更新または明示操作を待ち、旧通信へフォールバックしない。
- 接続世代と各購読世代を照合し、古い接続の応答・音声・確認を破棄する。復帰時にコメント履歴を再同期し、音声は新しい購読以後の項目だけを再生する。OBS操作を自動再送しない。制御の切断だけで正常なSRTを停止しない。
- 接続ごとの送信量・受信本文・待ちキューを制限する。遅いクライアントは切断して再同期させ、他端末やPC機能を待たせない。履歴は分割して送り、新着と音声を優先する。
- 直接接続の各通信は保存済みの同一PC・同一端末profileの候補から独立に選び、IPv6優先・IPv4代替と健全な接続維持は直接接続仕様に従う。TCPとSRTが異なるfamilyを使っても資格・端末を混在させない。各候補の接続試行に期限を設け、失敗したIPv6でIPv4の試行を無期限に妨げない。未登録候補・別経路へ自動切替しない。候補喪失時のQR再登録と復旧限界も同仕様に従う。

## 読取専用プロトコル版2

- `GET /mobile/bootstrap` は `protocolVersion: 2, mobilePublished, audioAvailable` だけを返す。履歴は含めず、通常の接続はWebSocketのhelloから始める。
- サーバーは `mobile.hello` のpayloadに同じメタデータを、共通エンベロープに接続ごとの乱数 `connectionId` を返す。クライアントは `mobile.subscribe` に `protocolVersion: 2, topic: comments|audio, generation, enabled` を送る。generationは正の32ビット整数で、同じtopicの変更ごとに増加する。サーバー通知にはconnectionIdと該当topicのgenerationを付ける。
- コメント購読時は `mobile.snapshotBegin`（revision、表示設定、取得稼働状態）、`mobile.snapshotChunk`（最大100件）、`mobile.snapshotEnd` を送る。履歴上限は10,000件。受信中の新着・削除を保留し、snapshotのrevisionより新しい差分を適用して一致させる。表示設定・取得状態も同じ世代で順序を保つ。
- コメントの公開項目と不透明ID、表示設定の限定、Host検証、管理面非公開は従来のスマホ音声仕様に従う。読取接続へOBS状態・認証・映像状態を出さない。
- 音声購読の結果は `mobile.subscription`、利用可否は `mobile.audioAvailabilityChanged`。`mobile.audioReady` のpayloadは `audioId, commentId, byteLength, expiresInMs`。audioIdは18バイト乱数の24文字base64url。音声は最大8MiB、16KiB以下の分割データとする。
- 各バイナリメッセージは36バイトのヘッダー（先頭32ビットbig endian `0x434d4132`、購読generation、バイトoffset、24バイトASCII audioId）とM4Aデータ。別世代、未知ID、重複・欠落offset、サイズ超過は破棄する。ディスク保存・Base64化・HTTP取得を行わない。
- クライアントは `mobile.audioStarted / mobile.audioEnded / mobile.audioError` にgenerationとaudioIdを返す。期限・上限で撤回した先読みは `mobile.audioDiscard` で削除する。再生中1件と先読み1件だけを端末メモリに保持する。
- ハートビート `ping / pong` はnonceを往復する。未知のイベントは無視し、不正な必須値は拒否する。版不一致は4406で切断する。

## 認証付き制御プロトコル版2

- LAN／Tailscaleは選択ネットワークの検証済みIPv4へbindし、正しいHost・ローカルアドレス・接続元範囲を検証する。直接接続は以下の専用HTTPS／WSS境界に従う。制御接続では全経路でOrigin付き要求を拒否し、資格情報をURLへ入れない。
- Upgrade時の `X-CasMate-Obs` と `X-CasMate-Outdoor` は各用途のBearerトークン。更新資格に加えて提示された用途別資格を個別に検証する。登録購読だけなら用途資格は不要。両方ある場合は同一端末・選択ネットワークでなければ拒否する。映像資格だけでOBS操作を許可しない。利用中も失効・設定変更を検証する。
- `control.hello` のpayloadは `protocolVersion: 2`、共通エンベロープにconnectionIdを持つ。`control.subscribe` は `protocolVersion: 2, generation, obs, outdoor, registration`。権限があるtopicだけ購読できる。通知と応答にはconnectionIdとgenerationを付ける。
- `obs.state` はOBS状態の変化で送る。Android操作の許可がオフならconnectionをdisabledとして操作不可にする。`obs.prepare / obs.confirm / obs.cancel` は既存の操作本文をpayloadに持ち、要求ごとの `id` に `control.result`（statusとpayload、またはcode/message）を一度返す。操作requestIdによる重複排除と状態確認はOBS仕様を維持する。確認期限は10秒。
- `outdoor.report` は既存の状態本文を変化時に送る。`outdoor.feedbackSubscribe` はsessionIdとgenerationをpayloadに持ち、同じ映像世代の `outdoor.feedback` を最大250ms間隔で送る。SRT受信証拠の有効期限1秒は延長しない。状態送信がなくても接続と購読が健全ならPC側の端末接続状態を維持する。
- メッセージ本文は8KiB以下。操作応答の期限5秒、確認後の切断は結果不明。操作受付を配信成功とみなさず、OBSの実状態で確定する。接続断では確認を取り消す。資格無効は4403、版不一致は4406。共通のping/pongを用いる。

<a id="direct-secure-transport"></a>

## 直接接続のHTTPS／WSSと用途別認証

PC鍵確認と共通ネイティブ取得、TLS・公開候補・Windows許可は[直接接続仕様](./smartphone-direct-connection.md#通信保護と外部入口)、資格の発行・保存・形式は[直接接続登録](./smartphone-integration.md#直接接続の招待版9と登録応答版10)が所有する。本節は各入口が受け付ける権限を所有する。

| 専用入口 | 必須認証・許可 |
| --- | --- |
| `POST /smartphone/enroll` | 直接接続の招待Bearer。端末登録だけ。本文・応答はスマホ連携仕様に従う |
| `GET /comments`、`GET /mobile/bootstrap`、コメント表示に必要な静的資産 | `X-CasMate-Read`の用途別Bearer。登録済み端末の読取だけ |
| `WSS /mobile/ws` | Upgrade時に同じ読取Bearer。既存の読取専用プロトコル版2だけ |
| `WSS /smartphone/ws` | 更新資格は`X-CasMate-Registration`で必須。版選択は追加契約に従い、OBS・映像・認識には用途別ヘッダーを個別に検証 |

- 外部専用サーバーは表のメソッド・パスと実際に必要な資産の許可リストだけを提供する。`embedded=android`は表示用で権限を追加しない。静的資産のディレクトリ全体・パストラバーサル・管理ビルド・OBS素材は公開しない。匿名bootstrap、Cookie・URL・JavaScript経由の資格、CORSを使う通常ブラウザ登録は提供しない。
- コメント専用の独立ビルド`dist/direct-mobile`だけを使い、一般管理画面のbundleを混在させない。コメント画像は実際に取得したコメントの許可CDNだけをPCが必要最小限のHTTPSで取得し、認証付き`/mobile/assets/<不透明ID>`へ射影する。任意URL・リダイレクト・Cookie・資格の外部転送を許さず、DNSの全候補と実接続先の公開範囲を確認する。取得は5秒・512KiB、メモリーキャッシュは4MiB、登録URLは2048件に制限し、ディスクへ残さない。
- Hostは現在許可している公開候補の数値アドレスと公開TCPポートに限定する。IPv4 NATのローカル受信先と公開Hostを別に検証し、IPv6の角括弧を正規化する。接続先のローカルアドレス・PC側ポートも選択インターフェースの所有待受と一致させる。公開接続元にLAN／Tailscaleのprivate範囲制約を流用せず、TLS・用途別資格で認証する。Origin付き要求はすべての直接接続入口で拒否する。
- 読取トークンは制御Upgradeで、制御トークンは読取資産・読取Upgradeで、招待は登録以外で使えない。用途が複数ある要求はすべて個別に検証し、同一端末・directへの一致を必要とする。余分な用途の資格で権限を昇格させない。
- 設定OFF・端末削除・秘密再発行で対象購読・HTTP資産取得を終了する。設定OFFは資格失効とは区別する。他端末・他用途の健全な通信は維持する。no-storeを登録、HTML、bootstrap、認証付き資産へ適用し、秘密をキャッシュ・アクセスログへ記録しない。
- HTTP取得中とWSSの失効を250ms間隔で確認し、非同期HTML・画像取得の応答前にも再確認する。証明書更新は同じPC鍵を検証して既存TLS待受へ反映し、正常なWSSを終了させない。
- HTTP本文・登録・制御の上限を認証前にも適用する。TLSハンドシェイク・未認証接続・認証再試行には待機期限と接続元別・全体の上限を設け、上限超過を局所拒否する。未認証接続の大量発生で既存の認証済み購読・SRT・PC管理を待たせない。
- TLS・資格未提示の各待機は5秒、未認証枠は接続元別8・全体64、TLS接続とWSSは全体128とする。認証失敗20回／60秒を局所拒否し、失敗の一時記録は最大1024接続元に限定する。認証済み接続は未認証枠を消費せず、停止時にはTLS未完了の生TCP接続も終了する。

## 検証

- 旧版3db6728と新方式の同条件で、要求数・転送量・描画/再生開始の戻り応答時間・再接続時間を比較する。LANで各30標本以上、p95目標はコメント/OBS反映500ms以下、音声準備完了から再生開始750ms以下、復帰5秒以下。音声合成時間を除外し、端末間の時計差を使わない。測定値と未測定範囲を区別する。
- 履歴大量送信、連続音声、待ち15秒、停止、半開き、PC再起動、ネットワーク変更、旧世代、権限失効、複数端末、確認応答喪失を検証する。Androidの画面ロック・背景・長時間待機、通常ブラウザ、LAN/Tailscaleを確認する。OBS開始終了は隔離したローカル試験出力を用い、本番配信を開始しない。
- 直接接続では新たにTLS／鍵確認、認証付きHTML・全資産、Hostの公開／内部区別、IPv4／IPv6候補ごとの接続と片系統故障、用途違い・招待の権限違反、失効中の資産取得、未認証接続の制限を検証する。LAN／Tailscaleの通信版・無認証読取・通常ブラウザの回帰も維持する。実装完了条件は[直接接続の受け入れ条件](./smartphone-direct-connection.md#受け入れ条件と実装段階の検証)を参照する。
