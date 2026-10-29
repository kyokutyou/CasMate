# VDO.Ninja 調査: スマホ外配信を OBS に取り込む場合

調査日: 2026-09-07  
対象: きゃすメイトで、配信者がスマホのカメラ・マイクを屋外から OBS へ送りつつ、同じスマホでコメント一覧と読み上げを使う構成。

## 結論

VDO.Ninja では**ルームを作る必要はない**。単一のスマホ映像を OBS へ送るだけなら、固定したランダムなストリーム ID を使う 1 対 1 の `push` / `view` 構成が最小である。

- スマホ用（送信）: `https://vdo.ninja/?push=<stream-id>`
- OBS のブラウザソース用（受信）: `https://vdo.ninja/?view=<stream-id>`

`push` は送信者、`view` は受信者を表す公式の URL パラメータであり、同じ ID を指定する。ルームは複数参加者をまとめるための別機能である。ストリーム ID は最大 64 文字で大文字・小文字を区別し、すでに同じ ID が送信中なら後から開いた送信は失敗する。  
出典: [公式 `&push` ドキュメント](https://docs.vdo.ninja/advanced-settings/setup-parameters/push)、[公式 `&view` ドキュメント](https://docs.vdo.ninja/advanced-settings/mixer-scene-parameters/view)

したがって、きゃすメイト側がランダムな ID を一度作成・安全に保存し、送信用リンクと OBS 用リンクを生成すれば、利用者に「ルーム作成」や URL の組み立てをさせずに済む。ただし、これは現時点での**製品提案**であり、VDO.Ninja をアプリに組み込む正式仕様ではない。

## 最短の利用フロー（ルームなし）

1. きゃすメイトが推測困難なストリーム ID を生成し、送信 URL と OBS 用受信 URL を表示する。
2. 配信者はスマホで送信 URL を開き、カメラ・マイク権限を許可して開始する。
3. OBS では「ブラウザソース」に受信 URL を設定する。公式手順は、幅 1280・高さ 720 の例と、音声を扱うための「Control audio via OBS」を有効にすることを案内している。

公式には、送信用リンクを OBS に入れるとカメラ追加画面が出るので、OBS 側は `push` ではなく `view` を使うよう明記されている。  
出典: [公式 OBS 取り込みガイド](https://docs.vdo.ninja/guides/use-vdo.ninja-as-a-webcam-for-google-hangouts-zoom-and-more)、[公式トラブルシューティング](https://docs.vdo.ninja/common-errors-and-known-issues/no-video-in-obs-just-an-add-camera-button)

OBS 側では、ブラウザソースの「非表示時に停止」と「シーンが有効になったらブラウザを再読み込み」を無効にすることを公式が案内している。WebRTC の入力を、シーン切替によって意図せず停止・再接続させないためである。  
出典: [公式 OBS で WebRTC ソースを有効にするガイド](https://docs.vdo.ninja/guides/enabling-webrtc-sources-in-obs)

### 操作を減らす URL パラメータ

| 目的 | 送信 URL に加える候補 | 公式に確認できる効果 |
| --- | --- | --- |
| 開始前の選択画面を省く | `&autostart&webcam` | カメラ／音声の準備後に自動開始する。 |
| 画面共有を選べないようにする | `&webcam` | カメラ送信専用にする。 |
| 前後カメラなど既定カメラを指定 | `&videodevice=` または `&vdo=` | 既定のビデオ機器を事前選択する（`vdo` は後から変更可能）。実際の機器名・識別子は端末依存。 |
| 送信解像度・フレームレートの目標を設定 | `&quality=` | 品質プリセットを指定する。既定は公式チートシート上 720p60。 |
| 送信品質の上限を調整 | `&outboundvideobitrate=` / `&maxvideobitrate=` | 送信側の既定／上限を設定できる。受信側の `videobitrate` が既定目標を上書きし得る。 |

URL パラメータは実装前に実機（対象の Android/iPhone、回線、OBS バージョン）で検証する必要がある。とくに公式は `&videobitrate` の既定目標を約 2500 kbps とし、動きの大きい映像では引上げが必要な場合がある一方、下げると CPU・帯域・カクつきが改善する場合があるとしている。  
出典: [公式セットアップ・パラメータ一覧](https://docs.vdo.ninja/advanced-settings/setup-parameters)、[公式 `&autostart`](https://docs.vdo.ninja/advanced-settings/setup-parameters/and-autostart)、[公式ビデオ・パラメータ一覧](https://docs.vdo.ninja/advanced-settings/video-parameters)、[公式ビットレート説明](https://docs.vdo.ninja/advanced-settings/video-bitrate-parameters/bitrate)、[公式チートシート](https://docs.vdo.ninja/advanced-settings/cheat-sheet-of-basic-parameters)

## スマホでコメント・読み上げと共存させる際の制約

公式に確認できるバックグラウンド動作の案内は Android の**マイク**についてである。テスト機種（Galaxy Z Fold 6）では、アプリ履歴画面からブラウザを「Keep open」にすると、別アプリへ切り替えてもマイクを維持できるとしている。ただし公式も端末・Android バージョンにより結果が異なると明記している。再起動後は開始操作が必要である。  
出典: [公式 Android バックグラウンド・マイク ガイド](https://docs.vdo.ninja/guides/keep-mic-active-in-background-on-android-browser)

この調査で確認できた公式資料には、**カメラ映像をバックグラウンドまたは画面ロック中に継続送信できるという保証はない**。iOS についても同等の公式保証は確認できなかった。したがって、コメントと読み上げをきゃすメイト自身の画面内で表示し、VDO.Ninja の送信ページを前面に保たなくても映像送信を維持できる、と前提にして設計してはならない。実際に採用する場合は、Android／iOS 別に「画面切替・画面ロック・着信・省電力・回線切替」の実機試験を要する。

公式には Android 用のネイティブ版もあるが、これは一方向の送信専用で、リモート映像や音声の視聴はできず、機能も限定的である。Android のバックグラウンド送信を優先する「映像専用端末」には候補になる一方、同じスマホ上でコメント UI や返し音声を扱う要件への直接の解決策ではない。iOS の公式ページは、フルスクリーン時の映像フリーズ例などブラウザ制約も記載する。  
出典: [公式 Android プラットフォーム情報](https://docs.vdo.ninja/platform-specific-issues/android)、[公式ネイティブモバイル版情報](https://docs.vdo.ninja/steves-helper-apps/native-mobile-app-versions)、[公式 iOS プラットフォーム情報](https://docs.vdo.ninja/platform-specific-issues/ios)

## 接続の仕組み、屋外回線、再接続

VDO.Ninja は WebRTC を用いる。公式リポジトリは、映像接続が約 95% のケースで送信者と視聴者の直接 P2P 接続になるとしている。接続の開始には STUN と handshake（シグナリング）サーバーを使い、厳格なファイアウォールや一部の 4G/LTE 接続では TURN リレーが必要になる場合がある。公式リポジトリでは、リモート参加者のおよそ 5% が TURN を必要とするという目安を示している。  
出典: [公式リポジトリ README](https://github.com/steveseguin/vdo.ninja#server-side--api-software)

これは、スマホ→自宅 OBS の屋外運用でも「通常は直接接続できるが、携帯回線やネットワーク条件によって接続不能・品質低下が起こり得る」ことを意味する。TURN は帯域や CPU を減らさず、公式は多くの利用者には性能改善にならないため通常は避けるべきとも説明している。  
出典: [公式リポジトリ README](https://github.com/steveseguin/vdo.ninja#server-side--api-software)

公式リリースノートには再接続ロジックの改善と `&timeouts`（既定 10000 ms）の記載があるが、携帯回線の断・復帰時に「必ず無操作で復旧する」という仕様は確認できない。きゃすメイトとしては、接続状態を可視化し、送信ページ再読込・OBS ソース再読込・予備方式への切替手順を用意するのが妥当である。これは**設計上の推奨**である。  
出典: [公式リリースノート](https://github.com/steveseguin/vdo.ninja/releases)

## セキュリティとプライバシー

- 公式プライバシーポリシーは、通話コンテンツをセッション終了後に保存しないとしている。一方、P2P 接続では相手ピアに IP アドレスと基本的な端末・ネットワーク情報が見える可能性がある。VPN または TURN/SFU リレーは IP 露出を抑え得るが、性能・遅延とのトレードオフがある。  
  出典: [公式プライバシーポリシー](https://docs.vdo.ninja/help/privacy-and-security-details/vdo.ninja-privacy-policy)
- 同ポリシーは、Cloudflare がセキュリティと性能のためにクエリパラメータを含む完全な URL を記録すると明記する。`push` URL、ストリーム ID、パスワード、発行トークンを配信画面・スクリーンショット・ログへ露出させないことが必要である。  
  出典: [公式プライバシーポリシー](https://docs.vdo.ninja/help/privacy-and-security-details/vdo.ninja-privacy-policy)
- `&password` はパスワードを設定でき、公式チートシートによれば初期ハンドシェイクの暗号化とルーム名の難読化に使われる。しかし、公式のプライバシー詳細は通常の P2P がデフォルトで E2EE ではないと説明する。そのため、パスワードだけを「映像・音声の完全なエンドツーエンド暗号化保証」と説明しない。  
  出典: [公式チートシート](https://docs.vdo.ninja/advanced-settings/cheat-sheet-of-basic-parameters)、[公式プライバシー詳細](https://docs.vdo.ninja/help/privacy-and-security-details)
- `&password` を使う場合は、送信 URL と OBS 側の受信 URL の双方に設定する。公式は URL フラグメント（`#` の後）に置く利用方法と、パスワード用ハッシュ生成ツールも案内している。  
  出典: [公式 `&password` ドキュメント](https://docs.vdo.ninja/advanced-settings/setup-parameters/and-password)
- `&secure` は初回接続後に送信者を handshake サーバーから切り離すが、視聴者を 1 人に制限し、切断後の再接続もできなくなる。ライブの自動復旧を必要とする用途には通常不向きである。  
  出典: [公式 `&secure` ドキュメント](https://docs.vdo.ninja/advanced-settings/turn-and-stun-parameters/secure)

単一の OBS だけが見る私用構成では、長期固定の分かりやすい ID ではなく、配信ごとに高エントロピー ID と必要ならパスワードを発行し、OBS にだけ受信 URL を渡す方式が望ましい。これは上記の事実に基づく**推奨**である。

## 料金・ホスティング

公式リポジトリは、ホスト版 `vdo.ninja` を無料で利用でき、導入（自己ホスト）は任意としている。自己ホストは HTTPS 対応 Web サーバーにリポジトリのファイルを置くところから始められるが、独立運用したい場合は TURN、STUN、handshake サーバーも別途構成する必要がある。単に Web UI を自己ホストしても、設定を変えなければ公式の handshake/relay 基盤を使い続ける。  
出典: [公式リポジトリ README](https://github.com/steveseguin/vdo.ninja#how-to-deploy-this-repo)、[公式プライバシー詳細](https://docs.vdo.ninja/help/privacy-and-security-details)

したがって MVP は公式ホスト版を検証対象にし、屋外回線での接続成功率・遅延・消費電力・アプリ切替時の継続性を測定する。その結果、可用性またはデータ経路の管理が要件になった段階で、専用のシグナリング／TURN を含む自己ホストを比較検討するのが現実的である。これは**段階導入の提案**である。

## きゃすメイトへの適合性判断（未採用の提案）

VDO.Ninja は「スマホカメラをすぐ OBS に入れる」実証候補としては有力だが、外配信中にきゃすメイトのコメント・読み上げ画面へ切り替える要件は、モバイルブラウザの前景／バックグラウンド制約が最大の不確実性である。採否を決める前に、少なくとも次を実測する。

1. Android と iPhone の各実機で、コメント画面への切替・画面ロック・Bluetooth マイク・省電力モード時に映像と音声が継続するか。
2. 5G、4G、Wi-Fi、回線切替の各条件で、初回接続・切断検知・復旧に要する時間を測る。
3. OBS のブラウザソースで映像と音声を受信し、配信音声との二重化・エコーが起きない設定を確認する。
4. URL／トークンを UI、ログ、診断情報、画面共有に表示しない運用を確認する。

この文書は調査メモであり、正式な実装仕様ではない。
