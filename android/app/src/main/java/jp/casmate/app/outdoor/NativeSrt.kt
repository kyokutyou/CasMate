package jp.casmate.app.outdoor

/** Narrow JNI boundary; handles are registry IDs, not pointers exposed to Kotlin. */
internal object NativeSrt {
    init { System.loadLibrary("casmate-srt") }
    external fun create(passphrase: String, latency: Int): Long
    external fun connect(handle: Long, address: String, port: Int, identity: String, direct: Boolean = false): Int
    external fun send(handle: Long, bytes: ByteArray): Int
    external fun stats(handle: Long): LongArray?
    external fun close(handle: Long)
}
