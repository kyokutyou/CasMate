package jp.casmate.app.obs

import java.io.IOException
import javax.net.ssl.SSLException

internal fun directEnrollmentConnectionFailure(error: IOException, usingWifi: Boolean): EnrollmentFailure {
    if (error is SSLException) return EnrollmentFailure(
        "QRは読み取れましたが、PCの本人確認に失敗しました。PCの日時を確認し、PCで共通QRを開き直して読み取ってください。"
    )
    val stoppedAt = "QRは読み取れましたが、PCに接続できませんでした。"
    val wifiHelp = if (usingWifi)
        "\n自宅のWi-Fiでは、直接接続できない場合があります。携帯回線か、携帯回線を使ったテザリングで試してください。"
    else ""
    return EnrollmentFailure(stoppedAt + wifiHelp +
        "\nPC版の起動・「直接接続」ONも確認してください。")
}
