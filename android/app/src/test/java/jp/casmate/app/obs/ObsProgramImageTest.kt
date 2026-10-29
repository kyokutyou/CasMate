package jp.casmate.app.obs

import android.graphics.Bitmap
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ObsProgramImageTest {
    private val id = "abcdefghijklmnopqrstuvwx"
    private fun jpeg(): ByteArray = ByteArrayOutputStream().apply {
        Bitmap.createBitmap(32, 18, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.BLACK) }
            .compress(Bitmap.CompressFormat.JPEG, 75, this)
    }.toByteArray()
    private fun metadata(bytes: ByteArray) = JSONObject().put("imageId", id).put("sceneName", "配信")
        .put("capturedAt", "2026-10-14T00:00:00.000Z").put("width", 32).put("height", 18)
        .put("byteLength", bytes.size).put("mimeType", "image/jpeg")
    private fun frame(bytes: ByteArray, offset: Int = 0, generation: Int = 7, imageId: String = id): ByteArray =
        ByteBuffer.allocate(36 + bytes.size).order(ByteOrder.BIG_ENDIAN).putInt(0x434d4931).putInt(generation).putInt(offset)
            .put(imageId.toByteArray(Charsets.US_ASCII)).put(bytes).array()

    @Test fun assemblesOnlyTheAnnouncedImageAndDecodesBlackJpegWithoutSaving() {
        val bytes = jpeg(); val receiver = ObsProgramImageReceiver(7)
        assertFalse(receiver.accept(frame(bytes)))
        receiver.begin(metadata(bytes))
        assertFalse(receiver.accept(frame(bytes.copyOfRange(0, 50), generation = 6)))
        assertFalse(receiver.accept(frame(bytes.copyOfRange(0, 50), imageId = "xxxxxxxxxxxxxxxxxxxxxxxx")))
        assertFalse(receiver.accept(frame(bytes.copyOfRange(0, 50))))
        assertTrue(receiver.accept(frame(bytes.copyOfRange(50, bytes.size), 50)))
        val image = receiver.decode()
        assertEquals("配信", image.sceneName); assertEquals(32, image.bitmap.width); assertEquals(18, image.bitmap.height)
        assertEquals(android.graphics.Color.BLACK, image.bitmap.getPixel(16, 9))
    }
    @Test fun rejectsMissingDuplicateOversizedAndInvalidFrames() {
        val bytes = jpeg()
        fun ready() = ObsProgramImageReceiver(7).apply { begin(metadata(bytes)) }
        assertThrows(IllegalArgumentException::class.java) { ready().accept(frame(bytes, 1)) }
        val duplicate = ready(); duplicate.accept(frame(bytes.copyOfRange(0, 50)))
        assertThrows(IllegalArgumentException::class.java) { duplicate.accept(frame(bytes.copyOfRange(0, 50))) }
        assertThrows(IllegalArgumentException::class.java) { ready().accept(frame(bytes + byteArrayOf(1))) }
        assertThrows(IllegalArgumentException::class.java) { ready().accept(ByteArray(16421)) }
        assertThrows(IllegalArgumentException::class.java) { ready().accept(frame(bytes).apply { this[0] = 0 }) }
        assertThrows(IllegalArgumentException::class.java) { ready().decode() }
    }
    @Test fun validatesMetadataAndDecodedDimensionsBeforeDisplaying() {
        val bytes = jpeg()
        for ((key, value) in listOf("byteLength" to 2097153, "width" to 1281, "height" to 18.5,
            "byteLength" to "100", "mimeType" to "image/png", "imageId" to "short", "capturedAt" to "bad")) {
            assertThrows(Exception::class.java) { ObsProgramImageReceiver(7).begin(metadata(bytes).put(key, value)) }
        }
        val wrong = ObsProgramImageReceiver(7).apply { begin(metadata(bytes).put("width", 33)); accept(frame(bytes)) }
        assertThrows(IllegalArgumentException::class.java) { wrong.decode() }
        val invalid = ObsProgramImageReceiver(7).apply { begin(metadata(bytes)); accept(frame(ByteArray(bytes.size))) }
        assertThrows(IllegalArgumentException::class.java) { invalid.decode() }
    }
}
