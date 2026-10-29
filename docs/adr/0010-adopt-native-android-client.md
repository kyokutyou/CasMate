---
status: accepted
---

# WebViewとネイティブ音声サービスを分離したAndroidクライアントを採用する

2026-10-04追記: [ADR 0020](./0020-adopt-smartphone-direct-connection.md)の直接接続では、PC鍵確認・用途別認証を伴うネイティブ通信がHTMLと全関連資産も取得する。WebView表示とネイティブ音声の分離、LAN／Tailscaleの既存HTTP・URL登録は維持する。

v0.4.0では、スマホコメント画面の表示中に画面消灯を防止し、画面ロック、他アプリ表示、または履歴画面からの除去後もスマホ音声再生を継続するため、専用のAndroidクライアントを採用する。

通常ブラウザは画面非表示時のWebSocket接続と音声再生を継続保証できない。Screen Wake Lock APIは安全なコンテキストを必要とし、現行のTailscale IPv4へのHTTP直接公開では正式要件を満たさない。Chromeの実験フラグはTLSを追加せず、端末ごとの手動設定と将来互換性に依存する。調査内容は [HTTP公開中のスマホ画面消灯防止方式調査](../research/mobile-screen-wake-lock-over-http-2026-08.md) を参照する。

AndroidのMedia3は、バックグラウンド再生を行うPlayerとMediaSessionを `MediaSessionService` に置く構成を提供する。[Android Developers: Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback)

## Considered Options

- Chromeの実験フラグとScreen Wake Lock APIを使用する
- Tailscale Serveでブラウザ画面をHTTPS化する
- コメント一覧と音声の両方をAndroidネイティブで作り直す
- コメント一覧はWebViewで再利用し、音声だけをAndroidネイティブサービスへ分離する

Chromeの実験フラグは短期検証には利用できるが、正式なHTTPS化ではなく、画面ロック中またはバックグラウンドの再生を解決しない。Tailscale Serveはブラウザの画面消灯防止には適するが、画面ロック中のWebSocketと音声再生を保証せず、現行のIPv4 Host検証、WebSocket URL、公開方式も変更する必要がある。

コメント一覧を最初からComposeで作り直す方式はAndroidだけで完結する一方、既存コメント画面との表示差異と二重保守が生じる。既存画面はスマホ向け読取専用面としてすでに分離されているため、表示だけをWebViewで再利用できる。

## Decision

- Android 10以降を対象とする専用Androidクライアントを、Windows版と同じリポジトリで管理する。
- Android画面はKotlinとJetpack Composeで構成し、コメント一覧だけを表示専用WebViewで再利用する。
- WebViewは音声を所有しない。音声のWebSocket購読、M4A取得、Media3再生、完了・失敗通知、再接続は `MediaSessionService` が所有する。
- Android画面の表示中はOSの画面消灯を抑止する。
- 音声待機中は `connectedDevice`、M4A再生中は `connectedDevice` と `mediaPlayback` のforeground service typeを使用し、利用者が明示停止できる通知を表示する。
- 画面ロック、他アプリ表示、履歴画面からの除去では開始希望を維持する。端末再起動、強制停止、明示停止では解除する。
- LANとTailscale IPv4への現行HTTP直接公開を再利用し、Tailscale Serve、TLS、追加認証、クラウド中継をAndroid採用の前提にしない。
- 署名済みAPKを対応するWindows版と同じリリースへ添付し、利用者が手動でインストールおよび更新する。

## Consequences

- ブラウザの安全なコンテキストや画面表示状態に依存せず、Androidが許可する前面サービスとして音声待機と再生を継続できる。
- コメント一覧の表示実装をPCブラウザ版と共有でき、Android固有の実装は接続登録、画面枠、音声、通知、ライフサイクルへ限定できる。
- WebViewとAndroid音声サービスは別接続になるため、WebView側の音声機能を無効化し、同一端末内で音声購読を競合させない必要がある。
- AndroidプロジェクトのためにGradle、Android SDK、Media3、Composeの開発環境と検証が追加されるが、Windows側の通常ビルドとは分離する。
- HTTP平文通信をAndroidで許可する必要があるため、接続先を既存のLANまたはTailscale IPv4へ制限し、別オリジンへの遷移とリダイレクトを拒否する必要がある。
- Androidと端末メーカーは前面サービスを強制停止できるため、全端末・全設定での無条件の存続は保証できない。通常の前面サービス、再接続、任意の省電力設定案内で実用上の継続を提供する。
- Google Play審査と自動更新は初版に含めず、署名鍵の安全な外部保管と手動APK更新が必要になる。

具体的なAndroid画面、サービス、通知、互換性、配布、テストは [Androidクライアント仕様](../features/android-mobile-client.md) を参照する。PC側の公開契約、M4A、キューは [スマホ音声再生仕様](../features/mobile-speech.md) を参照する。
