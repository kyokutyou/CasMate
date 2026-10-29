---
status: accepted
2026-10-03追記: 通信エンジン・受信構成・登録応答版・PCでの受信停止は[ADR 0018](./0018-native-srt-and-local-receiver.md)で更新する。その他の判断は維持する。

---

# Android外配信でSRTによるOBS直接受信を採用する

## Context

v0.4.0でスマホ1台の映像・配信マイクとコメント・読み上げを統合する。配信者はTailscaleを導入済みで、OBSはきゃすメイトPCと同じWindowsで稼働する。OBSへ直接送信すればPCアプリへの映像中継と再エンコードを追加せずに済む。

## Considered Options

- 外部のVDO.Ninja Androidアプリを併用する。
- AndroidからSRTでOBSへ直接送る。
- きゃすメイトPCを映像中継にする。
- RIST、WebRTC、独自プロトコルを採用する。

OBSはSRTのメディアソース受信を案内している。[OBS公式SRTガイド](https://obsproject.com/kb/srt-protocol-streaming-guide)。既存のTailscale接続を使用することで公開受信ポートを前提にしない構成にできる。[Tailscale端末間接続](https://tailscale.com/docs/how-to/connect-to-devices)。比較材料は [転送方式調査](../research/mobile-to-obs-protocol-alternatives.md) を参照する。調査メモは正式仕様ではない。

## Decision

- SRTを映像経路として採用し、Androidが送信、OBSが受信を所有する。
- PCアプリはQRによる設定提供とAndroidからの状態受付を所有する。映像中継は導入しない。OBS自動操作を導入しない当初の判断は、[ADR 0012](./0012-adopt-authenticated-obs-control.md) により配信開始・終了だけ変更する。
- 映像、状態報告、コメント・読み上げを独立した通信責務とする。
- 既存の読取専用公開面とは別に、外配信状態に限定した認証付き待受を設ける。ADR 0003・0009のコメント用公開契約へ秘密情報や管理操作を追加しない。
- Android映像送信のライフサイクルは既存のAndroid音声サービスと分離する。ADR 0010のコメント表示・読み上げの責任分離を維持する。

## Consequences

- Androidにはカメラ・マイク・エンコード・SRT送信の実装と実機検証が必要になる。
- PC状態報告が途絶しても映像を継続できる一方、OBSで実際に表示されているかをアプリだけで保証しない。
- 固定受信設定は繰り返し使用できるが、資格情報やアドレス変更時にはOBS設定とAndroid登録の更新を要する。
- 実装に用いるSRTライブラリは配布可能性とライセンスを確認し、版を固定して第三者通知へ記録する。方式採用は特定ライブラリの無条件採用を意味しない。

具体的な設定、通信契約、状態と試験は [Android外配信仕様](../features/outdoor-streaming.md) が所有する。

2026-09-22の[ADR 0015](./0015-adopt-audio-first-outdoor-adaptation.md)で、直接SRT構成を維持した音声優先の適応と送信品質拡張を採用した。
