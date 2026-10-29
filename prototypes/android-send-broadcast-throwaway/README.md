# Android「送信・配信」の操作見本（throwaway）

スマホの映像・マイク送信とOBS配信の状態・操作を、同じダイアログ内で見分けられるかを確認するための見本。2026-10-14、利用者が2案「すっきり区切り」を採用した。現行の配置・表示・検証条件は[Android画面仕様](../../docs/features/android-mobile-client.md#send-broadcast-dialog)が所有する。本体実装と検証の完了はこの比較資料とは区別する。

- **区画カード**：機能ごとのカードに状態、送信速度・マイク、主操作をまとめる。初期表示はこの案。
- **すっきり区切り**：枠を減らし、見出し近くに状態を置いて区切り線で整理する。

どちらも停止確認、OBS開始・終了の確認、状態詳細、OBS映像確認を操作できる。すべて架空のローカル状態で、実際のカメラ・マイク・SRT・OBS・登録・設定保存へ接続しない。製品ビルドにも組み込まない。

会話内の見本では調整パネルから配色、端末幅、文字倍率、送信・OBSの障害状態を切り替えられる。ブラウザー単独表示では調整パネルを使わず、画面内のボタンと下部の案切替を操作できる。

起動（リポジトリルート）：

```powershell
node prototypes/android-send-broadcast-throwaway/preview.mjs
```

<http://127.0.0.1:5216/> を開く。`--build` を付けると表示用HTMLの生成だけを行う。生成先はGit除外済みの `tmp/android-send-broadcast-prototype-build/`。

表示用ラッパーの生成には、この環境のvisualizeプラグインと同梱Pythonを使う。別環境では `CASMATE_VISUALIZE_RENDERER` と `CASMATE_PYTHON` にそれぞれの絶対パスを指定できる。

## 検証

```powershell
pnpm lint:prototypes
pnpm test:prototypes
node prototypes/android-send-broadcast-throwaway/preview.mjs --build
node prototypes/android-send-broadcast-throwaway/preview.mjs --verify
```

`verify-layout.mjs` は生成したHTMLと検証結果ディレクトリーを絶対パスで受け取るElectron用の検証スクリプト。Electronの作業ディレクトリーを検証専用の一時ディレクトリーにし、両案・320/360/400幅・ライト/ダーク・文字1/1.5/2倍、状態変化での操作位置、確認・取消・送信と配信の独立性を検証する。

これはブラウザーでの配置と操作の見本であり、Android本体や実サービスの動作確認には使わない。
