# PNGキャラクターモーション方式調査

調査日: 2026-08-31  
対象: きゃすメイトの閉口素材・口開き素材を、OBSキャラクタービュー、管理画面内プレビュー、独立キャラクターウィンドウで「動いているように見せる」方式。これは採用判断用の調査メモであり、正式仕様ではない。

## 結論

第一候補は、**現在の閉口・口開き画像を包む共通要素へCSSキーフレームアニメーションを設定し、全身を小さく上下移動・拡縮・回転させる方式**である。

現行実装は、閉口・口開きの2枚を同じ位置へ重ね、口形状態に応じて不透明度だけを切り替えている（[CharacterImage.tsx](../../src/renderer/components/CharacterImage.tsx)）。両画像ではなく外側の `.character-layers` を動かせば、口パク用の位置一致を保ったまま、OBS、管理画面、独立ウィンドウへ同じ動きを適用できる。

CSS Animationsは、キーフレーム間で `transform` などのCSSプロパティを時間変化させられる。[W3C: CSS Animations Level 1](https://www.w3.org/TR/css-animations-1/)、[W3C: CSS Transforms Level 1](https://www.w3.org/TR/css-transforms-1/) 基本的なアニメーションはJavaScriptなしで記述でき、ブラウザー側が非表示時の更新頻度などを最適化できる。[MDN: CSS animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using)

この方式は**一枚絵を変形させるだけ**なので、髪、腕、目などを別々には動かせない。しかし「軽い呼吸」「重心の揺れ」「わずかな浮き沈み」には十分で、現在のReact/Electron構成に描画ライブラリを追加しなくてよい。

## 現在の仕様・実装との関係

確認できた事実:

- 現在の正式仕様は、閉口素材と口開き素材を全キャラクター表示面で同期し、両方をマウントしたまま不透明度で切り替える（[簡易キャラクター表示仕様](../features/simple-character-display.md)）。
- `OUT_OF_SCOPE.md` が除外しているのは、待機・反応・表情など口形以外の**画像切替**、Live2D、VRM、3Dモデルである。単一素材の位置・拡縮・回転は明記されていない（[OUT_OF_SCOPE.md](../../OUT_OF_SCOPE.md)）。
- 現在の `.character-layers` は表示領域いっぱいを使い、その中の2画像へ同じ `object-fit: contain` を適用している（[styles.css](../../src/renderer/styles.css)）。
- Electronの透明なBrowserWindowは公式に対応するが、Windowsでは枠なしウィンドウが前提で、透明ウィンドウにはプラットフォーム上の制約がある。[Electron: Custom Window Styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)

この調査後、モーションの挙動・固定値・停止条件・テスト条件は [簡易キャラクター表示仕様](../features/simple-character-display.md) に正式採用された。

## 推奨する見せ方

以下は検証済み仕様ではなく、最初の実機調整値である。

1. **呼吸**: 約3.2～4.0秒で、足元を基準に高さを100%から101～101.5%へゆっくり往復する。
2. **重心の揺れ**: 約4.5～6.0秒で、左右へ0.3～0.7度だけ回転する。
3. **浮き沈み**: 約2.8～4.0秒で、上下へ画像高の0.2～0.5%だけ移動する。
4. 三つを同じ周期・同じ折り返しにせず、わずかに周期をずらして機械的な反復感を弱める。
5. `transform-origin` は足元に近い `50% 90%` 前後から調整する。`transform-origin` は変形の基準点を指定するCSSプロパティである。[MDN: transform-origin](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-origin)

画像を拡大・移動すると表示領域の端で切れる可能性がある。初期値はごく小さくし、OBSブラウザソースと独立ウィンドウの上下左右に安全余白がない素材でも実機確認する。

### 構造案

```text
モーション用ラッパー（上下・拡縮・回転）
└─ 現在の character-layers（口パク用）
   ├─ 閉口画像（opacity 0/1）
   └─ 口開き画像（opacity 0/1）
```

モーションを口形ごとの画像へ別々に設定しない。外側の一つのラッパーへ設定することで、両素材の位置とアニメーション位相を常に一致させる。

## 方式比較

| 方式 | 必要素材 | 得意な表現 | 現行構成への影響 | 判定 |
| --- | --- | --- | --- | --- |
| CSSキーフレーム + `transform` | 現在の1～2枚 | 呼吸、揺れ、上下動 | 小さい。既存DOMとCSSを拡張 | **第一候補** |
| Web Animations API | 現在の1～2枚 | 状態に応じた開始・停止・速度変更 | 小～中。React側の制御が増える | 動的制御が必要になった段階 |
| APNG / アニメWebP / GIF | 描き込み済みの複数フレーム | 瞬き、髪揺れ、全身動作 | 素材制作と再生・位相検証が必要 | 素材側で作る第二候補 |
| `requestAnimationFrame` | 現在の1～2枚 | 毎フレーム計算する不規則運動 | 中。時刻差分、停止、後始末が必要 | 初期実装には不要 |
| Canvas / PixiJS | 1枚、複数パーツ、スプライト等 | 多数の部品、マスク、フィルター、複雑な2D演出 | 大きい。描画方式を置換・併設 | 将来の高度表現向け |
| スプライトシート | 複数フレームをまとめた画像とフレーム情報 | 手描きの瞬き、身振り | 素材形式、検証、設定、再生管理を追加 | 別機能として検討 |
| Live2D Cubism | 分割PSDから作るモデル一式 | 部位変形、表情、物理演算 | 非常に大きい。SDK・制作工程・ライセンス対応 | 現在の対象外 |
| Spine | パーツ素材とSpineモデル | ボーン式2Dアニメーション | 非常に大きい。ランタイムと制作工程を追加 | 現在の対象外 |

### Web Animations API

Web Animations APIは、CSS Animationsと同じアニメーションモデルをスクリプトから扱い、再生、停止、シーク、速度変更、完了待機などを行える。[W3C: Web Animations](https://www.w3.org/TR/web-animations-1/)

将来、「読み上げ中だけ揺れを強くする」「設定画面で速度を変える」「全表示面を共通の時刻へ合わせる」といった動的制御が正式要件になれば候補になる。常時の待機モーションだけならCSSの方が状態管理とテスト範囲が小さい。

### `requestAnimationFrame`

`requestAnimationFrame` は次回再描画前にコールバックを実行する一回限りのAPIで、継続には毎回再登録が必要である。また高リフレッシュレート画面で速度が変わらないよう、渡された時刻を使って進行量を計算する必要がある。[MDN: requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)

ランダムな揺れや物理計算を毎フレーム行う場合には向くが、周期的な呼吸と揺れだけに使う利点は小さい。

### APNG / アニメWebP / GIF

APNGはPNGファイル内に複数のフレームを格納する形式であり、一枚の静止画から動きを自動生成するものではない。[W3C: Portable Network Graphics (PNG) Specification, Third Edition](https://www.w3.org/TR/png-3/)

素材制作者が瞬き、髪揺れ、身振りを描けるなら、CSSによる全体変形より自然な動きを一つの画像ファイルへ持たせられる。現仕様はアニメーションWebPとGIFの維持を明記しているが、APNGのアニメーション維持は明記していないため、正式対応には素材検証、閉口・口開き素材間の再生位相、各表示面での実機テストを追加する必要がある。

### Canvas / PixiJS

PixiJSは、PNGをテクスチャとして読み込むSprite、位置・回転・拡縮を持つシーングラフ、マスクやフィルターを提供する。[PixiJS: Sprite](https://pixijs.com/8.x/guides/components/scene-objects/sprite)、[PixiJS: Scene Objects](https://pixijs.com/8.x/guides/components/scene-objects) ライセンスはMITである。[PixiJS LICENSE](https://github.com/pixijs/pixijs/blob/dev/LICENSE)

多数の画像パーツやパーティクルを同時に扱う段階では有力だが、現在の画像2枚を数px動かすためだけに導入すると、Reactの`img`表示、画像読込失敗時のフォールバック、GIF/WebPアニメーション維持、OBS透明表示の検証範囲が広がる。

### Live2Dは「PNG一枚を入れるだけ」ではない

Live2D Cubismの組み込みモデルは `.moc3`、`.model3.json`、PNGテクスチャ、必要に応じて物理設定やモーションデータを組み合わせる。公式資料でも、モデル作業用データ、SDK用モデル、テクスチャ、物理、モーションを別のファイル種別としている。[Live2D: File Types and Extensions](https://docs.live2d.com/en/cubism-editor-manual/file-type-and-extension/)

また、Cubism Editorへモデル素材として読み込む元データはレイヤー分けされたPSDが前提である。[Live2D: Notes on PSD creation](https://docs.live2d.com/en/cubism-editor-manual/precautions-for-psd-data/) 既存の完成PNG一枚をそのまま渡して、髪・目・口などが自動的に独立して動く方式ではない。

### Spineのライセンス注意

Spine Runtimeを製品へ組み込む場合、公式ランタイムライセンスはSpine Editorライセンスとの関係や再配布条件を定めている。[Spine Runtimes License Agreement](https://esotericsoftware.com/licenses/Spine-Runtimes-License-Agreement.pdf) 現在の小さなモーションのために採用する合理性はなく、将来検討時は制作環境と配布条件を改めて確認する。

## 同期・停止・アクセシビリティ

### 表示面間の同期

CSSアニメーションだけでは、各表示面を開いた時点から独立して再生が始まるため、OBS、管理画面、独立ウィンドウの**フレーム位相までは一致しない**。現在の仕様が同期対象としているのは素材、口形状態、設定リビジョンであり、待機モーションの位相ではない。

第一段階では、全表示面に同じキーフレームと固定値を使い、位相の完全一致は要求しないことを推奨する。完全同期が必要になった場合だけ、共通の時刻基準からWeb Animations APIの再生位置を設定する。毎フレームの位置をWebSocket配信する必要はない。

### 非表示時

Electron公式は、非表示・最小化中の高価な処理を停止して消費電力を抑えることを推奨している。[Electron: BrowserWindow / Page visibility](https://www.electronjs.org/docs/latest/api/browser-window/#page-visibility) CSSだけの小さなモーションではブラウザー側の最適化を利用できるが、将来JavaScriptやCanvasへ移る場合は `document.visibilityState` を使った停止を仕様化する。

### 動きを減らす設定

OSの「視覚効果を減らす」設定は `prefers-reduced-motion` で検出できる。[MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion) 管理画面内プレビューでは尊重する価値がある。一方、OBS出力は配信演出として意図的に動かしたい場合があるため、OS設定だけでOBSの動きを止めるか、アプリ設定を優先するかは正式仕様で決める。

## 推奨する段階的な進め方

### 第1段階: 仕様化と小さな実証

- [簡易キャラクター表示仕様](../features/simple-character-display.md) を正式な所有文書とし、「常時モーション」の挙動を追加する。
- 既存の閉口・口開き画像の外側へモーション用ラッパーを一つ追加する。
- まず呼吸とごく小さな揺れだけを固定値で実装し、利用者設定は増やさない。
- PNG、静止WebP、GIF、アニメーションWebP、口開き素材あり・なしで確認する。
- OBS、管理画面、独立ウィンドウで、透明背景、位置一致、口パク、表示端の欠け、CPU/GPU負荷を実機確認する。

### 第2段階: 必要な場合だけ設定を追加

- 「モーションを使う」のオン・オフだけを候補にする。
- 速度・振幅・回転量の細かなスライダーは、固定値で不都合が確認されるまで追加しない。
- 読み上げ中の強調や一時停止が必要なら、CSSクラス切替またはWeb Animations APIを比較する。

### 第3段階: 素材自体を高度化する場合

- 瞬きやポーズ切替は、複数の全身画像またはスプライトシートを扱う別仕様にする。
- 髪・目・腕を独立して動かす要件が固まった場合に、分割パーツ + Canvas/PixiJS、Live2D、Spineを制作コスト・配布条件込みで再調査する。
- Live2D、VRM、3Dモデルは現行 `OUT_OF_SCOPE.md` から正式採用されるまで実装しない。

## 採用判断

- **一枚絵を生きているように見せる第一歩として、CSSキーフレームによる全身の微動を採用候補にする。**
- **現在の口パクDOMを内側に保ち、外側ラッパーだけを動かす。**
- **初期版にPixiJS、Canvas、Live2D、Spineを導入しない。** 表現力より実装・検証範囲の増加が大きい。
- **位相の完全同期や細かな利用者設定を初期要件にしない。** 同じ動き方が各表示面で再現されれば十分とする。
- 実装へ進む前に、モーションのオン・オフ、OSの動きを減らす設定とOBSの関係、固定する振幅・周期を正式仕様で決める。
