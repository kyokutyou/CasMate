# HTTP公開中のスマホ画面消灯防止方式調査

調査日: 2026-08-31

対象: Tailscale IPv4の `http://100.x.y.z:{port}/comments` で表示するスマホコメント画面において、Android版Chromeの自動消灯を防止する方法。

この文書は採用判断用の調査メモであり、正式仕様ではない。

## 結論

短期検証では、Android版Chromeの `chrome://flags/#unsafely-treat-insecure-origin-as-secure` に現在のTailscale HTTPオリジンを登録し、スマホコメント画面から Screen Wake Lock API を要求する方式が最小変更で成立する可能性が高い。

これは通信をHTTPS化しない。Chrome内で指定したHTTPオリジンだけを安全なオリジンとして扱う開発・検証用の例外設定である。Pixelごとの手動設定が必要で、Chromeの実験フラグであるため正式機能として長期保証はできない。

正式機能として提供する場合の第一候補はTailscale Serveである。ServeはループバックHTTPサーバーをtailnet内限定のHTTPS URLへ中継し、有効なTLS証明書を自動取得できる。ただし現行きゃすメイトのTailscale公開契約とHost検証はServeのFQDNを受理しないため、仕様と実装の変更が必要になる。

## 確認した事実

### Screen Wake Lock APIの条件

