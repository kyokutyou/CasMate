---
status: accepted
---

# PCに集約した認証付きOBS操作と共用QRを採用する

2026-10-04追記: 外部利用へ[ADR 0020](./0020-adopt-smartphone-direct-connection.md)の直接接続専用WSSを追加する。PCのループバックOBS接続、用途別認証・確認・失効と操作の非再送は維持し、OBS本体や一般管理面の公開は認めない。

## Context

v0.4.0で音声認識とAndroidからOBS配信を開始・終了する。音声操作は検証後に無効化できる必要がある。Androidは既存の外配信用QRを利用して登録の手間を増やさず、LANでも操作する。

## Considered Options

- AndroidへOBSパスワードを渡して直接操作する。
- 認証なしのコメント公開面へ操作を追加する。
- PCへOBS接続を集約し、専用の認証付き操作経路を設ける。

## Decision

PCがobs-websocket v5へ接続し、音声とAndroidの要求を共通の確認・実行処理で扱う。Androidは限定された操作権限だけを持ち、OBSパスワードを受け取らない。音声操作はAndroidと独立して無効化できる。

外配信用QRの新形式へOBS操作登録を含める。映像用と操作用の資格情報は別にし、一方の失効が他方へ波及しないようにする。OBS操作単独の登録も同じ入口で扱う。

ADR 0003・0009の読取専用公開契約は維持する。ADR 0011のOBS操作を導入しない判断を開始・終了に限って変更し、直接SRT送信と状態報告の独立性は維持する。

## Consequences

- 認証、確認待ち、重複抑止、結果不明の処理が必要になる。
- LANのHTTP認証は暗号化ではなく、信頼できるLANを前提とする。外部利用はTailscaleを使用する。
- 接続は再試行しても操作は再送せず、現在状態を再取得する。映像表示や配信サイトでの公開成功は保証しない。
- 詳細は [OBS操作仕様](../features/obs-control.md)、QR形式は [Android外配信仕様](../features/outdoor-streaming.md) が所有する。

## References

- [OBS公式Remote Control Guide](https://obsproject.com/kb/remote-control-guide)
- [obs-websocket公式プロトコル](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md)

## 2026-09-17 統一登録の追加判断

外配信で映像・音声・OBS操作・コメントを同時に使う利用が中心のため、接続登録を版4 QRにまとめる。資格情報と実行系統は独立したままとし、登録による撮影・配信・読み上げの自動開始はしない。

Androidの接続先を複数ファイルへ順に書いてロールバックする方式では、途中の保存失敗でPCの組み合わせが分かれるため、一つのKeystore暗号化・AtomicFileへまとめて置換する。旧保存を移行前に消さず、新保存が存在すれば旧保存へ暗黙に戻らない。品質・音量・読み上げ開始希望は別の設定として保持する。詳細は[統一登録契約](../features/outdoor-streaming.md#統一登録qr版4)が所有する。
