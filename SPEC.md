# きゃすメイト 仕様書

## プロジェクト概要

きゃすメイトは、ストリーミング配信中の配信者を支援するWindows向けローカルアプリケーションと、そのPCへLAN、Tailscaleまたは直接接続で接続するAndroidクライアントである。

現在のバージョンでは、YouTube Live、Twitch、したらば・jpnkn掲示板のコメントを一つの画面へ集約し、OBS上へコメント、コメントに反応する文字演出、配信者の認識結果、簡易キャラクターを表示する。さらに、VOICEVOXによるコメント読み上げ、LANまたは配信者自身のTailscaleプライベート接続を使うスマホへの圧縮音声配信、Androidでの画面消灯防止と画面ロック・他アプリ表示中の読み上げ、読み上げに応じた簡易キャラクターの口パクと常時微動、掲示板での次スレッド作成、端末内で動作する配信者音声認識を提供する。配信者音声認識とAndroidからの確認付きOBS配信開始・終了も提供する。追加採用したAIリスナーはv0.5.0の追加機能として扱い、それ以外のAI会話、認識結果を利用した自動処理、一般的なコメント投稿・返答へ対象を広げない。

正式な用語は [CONTEXT.md](./CONTEXT.md) を参照する。

2026-10-29、自作コード・設定・文書の公開ライセンスにAGPL-3.0-or-laterを採用した。適用範囲と許諾は [NOTICE.md](./NOTICE.md) と [LICENSE](./LICENSE)、同梱物は各機能の配布仕様に従う。

## 現在の開発対象バージョン

2026-10-15、[コメント読み上げ](./docs/features/comment-speech.md)のVOICEVOX本文受信と[スマホ音声](./docs/features/mobile-speech.md)の変換に処理期限と終了時の取消を追加採用した。期限・復旧条件は各機能仕様が所有する。

**v0.5.0**

既存v0.4.0の機能を継承し、AIリスナーとAndroid外配信の送信品質拡張を追加する。外配信の自動ビットレート制御は2026-09-30採用の再設計仕様に統一し、動く映像と早い動画復帰、数値診断、録画を求めない検証を対象とする。2026-09-30の再設計版の製品コードと同時点の必須確認を完了した。2026-10-03採用の送受信刷新は、外配信仕様のネイティブ送受信契約を現行契約とし、過去の検証とは区別する。確認済み構成・実測値・未確認範囲は[ネイティブ送受信の検証記録](./docs/validation/native-outdoor-transport-2026-10-03.md)、先行実装の結果は[2026-09-30の検証記録](./docs/validation/outdoor-adaptation-implementation-2026-09-30.md)を参照する。

2026-10-04、[PC・スマホ直接接続](./docs/features/smartphone-direct-connection.md)を同じv0.5.0へ追加採用・製品実装した。**実装済み・実機検証未完了**。自動テスト・ビルドと未確認の実ルーター・Windows権限要求・外部回線の範囲は[直接接続の検証記録](./docs/validation/smartphone-direct-connection-2026-10-04.md)に従う。既存の検証記録を直接接続の検証済みとして扱わない。