- Screen Wake Lock APIは画面の減光・消灯・ロックを防止できるが、安全なコンテキストでのみ利用できる。[MDN Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- Chromeでは画面が非表示になるとロックが自動解除される。再び表示されたときは `visibilitychange` を受けて再取得する必要がある。[Chrome Developers: Stay awake with the Screen Wake Lock API](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock)
- ブラウザまたはOSは、低電力状態、非表示状態、設定などを理由に要求を拒否または解除できる。[MDN WakeLock](https://developer.mozilla.org/en-US/docs/Web/API/WakeLock)

### Android ChromeでHTTPを安全扱いする例外

- Secure Contexts仕様がHTTPでも自動的に信頼可能とするIPアドレスはループバック等に限られ、Tailscaleの `100.64.0.0/10` は含まれない。一方、利用者または管理者が信頼するよう構成したオリジンは信頼可能として扱える。[W3C Secure Contexts](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy)
- Chromiumは `chrome://flags/#unsafely-treat-insecure-origin-as-secure` を提供し、指定したHTTPオリジンを安全なオリジンとして扱えるとしている。[Chromium: Deprecating Powerful Features on Insecure Origins](https://www.chromium.org/Home/chromium-security/deprecating-powerful-features-on-insecure-origins/)
- 現行Chromiumソースではこのフラグが `kOsAll`、すなわちAndroidを含む全OS向けに登録されている。[Chromium `about_flags.cc`](https://chromium.googlesource.com/chromium/src/+/f8bcc03a10c028e06af163034cd099984e314c0f/chrome/browser/about_flags.cc)
- Androidでコマンドライン引数を直接与える方法はrootまたは開発モードを必要とする。一方、`chrome://flags` の画面から設定する方式は別の入口である。[Chromium: Deprecating Powerful Features on Insecure Origins](https://www.chromium.org/Home/chromium-security/deprecating-powerful-features-on-insecure-origins/)
- この設定はTLS暗号化や証明書を追加するものではない。Chromeの安全なコンテキスト制限を対象オリジンだけ上書きする。[Chromium policy definition](https://chromium.googlesource.com/chromium/src/+/HEAD/components/policy/resources/templates/policy_definitions/Miscellaneous/UnsafelyTreatInsecureOriginAsSecure.yaml)
- 管理対象端末では同等の `OverrideSecurityRestrictionsOnInsecureOrigin` Chrome Enterpriseポリシーも使えるが、個人所有Pixelの通常設定を置き換えるものではない。[Chrome Enterprise policy](https://chromeenterprise.google/policies/override-security-restrictions-on-insecure-origin/)

### Tailscale Serveによる実際のHTTPS化

- Tailscale Serveは `http://127.0.0.1:{port}` のローカルサービスを、tailnet内限定の `https://{device}.{tailnet}.ts.net` へリバースプロキシできる。HTTPS通信はTailscaleデーモンが終端し、証明書を自動取得する。[Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
- Serveの利用にはtailnetでHTTPS証明書を有効化する必要があり、未設定時はCLIが同意用Web画面を案内する。[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- `tailscale serve --bg {port}` の構成は再起動後も再開される。[Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
- MagicDNSは全プランで利用でき、端末へ名前を割り当てる。[Tailscale MagicDNS](https://tailscale.com/docs/features/magicdns)
- `tailscale cert` で証明書と秘密鍵を取り出してきゃすメイト自身にHTTPSを実装することもできるが、サーバーへの組込みと更新管理が必要になる。[Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli)

### 自己署名証明書

- 自己署名証明書は既定ではブラウザに信頼されず警告になる。通常のHTTPSとして利用するには端末が信頼するCAで署名された証明書が必要である。[web.dev: Use HTTPS for local development](https://web.dev/articles/how-to-use-local-https)
- Androidアプリは独自のNetwork Security ConfigurationでカスタムCAを信頼できるが、これは専用Androidアプリの設定であり、既存Chromeの信頼設定をきゃすメイトから変更する手段ではない。[Android Developers: Network security configuration](https://developer.android.com/privacy-and-security/security-config)

## 短期検証手順

1. PixelのChromeで `chrome://flags/#unsafely-treat-insecure-origin-as-secure` を開く。
2. きゃすメイトに表示されたURLからパスを除き、オリジンを入力する。例: `http://100.100.20.30:3000`
3. フラグをEnabledにしてChromeを再起動する。
4. スマホコメント画面を開き、開発者コンソール相当の確認または画面実装から `window.isSecureContext === true` と `"wakeLock" in navigator` を確認する。
5. スマホコメント画面の利用者操作から `navigator.wakeLock.request("screen")` を実行する。
6. 画面を別アプリへ切り替えて戻した場合は、表示状態へ戻った時点でロックを再取得する。

Tailscale IPv4またはポートが変わった場合、フラグへ登録したオリジンも更新する必要がある。

## 現行実装との関係

- 現行スマホ画面は `http://{tailscaleIPv4}:{port}/comments` を生成し、Wake Lock APIを呼び出していない。
- 現行スマホ公開サーバーは要求のHostを `{address}:{port}` に固定している。Tailscale ServeのFQDNをそのまま転送すると、この検証により拒否される。
- 現行WebSocket URLは `ws://` 固定である。HTTPS化する場合は `wss://` を選択する必要がある。
- 現行Tailscale公開サーバーはTailscale IPv4へ直接待ち受ける。Serveが公式にサポートするHTTPプロキシ先は `127.0.0.1` なので、正式なServe対応ではスマホ専用ループバック待受または同等の分離が必要である。[Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)

## 推奨

### 短期

Chromeフラグを利用者が設定する前提で、スマホコメント画面へ「画面を消灯しない」トグルを追加する。API非対応、非安全コンテキスト、OSによる解除を区別して案内し、音声開始とは独立した一時状態にする。

この方式はPixel実機検証用と位置付け、Chromeフラグを正式な配布要件にはしない。

### 正式対応

Tailscale Serveを正式採用し、スマホ専用ループバック待受だけをServeへ渡す。管理APIをServeへ渡さず、FQDNのHost検証、`wss://`、URL・QRコード、Serveの初回同意と状態検出を仕様化する。

### 非推奨

- 無音動画や極小動画をループ再生して画面消灯を妨げる方式は、Chromeの画面保持契約として公式に保証されていないため採用しない。
- 自己署名証明書だけを配布し、警告画面を突破させる方式は、信頼済みHTTPSと同じ挙動を保証できず、端末側の証明書管理も増えるため採用しない。
