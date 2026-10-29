# Android「きゃすメイト」UI・UX 8案の比較見本

2026-10-07作成。既存機能を前提に、画面構成・情報の優先順位・ナビゲーション・片手操作を比較する独立した見本です。8案はいずれも未採用です。選んだ方向性を次の段階で改善するための資料で、正式仕様や製品コードを変更しません。

## 開く

リポジトリのルートで次を実行します。

```powershell
node prototypes/android-eight-concepts-throwaway/preview.mjs
```

[8案の比較見本](http://127.0.0.1:5216/)を開きます。8案を同時に一覧で見比べ、各案を拡大して確認できます。番号と短い名前、特徴、使いやすさの狙いを添えています。全案で同じ架空コメント・映像・状態を使い、コメント、外配信、スマホ連携、設定の主要画面を比較します。

ブラウザーで直接開ける単一HTMLを作る場合は、次を実行します。出力先はこの見本ディレクトリ内の`index.html`です。

```powershell
node prototypes/android-eight-concepts-throwaway/preview.mjs --build
```

## 見本の範囲

実際のPC・OBS・カメラ・マイク・読み上げ・Androidサービスへ接続しません。表示内容・映像・数値は架空の例で、操作は端末内の見本状態だけを変更します。製品の登録情報、コメント、秘密、設定を読み出し・保存しません。外部のスクリプト・フォント・画像を読み込まず、プレビューはループバックだけで提供します。HTMLのCSPは外部通信を許可しません。

映像・マイクの送信、OBS本番配信、コメント読み上げは独立した操作として示します。登録や画面移動だけで開始しません。送信停止とOBS開始・終了は確認を挟みます。送信中のQR登録と経路切替は不可です。新機能は追加しません。コメントはサービス名・投稿者名・本文を表示する読み取り専用の一覧です。

正式な動作は[Androidクライアント仕様](../../docs/features/android-mobile-client.md)、[コメント一覧仕様](../../docs/features/comment-list.md)、[Android外配信仕様](../../docs/features/outdoor-streaming.md)、[スマホ連携仕様](../../docs/features/smartphone-integration.md)、[OBS操作仕様](../../docs/features/obs-control.md)が所有します。ナビゲーションや配置の提案は採用判断前の比較資料です。採用後に正式仕様を更新してから製品へ反映します。

既存の4案見本`prototypes/android-ui-throwaway/`は保持します。この見本から製品ソース・設定・依存関係へ変更を加えず、APK・インストーラー・配布用EXEは生成しません。

## 確認

```powershell
node prototypes/android-eight-concepts-throwaway/verify.mjs
node prototypes/android-eight-concepts-throwaway/verify-layout.mjs
pnpm lint:prototypes
pnpm test:prototypes
```

`verify.mjs`はローカルのJSDOMで8案×4主要画面の描画、全案共通のコメント、画面移動による状態保持、送信・OBS配信・読み上げの独立、停止確認と取消、OBS確認の10秒失効、送信中の変更制限、現在状態に合う診断、再送信時の操作状態、DOM IDの重複、スクリプトエラー、ネットワークAPIの不使用を確認します。表示の読みやすさ・タップ寸法・文字拡大・Android実機の動作はJSDOMで確認できません。ブラウザーでの画面確認とAndroid実機・OBS・実回線の確認を区別します。

見本のJSDOM確認、`pnpm lint:prototypes`（53ソース）、`pnpm test:prototypes`（7ファイル・69件）、単一HTML生成を確認済みです。`verify-layout.mjs`はこのPCのChromeとCodex同梱Playwrightを利用し、8案×4画面を320・398・736・1200pxで確認しました。横はみ出しなし、拡大画面の有効な操作領域48px以上、診断パネルの横はみ出しなし、設定画面の文字130%時の横はみ出しなし、ブラウザーのスクリプトエラーなしを確認しています。`screenshots/`に一覧と各案のコメント・外配信画面を保存し、画像でも確認しました。

製品全体の検証結果と見本の確認は別です。製品の`pnpm lint`・`pnpm typecheck`・`pnpm build`は成功。ビルド時にNuGetの脆弱性データ取得のネットワーク警告がありました。製品全体テストはサンドボックス内でElectron描画初期化により7件失敗、通常権限で同じ`pnpm test --maxWorkers=2`を実行すると1007件中1006件成功、既存のOBS登録画面テスト1件がネイティブフォーカスの検査で失敗しました。この見本への参照を持たない製品描画テストで、製品コードは変更していません。Android実機・OBS実接続・実回線の動作はこの見本で検証していません。