同日、[スマホ連携の接続準備の一本化](./docs/features/smartphone-integration.md#simplified-preparation)を追加採用・実装した。**実装済み・実機検証未完了**。利用者向け動作と更新・互換契約は同節、自動検証・独立レビュー・未確認範囲は[接続準備一本化の検証記録](./docs/validation/smartphone-unified-preparation-2026-10-04.md)を参照する。直接接続の既存実装・検証とは区別する。

同日、スマホ連携設定のUI/UX再構築を採用・実装した。接続・共通QR・端末一覧を主な操作とし、詳細設定は明示展開する。2026-10-05に端末ごとのOBS登録手順への入口を採用した。[PC管理画面](./docs/features/smartphone-integration.md#pc管理画面)が現行の配置と状態表示を所有する。画面の検証結果と未確認範囲は[UI再構築の検証記録](./docs/validation/smartphone-settings-ui-2026-10-05.md)を参照する。

2026-10-07、Androidの画面再構築に続き、フッターなし比較見本の1案「操作を上部に集約」を採用した。両画面のアプリ下部操作をなくし、上部タブ・機能別操作メニュー、左右フリック、初回QR登録、明示的なライト／ダーク配色は[Android画面仕様](./docs/features/android-mobile-client.md#android画面)に従う。**フッターなし配置は実装済み・自動検証とLAN実機確認済み**。通信と各サービスの契約は維持する。確認条件と未確認範囲は[今回の検証記録](./docs/validation/android-footer-free-2026-10-07.md)を参照する。

同日、コメント画面のヘッドホンから読み上げON／OFFを直接操作し、左隣の歯車から設定・状態詳細を開く変更を追加採用した。契約は[Android画面仕様](./docs/features/android-mobile-client.md#配信中の画面と設定)が所有する。**実装済み・自動検証とLAN実機確認済み**。確認条件と検証中の失敗・修正は[追加採用の検証記録](./docs/validation/android-footer-free-2026-10-07.md#ヘッドホン直接切替の追加検証)を参照する。

同日、タブ移動時のコメント表示の保持と、両画面の非操作領域全体での横フリックを採用した。配置・購読・再生成・入力の契約は[Android画面仕様](./docs/features/android-mobile-client.md#配信中の画面と設定)に従う。Android本体へ実装し、自動検証・ビルド・実機確認を完了した（[検証記録](./docs/validation/android-smooth-navigation-2026-10-07.md)）。

同日、カメラの重畳状態表示の透明化と、コメント画面と同じ位置への設定・操作アイコンの配置を追加採用した。契約は[Android画面仕様](./docs/features/android-mobile-client.md#配信中の画面と設定)が所有する。**Android本体へ実装済み・自動検証とLAN実機確認済み**（[検証記録](./docs/validation/android-camera-transparent-2026-10-07.md)）。

同日、Android全体の選択ボタンと無効な操作の視認性改善を採用し、Android本体へ実装した。表示・入力条件は[初回起動と配色](./docs/features/android-mobile-client.md#初回起動と配色)が所有する。両配色の自動描画検証・全体テスト・ビルドと、実機での選択表示・操作禁止の確認を完了した。

同日、スマホ連携の説明短縮見本の1案「必要な情報だけ」を採用し、Android本体へ実装した。表示・詳細展開・エラー・操作条件は[スマホ連携の登録画面](./docs/features/android-mobile-client.md#スマホ連携の登録画面)が所有する。両配色・文字拡大の自動検証と実機確認、全体テスト・ビルドを完了した。

同日、横向き出力でプレビューが回転する不具合の修正を採用した。縦横比と画像回転を分離し、[映像の向きと描画](./docs/features/outdoor-streaming.md#映像の向きと描画)が条件と検証を所有する。Android本体へ実装し、自動描画・全体テスト・ビルドとLAN実機確認を完了した。実物の端末回転など未確認の範囲は[検証記録](./docs/validation/android-camera-orientation-2026-10-07.md)を参照する。

同日、操作可能なOFFスイッチが無効に見える配色の修正を採用した。操作可能／禁止とON／OFFの表示は[初回起動と配色](./docs/features/android-mobile-client.md#初回起動と配色)に従い、弱回線対策の固定モード時は灰色の無効表示を使う。追加修正で無効表示の緑味を除去し、操作可能時との区別を明確にした。Android本体へ実装し、両配色の描画と実機での自動ON／OFF・固定時と送信中の操作禁止、全体テスト・ビルドを確認した。

- 対象OS: Windows 11、Android 10以降
- UI言語: 日本語
- 配布形態: Windows用インストーラー、手動配布する署名済みAndroid APK

## 実装対象機能

2026-10-27、PC全画面調査の優先度「低」の表現整理を採用する。重複説明の集約と操作名の明確化は、管理画面・初回設定および各機能の所有仕様に従う。設定値、送信条件、削除の確認条件は変更しない。

2026-10-27、設定一覧の「AIリスナーの人格」ショートカット欄を削除する。入口の配置は[管理画面](./docs/features/management-screen.md#設定への入口と連携状態)に従う。

2026-10-26、PC全画面調査の優先度「中」の改善を採用する。各機能仕様の画面説明・初回設定・操作案内を更新し、保存・送信・本人確認の条件は各所有仕様に従う。

2026-10-26、PC画面調査の優先度「高」の改善を採用する。コメント一覧の接続・空状態は[コメント一覧](./docs/features/comment-list.md#空状態)、テスト送信の明示と色編集は[文字演出の管理画面](./docs/features/text-effects.md#管理画面)、追加先シーンと候補の表示は[OBSソース登録](./docs/features/obs-source-registration.md#画面と操作)が所有する。

2026-10-25、「配信準備」の独立画面を廃止し、ホーム・配信中・設定の3ページとする。画面・案内の整理と既存機能の維持は[管理画面](./docs/features/management-screen.md#配信準備画面の廃止)に従う。

2026-10-25、ホーム最下部の補助リンクを設定へ集約する。配置と移動は[管理画面](./docs/features/management-screen.md#設定への入口と連携状態)、保存先の操作は[アプリ設定](./docs/features/local-application.md#アプリ設定の管理画面)に従う。

2026-10-24、初回設定のスマホ連携に3手順の見本を採用する。上部の用途・前提準備の要約と、不足時だけの設定入口、接続準備・登録・利用確認の配置は[初回設定](./docs/features/initial-setup.md#案内と確認)に従う。

2026-10-24、複数LANアダプターのPCでスマホ用LANを選択する。初回設定とスマホ連携設定で共通の選択を使い、保存・消失・接続先の統一は[スマホ連携仕様](./docs/features/smartphone-integration.md#lan-adapter-selection)に従う。

2026-10-24、VOICEVOXの自動探索を標準場所とWindowsのインストール情報へ拡張し、起動確認後の場所を保存する。初回設定の準備操作は[コメント読み上げ](./docs/features/comment-speech.md#voicevox-engine)と[初回設定](./docs/features/initial-setup.md#案内と確認)に従う。

2026-10-21、はじめての設定のAIリスナー・文字演出・キャラクターにも比較見本のA案「手順と確認を並べる」を採用する。4手順と保存済み状態・説明用プレビュー、利用開始・送信・実表示の区別は[初回設定](./docs/features/initial-setup.md#案内と確認)に従う。

2026-10-21、はじめての設定のスマホ連携・配信者音声認識に比較見本のA案「手順と確認を並べる」を追加採用する。4手順の操作、実状態・結果との分離、既存契約の維持は[初回設定](./docs/features/initial-setup.md#案内と確認)に従う。

2026-10-21、はじめての設定に比較見本のC案「設定と確認を並べる」と、入口・確認結果のC案「選択と確認を並べる」を採用する。ようこそ・機能選択・確認結果、およびコメント接続・読み上げ・OBS表示を中心とした配置・操作案内と確認の分離は[初回設定](./docs/features/initial-setup.md#案内と確認)に従う。

2026-10-20、AIリスナーに見本「よく使う設定をすっきり」と、評価後の「不足している設定と次の操作を示す」改善見本を採用する。目的別タブ、状態別の案内・操作、狭い画面と説明の整理は[AIリスナーの管理画面](./docs/features/ai-listener.md#管理画面)に従う。

2026-10-20、掲示板の次スレッド作成に見本「設定と確認を並べる」を採用し、状態欄は追加見本「2行にまとめる」を採用する。配置・説明・詳細展開は[次スレッド作成の管理画面](./docs/features/shitaraba-next-thread.md#管理画面)に従う。

2026-10-20、コメントフィルターに見本「設定とテストを並べる」を採用する。説明短縮とルールの詳細展開、常設の判定テストは[コメントフィルターの管理画面](./docs/features/comment-filter.md#管理画面)に従う。

2026-10-20、アプリ設定に見本「外観を選びやすく」を採用する。配色の画面見本、文字サイズの横並び、接続設定の折り畳みと更新案内は[アプリ設定の管理画面](./docs/features/local-application.md#アプリ設定の管理画面)に従う。

2026-10-20、スマホ連携の説明整理見本「接続とスマホを整理」を採用する。同日、下部は「一覧で操作する」のコンパクト見本を採用する。接続カードの順序、常設の読み上げ案内、登録済みスマホのカードと下部の設定一覧は[スマホ連携のPC管理画面](./docs/features/smartphone-integration.md#pc管理画面)に従う。

2026-10-20、「OBSに追加」ダイアログに説明整理の見本を採用する。対象を含む単一見出し、状態とソース情報の集約、未接続時の主操作、折りたたみの詳細と手動コピーは[OBSソース登録の画面と操作](./docs/features/obs-source-registration.md#画面と操作)に従う。

2026-10-20、旧「OBS用URL」の画面名を「OBSにソースを追加」とし、実装確認後の見直しで「用途別カード」を採用する。4種類を見渡せるカードの用途・URL・操作と、下部の補助手順は[OBSソース追加の管理画面](./docs/features/local-application.md#obs用urlの管理画面)に従う。

2026-10-20、PCのOBS操作画面に比較見本の1案「ステータス中心」を採用した。上部の稼働状態、音声・Androidの操作許可、折りたたみ式の詳細設定と初回設定時の表示は[OBS操作の管理画面](./docs/features/obs-control.md#管理画面)に従う。

2026-10-19、OBSコメント表示・OBS音声認識表示の「文字と背景」を削除し、「デザインを編集」から単一の別ウィンドウで外観を編集する方針を採用した。編集・プレビュー・保存と移行は[OBSデザイン編集](./docs/features/obs-style-editor.md#アプリ内のobsデザイン編集)、窓管理と管理APIは[ローカルアプリケーション](./docs/features/local-application.md#obsデザイン編集ウィンドウ)が所有する。独立HTMLの着せ替えツールは引き続き提供する。

同日、コメント・音声認識で名前を統一した10種類のプリセットと、小さな見本付きカードによる選択を採用した。定義と操作は[共通プリセット](./docs/features/obs-style-editor.md#共通プリセットと選択カード)が所有する。

同日、名前入力なしで現在のデザインを残し、保存した見本から呼び出す機能を採用した。操作は[保存したデザイン](./docs/features/obs-style-editor.md#保存したデザイン)、永続化・管理API・公開制限は[OBSデザイン編集ウィンドウ](./docs/features/local-application.md#obsデザイン編集ウィンドウ)が所有する。

同日、アプリ内OBSデザイン編集の右側を「調整」「プリセット」「保存済み」に分け、保存操作を常設する方針を採用した。同日の追加改善として、調整タブの見本に合わせた分類と2列配置を採用した（[調整タブの配置](./docs/features/obs-style-editor.md#調整タブの配置)）。配置・状態保持・操作は[編集パネルの3タブ](./docs/features/obs-style-editor.md#編集パネルの3タブ)が所有する。

2026-10-18、既存機能の改善として[コメント取得](./docs/features/comment-acquisition.md)の保存中の別接続操作による巻き戻り防止とTwitchの再接続指示への対応、および[コメント一覧](./docs/features/comment-list.md)の変更のない行の本文再処理削減を採用した。部分保存の共通契約は[設定保存](./docs/features/local-application.md#設定保存)に従う。

同日、全正式対象の調査から、[コメント読み上げ](./docs/features/comment-speech.md)、[配信者音声認識](./docs/features/streamer-speech-recognition.md)、[OBSコメント表示](./docs/features/comment-overlay.md)、[OBS音声認識表示](./docs/features/speech-recognition-overlay.md)、[文字演出](./docs/features/text-effects.md)、[ローカルアプリケーション](./docs/features/local-application.md)の安定性と共通状態処理の性能改善を採用した。契約は各所有仕様、調査範囲・候補判断・比較と未確認範囲は[全正式対象の調査・改善記録](./docs/validation/whole-product-improvement-2026-10-18.md)を参照する。

2026-10-17、直接接続の終了時の削除開始を優先し、探索の共通期限・UPnPの照会整理・Windows規則操作の負荷と故障時の待ちを改善することを採用した。条件は[直接接続のライフサイクル](./docs/features/smartphone-direct-connection.md#公開と待受のライフサイクル)と同仕様のWindows受信許可に従う。

2026-10-17、直接接続のWindows受信規則を初回UACで導入する専用サービスへ分離し、通常のON／OFFでUACを要求しない方式を採用した。初回・更新・故障・閉鎖・削除の契約は[直接接続仕様](./docs/features/smartphone-direct-connection.md#windowsファイアウォールと閉鎖)、判断は[ADR 0029](./docs/adr/0029-direct-firewall-service.md)が所有する。

2026-10-16、PC管理画面のマウスによる戻る・進むと、ホーム下部から設定保存先を開く操作を追加採用した。移動履歴は[管理画面](./docs/features/management-screen.md#navigation-state)、保存先を開く管理操作は[ローカルアプリケーション](./docs/features/local-application.md#設定保存)が所有する。
2026-10-16、PC管理画面に、選んだ機能を順に設定・確認する[初回設定](./docs/features/initial-setup.md)を追加採用した。新規利用時の案内、中断再開、確認記録と管理専用の進行保存は同仕様が所有する。

2026-10-16、PCのスマホ連携に、表示中の経路と接続準備ONの経路を区別する簡略版を採用した。同日の見直しで表示印の文字を削除し、色付きカードを採用した。選択表示と、経路が異なる場合の既存状態欄からの移動は[スマホ連携のPC管理画面](./docs/features/smartphone-integration.md#pc管理画面)に従う。

2026-10-16、配信者音声認識のプレビュー付近での稼働状態表示、開始時に使う適用済み入力の明示、モデル準備と復旧操作の整理を採用した。同日の再評価で、固定領域と重複説明の圧縮、障害理由を先に示す表示と復旧先への移動、配信への利用設定と認識の稼働表示の分離を追加採用した。プレビューの入力確認用の移動ボタンは同日の見直しで削除する。配置・状態別の案内・操作位置の保持は[配信者音声認識の管理画面](./docs/features/streamer-speech-recognition.md#管理画面)に従う。

2026-10-15、PC管理画面の配信準備で「今回確認する項目」を選ぶ改善を採用した（2026-10-25に独立画面を廃止）。現在の構成は[配信準備画面の廃止](./docs/features/management-screen.md#配信準備画面の廃止)に従う。

2026-10-15、PC管理画面の個別設定の説明枠を、用途を伝える短い1文に統一する改善を採用した。共通の構成は[設定編集画面の共通レイアウト](./docs/features/management-screen.md#設定編集画面の共通レイアウト)、説明文言と操作に必要な補足は各機能仕様に従う。

2026-10-15、PC管理画面の「配信中」に、操作見本A案「操作を上部に集約」を採用した。操作順と接続・コメント・詳細の配置は[配信中の画面](./docs/features/management-screen.md#配信中)に従う。同画面の読み返し中の新着件数表示と、接続数を「○件接続中」で示す改善も採用する。

2026-10-15、AIリスナーの[長さと文体](./docs/features/ai-listener.md#短文と話し方の生成指示)、[返答対象と明示的な見送り](./docs/features/ai-listener.md#返答対象と明示的な見送り)の改善を採用した。既存の投稿条件・上限を用い、生成機会ごとに1回のAPI要求で判断する。

2026-10-15、[AIリスナーの共有記憶](./docs/features/ai-listener.md#共有記憶)の保存待ちを最新状態へ集約する改善を採用した。保存完了・削除・失敗時の契約は同仕様が所有する。

2026-10-15、[AIリスナーのAPI使用量表示](./docs/features/ai-listener.md#api使用量)を追加採用した。集計範囲・欠測・管理専用公開は同仕様が所有する。

2026-10-15、PC音声の停止・プレイヤー故障時の復旧、コメント取得の応答期限と段階的な再試行、AIリスナーの発話中の投稿抑止と処理段階表示の改善を採用した。詳細は[コメント読み上げ](./docs/features/comment-speech.md#音声合成とpc再生)、[コメント取得](./docs/features/comment-acquisition.md#再接続と障害分離)、[AIリスナー](./docs/features/ai-listener.md#対象コメントと発話)の所有仕様に従う。実装・検証結果は今回の完了報告で区別する。

2026-10-14、PC管理画面の設定一覧を6分類へ再編することを採用した。分類・配置は[設定の分類一覧と編集先](./docs/features/management-screen.md#設定の分類一覧と編集先)に従う。

2026-10-14、送信開始直後の正常なマイク確認待ちを入力喪失の警告から区別する修正を採用した。表示条件は[送信・配信ダイアログ](./docs/features/android-mobile-client.md#send-broadcast-dialog)に従う。

2026-10-14、「送信・配信」の操作見本の2案「すっきり区切り」を採用した。スマホの送信とOBS配信を上下の区画に整理し、各状態と操作を近づける。同日、警告入口と接続未確認の表示、ダイアログの終了操作の整理を追加採用した。配置・表示・検証条件は[送信・配信ダイアログ](./docs/features/android-mobile-client.md#send-broadcast-dialog)が所有する。**追加整理を含め本体反映済み・自動検証とAndroid 12の停止状態・合成状態で実機確認済み**。実送信・読み上げ中の継続は未確認とし、2案採用時はPC・OBS停止中、追加整理では停止状態の実メニューと合成状態を確認した。

2026-10-14、スマホからOBSの本番シーンを静止画で確認する機能を追加採用・実装した。「送信・配信」から開き、以後は手動更新する。全接続経路と既存OBS操作許可を共用する。詳細は[OBS映像確認仕様](./docs/features/obs-program-preview.md)を参照する。**実装済み・LANの実OBSとAndroidで基本操作・復旧・送信との同時利用を確認、他経路は未検証**。実機の条件と残る未確認範囲は[実OBS・Android検証記録](./docs/validation/obs-program-preview-real-device-2026-10-14.md)、自動検証・実機UIの条件と全体Androidテストの未完了範囲は[実装・検証記録](./docs/validation/obs-program-preview-2026-10-14.md)を参照する。

2026-10-13、送信中のAndroidプレビューへの手書きとSRT映像への合成を採用・実装した。画面・編集・静止中の反映待ち・寿命は[Android手書き映像合成仕様](./docs/features/android-handwriting-overlay.md)に従う。採用判断は[ADR 0028](./docs/adr/0028-android-handwriting-overlay.md)、自動検証・LAN実機とOBS受信の確認条件・未確認範囲は[検証記録](./docs/validation/android-handwriting-overlay-2026-10-13.md)を参照する。

2026-10-14、操作見本のスマホ確認後に、ヘッダーなし・重畳道具列・2本指による表示操作・全体／中央拡大の交互切替・直接全消去を採用・実装した。配置と入力は[Android手書き映像合成仕様](./docs/features/android-handwriting-overlay.md#手書きモード)が所有する。実機・実GL・LAN／OBSの確認条件と制約は[再設計検証記録](./docs/validation/android-handwriting-redesign-2026-10-14.md)を参照する。

2026-10-13、Androidの完了済み登録更新案内を確認後に再表示しない変更を採用した。確認済みの保存、詳細の再閲覧、新しい案内と障害時の扱いは[スマホ連携の登録画面](./docs/features/android-mobile-client.md#スマホ連携の登録画面)に従う。

2026-10-13、Androidのスマホ連携をスマホ形のアイコンへ変更し、「送信・配信」の入口をヘッダーだけに統一することを採用した。現行配置は[Android画面仕様](./docs/features/android-mobile-client.md#映像マイクの分類と送信配信の入口2026-10-12追加採用)に従う。

2026-10-13、AndroidのQR登録失敗時に、停止した段階と対処を示す案内を追加採用した。直接接続のWi-Fi利用時の条件付き案内を含む表示契約は[スマホ連携の登録画面](./docs/features/android-mobile-client.md#スマホ連携の登録画面)が所有する。

2026-10-12、Androidカメラ画面の「映像・マイク」の分類一覧と、スマホ連携の左に置く「送信・配信」の直接入口を採用した。配置・分類・既存操作の保持は[Android画面仕様](./docs/features/android-mobile-client.md#映像マイクの分類と送信配信の入口2026-10-12追加採用)が所有する。**Android本体へ実装済み・両配色と文字2倍の自動描画、Android 12の実機UIと送信開始後の画面移動を確認済み**。読み上げとの同時継続とOBSの実受信は今回未確認とする。

2026-10-11、PC管理画面の8配色プリセットと独立した「アプリ設定」を追加採用した。既定はオーシャンとする。配置・適用範囲・配色は[管理画面の配色](./docs/features/management-screen.md#pc管理画面の配色)、保存は[アプリ設定](./docs/features/local-application.md#アプリ設定の管理画面)が所有する。

同日、オーシャンのホーム見本に合わせた視認性改善と、管理画面の文字サイズ「小・中・大」を採用した。標準は「中」。表示は[文字サイズ](./docs/features/management-screen.md#pc管理画面の文字サイズ)、保存は上記のアプリ設定仕様に従う。

2026-10-08、[端末共通のOBS入力](./docs/features/smartphone-integration.md#device-shared-obs-input)を追加採用した。同じ登録端末はLAN・Tailscale・直接接続で1つのOBSメディアソースを共用し、入力準備後はOFFでも登録・コピーできる。台帳の保持移行と一度だけの新規OBS登録を行う。**実装・自動検証済み、実端末とOBSでの映像・音声確認は未実施**。判断は[ADR 0026](./docs/adr/0026-device-shared-obs-input.md)に従う。

2026-10-08、PC管理画面の「接続の詳細設定」に比較見本の3案「接続経路図」を採用・実装した。配置・編集・状態表示は[接続の詳細設定](./docs/features/smartphone-integration.md#接続の詳細設定)、確認結果と未確認範囲は[検証記録](./docs/validation/connection-details-route-ui-2026-10-08.md)を参照する。

Android外配信では複数Androidの映像・配信マイクをLAN、Tailscaleまたは直接接続でPCの端末別ワーカーへSRT送信し、再エンコードせずOBSのループバックUDPソースへ転送する。Android画面は通常の状態と実送信速度、プレビューの診断要約、明示操作で開く診断パネルに整理する。配置・操作は[Android画面仕様](./docs/features/android-mobile-client.md#android画面)に従う。

スマホ関連は[スマホ連携仕様](./docs/features/smartphone-integration.md)に従い、家庭内LAN・外配信Tailscale・直接接続を排他的に選んで準備する。接続準備の一本化と登録情報の更新は同仕様の追加採用範囲とする。共通QRによる複数端末の登録も同仕様を参照する。2026-10-04に過去の互換処理を整理する方針を採用した。対応版管理と旧保存の退避は[保存の共通契約](./docs/features/local-application.md#compatibility-baseline)、登録の基準は[スマホ連携](./docs/features/smartphone-integration.md#compatibility-reset)に従う。仕様採用と実装・実機検証の完了は区別する。

| 機能 | 概要 | 詳細仕様 |
| --- | --- | --- |
| PC・スマホ間の通信 | コメント・音声と認証付き制御を2本の接続で管理する | [通信仕様](./docs/features/smartphone-transport.md) |
| スマホ連携 | ネットワーク別の共通準備画面、排他的公開、複数端末、ネットワーク別登録を提供する | [スマホ連携仕様](./docs/features/smartphone-integration.md) |
| PC・スマホ直接接続 | Android共通QRで映像・マイク、コメント・読み上げ、OBS操作を提供する。公開IPv4／IPv6、自動・手動開放、PC本人確認と復旧限界を定める（実装済み・実機検証未完了） | [直接接続仕様](./docs/features/smartphone-direct-connection.md) |
| OBS操作 | 配信者音声認識とAndroidから、確認付きでOBS配信を開始・終了する | [OBS操作仕様](./docs/features/obs-control.md) |
| OBS映像確認 | AndroidからOBSの本番シーンを静止画で取得・手動更新する | [OBS映像確認仕様](./docs/features/obs-program-preview.md) |
| OBSソース登録 | 「最短で追加」の共通画面からOBSで編集中のシーンへ4つの表示と端末共通メディアを追加・共有し、登録設定を確認する。約5秒の表示テストは4つのブラウザ表示だけを対象とする | [OBSソース登録仕様](./docs/features/obs-source-registration.md) |
| Android外配信 | 統一登録、映像・マイク送信とOBS配信の個別操作、ネイティブSRT送受信とOBSへのローカル転送、品質・マイク・カメラ調整に加え、固定／自動ビットレート、H.265、弱回線対策による低画質動画・必要時の静止・早期の動画復帰、映像故障の分離、数値履歴と明示書き出し、任意の映像時刻表示を対象とする | [Android外配信仕様](./docs/features/outdoor-streaming.md) |
| コメント取得 | YouTube Live、Twitch、したらば・jpnknからログイン不要で通常コメントを取得し、共通形式へ変換する | [コメント取得仕様](./docs/features/comment-acquisition.md) |
| コメントフィルター | NGワードまたは複数行アスキーアートに該当するコメントを全ての表示と読み上げから除外する | [コメントフィルター仕様](./docs/features/comment-filter.md) |
| 掲示板次スレッド作成 | 指定したレス番号で次スレッドを作成し、案内、成功読み上げ、接続先切替を行う | [したらば次スレッド作成仕様](./docs/features/shitaraba-next-thread.md) |
| OBSコメント表示 | 半透明の付箋スタイルを標準に、OBSブラウザソースへ積み上げまたは1件ずつの形式でコメントを表示する | [OBSコメント表示仕様](./docs/features/comment-overlay.md) |
| コメント文字演出 | 新着コメントの反応ワードに応じてOBSへ文字を降らせ、A案の一覧中心の編集画面でルールを調整する | [コメント文字演出仕様](./docs/features/text-effects.md) |
| 簡易キャラクター表示 | 閉口・口開きの静止PNGを、音量連動口パクと同期する常時微動付きで表示する | [簡易キャラクター表示仕様](./docs/features/simple-character-display.md) |
| ローカルアプリケーション | Electron製デスクトップアプリ、Web UI、ローカルバックエンド、設定保存、PC状態の取得・管理専用API、ウィンドウ寸法の管理を提供する | [ローカルアプリケーション仕様](./docs/features/local-application.md) |
| 管理画面 | スタジオボードのホーム・配信中・カテゴリカードの設定を提供し、既存操作、開いた場所への復帰、実測PC状態を維持する | [管理画面仕様](./docs/features/management-screen.md) |
| 初回設定 | 使いたい機能を選び、必要な準備・入力・確認を順に案内し、中断後も再開できる | [初回設定仕様](./docs/features/initial-setup.md) |
| コメント一覧 | 取得したコメントをアプリ内の独立ウィンドウと通常ブラウザで時系列表示する | [コメント一覧仕様](./docs/features/comment-list.md) |
| コメント読み上げ | VOICEVOXで新着コメントを読み上げ、OBSの1件表示時は表示とPC音声を同期する | [コメント読み上げ仕様](./docs/features/comment-speech.md) |
| スマホでコメントを聞く | 選択したスマホ接続経路へ、同じ読み上げ音声をAAC-LC・M4A・モノラルで配信する。直接接続はAndroid共通QR専用 | [「スマホでコメントを聞く」仕様](./docs/features/mobile-speech.md) |
| Androidクライアント | カメラ／コメント画面、初回QR登録、左右フリックと配色選択を提供し、既存WebViewとネイティブ音声サービスによる読み上げを維持する | [Androidクライアント仕様](./docs/features/android-mobile-client.md) |
| Android手書き映像合成 | 送信中の拡大・移動できるプレビューに手書きし、SRT映像へ合成する。静止中の手元編集と復帰成功後の反映を提供する | [Android手書き映像合成仕様](./docs/features/android-handwriting-overlay.md) |
| 配信者音声認識 | PCマイクまたは受信したスマホ音声をPC内で認識し、共通QR登録済みスマホから「配信に使う」のON/OFFと入力を操作する | [配信者音声認識仕様](./docs/features/streamer-speech-recognition.md) |
| OBS音声認識表示 | 配信者音声認識の確定結果を専用の外観と固定秒数でOBSへ表示し、専用設定画面で調整する | [OBS音声認識表示仕様](./docs/features/speech-recognition-overlay.md) |
| OBSデザイン編集・着せ替えツール | アプリの別ウィンドウでコメント・音声認識の外観を編集・保存する。独立HTML版ではOBS用CSSを作成する | [OBSデザイン編集・着せ替えツール仕様](./docs/features/obs-style-editor.md) |

## v0.5.0で追加する機能

| 機能 | 概要 | 詳細仕様 |
| --- | --- | --- |
| AIリスナー | OBS配信中に投稿上限付きで人格付きAIがコメントし、会話・指定OBSソースの画像・共有記憶・発言ログと、投稿しないGemini APIテストを扱う | [AIリスナー仕様](./docs/features/ai-listener.md) |

AIリスナーの採用判断は [決定記録](./docs/planning/ai-listener-open-decisions.md) で確認できる。導入作業と実サービスでの動作確認は [初回設定手順](./docs/guides/ai-listener-setup.md) を参照する。

## 仕様の位置付け

OBS側でコメント・音声認識の外観を調整する利用資料は[カスタムCSSテンプレートと編集ガイド](./docs/guides/obs-custom-css.md)を参照する。アプリ内のCSS入力・保存機能とクラス名の固定公開契約は追加しない。

- Android画面の再構築: [カメラとコメントの機能別画面を採用する](./docs/adr/0024-adopt-android-camera-comments-ui.md)

- OBSソース登録の採用判断: [PC管理画面からきゃすメイト用OBSソースを登録する](./docs/adr/0023-adopt-obs-source-registration.md)

- 互換性の基準と次回の整理: [契約ごとの対応範囲を管理する](./docs/adr/0022-reset-compatibility-baseline.md)


- スマホ連携の接続準備と登録更新の追加判断: [スマホ連携の接続準備を一本化する](./docs/adr/0021-unify-smartphone-connection-preparation.md)

- 直接接続の追加判断と既存公開禁止の適用境界: [PC・スマホ直接接続を採用する](./docs/adr/0020-adopt-smartphone-direct-connection.md)

- 現行の通信設計: [スマホの通信管理をネイティブへ集約する](./docs/adr/0019-consolidate-smartphone-transports.md)

- 重要な設計判断: [ネットワーク別のスマホ連携と複数端末を採用する](./docs/adr/0017-network-based-multi-device-smartphone-integration.md)

- 重要な設計判断: [管理画面をホームと設定に分離する](./docs/adr/0014-adopt-home-and-settings-management-ui.md)

- 重要な設計判断: [PCに集約した認証付きOBS操作と共用QRを採用する](./docs/adr/0012-adopt-authenticated-obs-control.md)

- 現行の送受信設計: [ネイティブSRTとPCローカル受信を採用する](./docs/adr/0018-native-srt-and-local-receiver.md)
- 先行判断: [Android外配信でSRTによるOBS直接受信を採用する](./docs/adr/0011-use-srt-direct-to-obs.md)（受信構成はADR 0018で更新）

- 重要な設計判断: [外配信の自動制御を動画継続・早期復帰優先で再設計する](./docs/adr/0016-redesign-outdoor-adaptation.md)
- 外配信の先行判断: [現在画像静止と送信品質拡張の採用](./docs/adr/0015-adopt-audio-first-outdoor-adaptation.md)（自動制御の優先順位・検証方針はADR 0016で更新）

現在の正式な実装対象は、本書と上記の機能別仕様書で定める。新たに重要な未定義挙動が判明した場合は、推測で実装せず仕様更新を先に行う。機能別仕様書間で必要となる仕様は複製せず、仕様を所有する文書を参照する。

- 重要な設計判断: [AIリスナーの投稿と共有記憶を採用する](./docs/adr/0013-adopt-ai-listener.md)

- 今回実装しない項目: [OUT_OF_SCOPE.md](./OUT_OF_SCOPE.md)
- 将来候補であり正式仕様ではない項目: [FUTURE_IDEAS.md](./FUTURE_IDEAS.md)
- 重要な設計判断: [ログイン不要のコメント取得を採用する](./docs/adr/0001-login-free-comment-acquisition.md)
- 重要な設計判断: [VOICEVOXとローカル音声変換を採用する](./docs/adr/0002-local-speech-pipeline.md)
- 重要な設計判断: [認証なしの読取専用LAN公開を限定採用する](./docs/adr/0003-unauthenticated-read-only-lan.md)
- 重要な設計判断: [したらばへの外部書き込みを次スレッド作成に限定する](./docs/adr/0004-limit-shitaraba-write-to-next-thread.md)
- 重要な設計判断: [したらば次スレッドは作成済み記録を永続化せず掲示板の同名タイトルを確認する](./docs/adr/0005-use-board-title-check-for-shitaraba-next-thread.md)
- 重要な設計判断: [配信者音声認識を独立した.NETワーカーへ分離する](./docs/adr/0006-isolate-speech-recognition-in-dotnet-worker.md)
- 重要な設計判断: [ReazonSpeech学習済みParakeet CTCを固定音声認識モデルにする](./docs/adr/0008-use-parakeet-ctc-as-fixed-speech-recognition-model.md)
- 外配信入力とスマホ操作: [受信済みスマホ音声の認識と専用操作資格を採用する](./docs/adr/0025-adopt-outdoor-speech-recognition.md)
- 重要な設計判断: [スマホ音声再生のインターネット経路にTailscaleプライベート接続を採用する](./docs/adr/0009-use-tailscale-private-network-for-mobile-speech.md)
- 重要な設計判断: [WebViewとネイティブ音声サービスを分離したAndroidクライアントを採用する](./docs/adr/0010-adopt-native-android-client.md)

2026-10-08、jpnknのコメント取得・次スレッド作成・AI投稿を採用した。既存掲示板枠をURLで切り替える。詳細は各機能仕様、判断は[ADR 0027](./docs/adr/0027-adopt-jpnkn-board.md)を参照する。実装・検証の完了は採用と区別する。
