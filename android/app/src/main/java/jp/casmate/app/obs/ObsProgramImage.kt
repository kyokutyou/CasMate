package jp.casmate.app.obs

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.time.Instant

internal data class ObsProgramImage(val bitmap: Bitmap, val sceneName: String, val capturedAt: String)

/** One bounded image on one authenticated socket; metadata must precede every byte. */
internal class ObsProgramImageReceiver(private val generation: Long) {
    private var metadata: JSONObject? = null
    private var bytes: ByteArray? = null
    private var offset = 0
    fun acknowledgement(): JSONObject? = metadata?.let { JSONObject().put("imageId", it.getString("imageId")).put("offset", offset) }

    fun begin(value: JSONObject) {
        require(metadata == null)
        val length = integer(value, "byteLength", 4, 2 * 1024 * 1024)
        integer(value, "width", 8, 1280); integer(value, "height", 8, 1280)
        require(value.optString("mimeType") == "image/jpeg")
        require(value.optString("imageId").matches(Regex("[A-Za-z0-9_-]{24}")))
        require(value.opt("sceneName") is String && value.getString("sceneName").length in 1..1024)
        require(value.opt("capturedAt") is String && value.getString("capturedAt").length <= 64)
        Instant.parse(value.getString("capturedAt"))
        metadata = value; bytes = ByteArray(length)
    }

    fun accept(frame: ByteArray): Boolean {
        val meta = metadata ?: return false
        require(frame.size in 37..16420)
        val header = ByteBuffer.wrap(frame).order(ByteOrder.BIG_ENDIAN)
        require(header.int == 0x434d4931)
        val receivedGeneration = header.int.toLong() and 0xffffffffL
        val receivedOffset = header.int.toLong() and 0xffffffffL
        val id = String(frame, 12, 24, Charsets.US_ASCII)
        if (receivedGeneration != generation || id != meta.getString("imageId")) return false
        val target = requireNotNull(bytes)
        val size = frame.size - 36
        require(receivedOffset == offset.toLong() && size <= target.size - offset)
        frame.copyInto(target, offset, 36)
        offset += size
        return offset == target.size
    }

    fun decode(): ObsProgramImage {
        val meta = requireNotNull(metadata); val data = requireNotNull(bytes)
        require(offset == data.size && data[0] == 0xff.toByte() && data[1] == 0xd8.toByte() &&
            data[data.lastIndex - 1] == 0xff.toByte() && data.last() == 0xd9.toByte())
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        require(bounds.outMimeType == "image/jpeg" && bounds.outWidth == meta.getInt("width") && bounds.outHeight == meta.getInt("height"))
        val bitmap = requireNotNull(BitmapFactory.decodeByteArray(data, 0, data.size))
        return ObsProgramImage(bitmap, meta.getString("sceneName"), meta.getString("capturedAt"))
    }

    private fun integer(value: JSONObject, key: String, min: Int, max: Int): Int {
        val number = value.opt(key)
        require(number is Number && number.toDouble().isFinite() && number.toDouble() == number.toInt().toDouble() && number.toInt() in min..max)
        return number.toInt()
    }
}
