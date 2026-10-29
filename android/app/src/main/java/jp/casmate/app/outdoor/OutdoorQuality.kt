package jp.casmate.app.outdoor

import android.content.Context
import android.util.AtomicFile
import java.io.File
import jp.casmate.app.compatibility.CompatibilityPolicy
import jp.casmate.app.compatibility.CompatibilityReset
import android.annotation.SuppressLint
import org.json.JSONObject

enum class OutdoorVideoCodec(val mime: String, val label: String) {
    H264("video/avc", "H.264"), H265("video/hevc", "H.265（HEVC）")
}
enum class OutdoorBitrateMode(val label: String) { FIXED("固定"), AUTO("自動") }

data class OutdoorQuality(val width: Int = 1280, val height: Int = 720, val fps: Int = 30,
    val videoBitrate: Int = 2500000, val audioBitrate: Int = 64000, val latencyMs: Int = 400,
    val keyframeSeconds: Int = 2, val preset: String = "標準",
    val videoCodec: OutdoorVideoCodec = OutdoorVideoCodec.H264,
    val bitrateMode: OutdoorBitrateMode = OutdoorBitrateMode.FIXED,
    val autoMinBitrate: Int = 500000, val autoMaxBitrate: Int = 2500000,
    val audioFirst: Boolean = false) {
    init {
        require((width to height) in resolutions)
        require(fps in frameRates && videoBitrate in 500000..12000000 && videoBitrate % 100000 == 0)
        require(audioBitrate in audioRates && latencyMs in 200..3000 && latencyMs % 100 == 0)
        require(keyframeSeconds in keyframes)
        require(preset in setOf("通信量優先", "標準", "画質優先", "動き優先", "カスタム"))
        require(autoMinBitrate in 500000..12000000 && autoMinBitrate % 100000 == 0)
        require(autoMaxBitrate in autoMinBitrate..12000000 && autoMaxBitrate % 100000 == 0)
        require(!audioFirst || bitrateMode == OutdoorBitrateMode.AUTO)
    }
    val initialBitrate get() = if (bitrateMode == OutdoorBitrateMode.AUTO) autoMinBitrate else videoBitrate
    fun withMode(mode: OutdoorBitrateMode) = copy(bitrateMode = mode, audioFirst = audioFirst && mode == OutdoorBitrateMode.AUTO)
    fun custom() = copy(preset = "カスタム")
    fun applyPreset(value: OutdoorQuality) = value.copy(videoCodec = videoCodec, bitrateMode = bitrateMode,
        audioFirst = audioFirst, autoMinBitrate = minOf(autoMinBitrate, value.videoBitrate), autoMaxBitrate = value.videoBitrate)
    fun json(): String = JSONObject().put("version", CompatibilityPolicy.ANDROID_OUTDOOR_QUALITY).put("width", width).put("height", height).put("fps", fps)
        .put("videoBitrate", videoBitrate).put("audioBitrate", audioBitrate).put("latencyMs", latencyMs)
        .put("keyframeSeconds", keyframeSeconds).put("preset", preset).put("videoCodec", videoCodec.name)
        .put("bitrateMode", bitrateMode.name).put("autoMinBitrate", autoMinBitrate)
        .put("autoMaxBitrate", autoMaxBitrate).put("audioFirst", audioFirst).toString()
    companion object {
        val resolutions = listOf(640 to 360, 854 to 480, 1280 to 720, 1920 to 1080)
        val frameRates = listOf(15, 24, 30, 60)
        val audioRates = listOf(32000, 64000, 96000, 128000, 192000)
        val keyframes = listOf(1, 2, 4)
        fun presets() = listOf(
            OutdoorQuality(854, 480, videoBitrate = 1000000, preset = "通信量優先"), OutdoorQuality(),
            OutdoorQuality(1920, 1080, videoBitrate = 6000000, audioBitrate = 128000, preset = "画質優先"),
            OutdoorQuality(fps = 60, videoBitrate = 5000000, audioBitrate = 96000, preset = "動き優先"))
        internal val fields = setOf("width", "height", "fps", "videoBitrate", "audioBitrate", "latencyMs", "keyframeSeconds", "preset",
            "videoCodec", "bitrateMode", "autoMinBitrate", "autoMaxBitrate", "audioFirst")
        fun parse(text: String): OutdoorQuality {
            val j = JSONObject(text)
            require(j.keys().asSequence().toSet() == fields + "version" && j.get("version") is Number &&
                j.getDouble("version") == CompatibilityPolicy.ANDROID_OUTDOOR_QUALITY.toDouble())
            return parseComplete(j)
        }
        internal fun parseComplete(j: JSONObject): OutdoorQuality {
            val numbers = fields - setOf("preset", "videoCodec", "bitrateMode", "audioFirst")
            for (key in numbers) require(j.get(key) is Number && j.getDouble(key) == j.getInt(key).toDouble())
            return OutdoorQuality(j.getInt("width"), j.getInt("height"), j.getInt("fps"), j.getInt("videoBitrate"),
                j.getInt("audioBitrate"), j.getInt("latencyMs"), j.getInt("keyframeSeconds"), j.get("preset") as String,
                OutdoorVideoCodec.valueOf(j.get("videoCodec") as String), OutdoorBitrateMode.valueOf(j.get("bitrateMode") as String),
                j.getInt("autoMinBitrate"), j.getInt("autoMaxBitrate"), j.get("audioFirst") as Boolean)
        }
        internal fun recognizeRetired(j: JSONObject) {
            val keys = j.keys().asSequence().toSet(); val base = fields - setOf("videoCodec", "bitrateMode", "autoMinBitrate", "autoMaxBitrate", "audioFirst")
            require(keys.containsAll(base) && keys.all { it in fields } && keys != fields)
            // Validate the old shape without carrying its values into the new quality settings.
            val validation = JSONObject(j.toString())
            for ((key, value) in mapOf("videoCodec" to "H264", "bitrateMode" to "FIXED", "autoMinBitrate" to 500000,
                "autoMaxBitrate" to j.getInt("videoBitrate"), "audioFirst" to false)) if (!validation.has(key)) validation.put(key, value)
            parseComplete(validation)
        }

    }
}

