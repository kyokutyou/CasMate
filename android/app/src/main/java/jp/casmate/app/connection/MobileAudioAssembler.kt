package jp.casmate.app.connection

import org.json.JSONObject
import java.nio.ByteBuffer

internal class ReceivedAudio(val id: String, val bytes: ByteArray, val expiresAt: Long)

/** Pure framing boundary: never accepts bytes without matching generation, ID, size and offset. */
internal class MobileAudioAssembler(private val now: () -> Long) {
    private class Item(val audio: ReceivedAudio, var offset: Int = 0)
    private val items = linkedMapOf<String, Item>()
    fun clear() = items.clear()
    fun discard(id: String) { items.remove(id) }
    fun begin(payload: JSONObject): Boolean {
        val id = payload.optString("audioId")
        val length = integer(payload, "byteLength")
        val ttl = integer(payload, "expiresInMs")
        if (!id.matches(Regex("[A-Za-z0-9_-]{24}")) || length !in 1..8 * 1024 * 1024 || ttl !in 1..15000 || items.size >= 2 || items.containsKey(id)) return false
        items[id] = Item(ReceivedAudio(id, ByteArray(length.toInt()), now() + ttl))
        return true
    }
    private fun integer(payload: JSONObject, key: String): Long {
        val value = payload.opt(key) as? Number ?: return -1
        val numeric = value.toDouble()
        return if (numeric.isFinite() && numeric == value.toLong().toDouble()) value.toLong() else -1
    }
    fun receive(bytes: ByteArray, generation: Long, failed: (String) -> Unit): ReceivedAudio? {
        if (bytes.size !in 37..16420) return null
        val data = ByteBuffer.wrap(bytes)
        if (data.int != 0x434d4132 || (data.int.toLong() and 0xffffffffL) != generation) return null
        val offset = data.int
        val id = bytes.copyOfRange(12, 36).toString(Charsets.US_ASCII)
        val item = items[id] ?: return null
        if (offset != item.offset || offset + bytes.size - 36 > item.audio.bytes.size || item.audio.expiresAt <= now()) {
            items.remove(id); failed(id); return null
        }
        bytes.copyInto(item.audio.bytes, offset, 36); item.offset += bytes.size - 36
        return if (item.offset == item.audio.bytes.size) { items.remove(id); item.audio } else null
    }
}
