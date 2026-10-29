# きゃすメイト Android

Androidクライアントは、PC版とは独立したGradleプロジェクトです。最低対応OSはAndroid 10（API 29）です。

## 開発ビルド

1. JDK 21とAndroid SDK Platform 37、NDK 28.2.13676358、CMake 3.22.1、Node.jsを用意する。Java/Kotlinの生成コード対象は17を維持する。
2. ネイティブSRTの固定依存はビルド時に取得・SHA-256検証する（詳細は [`native/outdoor/README.md`](../native/outdoor/README.md)）。必要に応じて `local.properties` の `sdk.dir` を自分のAndroid SDKへ向ける。
3. このディレクトリで次を実行する。

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

生成される `app/build/outputs/apk/debug/app-debug.apk` は開発確認用です。配布用APKには別途署名が必要です。署名鍵や `local.properties` はリポジトリへ含めないでください。

利用方法と対応環境は[きゃすメイトのREADME](../README.md)を参照してください。
