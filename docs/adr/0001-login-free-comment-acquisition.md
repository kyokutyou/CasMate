---
status: accepted
---

# ログイン不要のコメント取得を採用する

追記: [ADR 0013](./0013-adopt-ai-listener.md) で採用したAIリスナーの投稿用連携は別機能として扱う。本ADRのコメント取得方針は維持する。

v0.1.0では、配信者がAPIキーやOAuth認証を準備しなくても利用を開始できることを優先し、[unacast](https://github.com/pasta04/unacast)と同様に、公開されている配信・チャンネル・スレッドの識別情報からコメントを取得する方式を採用する。コードは流用せず、YouTube Live、Twitch、したらばを独立したコメントソースとして実装する。

## Considered Options

- YouTube Data APIおよびTwitch EventSubなどの公式APIだけを使用する方式
- ログイン不要方式と公式API方式を両方実装し、利用者が選択する方式
- ログイン不要方式だけを使用する方式

公式API方式は長期的な互換性を期待できる一方、アプリ登録、OAuth同意、資格情報の安全な保存が必要となり、v0.1.0の導入手順が大きくなる。両方式の同時提供は実装・テスト範囲が増えるため採用しない。

## Consequences

- 利用者はYouTubeのチャンネルIDまたはLive ID、Twitchのチャンネル名、したらばのスレッドURLだけで接続できる。
- YouTubeの公開ページまたは非公開内部インターフェース、Twitchの匿名IRC接続、したらばの公開取得形式に依存するため、予告のない外部仕様変更で取得不能になる可能性がある。
- 接続失敗を他のコメントソースから分離し、エラーの可視化、自動再接続、取得アダプター単位の交換可能性を必須とする。
- 将来公式APIへ移行する場合も、共通コメントおよび画面側の契約は変更せず、コメントソースの実装を置換できる構造とする。

参考: [YouTube Live Streaming API](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list)、[Twitch Chat認証](https://dev.twitch.tv/docs/chat/authenticating/)、[したらばヘルプ](https://rentalbbs.shitaraba.com/rule/help/)