/** Non-secret device settings, independent of the protected QR registration. */
@SuppressLint("UseKtx") // Check commit's Boolean result; KTX edit discards persistence failures.
class OutdoorPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("outdoor_controls", Context.MODE_PRIVATE)
    private val reset = CompatibilityReset(AtomicFile(File(context.noBackupFilesDir, "outdoor-quality.json")),
        { prefs.getString("quality", null)?.toByteArray(Charsets.UTF_8) }, { bytes -> commitQuality(String(bytes, Charsets.UTF_8)) })
    var resetNotice: String? = null
        private set
    fun quality(): OutdoorQuality = synchronized(lock) {
        resetNotice = reset.notice()
        val text = prefs.getString("quality", null) ?: return@synchronized OutdoorQuality()
        val root = JSONObject(text)
        if (root.has("version")) return@synchronized OutdoorQuality.parse(text)
        val complete = root.keys().asSequence().toSet() == OutdoorQuality.fields
        val value = if (complete && CompatibilityPolicy.IMPORT_COMPLETE_UNVERSIONED_QUALITY) OutdoorQuality.parseComplete(root) else {
            OutdoorQuality.recognizeRetired(root); OutdoorQuality()
        }
        resetNotice = reset.replace(text.toByteArray(Charsets.UTF_8), value.json().toByteArray(Charsets.UTF_8),
            if (complete) "送信品質を現行形式へ保存しました。品質の値は引き継いでいます。" else "旧送信品質を退避して初期値へ戻しました。品質を確認してください。")
        value
    }
    private fun commitQuality(text: String) {
        val previous = prefs.getString("quality", null)
        if (!prefs.edit().putString("quality", text).commit() || prefs.getString("quality", null) != text) {
            check(prefs.edit().putString("quality", previous).commit()) { "元の送信品質を復元できません。" }
            error("送信品質を保存できません")
        }
    }
    fun saveQuality(quality: OutdoorQuality) = synchronized(lock) {
        check(!OutdoorRuntime.state.value.active) { "変更するには配信を終了してください" }
        val previous = prefs.getString("quality", null)
        val failedReset = runCatching { reset.notice() }.isFailure
        if (!failedReset && (previous == null || runCatching { OutdoorQuality.parse(previous) }.isSuccess)) commitQuality(quality.json())
        else resetNotice = reset.replace(previous?.toByteArray(Charsets.UTF_8) ?: byteArrayOf(), quality.json().toByteArray(Charsets.UTF_8), "送信品質を保存しました。元の設定は退避しました。")
    }
    fun volume() = synchronized(lock) { prefs.getInt("volume", 100).also { require(it in 0..200) } }
    fun saveVolume(value: Int) = synchronized(lock) {
        require(value in 0..200)
        check(prefs.edit().putInt("volume", value).commit()) { "音量を保存できません" }
    }
    companion object { private val lock = Any() }
}
