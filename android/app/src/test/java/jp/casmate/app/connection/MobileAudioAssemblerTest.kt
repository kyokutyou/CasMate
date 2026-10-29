package jp.casmate.app.connection

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer

class MobileAudioAssemblerTest {
    private val id = "a".repeat(24)
    private fun header(length: Int = 4, ttl: Int = 15000) = JSONObject().put("audioId", id).put("byteLength", length).put("expiresInMs", ttl)
    private fun chunk(generation: Int, offset: Int, bytes: ByteArray) = ByteBuffer.allocate(36 + bytes.size)
        .putInt(0x434d4132).putInt(generation).putInt(offset).put(id.toByteArray()).put(bytes).array()

    @Test fun assemblesOnlyTheCurrentGenerationInOrderWithoutAcceptingGapsOrExpiredBytes() {
        var now = 0L; val assembler = MobileAudioAssembler { now }; val failed = mutableListOf<String>()
        assertTrue(assembler.begin(header()))
        assertNull(assembler.receive(chunk(1, 0, byteArrayOf(1, 2)), 2, failed::add))
        assertNull(assembler.receive(chunk(2, 0, byteArrayOf(1, 2)), 2, failed::add))
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), assembler.receive(chunk(2, 2, byteArrayOf(3, 4)), 2, failed::add)!!.bytes)
        assertTrue(assembler.begin(header()))
        assertNull(assembler.receive(chunk(2, 2, byteArrayOf(3, 4)), 2, failed::add)); assertEquals(listOf(id), failed)
        assertTrue(assembler.begin(header())); now = 15001
        assertNull(assembler.receive(chunk(2, 0, byteArrayOf(1)), 2, failed::add)); assertEquals(2, failed.size)
    }
    @Test fun boundsMemoryAndReleasesDiscardedOrDisconnectedAudio() {
        val assembler = MobileAudioAssembler { 0 }
        assertFalse(assembler.begin(header(8 * 1024 * 1024 + 1)))
        assertFalse(assembler.begin(header(1, 0)))
        assertFalse(assembler.begin(header().put("byteLength", "4")))
        assertFalse(assembler.begin(header().put("byteLength", 4.5)))
        assertFalse(assembler.begin(header().put("expiresInMs", 0.5)))
        assertTrue(assembler.begin(header()))
        assertFalse(assembler.begin(header()))
        assertTrue(assembler.begin(header().put("audioId", "b".repeat(24))))
        assertFalse(assembler.begin(header().put("audioId", "c".repeat(24))))
        assembler.discard(id); assertTrue(assembler.begin(header()))
        assembler.clear(); assertNull(assembler.receive(chunk(1, 0, byteArrayOf(1)), 1) { fail() })
    }
}
