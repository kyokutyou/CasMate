# `gemini-2.5-flash-lite` が利用できない原因の調査

調査日: 2026-09-14  
対象: きゃすメイトのAIリスナーで、同じGemini APIキーを使うと `gemini-3.1-flash-lite` は成功するが `gemini-2.5-flash-lite` はHTTP 404になる事象  
位置付け: この文書は調査メモであり、正式仕様や実装変更を指示するものではない。

## 結論

今回の症状は、Google側がGemini 2.5系への新規利用を制限しているために、利用中のAPIキーに紐づくプロジェクトで `gemini-2.5-flash-lite` が利用可能モデルとして公開されていない可能性が最も高い。Google AI Developers ForumのGoogle側回答（2026-07-22）は、2.5系へのアクセスを過去に利用したユーザーに限定し、新規プロジェクトには `gemini-3.1-flash-lite` または `gemini-3.5-flash` を使うよう案内している。[Google側の案内](https://discuss.ai.google.dev/t/gemini-2-5-flash-deprecated-without-warning-earlier-than-shutdown-date/174217/27)

これはモデル全体の廃止や、CasMateのモデル名の誤りとは別の状態である。公式モデルページはStable IDを `gemini-2.5-flash-lite` と掲載しており、公式廃止表でもこのStableモデルの停止日は未発表である。一方、同名のPreview版 `gemini-2.5-flash-lite-preview-09-2025` は停止済みである。[Gemini 2.5 Flash-Lite公式モデルページ](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite) [公式廃止表](https://ai.google.dev/gemini-api/docs/deprecations)

## 確認できた事実

### 利用者側で観測されたA/B結果

- 同じAPIキー、同じアプリ、同じ投稿先で `gemini-3.1-flash-lite` は生成・投稿・読み上げまで成功した。
- `gemini-2.5-flash-lite` に戻すとHTTP 404になり、投稿前にAIリスナーが停止した。

この結果から、APIキーの形式、認証ヘッダー、Geminiへの基本的なリクエスト、したらばの投稿経路全体が常に壊れている可能性は低い。モデル単位またはプロジェクト単位の利用可否と整合する。

### CasMateの呼び出し

CasMateは次の形式で呼び出している。

- `POST https://generativelanguage.googleapis.com/v1beta/models/{設定モデル}:generateContent`
- `x-goog-api-key` ヘッダーでAPIキーを送る
- 設定値のモデル名を別名へ変換せず、URLエンコードして使用する

この形式は公式のGenerateContent APIのエンドポイント形式と一致する。[GenerateContent API](https://ai.google.dev/api/generate-content)

モデル名の既定値は初回実装時から `gemini-2.5-flash-lite` で、入力検証による置換もない。[AIリスナー設定](../../src/shared/ai-listener.ts) [Gemini接続処理](../../src/main/ai/ai-connections.ts)

### CasMateの404表示

現在の実装は、Geminiから返る詳細な404本文を保存せず、HTTPステータスだけを次の共通表示へ変換する。

> 指定モデルを利用できません。モデル名と提供状況を確認してください。自動で別モデルへ切り替えません。

そのため、画面や既存のプロンプトログだけから「モデルの全体廃止」「プロジェクト単位のアクセス制限」「そのAPIメソッド非対応」を区別することはできない。404は利用枠超過を示すものでもない。通常の利用制限はHTTP 429、サービス過負荷はHTTP 503として扱われる。[Geminiトラブルシューティング](https://ai.google.dev/gemini-api/docs/troubleshooting)

## 最も確度の高い原因

利用中のAPIキーが紐づくプロジェクトが、2.5系を過去に利用した実績のない新規プロジェクトであるため、Google側の新規利用制限により `gemini-2.5-flash-lite` がそのプロジェクトの利用可能モデル一覧から外れていると推定する。無料料金表に2.5 Flash-Liteが掲載されていても、無料プランには一部モデルへの限定アクセスがあるため、料金表示だけでは個別プロジェクトでの利用を保証しない。[Gemini API料金表](https://ai.google.dev/gemini-api/docs/pricing)

これはGoogle側の案内と、同じキーで3.1だけが成功するという観測に基づく推定である。Googleのモデル一覧APIで対象キーを直接確認すれば、プロジェクト単位の利用可否を確定できる。

## 確定確認方法

APIキーをこのアプリや第三者へ貼り付けず、同じキーを使って公式のModels APIを呼ぶ。

```text
GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000
```

公式Models APIは、そのキーで利用できるモデルを返し、各モデルの `supportedGenerationMethods` で `generateContent` 対応を確認できる。[Models API](https://ai.google.dev/api/models)

- `models/gemini-2.5-flash-lite` が一覧にない: 今回のプロジェクトでは2.5が公開されていない。Google側の新規利用制限またはプロジェクトの利用条件が原因と確定できる。
- 一覧にあり、`supportedGenerationMethods` に `generateContent` がない: そのAPIメソッドでは利用できない。
- 一覧にあり、`generateContent` もある: モデルアクセス以外の一時障害、キーの制限、リクエスト内容を追加調査する。CasMateのA/B結果からは可能性は低い。

## 実用上の判断

現在の環境では、動作確認済みのStable `gemini-3.1-flash-lite` を使えばよい。Googleの廃止表では `gemini-3.1-flash-lite` の停止予定は2027-05-07で、後継として `gemini-3.5-flash-lite` が案内されている。[3.1 Flash-Lite公式モデルページ](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) [公式廃止表](https://ai.google.dev/gemini-api/docs/deprecations)

課金設定へ変更すれば2.5の利用制限が必ず解除される、という公式保証は確認できなかった。既存仕様の「自動切替なし」は維持し、2.5を設定したまま使えない場合は、利用可能モデル一覧の確認を案内するのが安全である。

## 今後の実装修正候補（未実施）

次回の実装候補として、設定画面に「モデルを確認」を追加し、同じAPIキーでModels APIを取得して、モデルの存在と `generateContent` 対応を表示すると、今回のような汎用404だけでは原因を判断できない問題を解消できる。これは本調査時点では提案であり、今回の調査に伴うコード変更は行っていない。
