package jp.casmate.app.outdoor

import java.util.Locale

internal fun Number?.asBitrate(): String = this?.let { String.format(Locale.ROOT, "%.2f Mbps", it.toDouble() / 1_000_000) } ?: "未計測"
internal fun Number?.asMillis(): String = this?.let { String.format(Locale.ROOT, "%.1f ms", it.toDouble()) } ?: "未計測"
internal fun Long.asSeconds(): String = String.format(Locale.ROOT, "%.1f秒", this / 1000.0)

internal fun OutdoorAdaptationReason.label(): String = when (this) {
    OutdoorAdaptationReason.NOT_STARTED -> "未計測"
    OutdoorAdaptationReason.UNAVAILABLE -> "計測中断"
    OutdoorAdaptationReason.BASELINE -> "比較基準待ち"
    OutdoorAdaptationReason.REBASELINE -> "計測をやり直し中"
    OutdoorAdaptationReason.COUNTER_RESET -> "カウンター再基準化中"
    OutdoorAdaptationReason.AUDIO_DROPPED -> "音声フレームの破棄"
    OutdoorAdaptationReason.AUDIO_STALLED -> "音声送信の停滞"
    OutdoorAdaptationReason.QUEUE_CONGESTION -> "送信待ちの混雑候補"
    OutdoorAdaptationReason.NETWORK_PRESSURE -> "回線悪化候補"
    OutdoorAdaptationReason.STABLE -> "安定"
    OutdoorAdaptationReason.OBSERVING -> "観測中"
    OutdoorAdaptationReason.FIXED -> "固定ビットレート"
    OutdoorAdaptationReason.CONTROL_STOPPED -> "自動制御停止"
    OutdoorAdaptationReason.EXCESS_OUTPUT -> "映像量が目標を超過"
    OutdoorAdaptationReason.VIDEO_WRITE_STALLED -> "映像のローカル送出停滞"
}
