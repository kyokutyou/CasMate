# OBS 32.2.2の実機検証用設定分離

調査日: 2026-10-24。対象はOBS Studio公式タグ`32.2.2`のWindows実装。調査のみ行い、OBS起動・既存設定変更・コピーは実行していない。

## 結論

既存インストールの`bin`、`data`、`obs-plugins`を新しいworkspace内`tmp`の独立ルートへコピーし、その`bin/64bit`を明示的な作業ディレクトリとして`obs64.exe --portable --only-bundled-plugins --disable-updater`で起動する方法が候補になる。設定はそのコピーの`config/obs-studio`へ分離できる。これは後述のソースからの運用上の推奨であり、この調査では起動成功を実証していない。

ただし**空設定で初回起動するだけでは入力機器へ触れないことを保証できない**。初回ソース作成を避ける試験用設定・入力ゼロのシーンを起動前に用意し、起動ログ・GetInputListで確認する必要がある。既存ユーザーのglobal.ini・user.ini・シーンはコピーしない。

## 確認した事実

| 項目 | ソースで確認できた動作 |
| --- | --- |
| `--portable`, `-p` | Windowsでは`ALLOW_PORTABLE_MODE=1`。引数解析が`portable_mode=true`を設定する。[obs-main.cpp](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/obs-main.cpp#L871-L965) |
| 設定保存先 | Windowsの`BASE_PATH`は`../..`、`CONFIG_PATH`はその`/config`。`GetAppConfigPath`・`GetAppConfigPathPtr`はportable時にこの相対パスを返し、通常時は`os_get_config_path`へ委譲する。[OBSApp.cpp](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/OBSApp.cpp#L1711-L1759) |
| 設定・シーン・プロファイルの位置 | `InitGlobalLocationDefaults`はConfiguration、SceneCollections、Profiles、PluginManagerSettingsの既定値を`GetAppConfigPath(..., nullptr)`にする。既存global.iniの明示Locationsをコピーすると既定値より優先される可能性を排除できないため、コピーしない。[OBSApp.cpp](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/OBSApp.cpp#L332-L350) |
| `OBS_USER_CONFIG_PATH` / `OBS_CONFIG_PATH` | 上記2関数の経路には環境変数参照がない。この名前による設定分離は確認できない。版の異なる記事等から対応を推測して使わない。[OBSApp.cpp](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/OBSApp.cpp#L1725-L1759) |
| `APPDATA`変更 | 通常モードのWindows実装は`SHGetFolderPathW(..., CSIDL_APPDATA, ..., SHGFP_TYPE_CURRENT, ...)`を使用し、`getenv("APPDATA")`ではない。子プロセスのAPPDATA変更のみで分離できるとは扱えない。[platform-windows.c](https://github.com/obsproject/obs-studio/blob/32.2.2/libobs/util/platform-windows.c#L377-L419) |
| 初回起動 | `CreateDefaultScene(firstStart)`はtrue時に`CreateFirstRunSources()`を呼ぶ。シーンデータのロード失敗時はuser設定`General/FirstRun`を読み、その反転を渡す。新規portableでFirstRun未設定のまま起動するのは避ける。[OBSBasic_SceneCollections.cpp](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/widgets/OBSBasic_SceneCollections.cpp#L1033-L1052)、[ロード経路](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/widgets/OBSBasic_SceneCollections.cpp#L1150-L1172) |
| Safe Mode | ヘルプは第三者プラグイン・スクリプト・WebSocketsを無効化すると記載。WebSocket実機結合確認には適さない。`--only-bundled-plugins`は付属プラグインのみの指定。[obs-main.cpp](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/obs-main.cpp#L1037-L1048) |
| インストール構成とcwd | Windowsビルドのデバッガ用cwdは`rundir/<構成>/bin/64bit`に指定される。データ探索も相対`data/obs-studio/`またはビルド設定`OBS_DATA_PATH`を使う。設定分離だけでなく資材検索を保つため、bin/64bitで起動する。[os-windows.cmake](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/cmake/os-windows.cmake#L73-L79)、[platform-windows.cpp](https://github.com/obsproject/obs-studio/blob/32.2.2/frontend/utility/platform-windows.cpp#L36-L53) |

ソース行番号はPowerShellのInvoke-WebRequestで公式raw URLを直接取得して確認した。Web抽出側には同一URLの古い行番号に見える応答があり、上記は直接取得したタグ本文の行番号を使用した。外部ソースの本文転載はしていない。

## 起動担当者への推奨手順と残る確認

1. 独立ルートにbin/data/obs-pluginsだけをコピーする。既存設定・資格情報をコピーしない。コピー先の解決済み絶対パスを確認する。
2. コピー側configに試験用global.ini・user.ini・入力ゼロのシーンを用意する。General/FirstRun=true、初期ウィザード等の扱いと現行版JSONの必須項目は実行担当者が確認する。この調査では最小設定ファイルの完全なスキーマ検証をしていない。
3. 試験専用のWebSocketポート・生成した一時パスワードを使用し、既存OBSと競合させない。既存の認証設定は流用しない。配信・録画・仮想カメラの自動開始引数は付けない。
4. 上記候補引数と明示cwdで起動し、portableログ、設定書込み先、入力ゼロ、配信/録画停止状態を確認してから結合試験へ進む。
5. 既存ユーザー設定と既存OBSプロセスには変更・終了操作を行わない。

上記の起動・設定準備は提案であり、実行権限や副作用の判断は親担当が行う。特に初回ソース作成の抑止、プラグインの起動時副作用、更新通信を含む完全な無通信・無機器アクセスはこのソース調査のみで実証していない。

## 同梱WebSocketの待受アドレス

**127.0.0.1だけへbindする正式な設定・CLIは、32.2.2同梱版で確認できない。** `--websocket_ipv4_only`はループバック制限ではなく、IPv4のAny（0.0.0.0）で待ち受ける指定になる。`server_bind_address`という推測の設定を追加しても制限されたと扱わない。

- OBS 32.2.2の[サブモジュール参照](https://github.com/obsproject/obs-studio/tree/32.2.2/plugins/obs-websocket)は`obsproject/obs-websocket`のコミット`1ef34bf48110c2a18184e50e41cd0b1a855e2147`。GitHub公式contents APIで固定SHAを確認した。
- この版の[Config.cpp:39-48](https://github.com/obsproject/obs-websocket/blob/1ef34bf48110c2a18184e50e41cd0b1a855e2147/src/Config.cpp#L39-L48)と[Load:59-129](https://github.com/obsproject/obs-websocket/blob/1ef34bf48110c2a18184e50e41cd0b1a855e2147/src/Config.cpp#L59-L129)が読む設定・引数には待受IPがない。CLIはポート、IPv4限定、パスワード、デバッグを扱う。
- [WebSocketServer::Start:103-111](https://github.com/obsproject/obs-websocket/blob/1ef34bf48110c2a18184e50e41cd0b1a855e2147/src/websocketserver/WebSocketServer.cpp#L103-L111)はIPv4限定時に`listen(tcp::v4(), port)`、通常時に`listen(port)`を呼ぶ。通常時のアドレスファミリー未対応ではIPv4へフォールバックする。特定IP endpointを渡す分岐がない。
- APIの意味はWebSocket++公式の[endpoint.hpp:433-501](https://github.com/zaphoyd/websocketpp/blob/0.8.2/websocketpp/transport/asio/endpoint.hpp#L433-L501)でも確認できる。プロトコルとポートだけのendpointを生成し、ポートだけのoverloadはIPv6（IPv4 mappedを想定）を選ぶ。特定ホストを選ぶ別overloadは存在するが、上記OBSコードは使っていない。このWebSocket++版の参照はAPI意味の補助根拠であり、インストール済みバイナリにリンクされたライブラリ版の実測ではない。

一時パスワードを付けても待受範囲は変わらない。loopbackだけの公開が実機試験の前提なら、この正式設定だけでは満たせないため、ネットワーク隔離・OSでのアクセス制限等を別途判断する必要がある。既存ファイアウォール変更やサーバー起動は本調査では実施していない。
